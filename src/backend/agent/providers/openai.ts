/**
 * OpenAI 兼容 /chat/completions 流式客户端（function tools）。
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

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

export function toOpenAIMessages(system: string, messages: ChatMessage[]): OpenAIMessage[] {
  const answered = answeredToolCallIds(messages);
  const out: OpenAIMessage[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      const calls = (m.toolCalls ?? []).filter((c) => answered.has(c.id));
      if (m.content === '' && calls.length === 0) continue;
      const msg: OpenAIMessage = { role: 'assistant', content: m.content === '' ? null : m.content };
      if (calls.length > 0) {
        msg.tool_calls = calls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.input) },
        }));
      }
      out.push(msg);
    } else if (m.toolCallId) {
      out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
    }
  }
  return out;
}

export function toOpenAITools(tools: readonly ToolDefinition[]) {
  return tools.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
}

interface OpenAIChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>;
    };
    finish_reason?: string | null;
  }>;
  error?: { message?: string };
}

/** 消费 SSE 数据行（不含 HTTP），便于单测直接回放样例。 */
export async function consumeOpenAIStream(
  events: AsyncIterable<{ data: string }>,
  onText: (delta: string) => void,
): Promise<ProviderResult> {
  let text = '';
  let stopReason: string | null = null;
  const partial = new Map<number, { id: string; name: string; args: string }>();
  for await (const ev of events) {
    if (ev.data === '[DONE]') break;
    if (ev.data.trim() === '') continue;
    const chunk = JSON.parse(ev.data) as OpenAIChunk;
    if (chunk.error) throw new Error(`E_PROVIDER: ${chunk.error.message ?? '流式响应返回错误'}`);
    const choice = chunk.choices?.[0];
    if (!choice) continue;
    const delta = choice.delta;
    if (delta?.content) {
      text += delta.content;
      onText(delta.content);
    }
    for (const tc of delta?.tool_calls ?? []) {
      const cur = partial.get(tc.index) ?? { id: '', name: '', args: '' };
      if (tc.id) cur.id = tc.id;
      if (tc.function?.name) cur.name += tc.function.name;
      if (tc.function?.arguments) cur.args += tc.function.arguments;
      partial.set(tc.index, cur);
    }
    if (choice.finish_reason) stopReason = choice.finish_reason;
  }
  const toolCalls = [...partial.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, c]) => {
      const parsed = parseToolInput(c.args);
      return {
        id: c.id || `call_${index}`,
        name: c.name,
        input: parsed.input,
        ...(parsed.error ? { inputError: parsed.error } : {}),
      };
    });
  return { text, toolCalls, stopReason };
}

export function createOpenAIProvider(config: ProviderConfig): Provider {
  const doFetch = config.fetchImpl ?? fetch;
  return {
    id: 'openai',
    async stream(req: ProviderRequest, onText: (delta: string) => void): Promise<ProviderResult> {
      const res = await doFetch(joinUrl(config.baseUrl, 'chat/completions'), {
        method: 'POST',
        signal: req.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({
          model: req.model,
          stream: true,
          messages: toOpenAIMessages(req.system, req.messages),
          tools: toOpenAITools(req.tools),
        }),
      });
      if (!res.ok || !res.body) throw await providerHttpError(res, config.apiKey);
      return consumeOpenAIStream(readSse(res.body), onText);
    },
  };
}
