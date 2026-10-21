/**
 * opencode serve 逐条工具审批原型（FR-116、宪法 九，specs/002-workspace-boards T125，任务卡 T-022）。
 *
 * T127（任务卡 T-034）起已在实验开关下接入：serve-runner.ts 负责常驻服务器与一轮对话，handlers.ts 按
 * `opencodeMode`（后端内部设置 / 环境变量 AICM_OPENCODE_MODE，默认 acp）选择；serve 启动失败回退到 run 模式（cli-runner.ts）。
 * 权限映射使用契约 v1.3 的 ApprovalKind（见 toApprovalRequest）。
 *
 * ───────────────────────── 评估结论（实测 opencode-ai 1.19.3，2026-10-20，Linux 沙箱 + 本地假 OpenAI 兼容模型）─────────────────────────
 *
 * 可行性：可行。真实二进制上跑通「建会话 → prompt_async → SSE 收到 permission.asked → 逐条 once/reject → 工具执行或报错 → session.idle」，
 * bash 与 write 两类工具都逐条弹出、逐条生效（本模块的 runServeTurn 也直接对真实 serve 跑通了 ask / auto-edits / 停止三种场景）；拒绝后工具 state 为 error（文案 "The user rejected permission to use this specific
 * tool call with the following feedback: …"），文件确实未写、命令确实未执行。
 *
 * 实测 API 形状（1.19.3，/doc 的 OpenAPI 3.1；测试夹具 tests/unit/backend/agent-cli/opencode-serve.test.ts 中逐字记录）：
 * - 启动：`opencode serve --port 0 --hostname 127.0.0.1`，stdout 打印 `opencode server listening on http://127.0.0.1:<port>`；
 *   设 `OPENCODE_SERVER_PASSWORD` 后全部路由要求 HTTP Basic（用户名 `opencode`），否则 401 + `WWW-Authenticate: Basic`；
 *   未设时 stdout 警告 "server is unsecured"。
 * - 所有实例路由带 `?directory=<项目根>` 选择工作目录（一个 serve 可服务多个目录）。
 * - `GET /global/health` → `{"healthy":true,"version":"1.19.3"}`。
 * - `POST /session` body `{title?, agent?, model?, permission?: [{permission, pattern, action: allow|deny|ask}]}` → Session（id `ses_…`）。
 *   **会话级 permission 规则集可用，且必须传**：不传时默认全部 allow（bash/write 直接执行，不发 permission.asked）。
 *   规则后者覆盖前者（`[*:ask, bash:deny]` 下 bash 被禁）；deny 的工具会从模型可用工具列表中移除（模型调用得到 "unavailable tool"）。
 * - `POST /session/:id/prompt_async` body `{parts:[{type:'text',text}], model?:{providerID,modelID}, agent?}` → 204，立即返回。
 * - `GET /event?directory=` SSE：仅 `data: <json>\n\n`，无 `event:` 行；首条 `server.connected`，周期性 `server.heartbeat`；
 *   事件形如 `{id:'evt_…', type, properties}`。本原型用到：permission.asked / permission.replied / message.part.updated /
 *   message.part.delta / session.status / session.idle / session.error。
 * - permission.asked.properties = `{id:'per_…', sessionID, permission:'bash'|'edit'|…, patterns, metadata, always, tool?:{messageID, callID}}`；
 *   bash 的 metadata = `{command}`；edit（write/edit 工具）的 metadata = `{filepath(绝对路径), diff(统一 diff)}`。
 * - 回复：`POST /permission/:requestID/reply` body `{reply:'once'|'always'|'reject', message?}` → `true`；
 *   旧路由 `POST /session/:id/permissions/:permissionID` body `{response}` 仍可用（已弃用倾向）。`GET /permission` 列出待批。
 * - `POST /session/:id/abort` → `true`，随后 session.error `MessageAbortedError`、工具 error "Tool execution aborted"。
 *
 * 稳定性 / 1.19.x 特性与风险：
 * 1. 事件顺序：permission.asked 可能早于工具 part 的 running 状态（此时 part.state.input 为 `{}`），审批内容必须取自权限事件的
 *    metadata（command / diff），不能依赖工具 part。
 * 2. 拒绝不中止本轮：1.19.3 的 reject 只让该工具调用失败，模型会继续下一步（实测拒绝 bash 后仍继续发起 write 并再次询问）。
 *    「停止」须显式 abort。
 * 3. abort 不清理待批：abort 后该权限仍留在 `GET /permission` 中（实测十余分钟后仍在），不发 permission.replied。原型在停止时先对本会话所有待批回 reject
 *    再 abort（宪法 九「停止时待批准视为拒绝」）。
 * 4. 默认放行：未传规则集即全部 allow，风险最高；原型每个会话都显式下发规则集，并 deny `external_directory`（宪法 十一）。
 * 5. schema 易变：同一 serve 同时暴露 v1（/session、/event、permission.asked）与 v2（/api/session、permission.v2.asked、
 *    `{action, resources}` 形状）两套 API，官方正在迁移到 v2；本原型绑定 v1，升级 opencode 需回归测试（夹具即回归基线）。
 * 6. 进程管理：常驻服务器 + 随机端口 + 随机密码，需在应用退出时结束进程树（Windows taskkill /T /F）；首个 prompt 冷启动较慢
 *    （实测加载 provider 插件数秒）。SSE 断线需重连并用 `GET /permission` 对账，原型已实现一次性对账与有限次重连。
 * 7. 文本为 token 级增量（message.part.delta），比 run 模式（整段 part）体验更好。
 *
 * 建议：采纳为「每次询问 / 自动批准编辑」模式的后续实现路径（ADR 0006 修订：从「备选」升为「计划中」），但保留 run 模式作为默认与回退：
 * 先在设置中以实验开关接入，权限映射改为会话级规则集（每次询问：edit/bash=ask；自动批准编辑：edit=allow、bash=ask；
 * 仅规划：edit/bash=deny + agent plan；三者均 external_directory=deny），从不回复 `always`。接入前需 contracts 泳道另开卡
 * （ApprovalRequest 需能表达 opencode 的其他权限类型，如 webfetch / doom_loop / task）。锁定 opencode 版本范围 1.19.x。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import type { ApprovalRequest, PermissionMode } from '../../../contracts/ipc.ts';
import { parseOpencodeLine, type OpencodeEvent } from './opencode-events.ts';
import { opencodeLaunchEnv } from './platform-env.ts';

// ───────────────────────── 类型（只描述原型用到的 v1 字段） ─────────────────────────

export type ServePermissionAction = 'allow' | 'deny' | 'ask';
export interface ServePermissionRule {
  permission: string;
  pattern: string;
  action: ServePermissionAction;
}
export type ServePermissionReply = 'once' | 'always' | 'reject';

export interface ServePermissionRequest {
  id: string;
  sessionID: string;
  permission: string;
  patterns: string[];
  metadata: Record<string, unknown>;
  always: string[];
  tool?: { messageID: string; callID: string };
}

export interface ServeEvent {
  id: string;
  type: string;
  properties: Record<string, unknown>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const rec = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

// ───────────────────────── 纯函数 ─────────────────────────

const LISTENING = /opencode server listening on (https?:\/\/[^\s]+)/;

/** 从 serve 的 stdout 行中解析监听地址。 */
export function parseListeningUrl(line: string): string | null {
  const m = LISTENING.exec(line);
  return m?.[1] ? m[1].replace(/\/+$/, '') : null;
}

/**
 * 权限模式 → opencode 会话级规则集（后者覆盖前者）。
 * 不下发规则集时 opencode 默认全部放行，因此任何会话都必须带上本规则集。
 */
export function serveRules(mode: PermissionMode): ServePermissionRule[] {
  const base: ServePermissionRule[] = [{ permission: '*', pattern: '*', action: 'allow' }];
  const tail: ServePermissionRule[] = [
    { permission: 'doom_loop', pattern: '*', action: 'ask' },
    { permission: 'external_directory', pattern: '*', action: 'deny' },
    // 本客户端没有承接 question 的界面：直接禁用，避免模型调用后失败（另有 OPENCODE_ENABLE_QUESTION_TOOL=false 双保险）。
    { permission: 'question', pattern: '*', action: 'deny' },
  ];
  if (mode === 'plan') {
    return [...base, { permission: 'edit', pattern: '*', action: 'deny' }, { permission: 'bash', pattern: '*', action: 'deny' }, ...tail];
  }
  if (mode === 'allow-all') {
    // 全部允许（v1.6）：不再弹审批；但项目根沙箱不可协商，越界目录照旧拒绝。
    return [...base, { permission: 'edit', pattern: '*', action: 'allow' }, { permission: 'bash', pattern: '*', action: 'allow' }, { permission: 'external_directory', pattern: '*', action: 'deny' }, { permission: 'question', pattern: '*', action: 'deny' }];
  }
  const edit: ServePermissionAction = mode === 'auto-edits' ? 'allow' : 'ask';
  // 宪法 九：命令永远需要批准（自动批准编辑也不例外）。
  return [...base, { permission: 'edit', pattern: '*', action: edit }, { permission: 'bash', pattern: '*', action: 'ask' }, ...tail];
}

export function parsePermissionRequest(v: unknown): ServePermissionRequest | null {
  const p = rec(v);
  const id = str(p.id);
  const sessionID = str(p.sessionID);
  if (!id.startsWith('per') || !sessionID) return null;
  const tool = rec(p.tool);
  const out: ServePermissionRequest = {
    id, sessionID, permission: str(p.permission) || 'unknown', patterns: strArr(p.patterns), metadata: rec(p.metadata), always: strArr(p.always),
  };
  if (str(tool.callID)) out.tool = { messageID: str(tool.messageID), callID: str(tool.callID) };
  return out;
}

function relPath(root: string, p: string): string {
  const rel = path.isAbsolute(p) ? path.relative(root, p) : p;
  return rel.split(path.sep).join('/');
}

/**
 * opencode 权限请求 → 应用 ApprovalRequest（契约 v1.3）。内容取自权限事件 metadata（工具 part 此时可能尚无 input）。
 * 每种都附原始 `permission` 与 `patterns`：
 * - edit → edit（相对路径 + diff）；bash → command；webfetch → webfetch（url）；doom_loop → loop（tool + 说明）；
 *   task → subagent（子任务说明，patterns 为子 agent 类型）；external_directory → external-dir（项目外绝对路径；
 *   规则集默认 deny，仅在仍被询问时如实展示）；其余 → other（说明 `opencode 权限：<名>`）。
 */
export function toApprovalRequest(perm: ServePermissionRequest, opts: { approvalId: string; appSessionId: string; projectRoot: string }): ApprovalRequest {
  const toolCallId = perm.tool?.callID || perm.id;
  const md = perm.metadata;
  const base = { id: opts.approvalId, sessionId: opts.appSessionId, toolCallId, permission: perm.permission, patterns: [...perm.patterns] };
  const first = perm.patterns[0] ?? '';
  switch (perm.permission) {
    case 'edit': {
      const file = str(md.filepath) || first;
      const diff = str(md.diff);
      return { ...base, kind: 'edit', path: file ? relPath(opts.projectRoot, file) : '', ...(diff ? { diff } : {}) };
    }
    case 'bash': {
      const command = str(md.command) || perm.patterns.join('\n');
      return { ...base, kind: 'command', command, shell: 'opencode bash 工具（opencode 自行执行）' };
    }
    case 'webfetch': {
      const url = str(md.url) || first;
      return { ...base, kind: 'webfetch', url };
    }
    case 'doom_loop': {
      const tool = str(md.tool) || first || 'unknown';
      return { ...base, kind: 'loop', tool, description: `工具 ${tool} 正以相同参数重复调用（疑似死循环），是否继续？` };
    }
    case 'task': {
      const description = str(md.description) || str(md.prompt) || `启动子 agent：${first || 'general'}`;
      return { ...base, kind: 'subagent', description };
    }
    case 'external_directory': {
      const dir = str(md.parentDir) || str(md.filepath) || first.replace(/[\\/]\*+$/, '');
      return { ...base, kind: 'external-dir', path: dir, description: '访问项目根以外的目录（项目根沙箱默认拒绝）' };
    }
    default:
      return { ...base, kind: 'other', description: str(md.description) || `opencode 权限：${perm.permission}` };
  }
}

/** SSE 增量解析器：喂入文本块，返回完整事件（仅 data 行，多行 data 以 \n 连接）。 */
export function createSseParser(): (chunk: string) => ServeEvent[] {
  let buf = '';
  return (chunk) => {
    buf += chunk.replace(/\r\n/g, '\n');
    const out: ServeEvent[] = [];
    let i: number;
    while ((i = buf.indexOf('\n\n')) !== -1) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = block.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n');
      if (!data) continue;
      try {
        const j = rec(JSON.parse(data));
        if (typeof j.type === 'string') out.push({ id: str(j.id), type: j.type, properties: rec(j.properties) });
      } catch {
        // 非 JSON 的 data 行忽略（服务器不会发送；容错）
      }
    }
    return out;
  };
}

/**
 * serve 事件 → 既有 run 模式的 OpencodeEvent（复用 opencode-events.ts 的解析与 toolStatus/diffForTool）。
 * message.part.updated 的 part 形状与 run 模式 JSONL 中的 part 相同；文本增量另以 text-delta 返回。
 */
export type ServeMappedEvent =
  | OpencodeEvent
  | { kind: 'text-delta'; sessionId: string; partId: string; delta: string }
  | { kind: 'idle'; sessionId: string }
  | { kind: 'busy'; sessionId: string };

const PART_TYPE: Record<string, string> = { text: 'text', tool: 'tool_use', 'step-start': 'step_start', 'step-finish': 'step_finish' };

export function mapServeEvent(ev: ServeEvent): ServeMappedEvent | null {
  const p = ev.properties;
  const sessionID = str(p.sessionID);
  switch (ev.type) {
    case 'message.part.updated': {
      const part = rec(p.part);
      const t = PART_TYPE[str(part.type)];
      if (!t) return null;
      return parseOpencodeLine(JSON.stringify({ type: t, sessionID: sessionID || str(part.sessionID), part }));
    }
    case 'message.part.delta':
      if (str(p.field) !== 'text') return null;
      return { kind: 'text-delta', sessionId: sessionID, partId: str(p.partID), delta: str(p.delta) };
    case 'session.error':
      return parseOpencodeLine(JSON.stringify({ type: 'error', sessionID, error: p.error }));
    case 'session.idle':
      return { kind: 'idle', sessionId: sessionID };
    case 'session.status': {
      const s = str(rec(p.status).type);
      if (s === 'idle') return { kind: 'idle', sessionId: sessionID };
      if (s === 'busy' || s === 'retry') return { kind: 'busy', sessionId: sessionID };
      return null;
    }
    default:
      return null;
  }
}

// ───────────────────────── HTTP 客户端 ─────────────────────────

export class OpencodeServeError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'OpencodeServeError';
    this.status = status;
  }
}

export interface ServeClientOptions {
  baseUrl: string;
  /** 项目根，作为 ?directory= 传给每个实例路由。 */
  directory: string;
  /** OPENCODE_SERVER_PASSWORD；有则发 Basic 认证（用户名 opencode）。 */
  password?: string;
  fetch?: FetchLike;
}

export class OpencodeServeClient {
  readonly baseUrl: string;
  readonly directory: string;
  private readonly auth: string | null;
  private readonly doFetch: FetchLike;

  constructor(opts: ServeClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.directory = opts.directory;
    this.auth = opts.password ? `Basic ${Buffer.from(`opencode:${opts.password}`).toString('base64')}` : null;
    this.doFetch = opts.fetch ?? ((input, init) => fetch(input, init));
  }

  private url(p: string, withDir = true): string {
    return `${this.baseUrl}${p}${withDir ? `?directory=${encodeURIComponent(this.directory)}` : ''}`;
  }

  private headers(json: boolean): Record<string, string> {
    const h: Record<string, string> = {};
    if (json) h['content-type'] = 'application/json';
    if (this.auth) h.authorization = this.auth;
    return h;
  }

  private async call(method: string, p: string, body?: unknown, withDir = true): Promise<unknown> {
    const res = await this.doFetch(this.url(p, withDir), {
      method, headers: this.headers(body !== undefined), ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    if (!res.ok) throw new OpencodeServeError(`opencode serve ${method} ${p} → ${res.status}${text ? `：${text.slice(0, 200)}` : ''}`, res.status);
    if (!text) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }

  async health(): Promise<{ healthy: boolean; version: string }> {
    const j = rec(await this.call('GET', '/global/health', undefined, false));
    return { healthy: j.healthy === true, version: str(j.version) };
  }

  async createSession(input: { title?: string; agent?: string; permission: ServePermissionRule[] }): Promise<string> {
    const j = rec(await this.call('POST', '/session', input));
    const id = str(j.id);
    if (!id.startsWith('ses')) throw new OpencodeServeError('opencode serve 未返回会话 ID', 0);
    return id;
  }

  async promptAsync(sessionId: string, input: { text: string; agent?: string; model?: { providerID: string; modelID: string } }): Promise<void> {
    await this.call('POST', `/session/${encodeURIComponent(sessionId)}/prompt_async`, {
      parts: [{ type: 'text', text: input.text }], ...(input.agent ? { agent: input.agent } : {}), ...(input.model ? { model: input.model } : {}),
    });
  }

  async listPermissions(): Promise<ServePermissionRequest[]> {
    const j = await this.call('GET', '/permission');
    return Array.isArray(j) ? j.map(parsePermissionRequest).filter((x): x is ServePermissionRequest => x !== null) : [];
  }

  async replyPermission(requestId: string, reply: ServePermissionReply, message?: string): Promise<void> {
    await this.call('POST', `/permission/${encodeURIComponent(requestId)}/reply`, { reply, ...(message ? { message } : {}) });
  }

  async abort(sessionId: string): Promise<void> {
    await this.call('POST', `/session/${encodeURIComponent(sessionId)}/abort`);
  }

  /** 打开 SSE 流；返回事件异步迭代器，signal 中止时结束。 */
  async *events(signal: AbortSignal): AsyncGenerator<ServeEvent> {
    const res = await this.doFetch(this.url('/event'), { method: 'GET', headers: { ...this.headers(false), accept: 'text/event-stream' }, signal });
    if (!res.ok || !res.body) throw new OpencodeServeError(`opencode serve 事件流打开失败：${res.status}`, res.status);
    const parse = createSseParser();
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        for (const ev of parse(dec.decode(value, { stream: true }))) yield ev;
      }
    } finally {
      reader.releaseLock();
    }
  }
}

// ───────────────────────── 一轮逐条审批 ─────────────────────────

export interface ServeApprovalRecord {
  permissionId: string;
  permission: string;
  toolCallId: string;
  approved: boolean;
}

export interface ServeTurnDeps {
  client: Pick<OpencodeServeClient, 'promptAsync' | 'listPermissions' | 'replyPermission' | 'abort' | 'events'>;
  /** opencode 会话 ID（已用 serveRules 创建）。 */
  sessionId: string;
  appSessionId: string;
  projectRoot: string;
  prompt: string;
  agent?: string;
  model?: { providerID: string; modelID: string };
  signal: AbortSignal;
  newId(): string;
  /** 逐条审批回调：true = 本次允许（once），false = 拒绝。永不回复 always。 */
  requestApproval(req: ApprovalRequest, perm: ServePermissionRequest): Promise<boolean>;
  /** 映射后的事件（工具、文本、错误等），交给调用方渲染。 */
  onEvent?(ev: ServeMappedEvent): void;
  /** SSE 意外断开时的最大重连次数（默认 2）。 */
  maxReconnects?: number;
}

export interface ServeTurnResult {
  status: 'idle' | 'aborted' | 'error';
  approvals: ServeApprovalRecord[];
  error?: string;
}

export const REJECT_MESSAGE = '用户拒绝了这次工具调用。';
export const STOP_MESSAGE = '用户已停止 agent。';

/**
 * 发送一条消息并逐条审批工具调用，直到会话回到 idle、被停止或出错。
 * 顺序：先订阅 SSE（确保不漏 permission.asked）→ 对账已有待批 → prompt_async → 处理事件。
 * 停止：先对本会话所有待批回 reject（opencode 的 abort 不清理待批）再 abort。
 */
export async function runServeTurn(deps: ServeTurnDeps): Promise<ServeTurnResult> {
  const { client, sessionId } = deps;
  const approvals: ServeApprovalRecord[] = [];
  const handled = new Set<string>();
  const inflight = new Set<Promise<void>>();
  const stream = new AbortController();
  let stopping = false;
  let busySeen = false;
  let stopPromise: Promise<void> | null = null;
  let markStopped: () => void = () => undefined;
  // 停止时让仍在等待用户的审批立即视为拒绝（不依赖调用方解除等待，避免死锁）
  const stopped = new Promise<false>((resolve) => {
    markStopped = () => resolve(false);
  });
  const isStopping = () => stopping || deps.signal.aborted;

  const decide = (perm: ServePermissionRequest): void => {
    if (perm.sessionID !== sessionId || handled.has(perm.id)) return;
    handled.add(perm.id);
    const task = (async () => {
      let approved = false;
      if (!isStopping()) {
        const req = toApprovalRequest(perm, { approvalId: deps.newId(), appSessionId: deps.appSessionId, projectRoot: deps.projectRoot });
        try {
          approved = await Promise.race([deps.requestApproval(req, perm), stopped]);
        } catch {
          approved = false;
        }
      }
      if (isStopping()) approved = false;
      approvals.push({ permissionId: perm.id, permission: perm.permission, toolCallId: perm.tool?.callID || perm.id, approved });
      await client.replyPermission(perm.id, approved ? 'once' : 'reject', approved ? undefined : (isStopping() ? STOP_MESSAGE : REJECT_MESSAGE))
        .catch(() => undefined); // 已被服务器清除（如会话结束）时回复会失败；停止流程会再对账
    })();
    inflight.add(task);
    void task.finally(() => inflight.delete(task));
  };

  const reconcile = async () => {
    for (const p of await client.listPermissions()) decide(p);
  };

  const stop = (): Promise<void> => {
    if (stopPromise) return stopPromise;
    stopping = true;
    markStopped();
    stopPromise = (async () => {
      try {
        await Promise.allSettled([...inflight]);
        const pending = await client.listPermissions().catch(() => [] as ServePermissionRequest[]);
        for (const p of pending) {
          if (p.sessionID !== sessionId) continue;
          if (!handled.has(p.id)) approvals.push({ permissionId: p.id, permission: p.permission, toolCallId: p.tool?.callID || p.id, approved: false });
          handled.add(p.id);
          await client.replyPermission(p.id, 'reject', STOP_MESSAGE).catch(() => undefined);
        }
      } finally {
        await client.abort(sessionId).catch(() => undefined);
        stream.abort();
      }
    })();
    return stopPromise;
  };
  const onAbort = () => void stop();
  deps.signal.addEventListener('abort', onAbort, { once: true });

  const maxReconnects = deps.maxReconnects ?? 2;
  let reconnects = 0;
  let prompted = false;
  let result: ServeTurnResult | null = null;
  try {
    while (result === null) {
      if (isStopping()) {
        await stop();
        result = { status: 'aborted', approvals };
        break;
      }
      const iter = client.events(stream.signal);
      let connected = false;
      try {
        for await (const ev of iter) {
          if (!connected) {
            connected = true;
            // 首个事件（server.connected）到达即已订阅：对账后再发消息
            await reconcile();
            if (!prompted) {
              prompted = true;
              await client.promptAsync(sessionId, { text: deps.prompt, ...(deps.agent ? { agent: deps.agent } : {}), ...(deps.model ? { model: deps.model } : {}) });
            }
          }
          if (ev.type === 'permission.asked') {
            const perm = parsePermissionRequest(ev.properties);
            if (perm) decide(perm);
            continue;
          }
          const mapped = mapServeEvent(ev);
          if (!mapped) continue;
          if ('sessionId' in mapped && mapped.sessionId && mapped.sessionId !== sessionId) continue;
          if (mapped.kind === 'busy') busySeen = true;
          deps.onEvent?.(mapped);
          if (mapped.kind === 'idle' && busySeen) {
            result = { status: stopping ? 'aborted' : 'idle', approvals };
            break;
          }
          if (mapped.kind === 'error' && stopping) {
            result = { status: 'aborted', approvals };
            break;
          }
        }
      } catch (err) {
        if (isStopping()) {
          result = { status: 'aborted', approvals };
          break;
        }
        if (reconnects >= maxReconnects) {
          result = { status: 'error', approvals, error: err instanceof Error ? err.message : String(err) };
          break;
        }
      }
      if (result !== null) break;
      if (isStopping()) {
        result = { status: 'aborted', approvals };
        break;
      }
      if (reconnects >= maxReconnects) {
        result = { status: 'error', approvals, error: 'opencode serve 事件流断开，重连次数已用尽' };
        break;
      }
      reconnects += 1;
    }
  } finally {
    deps.signal.removeEventListener('abort', onAbort);
    if (stopPromise) await stopPromise;
    stream.abort();
    await Promise.allSettled([...inflight]);
  }
  return result;
}

// ───────────────────────── 启动 / 附着服务器 ─────────────────────────

export interface ServeProcess {
  baseUrl: string;
  password: string;
  child: ChildProcess;
  close(): void;
}

export interface StartServeOptions {
  executable: string;
  cwd: string;
  password: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** 等待监听行的超时（毫秒，默认 15000）。 */
  timeoutMs?: number;
  spawnFn?: typeof spawn;
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
}

/**
 * 启动 `opencode serve --port 0 --hostname 127.0.0.1`（shell:false，随机端口，Basic 认证密码经环境变量注入），
 * 等待 stdout 打印监听地址。关闭时结束进程树。
 */
export function startOpencodeServe(opts: StartServeOptions): Promise<ServeProcess> {
  const platform = opts.platform ?? process.platform;
  const spawnFn = opts.spawnFn ?? spawn;
  const setT = opts.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT = opts.clearTimeoutFn ?? ((h) => clearTimeout(h as NodeJS.Timeout));
  const baseEnv = opts.env ?? process.env;
  const child = spawnFn(opts.executable, ['serve', '--port', '0', '--hostname', '127.0.0.1'], {
    // opencodeLaunchEnv：禁用 question 工具 + win32 shell 适配（Git Bash 探测 / PowerShell 回退），见 platform-env.ts。
    cwd: opts.cwd, env: { ...baseEnv, OPENCODE_SERVER_PASSWORD: opts.password, ...opencodeLaunchEnv(platform, baseEnv) }, shell: false, windowsHide: true,
    detached: platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
  });
  const close = () => {
    if (child.pid === undefined || child.exitCode !== null) return;
    try {
      if (platform === 'win32') spawnFn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      else process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  };
  return new Promise((resolve, reject) => {
    let out = '';
    let errTail = '';
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearT(timer);
      fn();
    };
    const timer = setT(() => finish(() => {
      close();
      reject(new Error(`opencode serve 启动超时${errTail.trim() ? `：${errTail.trim().slice(-500)}` : ''}`));
    }), opts.timeoutMs ?? 15000);
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      out += chunk;
      const url = parseListeningUrl(out);
      if (url) finish(() => resolve({ baseUrl: url, password: opts.password, child, close }));
    });
    child.stderr?.on('data', (chunk: string) => {
      errTail = (errTail + chunk).slice(-2000);
    });
    child.once('error', (err) => finish(() => reject(new Error(`无法启动 opencode serve：${err.message}`))));
    child.once('exit', (code) => finish(() => reject(new Error(`opencode serve 提前退出（退出码 ${String(code)}）${errTail.trim() ? `：${errTail.trim().slice(-500)}` : ''}`))));
  });
}

/** 附着到已运行的 serve：校验健康并返回客户端（版本不在 1.19.x 时由调用方决定是否继续）。 */
export async function attachOpencodeServe(opts: ServeClientOptions): Promise<{ client: OpencodeServeClient; version: string; supported: boolean }> {
  const client = new OpencodeServeClient(opts);
  const h = await client.health();
  if (!h.healthy) throw new OpencodeServeError('opencode serve 不健康', 0);
  return { client, version: h.version, supported: /^1\.19\./.test(h.version) };
}
