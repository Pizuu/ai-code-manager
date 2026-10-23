/**
 * Server-Sent Events 增量解析（OpenAI 与 Anthropic 流式接口共用）。
 */

export interface SseEvent {
  event: string | null;
  data: string;
}

/** 增量解析器：push 任意切分的文本块，返回已完整的事件。 */
export class SseParser {
  private buffer = '';

  push(chunk: string): SseEvent[] {
    this.buffer += chunk;
    const events: SseEvent[] = [];
    for (;;) {
      const match = /\r?\n\r?\n/.exec(this.buffer);
      if (!match) break;
      const block = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      const ev = parseBlock(block);
      if (ev) events.push(ev);
    }
    return events;
  }

  /** 流结束时处理没有以空行结尾的最后一个事件。 */
  flush(): SseEvent[] {
    const rest = this.buffer;
    this.buffer = '';
    const ev = rest.trim() === '' ? null : parseBlock(rest);
    return ev ? [ev] : [];
  }
}

function parseBlock(block: string): SseEvent | null {
  let event: string | null = null;
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line === '' || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  if (data.length === 0 && event === null) return null;
  return { event, data: data.join('\n') };
}

/** 把 fetch 响应体读成 SSE 事件流。 */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const parser = new SseParser();
  const decoder = new TextDecoder();
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      yield* parser.push(decoder.decode(value, { stream: true }));
    }
    yield* parser.push(decoder.decode());
    yield* parser.flush();
  } finally {
    reader.releaseLock();
  }
}
