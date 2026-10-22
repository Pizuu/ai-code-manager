/**
 * IPC 运行时参数校验（信任边界：渲染进程 → 主进程）。
 * 失败抛出 `E_VALIDATION: …`，错误码定义见 contracts/ipc.ts 的 IpcErrorCode。
 */
import type {
  AgentCliInput,
  AgentCliOutputFormat,
  AgentCliPreset,
  AgentRef,
  AgentSendRequest,
  ApprovalDecision,
  IpcErrorCode,
  PermissionMode,
  ProviderId,
  SettingsUpdate,
  TerminalCloseRequest,
  TerminalInputRequest,
  TerminalKind,
  TerminalOpenRequest,
} from '../../../contracts/ipc.ts';

export const MAX_MESSAGE_CHARS = 200_000;
const MAX_FIELD_CHARS = 2_000;
const MAX_REL_PATH_CHARS = 1_000;
const PROVIDERS: readonly ProviderId[] = ['openai', 'anthropic'];
const MODES: readonly PermissionMode[] = ['ask', 'auto-edits', 'plan', 'allow-all'];
const SESSION_ID_RE = /^[A-Za-z0-9-]{1,64}$/;

/** 构造带错误码的 Error，供 handler 抛出。 */
export function ipcError(code: IpcErrorCode, message: string): Error {
  return new Error(`${code}: ${message}`);
}

function fail(message: string): never {
  throw ipcError('E_VALIDATION', message);
}

export function asRecord(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(`${name} 必须是对象`);
  return value as Record<string, unknown>;
}

export function asString(value: unknown, name: string, opts: { max?: number; allowEmpty?: boolean } = {}): string {
  if (typeof value !== 'string') fail(`${name} 必须是字符串`);
  const max = opts.max ?? MAX_FIELD_CHARS;
  if (value.length > max) fail(`${name} 超过 ${max} 字符`);
  if (!opts.allowEmpty && value.trim() === '') fail(`${name} 不能为空`);
  return value;
}

export function asOneOf<T extends string>(value: unknown, allowed: readonly T[], name: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    fail(`${name} 必须是 ${allowed.join(' / ')} 之一`);
  }
  return value as T;
}

export function asSessionId(value: unknown): string {
  const id = asString(value, 'sessionId', { max: 64 });
  if (!SESSION_ID_RE.test(id)) fail('sessionId 格式非法');
  return id;
}

export function asRelDir(value: unknown): string {
  return asString(value, 'relDir', { max: MAX_REL_PATH_CHARS, allowEmpty: true });
}

/** v1.2：fs:read 的文件相对路径（非空；越界由沙箱判定）。 */
export function asRelPath(value: unknown): string {
  return asString(value, 'relPath', { max: MAX_REL_PATH_CHARS });
}

const MAX_ARRAY_ITEMS = 100;

/** v1.14：字符串数组参数（如 files:import 的绝对路径列表）；必须是数组，逐项按普通字符串校验。 */
export function asStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value)) fail(`${name} 必须是数组`);
  if (value.length > MAX_ARRAY_ITEMS) fail(`${name} 最多 ${MAX_ARRAY_ITEMS} 项`);
  return value.map((v) => asString(v, name));
}

const MAX_BRANCH_CHARS = 255;

/**
 * git:checkout 的分支名：非空字符串；不以 '-' 开头（防被 git 当作选项），
 * 不含空白与控制字符（git 引用名规则同样禁止，提前以 E_VALIDATION 拒绝）。
 * 切换时以参数数组传给 git（不经 shell），此处校验是第二道防线。
 */
export function asBranchName(value: unknown): string {
  const name = asString(value, 'branch', { max: MAX_BRANCH_CHARS }).trim();
  if (name.startsWith('-')) fail('branch 不能以 - 开头');
  if ([...name].some((ch) => (ch.codePointAt(0) ?? 0) <= 0x20 || ch.codePointAt(0) === 0x7f)) fail('branch 不能包含空白或控制字符');
  return name;
}

const FEATURE_ID_RE = /^\d{3}-[^/\\]+$/;

/**
 * v1.4：board:setFeature 的参数 { featureId }。null = 回到自动（最新）；
 * 非 null 必须是 specs 目录 id 的形状（NNN- 前缀且不含路径分隔符，防路径注入），
 * 真实存在性由 handler 再按该项目 specs 列表校验（不在列表内同样拒绝）。
 */
export function asFeatureSelection(value: unknown): string | null {
  const v = asRecord(value, 'featureSelection');
  const id = v.featureId;
  if (id === null) return null;
  if (typeof id !== 'string' || id.length > MAX_FIELD_CHARS || !FEATURE_ID_RE.test(id)) {
    fail('featureId 必须是 specs 目录 id（NNN-*）或 null');
  }
  return id;
}

export const MAX_SESSION_MODEL_CHARS = 200;

/**
 * v1.5：agent:setSessionModel 的参数 { sessionId, model }。
 * model 为 null / 缺省 / trim 后为空串 = 清除会话级覆盖（返回 null）；非空须为 trim 后 ≤200 字符的字符串。
 */
export function asSessionModelInput(value: unknown): { sessionId: string; model: string | null } {
  const v = asRecord(value, 'sessionModel');
  const sessionId = asSessionId(v.sessionId);
  if (v.model === null || v.model === undefined) return { sessionId, model: null };
  if (typeof v.model !== 'string') fail('model 必须是字符串或 null');
  const model = v.model.trim();
  if (model.length > MAX_SESSION_MODEL_CHARS) fail(`model 超过 ${MAX_SESSION_MODEL_CHARS} 字符`);
  return { sessionId, model: model === '' ? null : model };
}

/** baseUrl：空字符串 = 清空（003 起默认空白，由用户填写）；非空须为 http(s) URL。 */
function asHttpUrl(value: unknown): string {
  const raw = asString(value, 'baseUrl', { max: MAX_FIELD_CHARS, allowEmpty: true }).trim();
  if (raw === '') return '';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    fail('baseUrl 不是合法 URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') fail('baseUrl 只支持 http(s)');
  return raw.replace(/\/+$/, '');
}

export function validateSettingsUpdate(value: unknown): SettingsUpdate {
  const v = asRecord(value, 'settings');
  const out: SettingsUpdate = {};
  if (v.provider !== undefined) out.provider = asOneOf(v.provider, PROVIDERS, 'provider');
  if (v.baseUrl !== undefined) out.baseUrl = asHttpUrl(v.baseUrl);
  if (v.model !== undefined) out.model = asString(v.model, 'model', { max: 200, allowEmpty: true }).trim();
  if (v.permissionMode !== undefined) out.permissionMode = asOneOf(v.permissionMode, MODES, 'permissionMode');
  if (v.defaultAgent !== undefined) out.defaultAgent = asAgentRef(v.defaultAgent);
  if (v.apiKey !== undefined) {
    const k = asRecord(v.apiKey, 'apiKey');
    out.apiKey = {
      provider: asOneOf(k.provider, PROVIDERS, 'apiKey.provider'),
      value: asString(k.value, 'apiKey.value', { max: 1_000, allowEmpty: true }).trim(),
    };
  }
  return out;
}

export function validateSendRequest(value: unknown): AgentSendRequest {
  const v = asRecord(value, 'request');
  const out: AgentSendRequest = {
    sessionId: asSessionId(v.sessionId),
    text: asString(v.text, 'text', { max: MAX_MESSAGE_CHARS }),
  };
  // v1.11：可选布尔，透传给 startTurn 做「重提不重复」截断；非布尔值按未设置处理，不报错。
  if (typeof v.reaskLatest === 'boolean') out.reaskLatest = v.reaskLatest;
  return out;
}

const MAX_FILE_WRITE_CHARS = 2_500_000;
export function validateFileWriteRequest(value: unknown): { relPath: string; content: string } {
  const v = asRecord(value, 'fileWrite');
  const content = asString(v.content, 'content', { max: MAX_FILE_WRITE_CHARS, allowEmpty: true });
  if (content.includes('\0')) fail('content 不能包含 NUL');
  return { relPath: asRelPath(v.relPath), content };
}

export function validateApprovalDecision(value: unknown): ApprovalDecision {
  const v = asRecord(value, 'decision');
  if (typeof v.approved !== 'boolean') fail('approved 必须是布尔值');
  return { approvalId: asString(v.approvalId, 'approvalId', { max: 100 }), approved: v.approved };
}

export function validateSessionTodosUpdate(value: unknown): { sessionId: string; todos: Array<{ id: string; content: string; status: 'pending' | 'in_progress' | 'completed' }> } {
  const v = asRecord(value, 'sessionTodos');
  if (!Array.isArray(v.todos) || v.todos.length > 100) fail('todos 必须是最多 100 项的数组');
  const todos = v.todos.map((item, i) => {
    const t = asRecord(item, `todos[${i}]`);
    const status = asOneOf(t.status, ['pending', 'in_progress', 'completed'] as const, `todos[${i}].status`);
    return { id: asString(t.id, `todos[${i}].id`, { max: 100 }), content: asString(t.content, `todos[${i}].content`, { max: 1_000 }).trim(), status };
  });
  if (todos.some((t) => !t.content)) fail('待办内容不能为空');
  return { sessionId: asSessionId(v.sessionId), todos };
}

// ───────── v1.6：终端模式 ─────────

const TERMINAL_KINDS: readonly TerminalKind[] = ['shell', 'cli'];
/** 单次输入上限（一条命令的长度）。 */
export const MAX_TERMINAL_INPUT_CHARS = 8_000;

/**
 * terminal:open 的参数。kind 缺省 = 'shell'；restart 缺省 = false（复用已有终端）。
 * 渲染进程不能指定工作目录或命令原文——主进程按 kind 决定（宪法 十一：工作目录恒为项目根）。
 */
export function asTerminalOpenRequest(value: unknown): TerminalOpenRequest {
  const v = asRecord(value, 'terminalOpen');
  const kind = v.kind === undefined ? 'shell' : asOneOf(v.kind, TERMINAL_KINDS, 'kind');
  const restart = v.restart === undefined ? false : v.restart;
  if (typeof restart !== 'boolean') fail('restart 必须是布尔值');
  return { sessionId: asSessionId(v.sessionId), kind, restart };
}

/** terminal:input 的参数：data 为用户输入原文（允许含换行，长度受限）。 */
export function asTerminalInputRequest(value: unknown): TerminalInputRequest {
  const v = asRecord(value, 'terminalInput');
  const data = asString(v.data, 'data', { max: MAX_TERMINAL_INPUT_CHARS, allowEmpty: true });
  if (/\0/.test(data)) fail('data 不能包含 NUL');
  return { sessionId: asSessionId(v.sessionId), data };
}

/** terminal:close 的参数。 */
export function asTerminalCloseRequest(value: unknown): TerminalCloseRequest {
  const v = asRecord(value, 'terminalClose');
  return { sessionId: asSessionId(v.sessionId) };
}

// ───────── v1.1：Agent CLI（功能 002） ─────────

const CLI_ID_RE = /^[a-z0-9-]{1,40}$/;
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,100}$/;
const PRESETS: readonly AgentCliPreset[] = ['opencode', 'custom'];
const FORMATS: readonly AgentCliOutputFormat[] = ['opencode-json', 'text'];
const MAX_ARGS = 40;
const MAX_ENV = 30;

export function asCliId(value: unknown): string {
  const id = asString(value, 'id', { max: 40 });
  if (!CLI_ID_RE.test(id)) fail('Agent CLI id 格式非法');
  return id;
}

export function asAgentRef(value: unknown): AgentRef {
  const v = asString(value, 'agent', { max: 60 });
  if (v === 'builtin') return 'builtin';
  if (v.startsWith('cli:') && CLI_ID_RE.test(v.slice(4))) return v as AgentRef;
  fail('agent 必须是 builtin 或 cli:<id>');
}

function asArgList(value: unknown, name: string): string[] {
  if (!Array.isArray(value)) fail(`${name} 必须是字符串数组`);
  if (value.length > MAX_ARGS) fail(`${name} 最多 ${MAX_ARGS} 项`);
  return value.map((a, i) => {
    const s = asString(a, `${name}[${i}]`, { max: 2_000, allowEmpty: true });
    if (/[\0\r\n]/.test(s)) fail(`${name}[${i}] 不能包含换行或 NUL`);
    return s;
  });
}

export function validateAgentCliInput(value: unknown): AgentCliInput {
  const v = asRecord(value, 'agentCli');
  const command = asString(v.command, 'command', { max: 1_000 }).trim();
  if (/[\0\r\n]/.test(command)) fail('command 不能包含换行或 NUL');
  if (!Array.isArray(v.env)) fail('env 必须是数组');
  if (v.env.length > MAX_ENV) fail(`env 最多 ${MAX_ENV} 项`);
  const names = new Set<string>();
  const env = (v.env as unknown[]).map((raw, i) => {
    const e = asRecord(raw, `env[${i}]`);
    const name = asString(e.name, `env[${i}].name`, { max: 101 }).trim();
    if (!ENV_NAME_RE.test(name)) fail(`环境变量名非法：${name}`);
    if (names.has(name)) fail(`环境变量重复：${name}`);
    names.add(name);
    if (typeof e.secret !== 'boolean') fail(`env[${i}].secret 必须是布尔值`);
    const out: { name: string; secret: boolean; value?: string } = { name, secret: e.secret };
    if (e.value !== undefined) out.value = asString(e.value, `env[${i}].value`, { max: 4_000, allowEmpty: true });
    return out;
  });
  const input: AgentCliInput = {
    name: asString(v.name, 'name', { max: 60 }).trim(),
    preset: asOneOf(v.preset, PRESETS, 'preset'),
    command,
    args: asArgList(v.args, 'args'),
    resumeArgs: asArgList(v.resumeArgs, 'resumeArgs'),
    modelArgs: asArgList(v.modelArgs, 'modelArgs'),
    model: asString(v.model ?? '', 'model', { max: 200, allowEmpty: true }).trim(),
    outputFormat: asOneOf(v.outputFormat, FORMATS, 'outputFormat'),
    env,
  };
  if (v.id !== undefined && v.id !== null && v.id !== '') input.id = asCliId(v.id);
  return input;
}
