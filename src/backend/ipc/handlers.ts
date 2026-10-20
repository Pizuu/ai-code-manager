/**
 * IPC invoke 通道注册。每个通道一个 handler，类型来自 contracts/ipc.ts 的 IpcInvokeMap；
 * handlers 对象的映射类型保证契约中的每个通道都被实现（漏一个即编译失败）。
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AgentCliCheck, AgentEvent, AgentRef, GitSnapshot, IpcInvokeChannel, IpcInvokeMap, ProjectInfo, Session } from '../../../contracts/ipc.ts';
import { runCliTurn } from '../agent-cli/cli-runner.ts';
import { installHint } from '../agent-cli/presets.ts';
import { defaultResolveDeps, resolveExecutable, type ResolveDeps } from '../agent-cli/resolve.ts';
import { runAgentTurn } from '../agent/agent-loop.ts';
import { createAnthropicProvider } from '../agent/providers/anthropic.ts';
import { createOpenAIProvider } from '../agent/providers/openai.ts';
import type { Provider, ProviderConfig } from '../agent/providers/types.ts';
import { buildSystemPrompt } from '../agent/system-prompt.ts';
import type { AppState } from '../app-state.ts';
import { listTree } from '../fs/file-tree.ts';
import { summarizeSession, type SessionStore } from '../sessions/session-store.ts';
import type { SettingsStore } from '../settings/settings-store.ts';
import { loadSpecTasks } from '../specs/tasks-parser.ts';
import { buildBoard, readAgentsConfig } from '../workspace/board.ts';
import { emptyGitSnapshot, readGitSnapshot } from '../workspace/git-overview.ts';
import { createGitRunner } from '../workspace/git.ts';
import {
  asAgentRef,
  asCliId,
  asRelDir,
  asSessionId,
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
  platform: NodeJS.Platform;
  providerFactory?: (id: 'openai' | 'anthropic', config: ProviderConfig) => Provider;
  /** v1.1：可注入的可执行文件解析依赖、git 可执行文件与 CLI 子进程基础环境（测试用）。 */
  resolveDeps?: ResolveDeps;
  gitBin?: string;
  cliBaseEnv?: NodeJS.ProcessEnv;
}

/** 解析会话实际使用的 agent。 */
export function effectiveAgent(session: Session, defaultAgent: AgentRef): AgentRef {
  return session.agent ?? defaultAgent ?? 'builtin';
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

/** 去掉内部错误码以外的细节，保证不会把 Key 等敏感值带到界面。 */
function publicErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.length > 1000 ? `${msg.slice(0, 1000)}…` : msg;
}

export function createHandlers(deps: HandlerDeps): HandlerMap {
  const { settings, sessions, state, emit } = deps;
  const makeProvider = deps.providerFactory ?? defaultProviderFactory;

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

  const startCliTurn = async (session: Session, cliId: string, text: string): Promise<void> => {
    const root = state.project?.root;
    if (!root) throw ipcError('E_NO_PROJECT', '外部 Agent CLI 只能在打开的项目中运行（工作目录 = 项目根），请先打开项目文件夹。');
    const { runtime, executable } = await resolveCli(cliId);
    if (state.running.has(session.id)) throw ipcError('E_BUSY', '该会话正在运行，请等待完成或先停止。');
    const controller = new AbortController();
    state.running.set(session.id, controller);
    emit({ type: 'status', sessionId: session.id, running: true });
    void runCliTurn(session, text, {
      config: runtime,
      executable,
      projectRoot: root,
      mode: settings.getActive().permissionMode,
      platform: deps.platform,
      signal: controller.signal,
      emit,
      requestApproval: (req) => {
        emit({ type: 'approval-request', sessionId: session.id, approval: req });
        return state.approvals.request(req);
      },
      persist: (s) => sessions.save(s),
      newId: () => crypto.randomUUID(),
      now: () => new Date().toISOString(),
      ...(deps.cliBaseEnv ? { baseEnv: deps.cliBaseEnv } : {}),
    })
      .catch(async (err: unknown) => {
        emit({ type: 'error', sessionId: session.id, message: publicErrorMessage(err) });
        await sessions.save(session);
      })
      .finally(() => {
        state.running.delete(session.id);
        emit({ type: 'status', sessionId: session.id, running: false });
      });
  };

  const startTurn = async (sessionId: string, text: string): Promise<void> => {
    if (state.running.has(sessionId)) throw ipcError('E_BUSY', '该会话正在运行，请等待完成或先停止。');
    {
      const s = await sessions.get(sessionId);
      const agent = effectiveAgent(s, settings.getActive().defaultAgent);
      if (agent !== 'builtin') return startCliTurn(s, agent.slice(4), text);
    }
    const active = settings.getActive();
    const apiKey = settings.getApiKey(active.provider);
    if (!apiKey) throw ipcError('E_NO_API_KEY', '当前提供方尚未配置 API Key，请在设置中填写。');
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
    'fs:tree': async (relDir) => listTree(requireProject(state).root, asRelDir(relDir)),
    'sessions:list': async () => sessions.list(),
    'sessions:create': async () => sessions.create(state.project?.root ?? null, settings.getActive().defaultAgent),
    'sessions:get': async (id) => sessions.get(asSessionId(id)),
    'sessions:delete': async (id) => {
      const sid = asSessionId(id);
      state.stop(sid);
      await sessions.delete(sid);
    },
    'sessions:clear': async (id) => {
      const sid = asSessionId(id);
      if (state.running.has(sid)) throw ipcError('E_BUSY', '会话运行中，不能清空。请先停止。');
      return sessions.clear(sid);
    },
    'agent:send': async (req) => {
      const { sessionId, text } = validateSendRequest(req);
      await startTurn(sessionId, text);
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
    'sessions:setAgent': async (id, agent) => {
      const sid = asSessionId(id);
      const ref = asAgentRef(agent);
      if (state.running.has(sid)) throw ipcError('E_BUSY', '会话运行中，不能切换 agent。请先停止。');
      if (ref !== 'builtin' && !settings.hasAgentCli(ref.slice(4))) throw ipcError('E_VALIDATION', `未知的 agent：${ref}`);
      const s = await sessions.setAgent(sid, ref);
      emit({ type: 'session-updated', summary: summarizeSession(s) });
      return s;
    },
    'board:get': async () => {
      const now = new Date().toISOString();
      if (!state.project) {
        return { available: false, reason: '请先打开项目文件夹。', generatedAt: now, integrationBranch: 'dev', mainBranch: 'main', maxParallel: null, lanes: [], shared: [], feature: null, cards: [], contractVersion: null, boardFile: null, conflicts: [] };
      }
      const root = state.project.root;
      return buildBoard(root, createGitRunner(root, deps.gitBin), await gitSnapshot(root), now);
    },
    'git:get': async () => {
      if (!state.project) return emptyGitSnapshot({ mainBranch: 'main', integrationBranch: 'dev', branchPrefix: 'feat', maxParallel: null }, '请先打开项目文件夹。', new Date().toISOString());
      gitCache = null;
      return gitSnapshot(state.project.root);
    },
  };
}
