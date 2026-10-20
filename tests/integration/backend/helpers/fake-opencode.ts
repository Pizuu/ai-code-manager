/**
 * 假 opencode 可执行文件：输出与 opencode 1.19.3 `run --format json` 相同结构的 JSONL 事件
 * （见 contracts/fixtures/opencode-run.sample.jsonl），并把收到的参数与权限环境变量写入日志供断言。
 * 提示词关键字：slow = 长时间运行（测停止）；fail = 输出 error 事件并以 1 退出；crash = 写 stderr 后以 3 退出。
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const SCRIPT = String.raw`
const fs = require('node:fs');
const argv = process.argv.slice(2);
if (argv[0] === '--version') { console.log('1.19.3'); process.exit(0); }
const log = process.env.FAKE_OC_LOG;
const sep = argv.indexOf('--');
const prompt = sep >= 0 ? argv.slice(sep + 1).join(' ') : '';
const si = argv.indexOf('--session');
const sid = si >= 0 ? argv[si + 1] : 'ses_fake' + Date.now().toString(36);
if (log) fs.appendFileSync(log, JSON.stringify({ argv, cwd: process.cwd(), perm: process.env.OPENCODE_PERMISSION || null, secretSet: Boolean(process.env.FAKE_SECRET), plain: process.env.FAKE_PLAIN || null }) + '\n');
const ts = () => Date.now();
const out = (o) => process.stdout.write(JSON.stringify({ timestamp: ts(), sessionID: sid, ...o }) + '\n');
const msg = 'msg_1';
if (prompt.includes('crash')) { process.stderr.write('boom: something broke\n'); process.exit(3); }
if (prompt.includes('fail')) { out({ type: 'error', error: { name: 'APIError', data: { message: 'Model not found: fake/x', statusCode: 404 } } }); process.exit(1); }
out({ type: 'step_start', part: { id: 'prt_a', messageID: msg, sessionID: sid, type: 'step-start', snapshot: 'abc' } });
if (prompt.includes('slow')) { out({ type: 'text', part: { id: 'prt_t0', messageID: msg, sessionID: sid, type: 'text', text: '开始长任务…' } }); setInterval(() => {}, 1000); return; }
out({ type: 'text', part: { id: 'prt_t1', messageID: msg, sessionID: sid, type: 'text', text: '好的，' } });
out({ type: 'tool_use', part: { type: 'tool', tool: 'write', callID: 'call_w', id: 'prt_w', sessionID: sid, messageID: msg, state: { status: 'completed', input: { filePath: process.cwd() + '/hello.txt', content: 'hi\n' }, output: 'Wrote file successfully.', metadata: { exists: false, filepath: process.cwd() + '/hello.txt' }, title: 'hello.txt' } } });
out({ type: 'tool_use', part: { type: 'tool', tool: 'bash', callID: 'call_b', id: 'prt_b', sessionID: sid, messageID: msg, state: { status: 'completed', input: { command: 'echo ok' }, output: 'ok\n', metadata: {}, title: 'echo ok' } } });
out({ type: 'tool_use', part: { type: 'tool', tool: 'todowrite', callID: 'call_t', id: 'prt_td', sessionID: sid, messageID: msg, state: { status: 'completed', input: { todos: [{ id: '1', content: '写文件', status: 'completed' }, { id: '2', content: '验证', status: 'in_progress' }] }, output: '', metadata: {} } } });
out({ type: 'step_finish', part: { id: 'prt_f', reason: 'tool-calls', messageID: msg, sessionID: sid, type: 'step-finish', tokens: { input: 0, output: 0 }, cost: 0 } });
out({ type: 'text', part: { id: 'prt_t2', messageID: msg, sessionID: sid, type: 'text', text: '已写入 hello.txt。' } });
out({ type: 'step_finish', part: { id: 'prt_g', reason: 'stop', messageID: msg, sessionID: sid, type: 'step-finish', tokens: { total: 15, input: 10, output: 5 }, cost: 0 } });
`;

/** 在 dir 中写出可执行的假 opencode，返回其绝对路径（POSIX，shebang 指向当前 Node）。 */
export async function writeFakeOpencode(dir: string): Promise<string> {
  const file = path.join(dir, 'opencode');
  await fs.writeFile(file, `#!${process.execPath}\n(function(){${SCRIPT}\n})();\n`, { mode: 0o755 });
  return file;
}

export async function readFakeLog(file: string): Promise<Array<{ argv: string[]; cwd: string; perm: string | null; secretSet: boolean; plain: string | null }>> {
  try {
    return (await fs.readFile(file, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l) as { argv: string[]; cwd: string; perm: string | null; secretSet: boolean; plain: string | null });
  } catch {
    return [];
  }
}
