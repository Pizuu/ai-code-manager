/**
 * 运行中会话的前端实时副本。
 * 后端 sessions:get 只返回已持久化内容，回合进行中的正文 / 工具调用尚未落盘；
 * 切走运行中的会话时保留其前端对象（继续接收流式事件），切回时直接复用，回合结束时清除。
 */
export interface LiveSessionLike { id: string }

export class LiveSessionCache<S extends LiveSessionLike> {
  private readonly map = new Map<string, S>();

  /** 离开会话：仍在运行则保留副本。 */
  leave(prev: S | null | undefined, nextId: string, isRunning: (id: string) => boolean): void {
    if (prev && prev.id !== nextId && isRunning(prev.id)) this.map.set(prev.id, prev);
  }

  /** 进入会话：仍在运行且有副本时返回副本，否则 undefined（调用方回退到持久化版本）。 */
  enter(id: string, isRunning: (id: string) => boolean): S | undefined {
    return isRunning(id) ? this.map.get(id) : undefined;
  }

  /** 事件的落点：当前会话优先，其次是切走的运行中副本；都不是返回 null（丢弃）。 */
  target(current: S | null | undefined, sessionId: string): { session: S; isCurrent: boolean } | null {
    if (current && current.id === sessionId) return { session: current, isCurrent: true };
    const live = this.map.get(sessionId);
    return live ? { session: live, isCurrent: false } : null;
  }

  /** 回合结束：清除副本。 */
  finish(id: string): void { this.map.delete(id); }

  has(id: string): boolean { return this.map.has(id); }
}
