/**
 * Web 预览开发服务器（功能 003，FR-305，ADR 0008，契约 contracts/web-dev.ts v2）。仅开发使用，不进 Electron 打包。
 *
 *   npm run web [-- --port 5173 --project <目录>]
 *
 * - 只监听 127.0.0.1，校验 Host 头（防 DNS 重绑定）；写端点另校验 Origin（浏览器请求）。
 * - 静态提供 src/frontend/ 与 contracts/（仅 GET / HEAD）：.ts 经 Node `stripTypeScriptTypes` 原地擦除类型
 *   （行列号与源文件一致），index.html 原样提供，只把入口脚本换成 src/frontend/web/boot.ts。
 * - 后端（v2，2026-10-20 负责人决定）：进程内实例化与桌面端相同的 createHandlers + SettingsStore +
 *   SessionStore + AppState，除 Agent CLI 外全部通道走真实逻辑、真实落盘（见契约例外清单）：
 *   `/__api/<通道>`（POST）执行 invoke；`/__events`（SSE）推送全部 agent:event。
 * - 数据目录与桌面端 userData 等价（见 defaultDataDir），可用环境变量 AICM_DATA_DIR 覆盖。
 * - 项目目录由 --project 指定（默认应用根），启动时写入 AppState；project:pick 无系统对话框恒返回 null。
 */
import fs from 'node:fs/promises';
import http from 'node:http';
import { stripTypeScriptTypes } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import type { AgentCliCheck, AgentEvent, IpcInvokeChannel } from '../contracts/ipc.ts';
import { WEB_DEV_API_PREFIX, WEB_DEV_CHANNELS, WEB_DEV_DEFAULT_PORT, WEB_DEV_EVENTS_PATH } from '../contracts/web-dev.ts';
import { AppState } from '../src/backend/app-state.ts';
import { createHandlers, effectiveAgent } from '../src/backend/ipc/handlers.ts';
import { ipcError, validateSendRequest } from '../src/backend/ipc/validate.ts';
import { SessionStore } from '../src/backend/sessions/session-store.ts';
import { SettingsStore, type KeyCipher } from '../src/backend/settings/settings-store.ts';
import { resolveSafe } from '../src/backend/tools/sandbox.ts';

const APP_ROOT = path.resolve(import.meta.dirname, '..');
const HOST = '127.0.0.1';
const ENTRY = 'src/frontend/index.html';
const ELECTRON_SCRIPT = '<script type="module" src="../../dist/src/frontend/main.js"></script>';
const WEB_SCRIPT = '<script type="module" src="./web/boot.ts"></script>';
/** 只提供这些目录下的文件（相对应用根）。 */
const SERVED_PREFIXES = ['src/frontend/', 'contracts/'];
const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.ts': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.md': 'text/plain; charset=utf-8',
};
/** /__api 请求体上限（agent:send 长文本 / 设置更新都远小于此）。 */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const port = Number(argValue('--port') ?? process.env.PORT ?? WEB_DEV_DEFAULT_PORT);
const projectRoot = path.resolve(argValue('--project') ?? APP_ROOT);

/**
 * 与桌面端 Electron `app.getPath('userData')` 等价的数据目录：
 * appData（win32 %APPDATA% / darwin ~/Library/Application Support / linux $XDG_CONFIG_HOME 或 ~/.config）
 * + 应用名（package.json productName）。AICM_DATA_DIR 优先。
 */
function defaultDataDir(): string {
  if (process.env.AICM_DATA_DIR) return path.resolve(process.env.AICM_DATA_DIR);
  const appName = 'AI Code Manager';
  if (process.platform === 'win32') return path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), appName);
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', appName);
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), appName);
}
const dataDir = defaultDataDir();

/**
 * Web 预览没有 Electron safeStorage：如实报告「加密不可用」。
 * 真实 SettingsStore 据此拒绝新存密钥（E_ENCRYPTION）、并在读取桌面端已存密钥时经 decrypt 得到明确错误，
 * 而不是把密文当明文用或静默写坏桌面端的设置文件；非敏感设置与会话数据照常真实落盘。
 */
const webCipher: KeyCipher = {
  isAvailable: () => false,
  encrypt: () => {
    throw ipcError('E_ENCRYPTION', 'Web 预览无系统加密服务（safeStorage），拒绝保存密钥。');
  },
  decrypt: () => {
    throw ipcError('E_ENCRYPTION', 'Web 预览无法解密桌面端以 safeStorage 加密保存的密钥，请在桌面端使用该密钥。');
  },
};

// ── 事件（SSE）：handlers 的 emit 汇到这里，广播给所有已连接的浏览器 ──
const sseClients = new Set<http.ServerResponse>();
function emit(event: AgentEvent): void {
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(line);
    } catch {
      sseClients.delete(res);
    }
  }
}

// ── 真实后端实例化（与 main.ts bootstrap 相同的组装，注入换成 Web 等价物）──
const settings = new SettingsStore(path.join(dataDir, 'settings.json'), webCipher);
try {
  await settings.load();
} catch (err) {
  // 与桌面端一致：设置损坏时存储已备份并重置为默认，这里只提示（桌面端是弹窗）
  console.warn(`设置加载提示：${(err as Error).message}（已恢复默认设置继续运行）`);
}
const sessions = new SessionStore(path.join(dataDir, 'sessions'));
const state = new AppState();
state.setProject(projectRoot);

const handlers = createHandlers({
  settings,
  sessions,
  state,
  emit,
  platform: process.platform,
  // Web 无系统目录对话框：保持返回 null（项目已在启动时由 --project 确定）
  pickDirectory: async () => null,
  // Web 无系统文件管理器：no-op
  openPath: async () => {},
});

/** api 表的调用约定：收 args 元组数组，内部展开后调用真实 handler。 */
type AnyInvoke = (args: unknown[]) => Promise<unknown>;
type AnyHandlerFn = (...args: unknown[]) => Promise<unknown>;
const api: Record<string, AnyInvoke> = {};
for (const [channel, fn] of Object.entries(handlers)) {
  api[channel] = (args: unknown[]) => (fn as unknown as AnyHandlerFn)(...args);
}

// Agent CLI 例外一：check 不探测、不执行本机 CLI（保持 v1 模拟语义与文案）
api['agentCli:check'] = async (): Promise<AgentCliCheck> => ({
  ok: false, resolvedPath: null, version: null, message: 'Web 预览不检查、不启动本机 CLI。',
});

// Agent CLI 例外二：send 到外部 CLI 会话时在进入真实 handlers 前拒绝。
// handlers 未暴露 CLI 执行器注入点（runCliTurn 为直接 import，resolveDeps 也无法携带拒绝理由），
// 故在服务器分发层用真实 stores + effectiveAgent 判定后拦截：绝不启动真实 CLI 进程。
const realSend = api['agent:send'] as AnyInvoke;
api['agent:send'] = async (args: unknown[]) => {
  const { sessionId } = validateSendRequest(args[0]);
  const session = await sessions.get(sessionId);
  const agent = effectiveAgent(session, settings.getActive().defaultAgent);
  if (agent !== 'builtin') {
    const message = 'Web 预览不启动外部 Agent CLI（仅桌面端可运行）；请把会话切换为内置 agent，或在桌面端继续该会话。';
    emit({ type: 'error', sessionId, message });
    throw ipcError('E_CLI', message);
  }
  return realSend(args);
};

const STATUS_BY_CODE: Readonly<Record<string, number>> = { E_VALIDATION: 400, E_PATH_ESCAPE: 403, E_NOT_FOUND: 404 };

function send(res: http.ServerResponse, status: number, body: string | Buffer, type: string, head: boolean): void {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(head ? undefined : body);
}

function sendJson(res: http.ServerResponse, status: number, value: unknown, head: boolean): void {
  send(res, status, JSON.stringify(value ?? null), TYPES['.json'] as string, head);
}

function publicError(err: unknown): { status: number; message: string } {
  const msg = err instanceof Error ? err.message : String(err);
  const code = /^(E_[A-Z_]+):/.exec(msg)?.[1];
  // 只回传带错误码的说明；其它异常不外泄细节
  return code ? { status: STATUS_BY_CODE[code] ?? 500, message: msg.slice(0, 1000) } : { status: 500, message: 'E_INTERNAL: Web 预览服务器内部错误' };
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw ipcError('E_VALIDATION', '请求体过大。');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function handleApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
  const channel = decodeURIComponent(url.pathname.slice(WEB_DEV_API_PREFIX.length)) as IpcInvokeChannel;
  const fn = api[channel];
  if (!fn || !(WEB_DEV_CHANNELS as readonly string[]).includes(channel)) {
    return sendJson(res, 404, { error: `E_VALIDATION: Web 预览无此通道：${channel}` }, false);
  }
  let args: unknown;
  try {
    const parsed = JSON.parse(await readBody(req)) as { args?: unknown };
    args = Array.isArray(parsed) ? parsed : parsed.args;
  } catch {
    args = null;
  }
  if (!Array.isArray(args)) return sendJson(res, 400, { error: 'E_VALIDATION: 请求体必须是 { "args": [...] }' }, false);
  try {
    sendJson(res, 200, await fn(args), false);
  } catch (err) {
    const e = publicError(err);
    sendJson(res, e.status, { error: e.message }, false);
  }
}

function handleEvents(req: http.IncomingMessage, res: http.ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Content-Type-Options': 'nosniff',
  });
  res.write(': connected\n\n');
  sseClients.add(res);
  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      /* 关闭时由 close 事件清理 */
    }
  }, 25_000);
  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
}

async function handleStatic(res: http.ServerResponse, url: URL, head: boolean): Promise<void> {
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  if (rel === '' || rel === 'index.html') {
    res.writeHead(302, { Location: `/${ENTRY}` });
    res.end();
    return;
  }
  if (rel === 'favicon.ico') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (!SERVED_PREFIXES.some((p) => rel.startsWith(p))) return send(res, 404, 'Not found', 'text/plain; charset=utf-8', head);
  let abs: string;
  try {
    abs = await resolveSafe(APP_ROOT, rel);
    if (!(await fs.stat(abs)).isFile()) throw ipcError('E_NOT_FOUND', rel);
  } catch {
    return send(res, 404, 'Not found', 'text/plain; charset=utf-8', head);
  }
  const ext = path.extname(abs).toLowerCase();
  const type = TYPES[ext] ?? 'application/octet-stream';
  if (rel === ENTRY) {
    const html = await fs.readFile(abs, 'utf8');
    if (!html.includes(ELECTRON_SCRIPT)) return send(res, 500, 'index.html 入口脚本已变化，请同步 scripts/web-dev.ts', 'text/plain; charset=utf-8', head);
    return send(res, 200, html.replace(ELECTRON_SCRIPT, WEB_SCRIPT), type, head);
  }
  if (ext === '.ts') {
    const src = await fs.readFile(abs, 'utf8');
    return send(res, 200, stripTypeScriptTypes(src, { mode: 'strip', sourceUrl: `/${rel}` }), type, head);
  }
  return send(res, 200, await fs.readFile(abs), type, head);
}

const allowedHosts = new Set([`${HOST}:${port}`, `localhost:${port}`]);
const allowedOrigins = new Set([`http://${HOST}:${port}`, `http://localhost:${port}`]);

/** 写 / 事件端点的来源校验：浏览器请求必须带本机 Origin；无 Origin（curl 等本地工具）放行（Host 校验仍在）。 */
function originAllowed(req: http.IncomingMessage): boolean {
  const origin = req.headers.origin;
  return origin === undefined || allowedOrigins.has(origin);
}

const server = http.createServer((req, res) => {
  const method = req.method ?? 'GET';
  const head = method === 'HEAD';
  if (!allowedHosts.has(req.headers.host ?? '')) return send(res, 403, 'Forbidden host', 'text/plain; charset=utf-8', head);
  const url = new URL(req.url ?? '/', `http://${HOST}:${port}`);
  if (url.pathname.startsWith(WEB_DEV_API_PREFIX)) {
    if (method !== 'POST') {
      res.writeHead(405, { Allow: 'POST', 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Web 预览 API 只接受 POST');
      return;
    }
    if (!originAllowed(req)) return sendJson(res, 403, { error: 'E_VALIDATION: 非法的调用来源' }, false);
    handleApi(req, res, url).catch((err: unknown) => {
      if (!res.headersSent) sendJson(res, 500, { error: publicError(err).message }, false);
    });
    return;
  }
  if (url.pathname === WEB_DEV_EVENTS_PATH) {
    if (method !== 'GET') {
      res.writeHead(405, { Allow: 'GET', 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Web 预览事件通道只接受 GET');
      return;
    }
    if (!originAllowed(req)) return send(res, 403, 'Forbidden origin', 'text/plain; charset=utf-8', false);
    handleEvents(req, res);
    return;
  }
  if (method !== 'GET' && !head) {
    res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Web 预览静态文件只接受 GET / HEAD');
    return;
  }
  handleStatic(res, url, head).catch((err: unknown) => {
    if (!res.headersSent) sendJson(res, 500, { error: publicError(err).message }, head);
  });
});

server.listen(port, HOST, () => {
  console.log(`AI Code Manager · Web 预览（仅开发，真实数据）：http://${HOST}:${port}/`);
  console.log(`项目：${projectRoot}`);
  console.log(`数据目录：${dataDir}（与桌面端 userData 等价，AICM_DATA_DIR 可覆盖）`);
  console.log('除 Agent CLI 外全部走真实后端：settings / sessions 真实落盘、内置 agent 真实执行；Agent CLI 不检查、不启动。');
  console.log('注意：Web 预览无 safeStorage，API Key 不能在此保存或使用（E_ENCRYPTION），请在桌面端配置。');
  console.log('Alt+Q 或右下角「UI 定位」开关：悬停高亮、点击定位，可记录修改 / 删除并一键复制。Ctrl+C 退出。');
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    for (const res of sseClients) res.end();
    server.close(() => process.exit(0));
    // SSE 长连接会拖住 close，兜底退出
    setTimeout(() => process.exit(0), 500).unref();
  });
}
