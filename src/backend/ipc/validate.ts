/**
 * IPC 运行时参数校验（信任边界：渲染进程 → 主进程）。
 * 失败抛出 `E_VALIDATION: …`，错误码定义见 contracts/ipc.ts 的 IpcErrorCode。
 */
import type {
  AgentSendRequest,
  ApprovalDecision,
  IpcErrorCode,
  PermissionMode,
  ProviderId,
  SettingsUpdate,
} from '../../../contracts/ipc.ts';

export const MAX_MESSAGE_CHARS = 200_000;
const MAX_FIELD_CHARS = 2_000;
const MAX_REL_PATH_CHARS = 1_000;
const PROVIDERS: readonly ProviderId[] = ['openai', 'anthropic'];
const MODES: readonly PermissionMode[] = ['ask', 'auto-edits', 'plan'];
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

function asHttpUrl(value: unknown): string {
  const raw = asString(value, 'baseUrl', { max: MAX_FIELD_CHARS });
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
  if (v.model !== undefined) out.model = asString(v.model, 'model', { max: 200 }).trim();
  if (v.permissionMode !== undefined) out.permissionMode = asOneOf(v.permissionMode, MODES, 'permissionMode');
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
  return {
    sessionId: asSessionId(v.sessionId),
    text: asString(v.text, 'text', { max: MAX_MESSAGE_CHARS }),
  };
}

export function validateApprovalDecision(value: unknown): ApprovalDecision {
  const v = asRecord(value, 'decision');
  if (typeof v.approved !== 'boolean') fail('approved 必须是布尔值');
  return { approvalId: asString(v.approvalId, 'approvalId', { max: 100 }), approved: v.approved };
}
