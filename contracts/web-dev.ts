/**
 * Web 预览契约 v2（功能 003 制定，2026-10-20 负责人决定修订）：`npm run web` 的本地开发服务器
 * （scripts/web-dev.ts，infra）↔ 浏览器内的 window.api 适配器（src/frontend/web/mock-api.ts，frontend）。
 *
 * v2 语义（取代 v1 的「只读白名单 + 其余内存模拟」）：
 * - 服务器在进程内实例化与桌面端相同的后端（createHandlers + SettingsStore + SessionStore + AppState），
 *   下列全部 invoke 通道走真实逻辑、真实落盘；结果形状与 contracts/ipc.ts 的 IpcInvokeMap 完全相同。
 * - 线上格式：`POST {WEB_DEV_API_PREFIX}{channel}`，请求体 JSON `{ "args": [...args 元组] }`
 *   → 200 `application/json` 结果（void 结果序列化为 null）；失败 4xx/5xx `{ "error": "E_xxx: 说明" }`（WebDevError）。
 * - 事件：`GET {WEB_DEV_EVENTS_PATH}`（text/event-stream），每条消息 `data: <AgentEvent 的 JSON>`，
 *   承载运行状态、流式回复、审批请求、终端输出与 diff 等全部 agent:event。
 * - 仅 Agent CLI 保持模拟（负责人决定）：
 *   - `agentCli:check` 恒返回 `{ ok: false, resolvedPath: null, version: null, message: 'Web 预览不检查、不启动本机 CLI。' }`；
 *   - `agentCli:detect` 恒返回空数组 `[]`（不做任何本机探测）；
 *   - `agentCli:models` 恒返回 `{ models: [] }`（不启动本机 CLI 枚举模型，与 detect 同口径）；
 *   - `agent:send` 当会话 agent 为外部 CLI（cli:*）时被服务器拒绝（E_CLI 错误 + 同内容的 error 事件），绝不启动真实 CLI 进程；
 *   - `agentCli:save` / `agentCli:delete` 是设置数据，随 settings 真实落盘。
 * - `project:pick` 无系统对话框：恒返回 null（项目由 `--project` 参数在启动时确定）；
 *   `project:openRoot` 为 no-op。
 * - `files:pick`（v1.12）无系统对话框：浏览器侧适配器直接返回空数组（按取消处理），不发请求。
 * - 终端通道（v1.6）：`terminal:open` / `terminal:input` / `terminal:close` 与桌面端同逻辑，
 *   在开发机上真实启动子进程（PowerShell / bash），工作目录恒为项目根。
 * - API Key 与 CLI 敏感 env 在桌面端由 Electron safeStorage 加密，Web 预览无 safeStorage：
 *   SettingsStore 收到「加密不可用」的 cipher——读取与非敏感设置读写照常真实落盘，
 *   但新存密钥会被真实存储逻辑以 E_ENCRYPTION 拒绝，桌面端已存的密钥也无法在 Web 侧解密使用。
 * - 服务器只监听 127.0.0.1 并校验 Host 头（防 DNS 重绑定）；静态文件仍只接受 GET / HEAD。
 *   仅用于开发，不进入 Electron 打包。
 */
import type { IpcInvokeChannel } from './ipc.ts';

export const WEB_DEV_CONTRACT_VERSION = 'v2' as const;

export const WEB_DEV_API_PREFIX = '/__api/' as const;

export const WEB_DEV_EVENTS_PATH = '/__events' as const;

export const WEB_DEV_DEFAULT_PORT = 5173;

/** v2 开放的全部 invoke 通道（与 IpcInvokeMap 的键集合一致，下方穷举检查保证不漂移）。 */
export const WEB_DEV_CHANNELS = [
  'settings:get',
  'settings:set',
  'project:pick',
  'project:current',
  'project:openRoot',
  'fs:tree',
  'fs:read',
  'files:pick',
  'sessions:list',
  'sessions:create',
  'sessions:get',
  'sessions:delete',
  'sessions:clear',
  'sessions:setAgent',
  'agent:setSessionModel',
  'agent:send',
  'agent:stop',
  'agent:approve',
  'tasks:list',
  'agentCli:save',
  'agentCli:delete',
  'agentCli:check',
  'agentCli:detect',
  'agentCli:models',
  'board:get',
  'board:setFeature',
  'git:get',
  'git:checkout',
  'terminal:open',
  'terminal:input',
  'terminal:close',
] as const satisfies readonly IpcInvokeChannel[];

export type WebDevChannel = (typeof WEB_DEV_CHANNELS)[number];

// 编译期穷举检查：契约新增通道而此处遗漏时，类型变为 never 导致编译失败（同 preload.cts 的机制）
type MissingChannel = Exclude<IpcInvokeChannel, WebDevChannel>;
export const WEB_DEV_CHANNELS_EXHAUSTIVE: [MissingChannel] extends [never] ? true : never = true;

export interface WebDevError {
  error: string;
}
