/**
 * Web 预览只读适配器契约 v1（功能 003）：`npm run web` 的本地开发服务器（scripts/web-dev.ts，infra）
 * ↔ 浏览器内的 window.api 适配器（src/frontend/web/mock-api.ts，frontend）。
 *
 * - 只开放下列只读 invoke 通道；结果形状与 contracts/ipc.ts 的 IpcInvokeMap 完全相同。
 * - 线上格式：`GET {WEB_DEV_API_PREFIX}{channel}?args=<encodeURIComponent(JSON.stringify(args 元组))>`
 *   → 200 `application/json` 结果；失败 4xx/5xx `{ "error": "E_xxx: 说明" }`（WebDevError）。
 * - 服务器只接受 GET / HEAD，只监听 127.0.0.1；任何写文件、执行命令的通道都不在白名单内，
 *   由浏览器内适配器以内存模拟（不落盘）。仅用于开发，不进入 Electron 打包。
 */
import type { IpcInvokeChannel } from './ipc.ts';

export const WEB_DEV_CONTRACT_VERSION = 'v1' as const;

export const WEB_DEV_API_PREFIX = '/__api/' as const;

export const WEB_DEV_DEFAULT_PORT = 5173;

export const WEB_DEV_READONLY_CHANNELS = [
  'project:current',
  'fs:tree',
  'fs:read',
  'tasks:list',
  'board:get',
  'git:get',
] as const satisfies readonly IpcInvokeChannel[];

export type WebDevReadonlyChannel = (typeof WEB_DEV_READONLY_CHANNELS)[number];

export interface WebDevError {
  error: string;
}
