/**
 * 渲染进程访问主进程的唯一入口：preload 暴露的 window.api（类型来自 contracts/ipc.ts）。
 */
import type { RendererApi } from '../../contracts/ipc.ts';

declare global {
  interface Window {
    api: RendererApi;
  }
}

export const api: RendererApi = window.api;

/** 去掉 Electron 包装前缀，保留 "E_xxx: 说明"。 */
export function errorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
}
