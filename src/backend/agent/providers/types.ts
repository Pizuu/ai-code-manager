/**
 * 模型提供方统一接口。内部消息格式中立（contracts/ipc.ts 的 ChatMessage），各实现负责协议转换。
 */
import type { ChatMessage, ProviderId } from '../../../../contracts/ipc.ts';
import type { ToolDefinition } from '../../../../contracts/tools.ts';

export interface ProviderRequest {
  model: string;
  system: string;
  messages: ChatMessage[];
  tools: readonly ToolDefinition[];
  signal: AbortSignal;
}

export interface ProviderToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  /** 参数 JSON 无法解析时的说明；执行器据此直接返回参数错误。 */
  inputError?: string;
}

export interface ProviderResult {
  text: string;
  toolCalls: ProviderToolCall[];
  stopReason: string | null;
}

export interface Provider {
  readonly id: ProviderId;
  stream(req: ProviderRequest, onText: (delta: string) => void): Promise<ProviderResult>;
}

export interface ProviderConfig {
  baseUrl: string;
  /** 只在主进程内存中出现，绝不写入事件或错误信息。 */
  apiKey: string;
  fetchImpl?: typeof fetch;
}

/** 单个错误响应体回显的最大字符数。 */
const MAX_ERROR_BODY_CHARS = 500;

/** 把非 2xx 响应转为 E_PROVIDER 错误；会从回显中抹去 Key 以防服务端回显。 */
export async function providerHttpError(res: Response, apiKey: string): Promise<Error> {
  let body: string;
  try {
    body = (await res.text()).slice(0, MAX_ERROR_BODY_CHARS);
  } catch (err) {
    body = `（无法读取响应体：${(err as Error).message}）`;
  }
  if (apiKey) body = body.split(apiKey).join('***');
  return new Error(`E_PROVIDER: 模型服务返回 HTTP ${res.status}${body ? `：${body}` : ''}`);
}

/** 解析流式拼接出的工具参数 JSON。 */
export function parseToolInput(raw: string): { input: Record<string, unknown>; error?: string } {
  if (raw.trim() === '') return { input: {} };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return { input: parsed as Record<string, unknown> };
    }
    return { input: {}, error: '工具参数必须是 JSON 对象' };
  } catch {
    return { input: {}, error: `工具参数不是合法 JSON：${raw.slice(0, 200)}` };
  }
}

/** 已有对应 tool 结果消息的调用 ID；没有结果的调用不发送给模型，避免协议错误。 */
export function answeredToolCallIds(messages: ChatMessage[]): Set<string> {
  return new Set(messages.filter((m) => m.role === 'tool' && m.toolCallId).map((m) => m.toolCallId as string));
}

/** 拼接 baseUrl 与路径，去掉多余斜杠。 */
export function joinUrl(baseUrl: string, suffix: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${suffix.replace(/^\/+/, '')}`;
}
