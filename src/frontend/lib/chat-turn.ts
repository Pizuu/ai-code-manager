/**
 * 对话回合（主流对话样式）的纯计算：助手回合的头像文字，以及「思考」区（工具调用）的摘要与展开判定。
 * 纯函数、不依赖 DOM，便于单元测试。
 */
import type { ToolCallRecord } from '../../../contracts/ipc.ts';
import { toolLabel, toolTarget } from './tool-card-text.ts';

/** 思考区里各类工具调用的计数。 */
export interface ThinkCounts {
  /** 调用总数。 */
  total: number;
  /** 已完成。 */
  done: number;
  /** 运行中。 */
  running: number;
  /** 待批准（必须展开，否则批准按钮点不到）。 */
  pending: number;
  /** 等待中（模型已提出、尚未执行）。 */
  waiting: number;
  /** 失败。 */
  failed: number;
  /** 已拒绝。 */
  rejected: number;
}

/** 按状态分类计数工具调用。 */
export function countThink(calls: readonly ToolCallRecord[]): ThinkCounts {
  const c: ThinkCounts = { total: calls.length, done: 0, running: 0, pending: 0, waiting: 0, failed: 0, rejected: 0 };
  for (const call of calls) {
    switch (call.status) {
      case 'done': c.done++; break;
      case 'running': c.running++; break;
      case 'awaiting-approval': c.pending++; break;
      case 'error': c.failed++; break;
      case 'rejected': c.rejected++; break;
      default: c.waiting++; break; // 'pending'
    }
  }
  return c;
}

/** 是否存在待批准的调用（有则思考区必须展开，批准按钮不能被折叠藏起来）。 */
export function hasPendingApproval(calls: readonly ToolCallRecord[]): boolean {
  return calls.some((c) => c.status === 'awaiting-approval');
}

/** 思考区摘要：数量文案，如「3 个工具调用」。 */
export function thinkCountText(calls: readonly ToolCallRecord[]): string {
  const n = calls.length;
  if (n === 0) return '';
  return n === 1 ? '1 个工具调用' : `${n} 个工具调用`;
}

/**
 * 思考区摘要：状态明细，按重要度排序，只列非零项，如「1 待批准 · 2 完成」。
 * 全部为零状态（只有 waiting）时给出「等待中 N」。
 */
export function thinkStatusText(calls: readonly ToolCallRecord[]): string {
  const c = countThink(calls);
  const parts: string[] = [];
  if (c.pending) parts.push(`${c.pending} 待批准`);
  if (c.failed) parts.push(`${c.failed} 失败`);
  if (c.running) parts.push(`${c.running} 进行中`);
  if (c.rejected) parts.push(`${c.rejected} 已拒绝`);
  if (c.waiting) parts.push(`${c.waiting} 等待中`);
  if (c.done) parts.push(`${c.done} 完成`);
  return parts.join(' · ');
}

/** 思考区展开判定的输入（由渲染层从 store / thinkOpen / thinkSticky 拼出）。 */
export interface ThinkOpenInput {
  /** 有待批准的调用 → 必须展开（批准按钮不能被折叠藏起来）。 */
  pending: boolean;
  /** 正在思考（流式输出中）且用户未显式收起过 → 自动展开。 */
  streaming: boolean;
  /** 用户显式选择过（undefined = 没选过）。 */
  explicit?: boolean;
  /** 曾因待批准自动展开过（sticky），保持展开直到用户手动收起。 */
  sticky: boolean;
}

/**
 * 思考区展开判定（单一口径，渲染层与单测共用）：优先级从高到低 —— 待批准强制展开 → 正在思考自动展开 → 用户显式选择 → sticky → 折叠。
 */
export function thinkShouldOpen(input: ThinkOpenInput): boolean {
  if (input.pending) return true;
  if (input.streaming && input.explicit === undefined) return true;
  if (input.explicit !== undefined) return input.explicit;
  return input.sticky;
}

/** 思考区摘要：最近一次操作，如「读取文件 src/frontend/styles.css」。取不到目标时只给工具名。 */
export function thinkLastAction(calls: readonly ToolCallRecord[]): string {
  const last = calls.at(-1);
  if (!last) return '';
  const label = toolLabel(last.name);
  const target = toolTarget(last.name, last.input);
  return target ? `${label} ${target}` : label;
}

/** 回合头像文字：agent 短名的首字符（大写）；空名回退「AI」。 */
export function avatarText(who: string): string {
  const s = who.trim();
  if (!s) return 'AI';
  return s.slice(0, 1).toUpperCase();
}
