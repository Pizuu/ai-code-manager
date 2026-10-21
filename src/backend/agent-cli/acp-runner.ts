/**
 * opencode ACP 模式的一轮对话（照 orca 的 ACP 接入实现，默认 opencode 通道；handlers 启动失败回退 run 模式）。
 *
 * - 进程模型（同 orca）：一个 ACP 进程 = 一个 ACP 会话，按应用会话池化、跨轮复用；应用退出 closeAll()。
 *   进程指纹（CLI 配置 + 可执行文件 + 项目根）变化时重启。同一时刻只允许一个在途 prompt。
 * - 握手：initialize（protocolVersion 1、无 fs / terminal 能力）；恢复走 session/load（agent 声明
 *   agentCapabilities.loadSession 时），失败弃旧开新；续接 ID 存 session.cliSessions[`<cliId>@acp`]。
 * - 权限：session/request_permission → 既有 ApprovalRequest 审批通道（boolean 批准/拒绝映射为一次/拒绝；
 *   「总是」的选项选择规则在 selectPermissionOption 中实现并单测）。权限模式在客户端等价执行
 *   （参照 serveRules 的语义）：ask 逐条问；auto-edits 编辑类自动允许；plan 编辑/执行类自动拒绝、读/搜类自动允许。
 *   会话内「总是」不做本地缓存（agent 自行记忆，与 orca 一致）。
 * - 停止：先把全部待答权限回 cancelled，再发 session/cancel 通知。
 * - 启动失败（版本不达门禁、握手失败、建会话失败、未登录 -32000）抛 AcpStartupError 且尚未写入任何消息，调用方据此回退。
 */
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { AgentEvent, ApprovalRequest, PermissionMode, Session, ToolCallRecord } from '../../../contracts/ipc.ts';
import { createUnifiedDiff } from '../tools/diff.ts';
import {
  ACP_METHOD_NOT_FOUND, ACP_PROTOCOL_VERSION, AcpRpcError, isAcpAuthError, startAcpProcess, type AcpPeer,
} from './acp-client.ts';
import { beginCliTurn, type CliRuntimeConfig } from './cli-runner.ts';
import { probeCliVersion } from './detect.ts';
import { opencodeLaunchEnv } from './platform-env.ts';
import type { OpencodeEvent } from './opencode-events.ts';

export const ACP_INVOKE_TOOL = 'agent_cli';
export const ACP_VERSION_PROBE_TIMEOUT_MS = 5_000;
const INITIALIZE_TIMEOUT_MS = 60_000;
const SESSION_TIMEOUT_MS = 300_000;
const SET_MODEL_TIMEOUT_MS = 30_000;

export class AcpStartupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AcpStartupError';
  }
}

/** 续接键：ACP 会话 ID（与 run / serve 的键分开）。 */
export function acpSessionKey(cliId: string): string {
  return `${cliId}@acp`;
}

const rec = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function relPath(root: string, p: string): string {
  const rel = path.isAbsolute(p) ? path.relative(root, p) : p;
  return rel.split(path.sep).join('/');
}

/** 启动 / 轮次错误的最终文案：-32000 视为未登录，提示先 auth login。 */
function acpErrorMessage(err: unknown): string {
  if (isAcpAuthError(err)) return `opencode 未登录或凭据无效：请先运行 opencode auth login（${err instanceof Error ? err.message : String(err)}）`;
  return err instanceof Error ? err.message : String(err);
}

// ───────────────────────── 版本门禁 ─────────────────────────

export interface AcpVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: boolean;
  /** 归一化版本串，如 '1.19.3'。 */
  text: string;
}

/** 从 `--version` 输出（首行）解析版本号；找不到 x.y.z 数字三元组返回 null。带 `-` 预发布后缀记 prerelease。 */
export function parseAcpVersion(text: string | null | undefined): AcpVersion | null {
  if (!text) return null;
  const m = /(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?/.exec(text);
  if (!m) return null;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = Number(m[3]);
  return { major, minor, patch, prerelease: m[4] !== undefined, text: `${major}.${minor}.${patch}` };
}

/**
 * ACP 版本门禁（同 orca）：1.x 线需稳定版 ≥ 1.18.31，2.x 线需稳定版 ≥ 2.0.14；
 * 预发布版、其它主版本线、探测不到 / 解析失败一律不通过（prepare 据此回退）。
 */
export function acpVersionSupported(text: string | null | undefined): boolean {
  const v = parseAcpVersion(text);
  if (!v || v.prerelease) return false;
  if (v.major === 1) return v.minor > 18 || (v.minor === 18 && v.patch >= 31);
  if (v.major === 2) return v.minor > 0 || (v.minor === 0 && v.patch >= 14);
  return false;
}

// ───────────────────────── 权限（session/request_permission） ─────────────────────────

/** 审批答案：'once' 本次允许 / 'always' 总是允许 / 'reject' 拒绝。既有审批通道为 boolean，生产适配层映射 true→once、false→reject。 */
export type AcpApprovalAnswer = 'once' | 'always' | 'reject';

export interface AcpPermissionOption {
  optionId: string;
  name: string;
  kind: string;
}

export interface AcpPermissionRequest {
  sessionId: string;
  toolCall: {
    toolCallId: string;
    title: string;
    /** ACP 工具类别：read / edit / delete / move / search / execute / think / fetch / switch_mode / other。 */
    kind: string;
    status: string;
    rawInput: Record<string, unknown>;
  };
  options: AcpPermissionOption[];
}

export function parseAcpPermissionRequest(params: unknown): AcpPermissionRequest | null {
  const p = rec(params);
  const sessionId = str(p.sessionId);
  const tc = rec(p.toolCall);
  const toolCallId = str(tc.toolCallId);
  if (!sessionId || !toolCallId) return null;
  const options = (Array.isArray(p.options) ? p.options : [])
    .map((o) => {
      const r = rec(o);
      return { optionId: str(r.optionId), name: str(r.name), kind: str(r.kind) };
    })
    .filter((o) => o.optionId);
  return {
    sessionId,
    toolCall: { toolCallId, title: str(tc.title), kind: str(tc.kind), status: str(tc.status), rawInput: rec(tc.rawInput) },
    options,
  };
}

export type AcpPermissionClass = 'edit' | 'execute' | 'read' | 'other';

/** ACP 工具类别 → 权限类别：edit 类含 delete / move（均为落盘修改），read 类含 search。 */
export function acpPermissionClass(kind: string): AcpPermissionClass {
  if (kind === 'edit' || kind === 'delete' || kind === 'move') return 'edit';
  if (kind === 'execute') return 'execute';
  if (kind === 'read' || kind === 'search') return 'read';
  return 'other';
}

/**
 * 权限模式的客户端等价裁决（参照 serveRules 语义；ACP 无服务端规则集，由本客户端代行）：
 * ask = 逐条问；auto-edits = edit 类自动允许、其余仍问；plan = edit / execute 类自动拒绝、read 类自动允许、其余仍问；
 * allow-all（v1.6）= 一律自动允许（不再打扰用户；项目根沙箱仍由本应用把关）。
 */
export function acpAutoDecision(mode: PermissionMode, kind: string): 'allow' | 'reject' | 'ask' {
  if (mode === 'allow-all') return 'allow';
  const cls = acpPermissionClass(kind);
  if (mode === 'plan') {
    if (cls === 'edit' || cls === 'execute') return 'reject';
    if (cls === 'read') return 'allow';
    return 'ask';
  }
  if (mode === 'auto-edits') return cls === 'edit' ? 'allow' : 'ask';
  return 'ask';
}

/**
 * 审批答案 → 选项（同 orca 的映射）：总是 → allow_always 优先、无则 allow_once；
 * 一次 → allow_once 优先、无则 allow_always；拒绝 → reject_once 优先、无则 reject_always。无匹配返回 null（回 cancelled)。
 */
export function selectPermissionOption(options: readonly AcpPermissionOption[], answer: AcpApprovalAnswer): AcpPermissionOption | null {
  const order = answer === 'always'
    ? ['allow_always', 'allow_once']
    : answer === 'once'
      ? ['allow_once', 'allow_always']
      : ['reject_once', 'reject_always'];
  for (const k of order) {
    const o = options.find((x) => x.kind === k);
    if (o) return o;
  }
  return null;
}

/**
 * ACP 权限请求 → 应用 ApprovalRequest。toolCall.title 作标题（other 种类经 description 呈现，
 * edit / command 以 path / command 呈现）；kind / rawInput 填入契约的 permission / patterns 字段（做法同 serve 的 toApprovalRequest)。
 */
export function toAcpApprovalRequest(perm: AcpPermissionRequest, opts: { approvalId: string; appSessionId: string; projectRoot: string }): ApprovalRequest {
  const tc = perm.toolCall;
  const raw = tc.rawInput;
  const base = {
    id: opts.approvalId, sessionId: opts.appSessionId,
    toolCallId: tc.toolCallId, permission: tc.kind || 'other',
  };
  const cls = acpPermissionClass(tc.kind);
  if (cls === 'execute') {
    const command = str(raw.command) || tc.title;
    return { ...base, kind: 'command', command, shell: 'opencode bash 工具（opencode 自行执行）', patterns: command ? [command] : [] };
  }
  if (cls === 'edit') {
    const file = str(raw.filePath) || str(raw.path);
    const rel = file ? relPath(opts.projectRoot, file) : '';
    let diff: string | undefined;
    if (typeof raw.oldString === 'string' && typeof raw.newString === 'string') diff = createUnifiedDiff(raw.oldString, raw.newString, rel || 'file');
    else if (typeof raw.content === 'string') diff = createUnifiedDiff(null, raw.content, rel || 'file');
    return { ...base, kind: 'edit', path: rel, ...(diff ? { diff } : {}), patterns: file ? [file] : [] };
  }
  if (tc.kind === 'fetch') {
    const url = str(raw.url);
    return { ...base, kind: 'webfetch', url, patterns: url ? [url] : [] };
  }
  if (tc.kind === 'read') {
    const file = str(raw.filePath) || str(raw.path);
    return { ...base, kind: 'other', description: tc.title || (file ? `读取文件：${relPath(opts.projectRoot, file)}` : '读取文件'), patterns: file ? [file] : [] };
  }
  if (tc.kind === 'search') {
    const pattern = str(raw.pattern) || str(raw.query);
    return { ...base, kind: 'other', description: tc.title || (pattern ? `搜索：${pattern}` : '搜索'), patterns: pattern ? [pattern] : [] };
  }
  return { ...base, kind: 'other', description: tc.title || `opencode 工具：${tc.kind || 'unknown'}`, patterns: [] };
}

/** 批准卡片 / 调用记录文案。 */
export function describeAcpPermission(mode: PermissionMode): string {
  if (mode === 'plan') return 'ACP 模式：仅规划，编辑与命令自动拒绝，读取与搜索自动允许。';
  if (mode === 'auto-edits') return 'ACP 模式：编辑自动批准，其余工具调用逐条审批。';
  if (mode === 'allow-all') return 'ACP 模式：全部允许，不弹出审批。';
  return 'ACP 模式：每次工具调用逐条审批。';
}

// ───────────────────────── session/update 映射 ─────────────────────────

/** ACP 工具调用 content 数组 → 纯文本输出（取 content 块中的 text；diff / terminal 块不入正文）。 */
export function extractAcpContentText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const item of content) {
    const it = rec(item);
    if (it.type === 'content') {
      const inner = rec(it.content);
      if (inner.type === 'text' && typeof inner.text === 'string') parts.push(inner.text);
    } else if (it.type === 'text' && typeof it.text === 'string') {
      parts.push(it.text);
    }
  }
  return parts.join('');
}

/** ACP 工具类别 → 本应用工具名（与 run / serve 的 opencode 工具名对齐，使 diff / 终端 / 待办映射复用）。 */
export function acpToolName(kind: string, input: Record<string, unknown>, title: string): string {
  if (Array.isArray(input.todos)) return 'todowrite';
  switch (kind) {
    case 'execute': return 'bash';
    case 'edit': return typeof input.content === 'string' && input.oldString === undefined ? 'write' : 'edit';
    case 'read': return 'read';
    case 'search': return 'grep';
    case 'delete': return 'delete';
    case 'move': return 'move';
    case 'fetch': return 'webfetch';
    case 'think': return 'think';
    case 'switch_mode': return 'switch_mode';
    default: return title || 'tool';
  }
}

interface AcpToolState {
  kind: string;
  title: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  input: Record<string, unknown>;
  output: string;
  metadata: Record<string, unknown>;
}

/** tool_call / tool_call_update 按 toolCallId 合并为一个 OpencodeEvent（快照式上抛，sink 按 callId upsert)。 */
function mergeToolUpdate(tools: Map<string, AcpToolState>, upd: Record<string, unknown>): { ev: OpencodeEvent; isNew: boolean } | null {
  const id = str(upd.toolCallId);
  if (!id) return null;
  let st = tools.get(id);
  const isNew = !st;
  if (!st) {
    st = { kind: '', title: '', status: 'pending', input: {}, output: '', metadata: {} };
    tools.set(id, st);
  }
  if (str(upd.kind)) st.kind = str(upd.kind);
  if (str(upd.title)) st.title = str(upd.title);
  const rawInput = rec(upd.rawInput);
  if (Object.keys(rawInput).length) st.input = { ...st.input, ...rawInput };
  const s = str(upd.status);
  if (s === 'pending' || s === 'in_progress' || s === 'completed' || s === 'failed') {
    st.status = s === 'failed' ? 'error' : s === 'in_progress' ? 'running' : s;
  }
  const rawOutput = rec(upd.rawOutput);
  const md = rec(rawOutput.metadata);
  if (Object.keys(md).length) st.metadata = { ...st.metadata, ...md };
  // 输出正文优先 content 的 text 块，其次 opencode 方言 rawOutput.metadata.output（stdout；metadata.exit 为退出码，随 metadata 透传）
  const fromContent = extractAcpContentText(upd.content);
  if (fromContent) st.output = fromContent;
  else if (typeof md.output === 'string' && md.output) st.output = md.output;
  else if (typeof rawOutput.output === 'string' && rawOutput.output) st.output = rawOutput.output;
  else if (typeof upd.rawOutput === 'string' && upd.rawOutput) st.output = upd.rawOutput;
  const error = st.status === 'error' ? (st.output || st.title || '工具执行失败') : '';
  return {
    isNew,
    ev: {
      kind: 'tool', sessionId: null, callId: id, tool: acpToolName(st.kind, st.input, st.title),
      status: st.status, input: st.input, output: st.output, error, title: st.title, metadata: st.metadata,
    },
  };
}

// ───────────────────────── 进程池 ─────────────────────────

export interface AcpActiveTurn {
  onUpdate(params: unknown): void;
  onPermission(params: unknown): Promise<unknown>;
}

export interface AcpHandle {
  readonly peer: AcpPeer;
  acpSessionId: string;
  readonly version: string;
  busy: boolean;
  setActive(turn: AcpActiveTurn | null): void;
  close(): void;
}

export interface AcpManagerDeps {
  /** 启动 ACP 进程（默认 startAcpProcess）；测试可注入。 */
  startPeer?: typeof startAcpProcess;
  /** `<exe> --version` 探测（默认 detect.probeCliVersion，5s 超时）；失败返回 null。 */
  probeVersion?: (executable: string, cwd: string, env: NodeJS.ProcessEnv) => Promise<string | null>;
  platform?: NodeJS.Platform;
}

export interface AcpAcquireOptions {
  appSessionId: string;
  config: CliRuntimeConfig;
  executable: string;
  projectRoot: string;
  /** session.cliSessions 中保存的旧 ACP 会话 ID（可恢复时用 session/load)。 */
  storedSessionId?: string;
  baseEnv?: NodeJS.ProcessEnv;
}

/** ACP 进程池：一应用会话一进程（= 一 ACP 会话），跨轮复用；配置指纹变化或进程退出后重建。 */
export class AcpProcessManager {
  private readonly pool = new Map<string, { fingerprint: string; handle: Promise<AcpHandle> }>();
  private readonly deps: AcpManagerDeps;

  constructor(deps: AcpManagerDeps = {}) {
    this.deps = deps;
  }

  private static fingerprintFor(opts: AcpAcquireOptions): string {
    // 环境变量可能含密钥：只保存其哈希（同 serve 进程池）
    return createHash('sha256')
      .update(JSON.stringify([opts.config.id, opts.executable, opts.projectRoot, opts.config.model, Object.entries(opts.config.env).sort()]))
      .digest('hex');
  }

  /** 取得（必要时启动并握手）该应用会话的 ACP 进程与会话。失败抛 AcpStartupError 并丢弃缓存。 */
  async acquire(opts: AcpAcquireOptions): Promise<AcpHandle> {
    const fingerprint = AcpProcessManager.fingerprintFor(opts);
    const cur = this.pool.get(opts.appSessionId);
    if (cur && cur.fingerprint === fingerprint) {
      try {
        const h = await cur.handle;
        if (!h.peer.exited) return h;
      } catch {
        // 上次启动失败：落到重建
      }
    }
    if (cur) this.release(opts.appSessionId);
    const handle = this.start(opts);
    this.pool.set(opts.appSessionId, { fingerprint, handle });
    try {
      return await handle;
    } catch (err) {
      if (this.pool.get(opts.appSessionId)?.handle === handle) this.pool.delete(opts.appSessionId);
      throw err;
    }
  }

  private async start(opts: AcpAcquireOptions): Promise<AcpHandle> {
    const env: NodeJS.ProcessEnv = { ...(opts.baseEnv ?? process.env), ...opts.config.env };
    const probe = this.deps.probeVersion ?? ((exe, cwd, e) => probeCliVersion(exe, cwd, e, ACP_VERSION_PROBE_TIMEOUT_MS));
    const versionText = await probe(opts.executable, opts.projectRoot, env).catch(() => null);
    const version = parseAcpVersion(versionText);
    if (!version || !acpVersionSupported(versionText)) {
      throw new AcpStartupError(`opencode 版本 ${versionText?.trim() || '未知'} 不满足 ACP 接入门禁（1.x 需稳定版 ≥ 1.18.31，2.x 需稳定版 ≥ 2.0.14）`);
    }
    let active: AcpActiveTurn | null = null;
    const startPeer = this.deps.startPeer ?? startAcpProcess;
    const { peer } = startPeer(
      {
        executable: opts.executable, cwd: opts.projectRoot,
        // opencodeLaunchEnv：禁用 question 工具（本客户端无承接界面）+ win32 shell 适配，见 platform-env.ts。
        env: { ...env, OPENCODE_CLIENT: 'acp', ...opencodeLaunchEnv(this.deps.platform ?? process.platform, env) },
        ...(this.deps.platform ? { platform: this.deps.platform } : {}),
      },
      {
        onNotification: (method, params) => {
          if (method === 'session/update') active?.onUpdate(params);
        },
        onRequest: (method, params) => {
          if (method === 'session/request_permission') {
            // 无在途轮次时不应发生（load 回放等）：按取消回复，不阻塞 agent
            if (active) return active.onPermission(params);
            return { outcome: { outcome: 'cancelled' } };
          }
          // fs/*、terminal/* 及其它未知 client 方法一律 -32601：本客户端不声明 fs / terminal 能力
          // （orca 同此处理；opencode 1.x 会重发已批准的 fs/write_text_file，属其已知行为）
          throw new AcpRpcError(ACP_METHOD_NOT_FOUND, `Method not found: ${method}`);
        },
      },
    );
    const handle: AcpHandle = {
      peer,
      acpSessionId: '',
      version: version.text,
      busy: false,
      setActive: (t) => {
        active = t;
      },
      close: () => peer.close(),
    };
    try {
      const init = rec(await peer.request('initialize', {
        protocolVersion: ACP_PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: 'ai-code-manager', version: '1' },
      }, { timeoutMs: INITIALIZE_TIMEOUT_MS }));
      if (init.protocolVersion !== ACP_PROTOCOL_VERSION) {
        throw new AcpStartupError(`opencode ACP 协议版本不受支持（对方 protocolVersion=${String(init.protocolVersion)}，需要 ${ACP_PROTOCOL_VERSION}）`);
      }
      const loadSessionCap = rec(init.agentCapabilities).loadSession === true;
      let acpSessionId = '';
      if (opts.storedSessionId && loadSessionCap) {
        try {
          await peer.request('session/load', { sessionId: opts.storedSessionId, cwd: opts.projectRoot, mcpServers: [] }, { timeoutMs: SESSION_TIMEOUT_MS });
          acpSessionId = opts.storedSessionId;
        } catch {
          acpSessionId = ''; // 恢复失败：弃旧开新
        }
      }
      if (!acpSessionId) {
        const res = rec(await peer.request('session/new', { cwd: opts.projectRoot, mcpServers: [] }, { timeoutMs: SESSION_TIMEOUT_MS }));
        acpSessionId = str(res.sessionId);
        if (!acpSessionId) throw new AcpStartupError('opencode ACP 未返回会话 ID（session/new)');
      }
      handle.acpSessionId = acpSessionId;
      const model = opts.config.model.trim();
      if (model) {
        // 尽力而为：set_model 失败忽略（agent 用默认模型继续）
        await peer.request('session/set_model', { sessionId: acpSessionId, modelId: model }, { timeoutMs: SET_MODEL_TIMEOUT_MS }).catch(() => undefined);
      }
    } catch (err) {
      peer.close();
      if (err instanceof AcpStartupError) throw err;
      throw new AcpStartupError(acpErrorMessage(err));
    }
    // 进程退出后清池，下轮重建
    void peer.exitPromise.then(() => {
      const e = this.pool.get(opts.appSessionId);
      if (!e) return;
      void e.handle.then((h) => {
        if (h === handle) this.pool.delete(opts.appSessionId);
      }, () => undefined);
    });
    return handle;
  }

  /** 结束并丢弃某个应用会话的 ACP 进程。 */
  release(appSessionId: string): void {
    const cur = this.pool.get(appSessionId);
    if (!cur) return;
    this.pool.delete(appSessionId);
    cur.handle.then((h) => h.close(), () => undefined);
  }

  /** 应用退出时调用：结束全部 ACP 进程。 */
  closeAll(): void {
    for (const id of [...this.pool.keys()]) this.release(id);
  }

  get size(): number {
    return this.pool.size;
  }
}

// ───────────────────────── 一轮对话 ─────────────────────────

export interface AcpApprovalRecord {
  toolCallId: string;
  permission: string;
  approved: boolean;
  /** true = 权限模式自动裁决（未打扰用户）。 */
  auto: boolean;
}

export interface AcpTurnResult {
  status: 'done' | 'aborted' | 'error';
  approvals: AcpApprovalRecord[];
  error?: string;
}

export interface AcpTurnEngineDeps {
  handle: AcpHandle;
  appSessionId: string;
  projectRoot: string;
  prompt: string;
  mode: PermissionMode;
  signal: AbortSignal;
  newId(): string;
  /** 逐条审批（三态）：生产适配层由既有 boolean 审批通道映射（见 runAcpCliTurn)。 */
  requestApproval(req: ApprovalRequest, perm: AcpPermissionRequest): Promise<AcpApprovalAnswer>;
  onTextDelta(partId: string, delta: string): void;
  onEvent(ev: OpencodeEvent): void;
  /** usage_update 的 used（当前会话上下文已用 token 总量，累计口径）；适配层据此覆盖 session.usage.total 并落盘。 */
  onUsage?: (used: number) => void;
}

/** usage_update 的 used 提取：须为有限 number，否则返回 null（忽略该条）。 */
export function parseAcpUsageUsed(update: Record<string, unknown>): number | null {
  const used = update.used;
  return typeof used === 'number' && Number.isFinite(used) ? used : null;
}

type AcpPermissionOutcome = { outcome: 'selected'; optionId: string } | { outcome: 'cancelled' };

/**
 * ACP 一轮：发 session/prompt 并处理 session/update 与 session/request_permission，直到 prompt 响应。
 * stopReason:end_turn → done、cancelled → aborted、refusal / max_tokens / max_turn_requests / 其它 → error。
 * 进程中途退出时 prompt 请求被 peer 以 AcpProcessExitError 拒绝 → error（文案含 stderr 尾巴）。
 */
export async function runAcpTurn(deps: AcpTurnEngineDeps): Promise<AcpTurnResult> {
  const { handle } = deps;
  const acpSessionId = handle.acpSessionId;
  const approvals: AcpApprovalRecord[] = [];
  if (handle.busy) return { status: 'error', approvals, error: 'ACP 会话正忙：同一会话同一时刻只允许一个在途 prompt' };
  if (deps.signal.aborted) return { status: 'aborted', approvals };
  handle.busy = true;
  let stopping = false;
  const tools = new Map<string, AcpToolState>();
  let textSeq = 0;
  const pendingPerms = new Set<{ cancel(): void }>();

  const onUpdate = (params: unknown): void => {
    const p = rec(params);
    if (str(p.sessionId) && str(p.sessionId) !== acpSessionId) return;
    const upd = rec(p.update);
    switch (str(upd.sessionUpdate)) {
      case 'agent_message_chunk': {
        const c = rec(upd.content);
        if (str(c.type) === 'text' && str(c.text)) deps.onTextDelta(`acp-text-${textSeq}`, str(c.text));
        break;
      }
      case 'agent_thought_chunk':
        // 与 serve 路径同口径：thinking / reasoning 无对应 OpencodeEvent，忽略。
        break;
      case 'tool_call':
      case 'tool_call_update': {
        const m = mergeToolUpdate(tools, upd);
        if (m) {
          deps.onEvent(m.ev);
          if (m.isNew) textSeq += 1; // 工具边界后的文本另起一段（sink 以新 partId 分段）
        }
        break;
      }
      case 'usage_update': {
        // ACP 的 used = 当前会话上下文已用 token 总量（累计口径、整值覆盖，非逐轮增量——与 run/serve 的
        // step_finish tokens 逐轮累加口径不同，勿在此相加）；分解项（input/output/…）ACP 不给，由适配层保留旧值。
        const used = parseAcpUsageUsed(upd);
        if (used !== null) deps.onUsage?.(used);
        break;
      }
      default:
        // user_message_chunk / plan / available_commands_update / current_mode_update /
        // config_option_update / session_info_update / 未知 kind：本期不映射，忽略。
        break;
    }
  };

  const onPermission = (params: unknown): Promise<unknown> => {
    const perm = parseAcpPermissionRequest(params);
    if (!perm || perm.sessionId !== acpSessionId) return Promise.resolve({ outcome: { outcome: 'cancelled' } });
    return new Promise<unknown>((resolve) => {
      let settled = false;
      const finish = (outcome: AcpPermissionOutcome, approved: boolean, auto: boolean) => {
        if (settled) return;
        settled = true;
        pendingPerms.delete(entry);
        approvals.push({ toolCallId: perm.toolCall.toolCallId, permission: perm.toolCall.kind || 'other', approved, auto });
        resolve({ outcome });
      };
      const entry = { cancel: () => finish({ outcome: 'cancelled' }, false, false) };
      pendingPerms.add(entry);
      const finishWithAnswer = (answer: AcpApprovalAnswer, auto: boolean) => {
        const opt = selectPermissionOption(perm.options, answer);
        if (!opt) finish({ outcome: 'cancelled' }, false, auto);
        else finish({ outcome: 'selected', optionId: opt.optionId }, answer !== 'reject', auto);
      };
      void (async () => {
        const auto = acpAutoDecision(deps.mode, perm.toolCall.kind);
        if (auto === 'allow') return finishWithAnswer('once', true);
        if (auto === 'reject') return finishWithAnswer('reject', true);
        if (stopping) return entry.cancel();
        const req = toAcpApprovalRequest(perm, { approvalId: deps.newId(), appSessionId: deps.appSessionId, projectRoot: deps.projectRoot });
        // 审批通道异常 → null → cancelled（不默认批准）
        const answer: AcpApprovalAnswer | null = await deps.requestApproval(req, perm).catch(() => null);
        if (answer === null || stopping) return entry.cancel();
        return finishWithAnswer(answer, false);
      })();
    });
  };

  const onAbort = () => {
    stopping = true;
    // 先把全部待答权限回 cancelled（回复写出走微任务，先于下面排队的 cancel 通知），再发 session/cancel
    for (const p of [...pendingPerms]) p.cancel();
    queueMicrotask(() => handle.peer.notify('session/cancel', { sessionId: acpSessionId }));
  };
  deps.signal.addEventListener('abort', onAbort, { once: true });
  handle.setActive({ onUpdate, onPermission });
  try {
    const res = rec(await handle.peer.request('session/prompt', {
      sessionId: acpSessionId,
      prompt: [{ type: 'text', text: deps.prompt }],
    }));
    const stopReason = str(res.stopReason);
    if (stopping || deps.signal.aborted || stopReason === 'cancelled') return { status: 'aborted', approvals };
    if (stopReason === 'end_turn') return { status: 'done', approvals };
    return { status: 'error', approvals, error: stopReason ? `opencode ACP 以 ${stopReason} 结束本轮` : 'opencode ACP 未返回 stopReason' };
  } catch (err) {
    if (stopping || deps.signal.aborted) return { status: 'aborted', approvals };
    return { status: 'error', approvals, error: acpErrorMessage(err) };
  } finally {
    deps.signal.removeEventListener('abort', onAbort);
    handle.setActive(null);
    handle.busy = false;
  }
}

// ───────────────────────── handlers 接入（与 serve 版签名对齐） ─────────────────────────

export interface AcpTurnRunDeps {
  config: CliRuntimeConfig;
  executable: string;
  projectRoot: string;
  mode: PermissionMode;
  signal: AbortSignal;
  manager: AcpProcessManager;
  emit(event: AgentEvent): void;
  requestApproval(req: ApprovalRequest): Promise<boolean>;
  persist(session: Session): Promise<void>;
  newId(): string;
  now(): string;
  baseEnv?: NodeJS.ProcessEnv;
}

export interface PreparedAcpTurn {
  handle: AcpHandle;
  acpSessionId: string;
  version: string;
}

/**
 * 启动 / 附着 ACP 进程并取得会话。只读会话，不写任何消息；失败抛 AcpStartupError（调用方回退既有通道）。
 */
export async function prepareAcpTurn(session: Session, deps: AcpTurnRunDeps): Promise<PreparedAcpTurn> {
  const key = acpSessionKey(deps.config.id);
  const stored = session.cliSessions?.[key];
  const handle = await deps.manager.acquire({
    appSessionId: session.id,
    config: deps.config,
    executable: deps.executable,
    projectRoot: deps.projectRoot,
    ...(stored ? { storedSessionId: stored } : {}),
    ...(deps.baseEnv ? { baseEnv: deps.baseEnv } : {}),
  });
  return { handle, acpSessionId: handle.acpSessionId, version: handle.version };
}

/** ACP 模式一轮：prepared 来自 prepareAcpTurn。 */
export async function runAcpCliTurn(session: Session, userText: string, prepared: PreparedAcpTurn, deps: AcpTurnRunDeps): Promise<void> {
  const key = acpSessionKey(deps.config.id);
  const invoke: ToolCallRecord = {
    id: `cli-${deps.newId()}`, name: ACP_INVOKE_TOOL,
    input: {
      agent: deps.config.name, mode: 'acp', version: prepared.version, cwd: deps.projectRoot,
      permission: describeAcpPermission(deps.mode),
    },
    status: 'running',
  };
  const sink = await beginCliTurn(session, userText, { ...deps, sessionKey: key, infoToolCallId: () => invoke.id });
  session.cliSessions = { ...(session.cliSessions ?? {}), [key]: prepared.acpSessionId };
  sink.upsert(invoke);

  const result = await runAcpTurn({
    handle: prepared.handle,
    appSessionId: session.id,
    projectRoot: deps.projectRoot,
    prompt: userText,
    mode: deps.mode,
    signal: deps.signal,
    newId: deps.newId,
    requestApproval: async (req) => {
      const call = sink.calls.find((c) => c.id === req.toolCallId);
      if (call && call.status === 'running') sink.upsert({ ...call, status: 'awaiting-approval' });
      // 既有审批通道为 boolean（批准 / 拒绝两态）：映射为一次 / 拒绝；「总是」的选择规则在 selectPermissionOption
      return (await deps.requestApproval(req)) ? 'once' : 'reject';
    },
    onTextDelta: (partId, delta) => sink.appendDelta(partId, delta),
    onEvent: (ev) => sink.handle(ev),
    onUsage: (used) => {
      // used 是累计总量：只覆盖 total，分解项保留上一轮的值（ACP 不提供分解），并落盘保存
      // （sink.save 自带串行队列，与 run/serve 的 step-finish 落盘同口径；失败不打断回合，回合末 save 会再落一次）。
      const prev = session.usage;
      session.usage = {
        total: used,
        input: prev?.input ?? 0,
        output: prev?.output ?? 0,
        reasoning: prev?.reasoning ?? 0,
        cacheRead: prev?.cacheRead ?? 0,
        cacheWrite: prev?.cacheWrite ?? 0,
      };
      void sink.save().catch(() => undefined);
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
    sink.upsert({ ...invoke, status: 'error', output: `opencode acp 出错：${result.error ?? '未知错误'} · ${summary}` });
    deps.emit({ type: 'error', sessionId: session.id, message: `${deps.config.name}（acp）：${result.error ?? '未知错误'}` });
  } else if (aborted) {
    sink.upsert({ ...invoke, status: 'rejected', output: `已被用户停止（待批已回 cancelled 并发送 session/cancel）· ${summary}` });
  } else {
    sink.upsert({ ...invoke, status: 'done', output: `完成 · ${summary} · 会话 ${prepared.acpSessionId}` });
  }
  await sink.save();
}
