/**
 * 「重新提问不重复」（契约 v1.11）的截断点计算。纯函数，无副作用。
 *
 * 用户对最近一次提问点「重新发送 / 重新回答」时，发送方带 `reaskLatest` 标记；
 * 若会话最后一条 user 消息与本次重发文本完全一致，则把消息从那条 user 起整体
 * 截断（含其后的 assistant / tool 消息）后落盘，运行器随后重新追加该问题——
 * 最终对话里该问题只出现一次、保留最新一轮的回答。
 */

/**
 * 返回「最后一条 user 消息」的下标，当且仅当存在 user 消息且其中最后一条的
 * content 与 `text` 严格相等；否则返回 -1（不截断）。
 * 最后一条 user 消息之后可以有任意 assistant / tool 消息，都随截断移除；
 * 中间出现过的同文本 user 消息不算数，只认最后一条。
 */
export function reaskCutIndex(messages: readonly { role: string; content: string }[], text: string): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === 'user') return m.content === text ? i : -1;
  }
  return -1;
}
