/**
 * Web 预览的 window.api 适配器（FR-305，contracts/web-dev.ts v2，ADR 0008）。仅在 `npm run web` 中加载，不进 Electron 打包。
 * - 全部 invoke 通道：POST 到 Web 预览服务器，由与桌面端相同的真实后端执行（settings / sessions 落盘、
 *   内置 agent 真实运行）；仅 Agent CLI 按契约 v2 保持模拟（服务器侧拒绝/固定结果，见 contracts/web-dev.ts）。
 * - agent:event：经服务器的 SSE 端点（/__events）订阅，承载运行状态、流式回复、审批请求、终端输出与 diff。
 * 本文件只做传输适配，不再有任何内存模拟数据。
 */
import type { AgentEvent, IpcInvokeChannel, RendererApi } from '../../../contracts/ipc.ts';
import { WEB_DEV_API_PREFIX, WEB_DEV_EVENTS_PATH, type WebDevError } from '../../../contracts/web-dev.ts';

const listeners = new Set<(e: AgentEvent) => void>();
let events: EventSource | null = null;

function ensureEvents(): void {
  if (events) return;
  events = new EventSource(WEB_DEV_EVENTS_PATH);
  events.onmessage = (m) => {
    try {
      const event = JSON.parse(m.data as string) as AgentEvent;
      for (const l of listeners) l(event);
    } catch {
      // 非 JSON 数据（注释心跳等）忽略；EventSource 默认只把 data: 行交给 onmessage
    }
  };
}

async function remote(channel: string, args: unknown[]): Promise<unknown> {
  const res = await fetch(`${WEB_DEV_API_PREFIX}${channel}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ args }),
  });
  const body = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) throw new Error((body as WebDevError | null)?.error ?? `HTTP ${res.status}`);
  return body;
}

const api: RendererApi = {
  invoke: (async (channel: IpcInvokeChannel, ...args: unknown[]) => remote(channel, args)) as RendererApi['invoke'],
  onEvent: (listener) => {
    listeners.add(listener);
    ensureEvents();
    return () => {
      listeners.delete(listener);
    };
  },
  platform: 'web',
};

window.api = api;
