/**
 * 会话活动计数（图标栏徽标 + 状态栏，P0-3）：纯函数，便于单元测试。
 *
 * 计数口径：
 * - running：运行中的会话数（store.state.running 的会话 ID 集合）。
 * - pending：待批准的审批请求数（store.state.approvals 的条数；一条审批 = 一处待批准）。
 * - errors：出错数——当前会话内 status 为 'error' 的工具调用条数。
 *
 * 「点击直接跳转」：给定一种活动类型，返回应当跳转到的会话 ID；没有可跳转目标时返回 null。
 */

/** 一条工具调用的最小形状（只取状态与所属会话）。 */
export interface ToolCallLike {
  status: string;
}

export interface SessionActivity {
  /** 运行中的会话数。 */
  running: number;
  /** 待批准的审批数。 */
  pending: number;
  /** 出错的工具调用数。 */
  errors: number;
}

/** 总活动数（徽标上的数字）：运行 + 待批准 + 出错。 */
export function activityTotal(a: SessionActivity): number {
  return a.running + a.pending + a.errors;
}

export interface ActivityInput {
  /** 运行中的会话 ID 集合。 */
  running: ReadonlySet<string> | ReadonlyArray<string>;
  /** 待批准的审批条数。 */
  pending: number;
  /** 当前会话的工具调用列表（用于数出错）。 */
  toolCalls: readonly ToolCallLike[];
}

/** 统计会话活动。 */
export function sessionActivity(input: ActivityInput): SessionActivity {
  const running = input.running instanceof Set ? input.running.size : [...input.running].length;
  const errors = input.toolCalls.filter((c) => c.status === 'error').length;
  return { running, pending: input.pending, errors };
}

export type ActivityKind = 'running' | 'pending' | 'errors';

/**
 * 点击徽标 / 状态栏计数时应当跳转到的会话 ID。
 * - running：第一个运行中的会话。
 * - pending：第一个有待批准审批的会话。
 * - errors：出错工具调用所在的会话（只有当前会话的调用可见）。
 * 没有目标时返回 null（调用方应保持原地不动）。
 */
export function activityTarget(
  kind: ActivityKind,
  input: ActivityInput & { currentSessionId: string | null; approvalSessionIds: readonly string[] },
): string | null {
  if (kind === 'running') {
    const ids = input.running instanceof Set ? [...input.running] : [...input.running];
    return ids[0] ?? null;
  }
  if (kind === 'pending') return input.approvalSessionIds[0] ?? null;
  if (input.toolCalls.some((c) => c.status === 'error')) return input.currentSessionId;
  return null;
}

/** 状态栏文案片段：无活动时返回空数组。 */
export function activityLabels(a: SessionActivity): string[] {
  const out: string[] = [];
  if (a.running) out.push(`${a.running} 运行中`);
  if (a.pending) out.push(`${a.pending} 待批准`);
  if (a.errors) out.push(`${a.errors} 错误`);
  return out;
}
