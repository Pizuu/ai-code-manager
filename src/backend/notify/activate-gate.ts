/**
 * 通知激活就绪门（功能 005 / T-053，FR-503 / FR-514）。
 *
 * 问题：主进程的 agent:event 发送是即发即弃（窗口不存在 / 渲染层还没订阅时事件直接丢失），
 * 而通知服务在窗口创建前就已注册。应用冷启动未就绪时产生的审批会立刻发系统通知，用户
 * 点通知回传的 notify-activate 若赶在渲染层订阅 / 首轮数据加载完成之前到达，就会被丢弃，
 * 表现为「点了没反应」。
 *
 * 本门只拦 NotifyService 的出口（它只发 notify-activate，见 notify-service.ts），不改变其余
 * agent:event 的即发即弃语义（避免事件重放副作用）：
 * - 未就绪时到达的激活只暂存最新一次（负责人连点多条通知时，只有最后一次点击有意义）；
 * - 渲染就绪时把暂存补发恰一次，之后到达的激活直接放行；
 * - 页面重载 / 窗口重建时由 main.ts 调 reset() 复位就绪标志：已投递过的激活不重放
 *   （投递即清暂存），尚未投递的暂存保留——它不是「旧激活」，新页面就绪后仍应补发，
 *   否则重载窗口期内的点击又会丢失。
 *
 * 就绪信号（main.ts 接线）：渲染进程 bootstrap 里 `api.onEvent(handleEvent)` 之后必达的
 * `sessions:get` / `sessions:create` 调用到达主进程。两者都在订阅注册之后才被发出
 * （前端同一执行序：挂载视图 → api.onEvent → selectSession / sessions:create），且发出时
 * 首轮 settings / project / sessions 数据已先行加载完成；主进程收到调用即证明订阅已活。
 * 纯结构、无 Electron 依赖，单测以假 send 验证暂存 / 补发语义。
 */
import type { AgentEvent } from '../../../contracts/ipc.ts';

export class ActivateGate {
  private readonly send: (event: AgentEvent) => void;
  private ready = false;
  private pending: AgentEvent | null = null;

  constructor(send: (event: AgentEvent) => void) {
    this.send = send;
  }

  get isReady(): boolean {
    return this.ready;
  }

  /** 是否有尚未投递的暂存激活（测试与诊断用）。 */
  get hasPending(): boolean {
    return this.pending !== null;
  }

  /** notify-activate 专用出口：就绪直发，未就绪暂存（只留最新一次）。 */
  activate(event: AgentEvent): void {
    if (this.ready) {
      this.send(event);
      return;
    }
    this.pending = event;
  }

  /** 渲染就绪：补发暂存恰一次。重复调用不重发（暂存已清、且就绪后 activate 走直发）。 */
  markReady(): void {
    if (this.ready) return;
    this.ready = true;
    const pending = this.pending;
    this.pending = null;
    if (pending) this.send(pending);
  }

  /** 页面开始重载 / 窗口重建：就绪标志复位。已投递的激活不在暂存中，不会被重放。 */
  reset(): void {
    this.ready = false;
  }
}
