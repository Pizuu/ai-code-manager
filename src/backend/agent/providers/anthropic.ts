/**
 * Anthropic Messages API 流式客户端（tool_use / tool_result）。
 */
import type { ChatMessage } from '../../../../contracts/ipc.ts';
import type { ToolDefinition } from '../../../../contracts/tools.ts';
import { readSse } from './sse.ts';
import {
  answeredToolCallIds,
  joinUrl,
  parseToolInput,
  providerHttpError,
  type Provider,
  type ProviderConfig,
  type ProviderRequest,
  type ProviderResult,
} from './types.ts';

export const ANTHROPIC_VERSION = '2023-06-01';
const MAX_OUTPUT_TOKENS = 8192;

export type AnthropicBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: AnthropicBlock[];
}

/** 转换为 Anthropic 消息：工具结果作为 user 消息的 tool_result 块；相邻同角色消息合并。 */
export function toAnthropicMessages(messages: ChatMessage[]): AnthropicMessage[] {
  const answered = answeredToolCallIds(messages);
  const out: AnthropicMessage[] = [];
  const push = (role: AnthropicMessage['role'], blocks: AnthropicBlock[]) => {
    if (blocks.length === 0) return;
    const last = out[out.length - 1];
    if (last && last.role === role) last.content.push(...blocks);
    else out.push({ role, content: blocks });
  };
  for (const m of messages) {
    if (m.role === 'user') {
      push('user', [{ type: 'text', text: m.content }]);
    } else if (m.role === 'assistant') {
      const blocks: AnthropicBlock[] = [];
      if (m.content !== '') blocks.push({ type: 'text', text: m.content });
      for (const c of m.toolCalls ?? []) {
        if (answered.has(c.id)) blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input });
      }
      push('assistant', blocks);
    } else if (m.toolCallId) {
      push('user', [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content }]);
    }
  }
  return out;
}

export function toAnthropicTools(tools: readonly ToolDefinition[]) {
  return tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
}

interface AnthropicStreamEvent {
  type: string;
  index?: number;
  content_block?: { type: string; id?: string; name?: string };
  delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string };
  error?: { message?: string };
}

export async function consumeAnthropicStream(
  events: AsyncIterable<{ data: string }>,
  onText: (delta: string) => void,
): Promise<ProviderResult> {
  let text = '';
  let stopReason: string | null = null;
  const tools = new Map<number, { id: string; name: string; json: string }>();
  for await (const ev of events) {
    if (ev.data.trim() === '') continue;
    const data = JSON.parse(ev.data) as AnthropicStreamEvent;
    switch (data.type) {
      case 'content_block_start':
        if (data.content_block?.type === 'tool_use' && data.index !== undefined) {
          tools.set(data.index, { id: data.content_block.id ?? '', name: data.content_block.name ?? '', json: '' });
        }
        break;
      case 'content_block_delta':
        if (data.delta?.type === 'text_delta' && data.delta.text) {
          text += data.delta.text;
          onText(data.delta.text);
        } else if (data.delta?.type === 'input_json_delta' && data.index !== undefined) {
          const t = tools.get(data.index);
          if (t) t.json += data.delta.partial_json ?? '';
        }
        break;
      case 'message_delta':
        if (data.delta?.stop_reason) stopReason = data.delta.stop_reason;
        break;
      case 'error':
        throw new Error(`E_PROVIDER: ${data.error?.message ?? '流式响应返回错误'}`);
      default:
        break;
    }
  }
  const toolCalls = [...tools.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, t]) => {
      const parsed = parseToolInput(t.json);
      return { id: t.id || `toolu_${index}`, name: t.name, input: parsed.input, ...(parsed.error ? { inputError: parsed.error } : {}) };
    });
  return { text, toolCalls, stopReason };
}

/** baseUrl 可写成 https://api.anthropic.com 或 …/v1。 */
export function anthropicMessagesUrl(baseUrl: string): string {
  return /\/v1\/?$/.test(baseUrl) ? joinUrl(baseUrl, 'messages') : joinUrl(baseUrl, 'v1/messages');
}

export function createAnthropicProvider(config: ProviderConfig): Provider {
  const doFetch = config.fetchImpl ?? fetch;
  return {
    id: 'anthropic',
    async stream(req: ProviderRequest, onText: (delta: string) => void): Promise<ProviderResult> {
      const res = await doFetch(anthropicMessagesUrl(config.baseUrl), {
        method: 'POST',
        signal: req.signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': config.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model: req.model,
          max_tokens: MAX_OUTPUT_TOKENS,
          stream: true,
          system: req.system,
          messages: toAnthropicMessages(req.messages),
          tools: toAnthropicTools(req.tools),
        }),
      });
      if (!res.ok || !res.body) throw await providerHttpError(res, config.apiKey);
      return consumeAnthropicStream(readSse(res.body), onText);
    },
  };
}
