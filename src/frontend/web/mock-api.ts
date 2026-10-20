/**
 * Web 预览的 window.api 适配器（FR-305，contracts/web-dev.ts，ADR 0008）。仅在 `npm run web` 中加载，不进 Electron 打包。
 * - 只读通道（contracts/web-dev.ts 白名单）：GET Web 预览服务器，由主进程同一批只读函数读取真实项目。
 * - 其余通道：浏览器内存模拟——不写盘、不执行命令、不调用模型；刷新页面即重置。
 * - 设置与 Key：模拟「默认空白」，Key 只记录「是否已填写」，不保存值。
 */
import type {
  AgentCliConfig,
  AgentCliInput,
  AgentEvent,
  ChatMessage,
  IpcInvokeChannel,
  IpcInvokeMap,
  PublicSettings,
  RendererApi,
  Session,
  SessionSummary,
  SettingsUpdate,
} from '../../../contracts/ipc.ts';
import { WEB_DEV_API_PREFIX, WEB_DEV_READONLY_CHANNELS, type WebDevError } from '../../../contracts/web-dev.ts';

const READONLY: ReadonlySet<string> = new Set(WEB_DEV_READONLY_CHANNELS);
const listeners = new Set<(e: AgentEvent) => void>();
const emit = (e: AgentEvent) => {
  for (const l of listeners) l(e);
};
const now = () => new Date().toISOString();
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
let seq = 0;
const newId = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

async function remote(channel: string, args: unknown[]): Promise<unknown> {
  const res = await fetch(`${WEB_DEV_API_PREFIX}${channel}?args=${encodeURIComponent(JSON.stringify(args))}`);
  const body = (await res.json()) as unknown;
  if (!res.ok) throw new Error((body as WebDevError).error ?? `HTTP ${res.status}`);
  return body;
}

let settings: PublicSettings = {
  provider: 'openai', baseUrl: '', model: '', permissionMode: 'ask',
  hasApiKey: { openai: false, anthropic: false }, encryptionAvailable: true, lastProjectPath: null,
  agentClis: [], defaultAgent: 'builtin',
};

const sessions: Session[] = [{
  schemaVersion: 1, id: 'web-1', title: 'Web 预览示例会话', projectPath: null, createdAt: now(), updatedAt: now(), todos: [],
  messages: [
    { id: 'w-u1', role: 'user', content: '这是 Web 预览：界面与桌面版是同一套渲染层源码。', createdAt: now() },
    { id: 'w-a1', role: 'assistant', content: '（模拟回复）Web 预览不会调用模型、写文件或执行命令。打开右下角「UI 定位」，点击任意元素即可看到它的源文件与 CSS 选择器。', createdAt: now() },
  ],
}];

const summary = (s: Session): SessionSummary => ({ id: s.id, title: s.title, projectPath: s.projectPath, updatedAt: s.updatedAt, messageCount: s.messages.length, ...(s.agent ? { agent: s.agent } : {}) });
const find = (id: string): Session => {
  const s = sessions.find((x) => x.id === id);
  if (!s) throw new Error(`E_NOT_FOUND: 会话 ${id} 不存在（Web 预览内存会话）`);
  return s;
};

function toConfig(input: AgentCliInput, id: string): AgentCliConfig {
  return { ...input, id, env: input.env.map((e) => (e.secret ? { name: e.name, secret: true, hasValue: Boolean(e.value) } : { name: e.name, secret: false, value: e.value ?? '', hasValue: Boolean(e.value) })) };
}

/** 内存模拟的通道。 */
const local: { [C in IpcInvokeChannel]?: (...args: never[]) => IpcInvokeMap[C]['result'] | Promise<IpcInvokeMap[C]['result']> } = {
  'settings:get': () => clone(settings),
  'settings:set': (u: SettingsUpdate) => {
    const { apiKey, ...rest } = u;
    settings = { ...settings, ...rest };
    if (apiKey) settings.hasApiKey = { ...settings.hasApiKey, [apiKey.provider]: apiKey.value !== '' }; // 不保存 Key 值
    return clone(settings);
  },
  'project:pick': () => null,
  'sessions:list': () => sessions.map(summary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  'sessions:create': () => {
    const s: Session = { schemaVersion: 1, id: newId('web'), title: '新会话', projectPath: null, createdAt: now(), updatedAt: now(), messages: [], todos: [], agent: settings.defaultAgent ?? 'builtin' };
    sessions.unshift(s);
    return clone(s);
  },
  'sessions:get': (id: string) => clone(find(id)),
  'sessions:delete': (id: string) => {
    const i = sessions.findIndex((x) => x.id === id);
    if (i !== -1) sessions.splice(i, 1);
  },
  'sessions:clear': (id: string) => {
    const s = find(id);
    Object.assign(s, { messages: [], todos: [], title: '新会话', updatedAt: now() });
    return clone(s);
  },
  'sessions:setAgent': (id: string, agent: Session['agent']) => {
    const s = find(id);
    s.agent = agent;
    return clone(s);
  },
  'agent:send': (req: { sessionId: string; text: string }) => {
    const s = find(req.sessionId);
    const user: ChatMessage = { id: newId('u'), role: 'user', content: req.text, createdAt: now() };
    s.messages.push(user);
    if (s.title === '新会话') s.title = req.text.slice(0, 40);
    s.updatedAt = now();
    emit({ type: 'status', sessionId: s.id, running: true });
    const reply: ChatMessage = { id: newId('a'), role: 'assistant', content: '', createdAt: now(), ...(s.agent ? { agent: s.agent } : {}) };
    setTimeout(() => {
      emit({ type: 'message-start', sessionId: s.id, message: clone(reply) });
      reply.content = '（Web 预览模拟回复：不会调用模型、写文件或执行命令。）';
      s.messages.push(reply);
      emit({ type: 'text-delta', sessionId: s.id, messageId: reply.id, delta: reply.content });
      emit({ type: 'session-updated', summary: summary(s) });
      emit({ type: 'status', sessionId: s.id, running: false });
    }, 300);
  },
  'agent:stop': () => undefined,
  'agent:approve': () => undefined,
  'agentCli:save': (input: AgentCliInput) => {
    const list = settings.agentClis ?? [];
    const id = input.id ?? newId('cli').toLowerCase().replace(/[^a-z0-9-]/g, '');
    settings.agentClis = input.id ? list.map((c) => (c.id === id ? toConfig(input, id) : c)) : [...list, toConfig(input, id)];
    return clone(settings);
  },
  'agentCli:delete': (id: string) => {
    settings.agentClis = (settings.agentClis ?? []).filter((c) => c.id !== id);
    if (settings.defaultAgent === `cli:${id}`) settings.defaultAgent = 'builtin';
    return clone(settings);
  },
  'agentCli:check': () => ({ ok: false, resolvedPath: null, version: null, message: 'Web 预览不检查、不启动本机 CLI。' }),
};

const api: RendererApi = {
  invoke: (async (channel: IpcInvokeChannel, ...args: unknown[]) => {
    if (READONLY.has(channel)) return remote(channel, args);
    const fn = local[channel] as ((...a: unknown[]) => unknown) | undefined;
    if (!fn) throw new Error(`E_VALIDATION: Web 预览未提供通道 ${channel}`);
    return fn(...args);
  }) as RendererApi['invoke'],
  onEvent: (listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  platform: 'web',
};

window.api = api;
