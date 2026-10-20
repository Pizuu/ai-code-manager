/**
 * 沙箱 preload（CommonJS，宪法 十二）：只暴露契约中的白名单 invoke 通道与事件订阅。
 * 沙箱 preload 不能 require 本地模块，因此白名单内联在此，并用 satisfies 绑定 contracts/ipc.ts。
 */
import type * as ElectronModule from 'electron';
import type { AGENT_EVENT_CHANNEL, AgentEvent, IpcInvokeChannel, RendererApi } from '../../contracts/ipc.ts';

// eslint-disable-next-line @typescript-eslint/no-require-imports -- 沙箱 preload 只能是 CommonJS（ADR 0003）
const { contextBridge, ipcRenderer } = require('electron') as typeof ElectronModule;

const INVOKE_CHANNELS = [
  'settings:get',
  'settings:set',
  'project:pick',
  'project:current',
  'fs:tree',
  'sessions:list',
  'sessions:create',
  'sessions:get',
  'sessions:delete',
  'sessions:clear',
  'agent:send',
  'agent:stop',
  'agent:approve',
  'tasks:list',
  'agentCli:save',
  'agentCli:delete',
  'agentCli:check',
  'sessions:setAgent',
  'board:get',
  'git:get',
  'fs:read',
] as const satisfies readonly IpcInvokeChannel[];

// 编译期穷举检查：契约新增通道而此处遗漏时，类型变为 never 导致编译失败
type MissingChannel = Exclude<IpcInvokeChannel, (typeof INVOKE_CHANNELS)[number]>;
const allChannelsListed: [MissingChannel] extends [never] ? true : never = true;
void allChannelsListed;

const EVENT_CHANNEL: typeof AGENT_EVENT_CHANNEL = 'agent:event';
const allowed: ReadonlySet<string> = new Set(INVOKE_CHANNELS);

const api: RendererApi = {
  invoke: (channel, ...args) => {
    if (!allowed.has(channel)) return Promise.reject(new Error(`E_VALIDATION: 未授权的通道 ${channel}`));
    return ipcRenderer.invoke(channel, ...args);
  },
  onEvent: (listener) => {
    const wrapped = (_e: unknown, event: AgentEvent) => listener(event);
    ipcRenderer.on(EVENT_CHANNEL, wrapped);
    return () => {
      ipcRenderer.removeListener(EVENT_CHANNEL, wrapped);
    };
  },
  platform: process.platform,
};

contextBridge.exposeInMainWorld('api', api);
