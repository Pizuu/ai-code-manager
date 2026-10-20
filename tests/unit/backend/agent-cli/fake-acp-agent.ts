/**
 * 假 opencode ACP agent（测试夹具）：一个 node 脚本，以 NDJSON 逐行 JSON-RPC 2.0 说 ACP。
 * 行为由环境变量驱动（场景 / 版本 / 协议号 / load 能力），无网络、行为确定。
 * - `<exe> --version` → 打印 FAKE_ACP_VERSION（默认 1.19.3）
 * - `<exe> acp` → 进入 ACP 循环：initialize / session/new / session/load / session/set_model / session/prompt
 * 场景（FAKE_ACP_SCENARIO):
 * - basic：文本增量 + 工具调用全生命周期 + 若干应被忽略的 update，end_turn 收尾
 * - permission：发 session/request_permission，把客户端回的 outcome 以文本回显后 end_turn
 * - permission-hang：同上，但测试侧审批永不返回，靠 abort 触发 cancelled 回复
 * - cancel：prompt 后只发一段文本并挂起，等 session/cancel 通知后以 cancelled 回复
 * - die：prompt 后发一段文本、写 stderr 并以退出码 3 退出（不回复 prompt）
 * - hang：prompt 永不回复（peer 待答拒绝测试用）
 * - fsask：向客户端发 fs/read_text_file 请求，把收到的错误码以文本回显后 end_turn
 * 另：FAKE_ACP_ECHO_MODEL=1 时，basic 场景在 prompt 开头回显最近一次 session/set_model 收到的 modelId（MODEL:<id>）。
 */
import fs from 'node:fs/promises';
import path from 'node:path';

export const FAKE_ACP_AGENT_SOURCE = `#!/usr/bin/env node
const scenario = process.env.FAKE_ACP_SCENARIO || 'basic';
const version = process.env.FAKE_ACP_VERSION || '1.19.3';
if (process.argv[2] === '--version') {
  process.stdout.write(version + '\\n');
  process.exit(0);
}
if (process.argv[2] !== 'acp') {
  process.stderr.write('fake-acp: unknown mode ' + String(process.argv[2]) + '\\n');
  process.exit(2);
}
const proto = Number(process.env.FAKE_ACP_PROTO || '1');
const loadCap = process.env.FAKE_ACP_LOAD !== '0';
let buf = '';
let seq = 0;
let currentSession = null;
let lastModel = null;
let clientSeq = 1000;
const clientPending = new Map();
let cancelWaiter = null;

function send(obj) { process.stdout.write(JSON.stringify(obj) + '\\n'); }
function reply(id, result) { send({ jsonrpc: '2.0', id, result }); }
function replyError(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }); }
function update(u) { send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: currentSession, update: u } }); }
function textChunk(t) { update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: t } }); }
function requestClient(method, params) {
  const id = ++clientSeq;
  return new Promise((resolve, reject) => {
    clientPending.set(id, { resolve, reject });
    send({ jsonrpc: '2.0', id, method, params });
  });
}

function permOptions() {
  const all = [
    { optionId: 'opt-allow-once', name: 'Allow once', kind: 'allow_once' },
    { optionId: 'opt-allow-always', name: 'Always allow', kind: 'allow_always' },
    { optionId: 'opt-reject-once', name: 'Reject', kind: 'reject_once' },
    { optionId: 'opt-reject-always', name: 'Always reject', kind: 'reject_always' },
  ];
  const knob = process.env.FAKE_ACP_PERM_OPTIONS || 'all';
  if (knob === 'no-always') return all.filter((o) => o.kind !== 'allow_always');
  if (knob === 'no-once') return all.filter((o) => o.kind !== 'allow_once');
  return all;
}

async function runPrompt(id) {
  if (scenario === 'die') {
    textChunk('before death ');
    process.stderr.write('fake acp boom\\n');
    setTimeout(() => process.exit(3), 30);
    return;
  }
  if (scenario === 'hang') return; // 永不回复
  if (scenario === 'cancel') {
    textChunk('working ');
    cancelWaiter = () => reply(id, { stopReason: 'cancelled' });
    return;
  }
  if (scenario === 'permission' || scenario === 'permission-hang') {
    const kind = process.env.FAKE_ACP_PERM_KIND || 'execute';
    const rawInput = kind === 'edit' ? { filePath: '/proj/a.txt', content: 'hello\\n' } : { command: 'ls -la' };
    const outcome = await requestClient('session/request_permission', {
      sessionId: currentSession,
      toolCall: { toolCallId: 'call_perm', title: kind === 'edit' ? 'Write a.txt' : 'Run ls', kind, status: 'pending', rawInput },
      options: permOptions(),
    }).catch((e) => ({ rpcError: e && e.code }));
    textChunk('OUTCOME:' + JSON.stringify(outcome));
    const cancelled = outcome && outcome.outcome && outcome.outcome.outcome === 'cancelled';
    reply(id, { stopReason: cancelled ? 'cancelled' : 'end_turn' });
    return;
  }
  if (scenario === 'fsask') {
    let got;
    try {
      await requestClient('fs/read_text_file', { sessionId: currentSession, path: '/etc/passwd' });
      got = 'NO_ERROR';
    } catch (e) {
      got = 'ERR:' + String(e && e.code);
    }
    textChunk('FSRESULT:' + got);
    reply(id, { stopReason: 'end_turn' });
    return;
  }
  // basic
  if (process.env.FAKE_ACP_ECHO_MODEL === '1' && lastModel) textChunk('MODEL:' + lastModel + '\\n');
  textChunk('Hello ');
  textChunk('world');
  update({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'echo' } });
  update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'thinking…' } });
  update({ sessionUpdate: 'tool_call', toolCallId: 'call_bash', title: 'bash', kind: 'execute', status: 'pending', rawInput: { command: 'echo hi' } });
  update({ sessionUpdate: 'tool_call_update', toolCallId: 'call_bash', status: 'in_progress' });
  update({ sessionUpdate: 'plan', entries: [{ content: 'step 1', status: 'pending', priority: 'high' }] });
  update({ sessionUpdate: 'usage_update', used: 10, size: 1000 });
  update({ sessionUpdate: 'some_unknown_kind', foo: 1 });
  update({ sessionUpdate: 'tool_call_update', toolCallId: 'call_bash', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: 'hi\\n' } }], rawOutput: { metadata: { output: 'hi\\n', exit: 0 } } });
  textChunk('done');
  reply(id, { stopReason: 'end_turn' });
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\\n')) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.method && (typeof msg.id === 'number' || typeof msg.id === 'string')) {
      const id = msg.id;
      const p = msg.params || {};
      if (msg.method === 'initialize') {
        reply(id, { protocolVersion: proto, agentCapabilities: { loadSession: loadCap }, agentInfo: { name: 'fake-acp', version: '0.0.0' } });
      } else if (msg.method === 'session/new') {
        if (process.env.FAKE_ACP_AUTH === '1') { replyError(id, -32000, 'authentication required'); continue; }
        currentSession = 'ses_fake_' + String(++seq);
        reply(id, { sessionId: currentSession });
      } else if (msg.method === 'session/load') {
        if (process.env.FAKE_ACP_LOAD_FAIL === '1') { replyError(id, -32602, 'unknown session'); continue; }
        currentSession = p.sessionId;
        reply(id, {});
      } else if (msg.method === 'session/set_model') {
        lastModel = p.modelId || null;
        reply(id, {});
      } else if (msg.method === 'session/prompt') {
        void runPrompt(id);
      } else {
        replyError(id, -32601, 'unknown method ' + msg.method);
      }
    } else if (msg.method === 'session/cancel') {
      if (cancelWaiter) { const w = cancelWaiter; cancelWaiter = null; w(); }
    } else if (typeof msg.id === 'number' && clientPending.has(msg.id)) {
      const entry = clientPending.get(msg.id);
      clientPending.delete(msg.id);
      if (msg.error) entry.reject(Object.assign(new Error(msg.error.message || 'rpc error'), { code: msg.error.code }));
      else entry.resolve(msg.result);
    }
  }
});
process.stdin.on('end', () => process.exit(0));
`;

/** 把假 agent 写成可执行文件（名为 opencode），返回其路径。POSIX 专用（shebang）。 */
export async function writeFakeAcpAgent(dir: string): Promise<string> {
  const file = path.join(dir, 'opencode');
  await fs.writeFile(file, FAKE_ACP_AGENT_SOURCE, { mode: 0o755 });
  return file;
}
