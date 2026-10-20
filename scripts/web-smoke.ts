/**
 * Web 预览服务器自动化冒烟（T213 / 卡片 T-031，FR-305、SC-303）。
 *
 *   node scripts/web-smoke.ts
 *
 * 在随机空闲端口启动 scripts/web-dev.ts（真实子进程），逐项复现 specs/003-code-view-web-locator/quickstart.md
 * 中的手动 curl 检查，全部通过退出 0，任一失败退出 1。不改服务器行为，不写盘，结束时停止子进程。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';

const APP_ROOT = path.resolve(import.meta.dirname, '..');
const HOST = '127.0.0.1';
const START_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 10_000;

interface Reply {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

interface Check {
  name: string;
  method?: string;
  path: string;
  host?: string;
  expect: (r: Reply) => string | null;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, HOST, () => {
      const addr = s.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      s.close(() => resolve(port));
    });
  });
}

function request(port: number, c: Check): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: HOST, port, method: c.method ?? 'GET', path: c.path, headers: { Host: c.host ?? `${HOST}:${port}` }, timeout: REQUEST_TIMEOUT_MS },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (d: Buffer) => chunks.push(d));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
    req.end();
  });
}

function startServer(port: number): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/web-dev.ts', '--port', String(port), '--project', APP_ROOT], {
      cwd: APP_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`服务器 ${START_TIMEOUT_MS} ms 内未就绪：${out.slice(-500)}`));
    }, START_TIMEOUT_MS);
    const onData = (d: Buffer): void => {
      out += d.toString('utf8');
      if (out.includes(`http://${HOST}:${port}/`)) {
        clearTimeout(timer);
        resolve(child);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`服务器提前退出（${code ?? 'signal'}）：${out.slice(-500)}`));
    });
  });
}

const api = (channel: string, args: unknown[]): string => `/__api/${channel}?args=${encodeURIComponent(JSON.stringify(args))}`;
const status = (want: number) => (r: Reply): string | null => (r.status === want ? null : `状态码 ${r.status}，应为 ${want}`);
const all = (...fs: ((r: Reply) => string | null)[]) => (r: Reply): string | null => fs.map((f) => f(r)).find((e) => e !== null) ?? null;

/** 与 quickstart.md「Web 预览服务器手动 curl」逐项对应。 */
const CHECKS: readonly Check[] = [
  { name: '/ → 302 到入口', path: '/', expect: all(status(302), (r) => (r.headers.location === '/src/frontend/index.html' ? null : `Location 为 ${r.headers.location ?? '空'}`)) },
  { name: 'index.html 入口替换为 ./web/boot.ts', path: '/src/frontend/index.html', expect: all(status(200), (r) => (r.body.includes('src="./web/boot.ts"') && !r.body.includes('dist/src/frontend/main.js') ? null : '入口脚本未替换')) },
  { name: 'POST → 405', method: 'POST', path: '/', expect: all(status(405), (r) => (r.headers.allow === 'GET, HEAD' ? null : `Allow 为 ${r.headers.allow ?? '空'}`)) },
  { name: '/__api/agent:send → 404', path: api('agent:send', []), expect: status(404) },
  { name: 'fs:read ../../etc/passwd → 403 E_PATH_ESCAPE', path: api('fs:read', ['../../etc/passwd']), expect: all(status(403), (r) => (r.body.includes('E_PATH_ESCAPE') ? null : '缺少 E_PATH_ESCAPE')) },
  { name: 'fs:read package.json → 200', path: api('fs:read', ['package.json']), expect: all(status(200), (r) => (r.body.includes('ai-code-manager') ? null : '内容不含项目名')) },
  { name: '/package.json（不在白名单前缀）→ 404', path: '/package.json', expect: status(404) },
  { name: '/src/frontend/%2e%2e/%2e%2e/package.json → 404', path: '/src/frontend/%2e%2e/%2e%2e/package.json', expect: status(404) },
  { name: 'Host: evil.com → 403', path: '/src/frontend/index.html', host: 'evil.com', expect: status(403) },
];

async function main(): Promise<number> {
  const port = await freePort();
  const child = await startServer(port);
  let failed = 0;
  try {
    for (const c of CHECKS) {
      let err: string | null;
      try {
        err = c.expect(await request(port, c));
      } catch (e) {
        err = e instanceof Error ? e.message : String(e);
      }
      if (err) failed++;
      console.log(`${err ? '✗' : '✓'} ${c.name}${err ? ` —— ${err}` : ''}`);
    }
  } finally {
    child.removeAllListeners('exit');
    child.kill();
  }
  console.log(failed ? `Web 预览冒烟失败：${failed}/${CHECKS.length}` : `Web 预览冒烟通过：${CHECKS.length}/${CHECKS.length}`);
  return failed ? 1 : 0;
}

process.exitCode = await main().catch((e: unknown) => {
  console.error(`Web 预览冒烟无法运行：${e instanceof Error ? e.message : String(e)}`);
  return 1;
});
