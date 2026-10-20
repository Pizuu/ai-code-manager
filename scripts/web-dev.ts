/**
 * Web 预览开发服务器（功能 003，FR-305，ADR 0008，契约 contracts/web-dev.ts）。仅开发使用，不进 Electron 打包。
 *
 *   npm run web [-- --port 5173 --project <目录>]
 *
 * - 只监听 127.0.0.1，只接受 GET / HEAD，校验 Host 头（防 DNS 重绑定）。
 * - 静态提供 src/frontend/ 与 contracts/：.ts 经 Node `stripTypeScriptTypes` 原地擦除类型（行列号与源文件一致），
 *   index.html 原样提供，只把入口脚本换成 src/frontend/web/boot.ts。
 * - `/__api/<通道>`：只开放 contracts/web-dev.ts 白名单内的只读通道，调用主进程同一批只读函数（git 带 --no-optional-locks）。
 *   没有任何写文件、执行命令（git 只读查询除外）的端点；发送 / 设置 / 会话由浏览器内存模拟。
 */
import fs from 'node:fs/promises';
import http from 'node:http';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import type { IpcInvokeMap } from '../contracts/ipc.ts';
import { WEB_DEV_API_PREFIX, WEB_DEV_DEFAULT_PORT, WEB_DEV_READONLY_CHANNELS, type WebDevReadonlyChannel } from '../contracts/web-dev.ts';
import { listTree } from '../src/backend/fs/file-tree.ts';
import { readFileForView } from '../src/backend/fs/file-view.ts';
import { asRelDir, asRelPath, ipcError } from '../src/backend/ipc/validate.ts';
import { loadSpecTasks } from '../src/backend/specs/tasks-parser.ts';
import { resolveSafe } from '../src/backend/tools/sandbox.ts';
import { buildBoard, readAgentsConfig } from '../src/backend/workspace/board.ts';
import { readGitSnapshot } from '../src/backend/workspace/git-overview.ts';
import { createGitRunner } from '../src/backend/workspace/git.ts';

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

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const port = Number(argValue('--port') ?? process.env.PORT ?? WEB_DEV_DEFAULT_PORT);
const projectRoot = path.resolve(argValue('--project') ?? APP_ROOT);

const readonlyChannels: ReadonlySet<string> = new Set(WEB_DEV_READONLY_CHANNELS);
const gitSnapshot = async () => readGitSnapshot(createGitRunner(projectRoot), projectRoot, await readAgentsConfig(projectRoot), new Date().toISOString(), (d) => createGitRunner(d));

/** 只读通道实现：映射类型保证白名单中的每个通道都被实现。 */
const api: { [C in WebDevReadonlyChannel]: (args: unknown[]) => Promise<IpcInvokeMap[C]['result']> } = {
  'project:current': async () => ({ root: projectRoot, name: path.basename(projectRoot) || projectRoot }),
  'fs:tree': async (args) => listTree(projectRoot, asRelDir(args[0])),
  'fs:read': async (args) => readFileForView(projectRoot, asRelPath(args[0])),
  'tasks:list': async () => loadSpecTasks(projectRoot),
  'git:get': async () => gitSnapshot(),
  'board:get': async () => buildBoard(projectRoot, createGitRunner(projectRoot), await gitSnapshot(), new Date().toISOString()),
};

const STATUS_BY_CODE: Readonly<Record<string, number>> = { E_VALIDATION: 400, E_PATH_ESCAPE: 403, E_NOT_FOUND: 404 };

function send(res: http.ServerResponse, status: number, body: string | Buffer, type: string, head: boolean): void {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(head ? undefined : body);
}

function sendJson(res: http.ServerResponse, status: number, value: unknown, head: boolean): void {
  send(res, status, JSON.stringify(value), TYPES['.json'] as string, head);
}

function publicError(err: unknown): { status: number; message: string } {
  const msg = err instanceof Error ? err.message : String(err);
  const code = /^(E_[A-Z_]+):/.exec(msg)?.[1];
  // 只回传带错误码的说明；其它异常不外泄细节
  return code ? { status: STATUS_BY_CODE[code] ?? 500, message: msg.slice(0, 1000) } : { status: 500, message: 'E_INTERNAL: Web 预览服务器内部错误' };
}

async function handleApi(res: http.ServerResponse, url: URL, head: boolean): Promise<void> {
  const channel = decodeURIComponent(url.pathname.slice(WEB_DEV_API_PREFIX.length));
  if (!readonlyChannels.has(channel)) return sendJson(res, 404, { error: `E_VALIDATION: Web 预览只开放只读通道，${channel} 不可用` }, head);
  let args: unknown;
  try {
    args = JSON.parse(url.searchParams.get('args') ?? '[]');
  } catch {
    args = null;
  }
  if (!Array.isArray(args)) return sendJson(res, 400, { error: 'E_VALIDATION: args 必须是 JSON 数组' }, head);
  try {
    sendJson(res, 200, await api[channel as WebDevReadonlyChannel](args), head);
  } catch (err) {
    const e = publicError(err);
    sendJson(res, e.status, { error: e.message }, head);
  }
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

const server = http.createServer((req, res) => {
  const method = req.method ?? 'GET';
  const head = method === 'HEAD';
  if (method !== 'GET' && !head) {
    res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Web 预览只读：只接受 GET / HEAD');
    return;
  }
  if (!allowedHosts.has(req.headers.host ?? '')) return send(res, 403, 'Forbidden host', 'text/plain; charset=utf-8', head);
  const url = new URL(req.url ?? '/', `http://${HOST}:${port}`);
  const work = url.pathname.startsWith(WEB_DEV_API_PREFIX) ? handleApi(res, url, head) : handleStatic(res, url, head);
  work.catch((err: unknown) => {
    if (!res.headersSent) sendJson(res, 500, { error: publicError(err).message }, head);
  });
});

server.listen(port, HOST, () => {
  console.log(`AI Code Manager · Web 预览（仅开发，只读）：http://${HOST}:${port}/`);
  console.log(`项目：${projectRoot}（只读通道：${WEB_DEV_READONLY_CHANNELS.join('、')}）`);
  console.log('Alt+Q 或右下角「UI 定位」开关：悬停高亮、点击定位，可记录修改 / 删除并一键复制。Ctrl+C 退出。');
});
