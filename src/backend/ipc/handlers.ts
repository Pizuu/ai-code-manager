/**
 * IPC invoke 通道注册。每个通道一个 handler，类型来自 contracts/ipc.ts 的 IpcInvokeMap；
 * handlers 对象的映射类型保证契约中的每个通道都被实现（漏一个即编译失败）。
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AgentCliCheck, AgentCliDetection, AgentEvent, AgentRef, ApprovalRequest, BoardSnapshot, GitSnapshot, IpcInvokeChannel, IpcInvokeMap, ProjectInfo, Session, TerminalInfo } from '../../../contracts/ipc.ts';
import { AcpProcessManager, prepareAcpTurn, runAcpCliTurn, type PreparedAcpTurn } from '../agent-cli/acp-runner.ts';
import { runCliTurn, type CliRuntimeConfig } from '../agent-cli/cli-runner.ts';
import { detectInstalledClis, probeCliVersion } from '../agent-cli/detect.ts';
import { expandTemplate } from '../agent-cli/invocation.ts';
import { listOpencodeModels } from '../agent-cli/models.ts';
import { opencodeLaunchEnv } from '../agent-cli/platform-env.ts';
import { installHint } from '../agent-cli/presets.ts';
import { OpencodeServeManager, prepareServeTurn, runServeCliTurn, type PreparedServeTurn } from '../agent-cli/serve-runner.ts';
import { defaultResolveDeps, resolveExecutable, type ResolveDeps } from '../agent-cli/resolve.ts';
import { runAgentTurn } from '../agent/agent-loop.ts';
import { createAnthropicProvider } from '../agent/providers/anthropic.ts';
import { createOpenAIProvider } from '../agent/providers/openai.ts';
import type { Provider, ProviderConfig } from '../agent/providers/types.ts';
import { buildSystemPrompt } from '../agent/system-prompt.ts';
import type { AppState } from '../app-state.ts';
import { importFiles } from '../fs/file-import.ts';
import { listTree } from '../fs/file-tree.ts';
import { readFileForView } from '../fs/file-view.ts';
import { reaskCutIndex } from '../sessions/reask.ts';
import { summarizeSession, type SessionStore } from '../sessions/session-store.ts';
import { builtinConfigProblem, findCliRebindCandidate, type SettingsStore } from '../settings/settings-store.ts';
import { loadSpecTasks } from '../specs/tasks-parser.ts';
import { interactiveArgs, shellCommand, TerminalManager, type TerminalHandle } from '../terminal/terminal-manager.ts';
import { buildBoard, listFeatures, readAgentsConfig } from '../workspace/board.ts';
import { emptyGitSnapshot, readGitSnapshot } from '../workspace/git-overview.ts';
import { createGitRunner } from '../workspace/git.ts';
import {
  asAgentRef,
  asBranchName,
  asCliId,
  asFeatureSelection,
  asRelDir,
  asRelPath,
  asSessionId,
  asSessionModelInput,
  asStringArray,
  asTerminalCloseRequest,
  asTerminalInputRequest,
  asTerminalOpenRequest,
  ipcError,
  validateAgentCliInput,
  validateApprovalDecision,
  validateSendRequest,
  validateSettingsUpdate,
} from './validate.ts';

type HandlerMap = {
  [C in IpcInvokeChannel]: (...args: unknown[]) => Promise<IpcInvokeMap[C]['result']>;
};

export interface HandlerDeps {
  settings: SettingsStore;
  sessions: SessionStore;
  state: AppState;
  emit(event: AgentEvent): void;
  /** 打开系统目录选择框，返回绝对路径或 null。 */
  pickDirectory(): Promise<string | null>;
  /** v1.12：打开系统文件选择框（多选），返回选中的文件绝对路径数组，取消返回空数组；缺省（测试 / Web）为 undefined，handler 按空数组处理。 */
  pickFiles?: () => Promise<string[]>;
  /** 在系统文件管理器中打开目录（main.ts 注入 Electron shell.openPath）；缺省为 no-op。 */
  openPath?: (path: string) => Promise<void>;
  platform: NodeJS.Platform;
  providerFactory?: (id: 'openai' | 'anthropic', config: ProviderConfig) => Provider;
  /** v1.1：可注入的可执行文件解析依赖、git 可执行文件与 CLI 子进程基础环境（测试用）。 */
  resolveDeps?: ResolveDeps;
  gitBin?: string;
  cliBaseEnv?: NodeJS.ProcessEnv;
  /**
   * T127（实验）：opencode serve 常驻进程池；main.ts 传入并在退出时 closeAll()。缺省时内部新建。
   * 模式由 settings.getOpencodeMode(modeEnv) 决定（AICM_OPENCODE_MODE 优先，默认 acp）。
   */
  serveManager?: OpencodeServeManager;
  /**
   * opencode ACP 进程池；main.ts 传入并在退出时 closeAll()。缺省时内部新建。
   * 模式为 acp（默认）时 opencode 会话先走 ACP，启动失败回退既有 serve / run 逻辑。
   */
  acpManager?: AcpProcessManager;
  /**
   * v1.6：任务会话「终端模式」的终端进程池；main.ts 传入并在退出时 closeAll()。缺省时内部新建。
   */
  terminalManager?: TerminalManager;
  /** 读取 AICM_OPENCODE_MODE 的环境（默认 process.env；测试注入）。 */
  modeEnv?: NodeJS.ProcessEnv;
}

/** 解析会话实际使用的 agent。 */
export function effectiveAgent(session: Session, defaultAgent: AgentRef): AgentRef {
  return session.agent ?? defaultAgent ?? 'builtin';
}

/**
 * v1.5：会话级 CLI 模型覆盖的叠加（纯函数）。session.cliModel 非空时覆盖 CLI 配置的 model，
 * 否则原样返回。startCliTurn 是三条路径（ACP / serve / run）取 runtime 配置的唯一汇合点，
 * 在那里叠加一次即全路生效：ACP 读 config.model 发 session/set_model、serve 以
 * parseServeModel(config.model) 建会话、run 以 config.model 展开 modelArgs。
 */
export function effectiveCliRuntime(runtime: CliRuntimeConfig, session: Session): CliRuntimeConfig {
  const override = session.cliModel?.trim();
  return override ? { ...runtime, model: override } : runtime;
}

const VERSION_TIMEOUT_MS = 15_000;

function runVersion(file: string, env: NodeJS.ProcessEnv, cwd: string): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(file, ['--version'], { timeout: VERSION_TIMEOUT_MS, windowsHide: true, env, cwd, encoding: 'utf8', maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: String(stdout || stderr || (err ? err.message : '')).trim().slice(0, 300) });
    });
  });
}

function defaultProviderFactory(id: 'openai' | 'anthropic', config: ProviderConfig): Provider {
  return id === 'anthropic' ? createAnthropicProvider(config) : createOpenAIProvider(config);
}

async function readAgentsMd(root: string | null): Promise<string | null> {
  if (!root) return null;
  try {
    return await fs.readFile(path.join(root, 'AGENTS.md'), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

function requireProject(state: AppState): ProjectInfo {
  if (!state.project) throw ipcError('E_NO_PROJECT', '请先打开项目文件夹。');
  return state.project;
}

/** 项目未打开时的看板快照（board:get / board:setFeature 共用同一口径：不抛错，返回不可用快照）。 */
function noProjectBoard(now: string): BoardSnapshot {
  return {
    available: false, reason: '请先打开项目文件夹。', generatedAt: now, integrationBranch: 'dev', mainBranch: 'main',
    integrationRef: 'dev', integrationRefRemote: false, integrationMissing: null,
    maxParallel: null, lanes: [], shared: [], feature: null, features: [], cards: [], contractVersion: null, boardFile: null, conflicts: [],
  };
}

/** 去掉内部错误码以外的细节，保证不会把 Key 等敏感值带到界面。 */
function publicErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.length > 1000 ? `${msg.slice(0, 1000)}…` : msg;
}

export function createHandlers(deps: HandlerDeps): HandlerMap {
  const { settings, sessions, state, emit } = deps;
  const makeProvider = deps.providerFactory ?? defaultProviderFactory;

  const serveManager = deps.serveManager ?? new OpencodeServeManager({ platform: deps.platform });
  const acpManager = deps.acpManager ?? new AcpProcessManager({ platform: deps.platform });
  // v1.6：终端模式。输出与退出统一走 agent:event（契约 v1.6 的 terminal-data / terminal-exit）。
  const terminalManager = deps.terminalManager ?? new TerminalManager({
    platform: deps.platform,
    onData: (sessionId, terminalId, data) => emit({ type: 'terminal-data', sessionId, terminalId, data }),
    onExit: (sessionId, terminalId, code) => emit({ type: 'terminal-exit', sessionId, terminalId, code }),
  });
  const resolveDeps = () => deps.resolveDeps ?? defaultResolveDeps(deps.platform);
  let gitCache: { root: string; at: number; snap: GitSnapshot } | null = null;
  const gitSnapshot = async (root: string): Promise<GitSnapshot> => {
    if (gitCache && gitCache.root === root && Date.now() - gitCache.at < 3000) return gitCache.snap;
    const cfg = await readAgentsConfig(root);
    const snap = await readGitSnapshot(createGitRunner(root, deps.gitBin), root, cfg, new Date().toISOString(), (dir) => createGitRunner(dir, deps.gitBin));
    gitCache = { root, at: Date.now(), snap };
    return snap;
  };

  const resolveCli = async (id: string) => {
    const meta = settings.getAgentCliCommand(id);
    const runtime = settings.getAgentCliRuntime(id);
    if (!meta || !runtime) throw ipcError('E_CLI', `Agent CLI ${id} 不存在，请在设置中重新选择。`);
    const r = await resolveExecutable(meta.command, resolveDeps());
    if (!r.ok) throw ipcError('E_CLI', `${meta.name} 不可用：${r.reason}\n${installHint(meta.command, meta.preset, deps.platform)}`);
    return { runtime, executable: r.path, meta };
  };

  /**
   * v1.11「重新提问不重复」：reaskLatest 且会话最后一条 user 消息与本次文本完全一致时，
   * 把消息从那条 user 起整体截断并落盘（运行器随后重新追加该问题，最终只保留最新一轮）。
   * 调用点必须在「本回合确认能启动」的全部守卫之后、运行器追加之前。CLI 会话的
   * cliSessions 续接映射保留不动：外部 CLI 侧仍记得旧问答，分歧只限被截掉的这一轮，
   * 是可接受的重试形态（与 sessions:clear 的整表清空不同，这里不删映射）。
   */
  const applyReaskTruncation = async (session: Session, text: string): Promise<void> => {
    const cut = reaskCutIndex(session.messages, text);
    if (cut < 0) return;
    session.messages = session.messages.slice(0, cut);
    await sessions.save(session);
  };

  const startCliTurn = async (session: Session, cliId: string, text: string, opts?: { reaskLatest?: boolean }): Promise<void> => {
    const root = state.project?.root;
    if (!root) throw ipcError('E_NO_PROJECT', '外部 Agent CLI 只能在打开的项目中运行（工作目录 = 项目根），请先打开项目文件夹。');
    const { runtime: baseRuntime, executable } = await resolveCli(cliId);
    // v1.5：会话级模型覆盖在此一处叠加，turnDeps.config 供 ACP / serve / run 三路共用
    const runtime = effectiveCliRuntime(baseRuntime, session);
    if (state.running.has(session.id)) throw ipcError('E_BUSY', '该会话正在运行，请等待完成或先停止。');
    // 守卫（项目根 / CLI 可用 / 未运行）已全部通过，本回合确认能启动，此刻截断安全。
    if (opts?.reaskLatest) await applyReaskTruncation(session, text);
    const controller = new AbortController();
    state.running.set(session.id, controller);
    emit({ type: 'status', sessionId: session.id, running: true });
    const turnDeps = {
      config: runtime,
      executable,
      projectRoot: root,
      mode: settings.getActive().permissionMode,
      platform: deps.platform,
      signal: controller.signal,
      emit,
      requestApproval: (req: ApprovalRequest) => {
        emit({ type: 'approval-request', sessionId: session.id, approval: req });
        return state.approvals.request(req);
      },
      persist: (s: Session) => sessions.save(s),
      newId: () => crypto.randomUUID(),
      now: () => new Date().toISOString(),
      ...(deps.cliBaseEnv ? { baseEnv: deps.cliBaseEnv } : {}),
    };
    const opencodeMode = settings.getOpencodeMode(deps.modeEnv ?? process.env);
    const useAcp = runtime.outputFormat === 'opencode-json' && opencodeMode === 'acp';
    const useServe = runtime.outputFormat === 'opencode-json' && opencodeMode === 'serve';
    const run = async () => {
      if (useAcp) {
        let prepared: PreparedAcpTurn | null = null;
        try {
          prepared = await prepareAcpTurn(session, { ...turnDeps, manager: acpManager });
        } catch (err) {
          // 回退：此时尚未写入任何消息，改走既有 serve / run 逻辑
          emit({ type: 'error', sessionId: session.id, message: `opencode ACP 接入启动失败，已回退：${publicErrorMessage(err)}` });
        }
        if (prepared) return runAcpCliTurn(session, text, prepared, { ...turnDeps, manager: acpManager });
        if (controller.signal.aborted) return;
      }
      if (useServe) {
        let prepared: PreparedServeTurn | null = null;
        try {
          prepared = await prepareServeTurn(session, { ...turnDeps, manager: serveManager });
        } catch (err) {
          // 回退：此时尚未写入任何消息，改走默认的 run 模式（每轮批准）
          emit({ type: 'error', sessionId: session.id, message: `opencode serve 模式（实验）启动失败，已回退到 run 模式：${publicErrorMessage(err)}` });
        }
        if (prepared) return runServeCliTurn(session, text, prepared, { ...turnDeps, manager: serveManager });
        if (controller.signal.aborted) return;
      }
      return runCliTurn(session, text, turnDeps);
    };
    void run()
      .catch(async (err: unknown) => {
        emit({ type: 'error', sessionId: session.id, message: publicErrorMessage(err) });
        await sessions.save(session);
      })
      .finally(() => {
        state.running.delete(session.id);
        emit({ type: 'status', sessionId: session.id, running: false });
      });
  };

  const startTurn = async (sessionId: string, text: string, opts?: { reaskLatest?: boolean }): Promise<void> => {
    if (state.running.has(sessionId)) throw ipcError('E_BUSY', '该会话正在运行，请等待完成或先停止。');
    {
      const s = await sessions.get(sessionId);
      const agent = effectiveAgent(s, settings.getActive().defaultAgent);
      if (agent !== 'builtin') {
        let sess = s;
        let cliId = agent.slice(4);
        // 自愈（自动改绑）：绑定的 CLI 条目已不存在（被删后重加换了 id 等）时，同名条目恰好一条就
        // 改绑落盘再继续；零条/多条不乱绑，保持 startCliTurn → resolveCli 的原 E_CLI 报错。
        // 只对「id 不存在」触发，条目存在但可执行文件不可用等其它 E_CLI 不走这里。
        if (!settings.getAgentCliCommand(cliId)) {
          const cand = findCliRebindCandidate(cliId, settings.getPublic().agentClis ?? []);
          if (cand) {
            sess = await sessions.setAgent(s.id, `cli:${cand}`);
            emit({ type: 'session-updated', summary: summarizeSession(sess) });
            cliId = cand;
          }
        }
        return startCliTurn(sess, cliId, text, opts);
      }
    }
    const active = settings.getActive();
    const problem = builtinConfigProblem(active);
    if (problem) throw ipcError('E_NOT_CONFIGURED', `请先在设置中配置 agent：${problem}`);
    const apiKey = settings.getApiKey(active.provider);
    if (!apiKey) throw ipcError('E_NO_API_KEY', '请先在设置中配置 agent：当前提供方尚未保存 API Key（设置 › 内置 agent）。');
    const session = await sessions.get(sessionId);
    const root = state.project?.root ?? null;
    const provider = makeProvider(active.provider, { baseUrl: active.baseUrl, apiKey });
    const system = buildSystemPrompt({
      projectRoot: root,
      platform: deps.platform,
      mode: active.permissionMode,
      today: new Date().toISOString().slice(0, 10),
      agentsMd: await readAgentsMd(root),
    });
    if (state.running.has(sessionId)) throw ipcError('E_BUSY', '该会话正在运行，请等待完成或先停止。');
    // 守卫（未运行 / 已配置 / 有 Key）已全部通过，本回合确认能启动，此刻截断安全。
    if (opts?.reaskLatest) await applyReaskTruncation(session, text);
    const controller = new AbortController();
    state.running.set(sessionId, controller);
    emit({ type: 'status', sessionId, running: true });

    // 不 await：增量通过 agent:event 推送，invoke 立即返回
    void runAgentTurn(session, text, {
      provider,
      model: active.model,
      mode: active.permissionMode,
      projectRoot: root,
      system,
      signal: controller.signal,
      platform: deps.platform,
      emit,
      requestApproval: (req) => {
        emit({ type: 'approval-request', sessionId, approval: req });
        return state.approvals.request(req);
      },
      persist: (s) => sessions.save(s),
      newId: () => crypto.randomUUID(),
      now: () => new Date().toISOString(),
    })
      .catch(async (err: unknown) => {
        if (controller.signal.aborted) return;
        emit({ type: 'error', sessionId, message: publicErrorMessage(err) });
        await sessions.save(session);
      })
      .finally(() => {
        state.running.delete(sessionId);
        emit({ type: 'status', sessionId, running: false });
      });
  };

  // ── v1.6：终端模式（任务会话）──
  const terminalInfo = (t: TerminalHandle): TerminalInfo => ({
    id: t.id, sessionId: t.sessionId, kind: t.kind, program: t.program, cwd: t.cwd, startedAt: t.startedAt, alive: t.alive,
  });

  /**
   * 终端的启动参数（主进程决定，渲染进程不可控）：
   * - shell：项目根下的 PowerShell / bash；
   * - cli：本会话选定的外部 Agent CLI，去掉 JSON 输出参数后以人可读形式输出。
   * 工作目录恒为项目根（宪法 十一）。
   */
  const terminalSpec = async (sessionId: string, kind: 'shell' | 'cli') => {
    const root = state.project?.root;
    if (!root) throw ipcError('E_NO_PROJECT', '请先打开项目文件夹。');
    if (kind === 'shell') {
      const sh = shellCommand(deps.platform);
      return { sessionId, kind, cwd: root, file: sh.file, args: sh.args, program: sh.program };
    }
    const s = await sessions.get(sessionId);
    const agent = effectiveAgent(s, settings.getActive().defaultAgent);
    if (agent === 'builtin') {
      throw ipcError('E_CLI', '本会话未选择外部 Agent CLI，无法以 CLI 模式打开终端。请在会话顶部切换 agent，或改用 shell 模式。');
    }
    const { runtime, executable, meta } = await resolveCli(agent.slice(4));
    const vars = { prompt: '', model: runtime.model, session: '', cwd: root };
    const args = expandTemplate(interactiveArgs(runtime.args), vars);
    if (runtime.model.trim()) args.push(...expandTemplate(runtime.modelArgs, vars));
    // opencode 条目：终端是管道（非 PTY），同样弹不出 question 界面——与三条对话通道一致做启动环境适配
    // （question 禁用 + win32 shell 适配，见 platform-env.ts）；通用 CLI 只带自身 env。
    const effectiveEnv: NodeJS.ProcessEnv = { ...(deps.cliBaseEnv ?? process.env), ...runtime.env };
    const env = runtime.outputFormat === 'opencode-json' ? { ...runtime.env, ...opencodeLaunchEnv(deps.platform, effectiveEnv) } : runtime.env;
    return { sessionId, kind, cwd: root, file: executable, args, program: meta.name, env };
  };

  return {
    'settings:get': async () => settings.getPublic(),
    'settings:set': async (update) => settings.update(validateSettingsUpdate(update)),
    'project:pick': async () => {
      const dir = await deps.pickDirectory();
      if (!dir) return null;
      const info = state.setProject(dir);
      await settings.setLastProject(dir);
      return info;
    },
    'project:current': async () => state.project,
    'project:openRoot': async () => {
      await deps.openPath?.(requireProject(state).root);
    },
    'fs:tree': async (relDir) => listTree(requireProject(state).root, asRelDir(relDir)),
    'fs:read': async (relPath) => readFileForView(requireProject(state).root, asRelPath(relPath)),
    'files:pick': async () => (deps.pickFiles ? deps.pickFiles() : []),
    'files:import': async (absPaths) => importFiles(requireProject(state).root, asStringArray(absPaths, 'absPaths')),
    'sessions:list': async () => sessions.list(),
    'sessions:create': async () => sessions.create(state.project?.root ?? null, settings.getActive().defaultAgent),
    'sessions:get': async (id) => sessions.get(asSessionId(id)),
    'sessions:delete': async (id) => {
      const sid = asSessionId(id);
      state.stop(sid);
      terminalManager.close(sid); // v1.6：会话删除时一并结束其终端
      await sessions.delete(sid);
    },
    'sessions:clear': async (id) => {
      const sid = asSessionId(id);
      if (state.running.has(sid)) throw ipcError('E_BUSY', '会话运行中，不能清空。请先停止。');
      return sessions.clear(sid);
    },
    'agent:send': async (req) => {
      const { sessionId, text, reaskLatest } = validateSendRequest(req);
      await startTurn(sessionId, text, { reaskLatest });
    },
    'agent:stop': async (id) => {
      const sid = asSessionId(id);
      for (const approvalId of state.stop(sid)) emit({ type: 'approval-resolved', sessionId: sid, approvalId, approved: false });
    },
    'agent:approve': async (decision) => {
      const { approvalId, approved } = validateApprovalDecision(decision);
      const sessionId = state.approvals.resolve(approvalId, approved);
      if (sessionId) emit({ type: 'approval-resolved', sessionId, approvalId, approved });
    },
    'tasks:list': async () => (state.project ? loadSpecTasks(state.project.root) : []),
    'agentCli:save': async (input) => settings.saveAgentCli(validateAgentCliInput(input)),
    'agentCli:delete': async (id) => settings.deleteAgentCli(asCliId(id)),
    'agentCli:check': async (id): Promise<AgentCliCheck> => {
      const cid = asCliId(id);
      const meta = settings.getAgentCliCommand(cid);
      if (!meta) throw ipcError('E_NOT_FOUND', `Agent CLI ${cid} 不存在`);
      const r = await resolveExecutable(meta.command, resolveDeps());
      if (!r.ok) return { ok: false, resolvedPath: null, version: null, message: `${r.reason}\n${installHint(meta.command, meta.preset, deps.platform)}` };
      const runtime = settings.getAgentCliRuntime(cid);
      const v = await runVersion(r.path, { ...(deps.cliBaseEnv ?? process.env), ...(runtime?.env ?? {}) }, state.project?.root ?? path.dirname(r.path));
      return v.ok
        ? { ok: true, resolvedPath: r.path, version: v.out.split('\n')[0] ?? v.out, message: `可用：${r.path}` }
        : { ok: false, resolvedPath: r.path, version: null, message: `找到 ${r.path}，但运行 --version 失败：${v.out}` };
    },
    'agentCli:detect': async (): Promise<AgentCliDetection[]> => detectInstalledClis({
      resolveDeps: resolveDeps(),
      probeVersion: (file, cwd) => probeCliVersion(file, cwd, deps.cliBaseEnv ?? process.env),
    }),
    'agentCli:models': async (id): Promise<{ models: string[] }> => {
      const cid = asCliId(id);
      // 仅 opencode 条目（经 getAgentCliRuntime 归一化后 outputFormat 为 opencode-json）才枚举；
      // 非 opencode、条目不存在、枚举失败一律空数组不抛错（契约 v1.5）。
      const runtime = settings.getAgentCliRuntime(cid);
      const meta = settings.getAgentCliCommand(cid);
      if (!runtime || !meta || runtime.outputFormat !== 'opencode-json') return { models: [] };
      const models = await listOpencodeModels({
        command: meta.command,
        resolveDeps: resolveDeps(),
        env: { ...(deps.cliBaseEnv ?? process.env), ...runtime.env },
        cwd: state.project?.root ?? undefined,
      });
      return { models };
    },
    'sessions:setAgent': async (id, agent) => {
      const sid = asSessionId(id);
      const ref = asAgentRef(agent);
      if (state.running.has(sid)) throw ipcError('E_BUSY', '会话运行中，不能切换 agent。请先停止。');
      if (ref !== 'builtin' && !settings.hasAgentCli(ref.slice(4))) throw ipcError('E_VALIDATION', `未知的 agent：${ref}`);
      const s = await sessions.setAgent(sid, ref);
      emit({ type: 'session-updated', summary: summarizeSession(s) });
      return s;
    },
    'agent:setSessionModel': async (arg) => {
      const { sessionId, model } = asSessionModelInput(arg);
      // 会话不存在时 SessionStore.get 抛 E_NOT_FOUND，与 sessions:get 等同类通道一致
      const s = await sessions.setCliModel(sessionId, model);
      emit({ type: 'session-updated', summary: summarizeSession(s) });
      return s;
    },
    'board:get': async () => {
      const now = new Date().toISOString();
      if (!state.project) return noProjectBoard(now);
      const root = state.project.root;
      return buildBoard(root, createGitRunner(root, deps.gitBin), await gitSnapshot(root), now, state.boardFeatureFor(root));
    },
    'board:setFeature': async (arg) => {
      const now = new Date().toISOString();
      if (!state.project) return noProjectBoard(now);
      const root = state.project.root;
      const featureId = asFeatureSelection(arg);
      if (featureId !== null) {
        // 第二道校验：必须是该项目 specs 下真实存在的目录 id（防路径注入 / 已删除目录）。
        const known = await listFeatures(root);
        if (!known.some((f) => f.id === featureId)) throw ipcError('E_VALIDATION', `功能（规格）不存在：${featureId}`);
      }
      state.setBoardFeature(root, featureId);
      return buildBoard(root, createGitRunner(root, deps.gitBin), await gitSnapshot(root), now, featureId);
    },
    'git:get': async () => {
      if (!state.project) return emptyGitSnapshot({ mainBranch: 'main', integrationBranch: 'dev', branchPrefix: 'feat', maxParallel: null }, '请先打开项目文件夹。', new Date().toISOString());
      gitCache = null;
      return gitSnapshot(state.project.root);
    },
    'git:checkout': async (branch) => {
      const name = asBranchName(branch);
      const { root } = requireProject(state);
      const before = await gitSnapshot(root);
      if (before.currentBranch === name) return before;
      // 参数数组、不经 shell；分支名已经 asBranchName 校验（非空、不以 '-' 开头），
      // 不用 `checkout -- <name>`（'--' 后按路径处理，不是切换分支的语义）。
      const r = await createGitRunner(root, deps.gitBin)(['checkout', name]);
      if (!r.ok) throw ipcError('E_GIT', (r.stderr || r.stdout).trim() || `git checkout ${name} 失败`);
      gitCache = null;
      return gitSnapshot(root);
    },
    // ── v1.6：终端模式 ──
    'terminal:open': async (arg) => {
      const req = asTerminalOpenRequest(arg);
      // 会话必须存在（避免为不存在的会话启动进程）
      await sessions.get(req.sessionId);
      const existing = terminalManager.get(req.sessionId);
      if (existing && existing.alive && !req.restart) return terminalInfo(existing);
      const spec = await terminalSpec(req.sessionId, req.kind ?? 'shell');
      return terminalInfo(terminalManager.open(spec, req.restart));
    },
    'terminal:input': async (arg) => {
      const req = asTerminalInputRequest(arg);
      if (!terminalManager.write(req.sessionId, req.data)) {
        throw ipcError('E_NOT_FOUND', '该会话没有正在运行的终端。请先打开终端。');
      }
    },
    'terminal:close': async (arg) => {
      const req = asTerminalCloseRequest(arg);
      terminalManager.close(req.sessionId);
    },
  };
}
