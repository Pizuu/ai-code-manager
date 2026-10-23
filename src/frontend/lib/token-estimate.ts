import type { ChatMessage } from '../../../contracts/ipc.ts';

const ESTIMATES = new WeakMap<readonly ChatMessage[], { signature: number; total: number }>();
const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

function visitTexts(messages: readonly ChatMessage[], visit: (text: string) => void): void {
  for (const message of messages) {
    if (message.role === 'tool') continue;
    visit(message.role);
    visit(message.content);
    for (const call of message.toolCalls ?? []) {
      visit(call.name);
      try {
        visit(JSON.stringify(call.input) ?? '');
      } catch {
        // IPC 消息正常为 JSON 数据；异常对象仅跳过参数估算，不影响正文计数。
      }
      visit(call.output ?? '');
      visit(call.diff ?? '');
    }
  }
}

function signatureOf(messages: readonly ChatMessage[]): number {
  let signature = FNV_OFFSET;
  visitTexts(messages, (text) => {
    for (const char of text) signature = Math.imul(signature ^ (char.codePointAt(0) ?? 0), FNV_PRIME);
    signature = Math.imul(signature ^ 0x10ffff, FNV_PRIME); // 字段分隔符，避免相邻文本拼接歧义
  });
  return signature;
}

function isCjk(cp: number): boolean {
  return (cp >= 0x2e80 && cp <= 0x9fff)
    || (cp >= 0xf900 && cp <= 0xfaff)
    || (cp >= 0x3040 && cp <= 0x30ff)
    || (cp >= 0xac00 && cp <= 0xd7af);
}

function estimateText(text: string): number {
  let total = 0;
  let latinRun = 0;
  const flushLatin = () => {
    if (latinRun) total += Math.ceil(latinRun / 4);
    latinRun = 0;
  };
  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0;
    if (/\s/u.test(char)) {
      flushLatin();
    } else if (cp > 0xffff || isCjk(cp)) {
      flushLatin();
      total += 1;
    } else {
      latinRun += 1;
    }
  }
  flushLatin();
  return total;
}

/**
 * 估算当前会话文本的 token 数：CJK 字符约 1 token、拉丁文本每约 4 字符计 1 token。
 * 不依赖模型 tokenizer；结果只用于 UI 提示，不应参与额度、安全或计费决策。
 */
export function estimateConversationTokens(messages: readonly ChatMessage[]): number {
  const signature = signatureOf(messages);
  const cached = ESTIMATES.get(messages);
  if (cached?.signature === signature) return cached.total;
  let total = 0;
  visitTexts(messages, (text) => { total += estimateText(text); });
  ESTIMATES.set(messages, { signature, total });
  return total;
}
