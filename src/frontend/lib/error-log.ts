/**
 * 错误 / 日志分区（P1-6）：把「出错」变成可追溯的一等信息。纯函数，便于单元测试。
 *
 * 错误来源两类：
 * - agent：模型 / Agent 侧报错（渲染进程收到的 error 事件，通知文案）。
 * - tool：工具调用失败（ToolCallRecord.status === 'error'），detail 为工具输出原文。
 *
 * 「出错」状态：一个会话只要存在错误条目即视为出错（与是否运行中无关）。
 */

export type ErrorKind = 'agent' | 'tool';

export interface ErrorEntry {
  /** 稳定 id（用于 key / 去重）。 */
  id: string;
  kind: ErrorKind;
  /** 一行摘要。 */
  text: string;
  /** 详细原文（工具输出 / 完整报错），可为空。 */
  detail: string;
  /** ISO 时间戳。 */
  at: string;
}

/** 工具输出摘要在条目里的最大长度。 */
export const ERROR_DETAIL_LIMIT = 2000;

/** 工具调用失败 → 错误条目；非失败返回 null。 */
export function toolCallError(call: { id: string; name: string; status: string; output?: string }, at: string): ErrorEntry | null {
  if (call.status !== 'error') return null;
  const detail = (call.output ?? '').slice(0, ERROR_DETAIL_LIMIT);
  return { id: `tool:${call.id}`, kind: 'tool', text: `工具 ${call.name} 执行失败`, detail, at };
}

/** Agent 报错 → 错误条目。 */
export function agentError(id: string, message: string, at: string): ErrorEntry {
  return { id: `agent:${id}`, kind: 'agent', text: message.split('\n')[0]?.slice(0, 200) || '未知错误', detail: message.slice(0, ERROR_DETAIL_LIMIT), at };
}

/** 合并多来源条目，按时间排序并按 id 去重（后到的同 id 条目覆盖先到的）。 */
export function mergeErrorEntries(...groups: ReadonlyArray<readonly ErrorEntry[]>): ErrorEntry[] {
  const byId = new Map<string, ErrorEntry>();
  for (const g of groups) for (const e of g) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

/** 会话是否处于「出错」状态：有任一错误条目即为出错。 */
export function hasError(entries: readonly ErrorEntry[]): boolean {
  return entries.length > 0;
}

/** 分区标题文案。 */
export function errorSectionTitle(entries: readonly ErrorEntry[]): string {
  const n = entries.length;
  if (!n) return '错误与日志';
  const tool = entries.filter((e) => e.kind === 'tool').length;
  const agent = n - tool;
  const parts: string[] = [];
  if (agent) parts.push(`${agent} 条 Agent 错误`);
  if (tool) parts.push(`${tool} 条工具失败`);
  return `错误与日志（${parts.join(' · ')}）`;
}

/** 会话消息的最小形状（只取 id / 创建时间 / 工具调用）。 */
export interface MessageLike {
  id: string;
  createdAt: string;
  toolCalls?: ReadonlyArray<{ id: string; name: string; status: string; output?: string }>;
}

/** 从会话消息中抽出全部错误条目（工具失败）。 */
export function sessionErrorEntries(messages: readonly MessageLike[]): ErrorEntry[] {
  const out: ErrorEntry[] = [];
  for (const m of messages) {
    for (const c of m.toolCalls ?? []) {
      const e = toolCallError(c, m.createdAt);
      if (e) out.push(e);
    }
  }
  return out;
}
