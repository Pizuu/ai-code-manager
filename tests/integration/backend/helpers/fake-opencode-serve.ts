/**
 * 假 opencode（同时支持 `run --format json` 与 `serve`）：serve 子命令在 127.0.0.1 随机端口起一个 HTTP 服务器，
 * 按 opencode 1.19.3 v1 API 形状（见 tests/unit/backend/agent-cli/opencode-serve.test.ts 的真实夹具）应答：
 * Basic 认证（用户名 opencode，密码 OPENCODE_SERVER_PASSWORD）、/global/health、POST /session、/event SSE、
 * prompt_async、GET /permission、/permission/:id/reply、/session/:id/abort。
 *
 * 提示词中的 `perm:<权限名>`（可多个，按顺序）让假模型依次请求这些权限；每个回复后才发下一个，全部回复后输出文本并 idle。
 * 环境变量：FAKE_OC_LOG（请求日志，JSONL）、FAKE_SERVE_FAIL=1（serve 立即以 2 退出）、FAKE_SERVE_VERSION（健康检查版本）。
 * 无随机性、无外网；端口由系统分配。
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const SERVE = String.raw`
const http = require('node:http');
const log = process.env.FAKE_OC_LOG;
const L = (o) => { if (log) fs.appendFileSync(log, JSON.stringify({ serve: true, ...o }) + '\n'); };
if (process.env.FAKE_SERVE_FAIL === '1') { process.stderr.write('fake serve: port in use\n'); process.exit(2); }
const password = process.env.OPENCODE_SERVER_PASSWORD || '';
const expected = 'Basic ' + Buffer.from('opencode:' + password).toString('base64');
L({ start: true, argv, hasPassword: Boolean(password), permEnv: process.env.OPENCODE_PERMISSION || null, secretSet: Boolean(process.env.FAKE_SECRET) });
const clients = new Set();
let pending = [];
let seq = 0;
const sessions = new Map();
const META = (dir) => ({
  bash: { tool: 'bash', patterns: ['echo hi'], metadata: { command: 'echo hi' }, input: { command: 'echo hi' }, output: 'hi\n' },
  edit: { tool: 'write', patterns: ['a.txt'], metadata: { filepath: dir + '/a.txt', diff: '--- a.txt\n+++ a.txt\n@@ -0,0 +1,1 @@\n+hello\n' }, input: { filePath: dir + '/a.txt', content: 'hello\n' }, output: 'Wrote file successfully.' },
  webfetch: { tool: 'webfetch', patterns: ['https://opencode.ai/docs/cli/'], metadata: { url: 'https://opencode.ai/docs/cli/', format: 'markdown' }, input: { url: 'https://opencode.ai/docs/cli/' }, output: '# CLI' },
  doom_loop: { tool: 'read', patterns: ['read'], metadata: { tool: 'read', input: { filePath: dir + '/README.md' } }, input: { filePath: dir + '/README.md' }, output: '# demo' },
  task: { tool: 'task', patterns: ['general'], metadata: { description: '调研 README 中的脚本', subagent_type: 'general' }, input: { description: '调研 README 中的脚本', subagent_type: 'general' }, output: 'done' },
  external_directory: { tool: 'read', patterns: ['/etc/*'], metadata: { filepath: '/etc/hosts', parentDir: '/etc' }, input: { filePath: '/etc/hosts' }, output: '127.0.0.1 localhost' },
  skill: { tool: 'skill', patterns: ['pdf-tools'], metadata: {}, input: { name: 'pdf-tools' }, output: 'loaded' },
});
const send = (type, properties) => {
  const data = 'data: ' + JSON.stringify({ id: 'evt_' + String(++seq).padStart(6, '0'), type, properties }) + '\n\n';
  for (const c of clients) c.write(data);
};
const part = (sid, p) => send('message.part.updated', { sessionID: sid, part: { sessionID: sid, messageID: 'msg_1', ...p } });
function next(sid) {
  const s = sessions.get(sid);
  const name = s.queue.shift();
  if (name === undefined) {
    send('message.part.delta', { sessionID: sid, messageID: 'msg_1', partID: 'prt_txt', field: 'text', delta: '完成' });
    part(sid, { id: 'prt_txt', type: 'text', text: '完成' });
    part(sid, { id: 'prt_fin', type: 'step-finish', reason: 'stop', tokens: { total: 6, input: 5, output: 1 } });
    send('session.status', { sessionID: sid, status: { type: 'idle' } });
    send('session.idle', { sessionID: sid });
    return;
  }
  const m = META(s.dir)[name] || { tool: name, patterns: ['x'], metadata: {}, input: {}, output: '' };
  const n = ++s.n;
  const callID = 'call_' + n;
  const perm = { id: 'per_' + String(n).padStart(4, '0') + sid.slice(4), sessionID: sid, permission: name, patterns: m.patterns, metadata: m.metadata, always: ['*'], tool: { messageID: 'msg_1', callID } };
  s.current = { perm, m, callID };
  pending.push(perm);
  // 与 1.19.3 一致：permission.asked 早于工具 part 的 running
  send('permission.asked', perm);
  part(sid, { id: 'prt_' + callID, type: 'tool', tool: m.tool, callID, state: { status: 'pending', input: {}, raw: '' } });
}
const body = (req) => new Promise((resolve) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { resolve(b ? JSON.parse(b) : undefined); } catch { resolve(b); } }); });
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const b = req.method === 'POST' ? await body(req) : undefined;
  L({ method: req.method, path: p, directory: url.searchParams.get('directory'), body: b, auth: req.headers.authorization === expected });
  if (req.headers.authorization !== expected) { res.writeHead(401, { 'www-authenticate': 'Basic realm="Secure Area"' }); res.end('Unauthorized'); return; }
  const json = (v) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)); };
  let m;
  if (req.method === 'GET' && p === '/global/health') return json({ healthy: true, version: process.env.FAKE_SERVE_VERSION || '1.19.3' });
  if (req.method === 'POST' && p === '/session') {
    const id = 'ses_fake' + String(sessions.size + 1).padStart(4, '0');
    sessions.set(id, { dir: url.searchParams.get('directory') || process.cwd(), queue: [], n: 0, current: null });
    return json({ id, title: (b && b.title) || '', version: '1.19.3' });
  }
  if (req.method === 'GET' && p === '/event') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    clients.add(res);
    req.on('close', () => clients.delete(res));
    res.write('data: ' + JSON.stringify({ id: 'evt_connected', type: 'server.connected', properties: {} }) + '\n\n');
    return;
  }
  if (req.method === 'GET' && p === '/permission') return json(pending);
  if (req.method === 'POST' && (m = /^\/session\/([^/]+)\/prompt_async$/.exec(p))) {
    const sid = decodeURIComponent(m[1]);
    const s = sessions.get(sid);
    if (!s) { res.writeHead(404); res.end('{"name":"NotFoundError"}'); return; }
    const text = (b && b.parts && b.parts[0] && b.parts[0].text) || '';
    s.queue = [...text.matchAll(/perm:([a-z_]+)/g)].map((x) => x[1]);
    res.writeHead(204); res.end();
    setImmediate(() => {
      send('session.status', { sessionID: sid, status: { type: 'busy' } });
      part(sid, { id: 'prt_start', type: 'step-start' });
      next(sid);
    });
    return;
  }
  if (req.method === 'POST' && (m = /^\/permission\/([^/]+)\/reply$/.exec(p))) {
    const id = decodeURIComponent(m[1]);
    const perm = pending.find((x) => x.id === id);
    if (!perm) { res.writeHead(404); res.end('{"name":"PermissionNotFoundError"}'); return; }
    pending = pending.filter((x) => x.id !== id);
    json(true);
    const s = sessions.get(perm.sessionID);
    const cur = s && s.current;
    setImmediate(() => {
      send('permission.replied', { sessionID: perm.sessionID, requestID: id, reply: b.reply });
      if (!cur || cur.perm.id !== id || s.aborted) return;
      const ok = b.reply !== 'reject';
      part(perm.sessionID, { id: 'prt_' + cur.callID, type: 'tool', tool: cur.m.tool, callID: cur.callID, state: ok
        ? { status: 'completed', input: cur.m.input, output: cur.m.output, metadata: {}, title: cur.m.tool }
        : { status: 'error', input: cur.m.input, error: 'The user rejected permission to use this specific tool call with the following feedback: ' + (b.message || '') } });
      send('session.status', { sessionID: perm.sessionID, status: { type: 'busy' } });
      next(perm.sessionID);
    });
    return;
  }
  if (req.method === 'POST' && (m = /^\/session\/([^/]+)\/abort$/.exec(p))) {
    const sid = decodeURIComponent(m[1]);
    const s = sessions.get(sid);
    if (s) { s.aborted = true; s.queue = []; }
    json(true);
    setImmediate(() => {
      send('session.error', { sessionID: sid, error: { name: 'MessageAbortedError', data: { message: 'Aborted' } } });
      send('session.status', { sessionID: sid, status: { type: 'idle' } });
      send('session.idle', { sessionID: sid });
    });
    return;
  }
  res.writeHead(404); res.end('not found');
});
server.listen(0, '127.0.0.1', () => {
  process.stdout.write('opencode server listening on http://127.0.0.1:' + server.address().port + '\n');
});
`;

/** 在 dir 中写出可执行的假 opencode（run 行为同 fake-opencode.ts，另支持 serve），返回其绝对路径（POSIX）。 */
export async function writeFakeOpencodeWithServe(dir: string, runScript: string): Promise<string> {
  const file = path.join(dir, 'opencode');
  const script = `const fs = require('node:fs');\nconst argv = process.argv.slice(2);\nif (argv[0] === 'serve') {${SERVE}\n} else {(function(){${runScript}\n})();}\n`;
  await fs.writeFile(file, `#!${process.execPath}\n${script}`, { mode: 0o755 });
  return file;
}

export interface FakeLogEntry {
  serve?: boolean;
  start?: boolean;
  argv?: string[];
  method?: string;
  path?: string;
  directory?: string | null;
  body?: unknown;
  auth?: boolean;
  hasPassword?: boolean;
  permEnv?: string | null;
  secretSet?: boolean;
  perm?: string | null;
}

export async function readLog(file: string): Promise<FakeLogEntry[]> {
  try {
    return (await fs.readFile(file, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l) as FakeLogEntry);
  } catch {
    return [];
  }
}
