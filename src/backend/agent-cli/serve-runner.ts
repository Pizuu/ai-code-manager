/**
 * opencode serve 模式的一轮对话（实验开关，T127 / 任务卡 T-034，FR-116、宪法 九、宪法 十一，ADR 0006 修订）。
 *
 * - 模式选择：`opencodeMode = 'run' | 'serve' | 'acp'`，默认 acp（acp-runner.ts，ACP 启动失败回退 run)。
 *   契约 v1.3 的 PublicSettings 尚无此字段，
 *   因此只读后端内部设置键（settings.json 中的 opencodeMode，不经 IPC）或环境变量 AICM_OPENCODE_MODE（优先）。
 * - 常驻服务器：每个 CLI 配置（可执行文件 + 环境变量）一个 `opencode serve`，随机端口 + 随机密码（Basic 认证），
 *   只监听 127.0.0.1；配置变化时重启；应用退出时 closeAll() 结束进程树。
 * - 每个会话按权限模式创建 opencode 会话并下发规则集（serveRules，external_directory 默认 deny）；
 *   续接 ID 存于 session.cliSessions[`<cliId>@serve-<mode>`]（与 run 模式的键分开，避免带着不同规则集续接）。
 * - 逐条审批：permission.asked → ApprovalRequest（toApprovalRequest），只回复 once / reject，永不 always。
 * - 停止：先对本会话全部待批回 reject，再 abort（runServeTurn）。
 * - 启动失败（进程起不来、健康检查失败、版本不在 1.19.x、建会话失败）抛 ServeStartupError，
 *   且此时尚未写入任何消息，调用方据此回退到 run 模式。
 */
import { createHash, randomBytes } from 'node:crypto';
import type { AgentEvent, ApprovalRequest, PermissionMode, Session, ToolCallRecord } from '../../../contracts/ipc.ts';
import { beginCliTurn, type CliRuntimeConfig } from './cli-runner.ts';
import {
  OpencodeServeClient, runServeTurn, serveRules, startOpencodeServe,
  type ServeClientOptions, type ServeProcess, type ServeTurnDeps, type StartServeOptions,
} from './opencode-serve.ts';

export type OpencodeMode = 'run' | 'serve' | 'acp';
export const OPENCODE_MODE_ENV = 'AICM_OPENCODE_MODE';
export const SERVE_INVOKE_TOOL = 'agent_cli';
export const SUPPORTED_SERVE_VERSION = /^1\.19\./;

/** 解析模式：环境变量（run / serve / acp）优先，其次后端内部设置，默认 acp（ACP 接入，见 acp-runner.ts；启动失败由 handlers 回退 run)。 */
export function resolveOpencodeMode(env: NodeJS.ProcessEnv, stored: unknown): OpencodeMode {
  const e = (env[OPENCODE_MODE_ENV] ?? '').trim().toLowerCase();
  if (e === 'serve' || e === 'run' || e === 'acp') return e;
  if (stored === 'serve' || stored === 'run' || stored === 'acp') return stored;
  return 'acp';
}

/** 续接键：每种权限模式各自一个 opencode 会话（规则集在建会话时下发）。 */
export function serveSessionKey(cliId: string, mode: PermissionMode): string {
  return `${cliId}@serve-${mode}`;
}

/** `provider/model` → serve 的 model 字段；格式不符时返回 undefined（交给 opencode 默认模型）。 */
export function parseServeModel(model: string): { providerID: string; modelID: string } | undefined {
  const m = model.trim();
  const i = m.indexOf('/');
  if (i <= 0 || i === m.length - 1) return undefined;
  return { providerID: m.slice(0, i), modelID: m.slice(i + 1) };
}

export class ServeStartupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ServeStartupError';
  }
}

type ServeClientLike = Pick<OpencodeServeClient, 'health' | 'createSession'> & ServeTurnDeps['client'];

export interface ServeHandle {
  key: string;
  baseUrl: string;
  password: string;
  close(): void;
}

export interface ServeManagerDeps {
  /** 启动服务器（默认 startOpencodeServe）；测试可注入。 */
  start?: (opts: StartServeOptions) => Promise<ServeProcess | ServeHandle>;
  /** 由地址 / 目录 / 密码造客户端（默认 OpencodeServeClient）；测试可注入 fetch。 */
  client?: (opts: ServeClientOptions) => ServeClientLike;
  platform?: NodeJS.Platform;
  timeoutMs?: number;
}

/** 常驻 opencode serve 进程池：按 CLI 配置复用，配置变化时重启。 */
export class OpencodeServeManager {
  private readonly servers = new Map<string, { key: string; handle: Promise<ServeHandle> }>();
  private readonly deps: ServeManagerDeps;

  constructor(deps: ServeManagerDeps = {}) {
    this.deps = deps;
  }

  private static keyFor(executable: string, env: Record<string, string>): string {
    // 环境变量可能含密钥：只保存其哈希
    return createHash('sha256').update(JSON.stringify([executable, Object.entries(env).sort()])).digest('hex');
  }

  /** 取得（必要时启动）该 CLI 配置的服务器。失败抛 ServeStartupError 并丢弃缓存。 */
  async acquire(cliId: string, executable: string, cwd: string, env: NodeJS.ProcessEnv, cliEnv: Record<string, string>): Promise<ServeHandle> {
    const key = OpencodeServeManager.keyFor(executable, cliEnv);
    const cur = this.servers.get(cliId);
    if (cur && cur.key === key) {
      try {
        return await cur.handle;
      } catch {
        // 上次启动失败：重试
      }
    }
    if (cur) this.release(cliId);
    const start = this.deps.start ?? startOpencodeServe;
    const password = randomBytes(24).toString('base64url');
    const handle = start({
      executable, cwd, password, env: { ...env, ...cliEnv },
      ...(this.deps.platform ? { platform: this.deps.platform } : {}),
      ...(this.deps.timeoutMs !== undefined ? { timeoutMs: this.deps.timeoutMs } : {}),
    }).then((p): ServeHandle => ({ key, baseUrl: p.baseUrl, password: p.password, close: () => p.close() }));
    this.servers.set(cliId, { key, handle });
    try {
      return await handle;
    } catch (err) {
      if (this.servers.get(cliId)?.handle === handle) this.servers.delete(cliId);
      throw new ServeStartupError(err instanceof Error ? err.message : String(err));
    }
  }

  client(h: ServeHandle, directory: string): ServeClientLike {
    const make = this.deps.client ?? ((o: ServeClientOptions) => new OpencodeServeClient(o));
    return make({ baseUrl: h.baseUrl, directory, password: h.password });
  }

  /** 结束并丢弃某个 CLI 的服务器（如健康检查失败后）。 */
  release(cliId: string): void {
    const cur = this.servers.get(cliId);
    if (!cur) return;
    this.servers.delete(cliId);
    cur.handle.then((h) => h.close(), () => undefined);
  }

  /** 应用退出时调用：结束全部服务器进程树。 */
  closeAll(): void {
    for (const id of [...this.servers.keys()]) this.release(id);
  }

  get size(): number {
    return this.servers.size;
  }
}

export interface ServeTurnRunDeps {
  config: CliRuntimeConfig;
  executable: string;
  projectRoot: string;
  mode: PermissionMode;
  signal: AbortSignal;
  manager: OpencodeServeManager;
  emit(event: AgentEvent): void;
  requestApproval(req: ApprovalRequest): Promise<boolean>;
  persist(session: Session): Promise<void>;
  newId(): string;
  now(): string;
  baseEnv?: NodeJS.ProcessEnv;
}

export interface PreparedServeTurn {
  client: ServeClientLike;
  opencodeSessionId: string;
  baseUrl: string;
  version: string;
}

/**
 * 启动 / 附着服务器并取得 opencode 会话。只读会话，不写任何消息；失败抛 ServeStartupError（调用方回退 run 模式）。
 */
export async function prepareServeTurn(session: Session, deps: ServeTurnRunDeps): Promise<PreparedServeTurn> {
  const h = await deps.manager.acquire(deps.config.id, deps.executable, deps.projectRoot, deps.baseEnv ?? process.env, deps.config.env);
  const client = deps.manager.client(h, deps.projectRoot);
  let version: string;
  try {
    const health = await client.health();
    if (!health.healthy) throw new Error('健康检查未通过');
    version = health.version;
  } catch (err) {
    deps.manager.release(deps.config.id);
    throw new ServeStartupError(`opencode serve 健康检查失败：${err instanceof Error ? err.message : String(err)}`);
  }
  if (!SUPPORTED_SERVE_VERSION.test(version)) {
    deps.manager.release(deps.config.id);
    throw new ServeStartupError(`opencode serve 版本 ${version || '未知'} 不在已验证的 1.19.x 范围内`);
  }
  const key = serveSessionKey(deps.config.id, deps.mode);
  let opencodeSessionId = session.cliSessions?.[key] ?? '';
  if (!opencodeSessionId) {
    try {
      opencodeSessionId = await client.createSession({
        title: session.title.slice(0, 80) || 'ai-code-manager',
        ...(deps.mode === 'plan' ? { agent: 'plan' } : {}),
        permission: serveRules(deps.mode),
      });
    } catch (err) {
      throw new ServeStartupError(`opencode serve 创建会话失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { client, opencodeSessionId, baseUrl: h.baseUrl, version };
}

/** serve 模式一轮：prepared 来自 prepareServeTurn。 */
export async function runServeCliTurn(session: Session, userText: string, prepared: PreparedServeTurn, deps: ServeTurnRunDeps): Promise<void> {
  const key = serveSessionKey(deps.config.id, deps.mode);
  const invoke: ToolCallRecord = {
    id: `cli-${deps.newId()}`, name: SERVE_INVOKE_TOOL,
    input: {
      agent: deps.config.name, mode: 'serve（实验）', server: prepared.baseUrl, version: prepared.version, cwd: deps.projectRoot,
      permission: describeServePermission(deps.mode),
    },
    status: 'running',
  };
  const sink = await beginCliTurn(session, userText, { ...deps, sessionKey: key, infoToolCallId: () => invoke.id });
  session.cliSessions = { ...(session.cliSessions ?? {}), [key]: prepared.opencodeSessionId };
  sink.upsert(invoke);

  const model = parseServeModel(deps.config.model);
  const result = await runServeTurn({
    client: prepared.client,
    sessionId: prepared.opencodeSessionId,
    appSessionId: session.id,
    projectRoot: deps.projectRoot,
    prompt: userText,
    ...(deps.mode === 'plan' ? { agent: 'plan' } : {}),
    ...(model ? { model } : {}),
    signal: deps.signal,
    newId: deps.newId,
    requestApproval: async (req) => {
      const call = sink.calls.find((c) => c.id === req.toolCallId);
      if (call && call.status === 'running') sink.upsert({ ...call, status: 'awaiting-approval' });
      return deps.requestApproval(req);
    },
    onEvent: (ev) => {
      if (ev.kind === 'text-delta') sink.appendDelta(ev.partId, ev.delta);
      else if (ev.kind === 'idle' || ev.kind === 'busy') return;
      else if (ev.kind === 'error' && deps.signal.aborted) return; // 停止导致的 MessageAbortedError 不作为错误
      else sink.handle(ev);
    },
  });

  const aborted = result.status === 'aborted' || deps.signal.aborted;
  for (const c of sink.calls) {
    if (c.id === invoke.id) continue;
    if (c.status === 'running' || c.status === 'awaiting-approval' || c.status === 'pending') {
      sink.upsert({ ...c, status: aborted ? 'rejected' : 'error', output: c.output || (aborted ? '已被用户停止。' : '本轮结束时仍未完成。') });
    }
  }
  const rejected = result.approvals.filter((a) => !a.approved).length;
  const summary = `${result.approvals.length} 次审批（拒绝 ${rejected}）`;
  if (result.status === 'error') {
    sink.upsert({ ...invoke, status: 'error', output: `opencode serve 出错：${result.error ?? '未知错误'} · ${summary}` });
    deps.emit({ type: 'error', sessionId: session.id, message: `${deps.config.name}（serve）：${result.error ?? '未知错误'}` });
  } else if (aborted) {
    sink.upsert({ ...invoke, status: 'rejected', output: `已被用户停止（待批已拒绝并中止会话）· ${summary}` });
  } else {
    sink.upsert({ ...invoke, status: 'done', output: `完成 · ${summary} · 会话 ${prepared.opencodeSessionId}` });
  }
  await sink.save();
}

/** 批准卡片 / 调用记录文案。 */
export function describeServePermission(mode: PermissionMode): string {
  if (mode === 'plan') return 'serve 模式（实验）：仅规划，编辑与命令均禁止；访问项目外目录禁止。';
  if (mode === 'auto-edits') return 'serve 模式（实验）：编辑自动批准，每条命令逐条审批；访问项目外目录禁止。';
  if (mode === 'allow-all') return 'serve 模式（实验）：全部允许，不弹审批；访问项目外目录禁止。';
  return 'serve 模式（实验）：每次编辑与每条命令逐条审批；访问项目外目录禁止。';
}
