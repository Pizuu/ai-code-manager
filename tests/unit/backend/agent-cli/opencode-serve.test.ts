/**
 * opencode serve 逐条审批原型（T125 / T-022）。确定性：进程内假 HTTP/SSE 服务器（注入 fetch），无网络、无真实时间。
 * 下列夹具逐字摘自真实 opencode-ai 1.19.3 `opencode serve` 的响应与 SSE 事件（2026-10-20 沙箱实测，本地假模型发起 bash 与 write 工具调用），
 * 只删去与本原型无关的字段；它们是升级 opencode 时的回归基线。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { spawn } from 'node:child_process';
import type { ApprovalRequest } from '../../../../contracts/ipc.ts';
import { toolStatus } from '../../../../src/backend/agent-cli/opencode-events.ts';
import {
  OpencodeServeClient, OpencodeServeError, REJECT_MESSAGE, STOP_MESSAGE, attachOpencodeServe, createSseParser, mapServeEvent,
  parseListeningUrl, parsePermissionRequest, runServeTurn, serveRules, startOpencodeServe, toApprovalRequest,
  type ServeEvent, type ServeMappedEvent, type ServePermissionRequest,
} from '../../../../src/backend/agent-cli/opencode-serve.ts';

// ───────────────────────── 真实 1.19.3 形状夹具 ─────────────────────────

const ROOT = '/tmp/ocproj';
const SID = 'ses_ea7c18e95ffe4DOvT7NbDMAndx';

/** serve 启动时 stdout（未设密码时前面还有一行 "Warning: OPENCODE_SERVER_PASSWORD is not set; server is unsecured."）。 */
const REAL_LISTENING_LINE = 'opencode server listening on http://127.0.0.1:35865\n';
const REAL_HEALTH = { healthy: true, version: '1.19.3' };
const REAL_SESSION = {
  id: SID, slug: 'playful-wizard', projectID: 'global', directory: ROOT, path: '', cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, title: 'probe', version: '1.19.3',
  time: { created: 1792481784809, updated: 1792481784809 },
};

const REAL_PERM_BASH = {
  id: 'per_1583e7986001XUEpm13UM4yktA', sessionID: SID, permission: 'bash', patterns: ['echo hi > hi.txt'],
  metadata: { command: 'echo hi > hi.txt' }, always: ['echo *'], tool: { messageID: 'msg_1583e7598001cL2OTaSijsAexg', callID: 'call_bash_1' },
};
const REAL_PERM_EDIT = {
  id: 'per_1583e7b19001y7ACDcCCXSVnXQ', sessionID: SID, permission: 'edit', patterns: ['a.txt'],
  metadata: {
    filepath: '/tmp/ocproj/a.txt',
    diff: 'Index: /tmp/ocproj/a.txt\n===================================================================\n--- /tmp/ocproj/a.txt\n+++ /tmp/ocproj/a.txt\n@@ -0,0 +1,1 @@\n+hello\n',
  },
  always: ['*'], tool: { messageID: 'msg_1583e7aa6001faEmNocVsoYu28', callID: 'call_write_1' },
};

const ev = (id: string, type: string, properties: Record<string, unknown>) => ({ id, type, properties });
const E = {
  connected: ev('evt_1583d713b001PbtYYsWx6XmGOw', 'server.connected', {}),
  heartbeat: ev('evt_1583e0000001heartbeat000000', 'server.heartbeat', {}),
  busy: ev('evt_1583d8485001Vsjg56nJO5J06l', 'session.status', { sessionID: SID, status: { type: 'busy' } }),
  idleStatus: ev('evt_1583e7c90001idle0000000000', 'session.status', { sessionID: SID, status: { type: 'idle' } }),
  idle: ev('evt_1583e7c91001idle0000000000', 'session.idle', { sessionID: SID }),
  stepStart: ev('evt_1583e790b001stepstart00000', 'message.part.updated', {
    sessionID: SID, part: { id: 'prt_1583e790a001IOd4XarYPEsGR8', messageID: 'msg_1583e7598001cL2OTaSijsAexg', sessionID: SID, snapshot: 'af1d5fede2190b8aa46b32c5adde4a3dd7d9bff4', type: 'step-start' },
  }),
  // 1.19.3：permission.asked 可能早于工具 part 进入 running（此时 input 为空）
  bashPending: ev('evt_1583e7912001bashpending000', 'message.part.updated', {
    sessionID: SID, part: { id: 'prt_1583e7911001gknygoLjRZnSIC', messageID: 'msg_1583e7598001cL2OTaSijsAexg', sessionID: SID, type: 'tool', tool: 'bash', callID: 'call_bash_1', state: { status: 'pending', input: {}, raw: '' } },
  }),
  bashAsked: ev('evt_1583e7988001a3WYCkg1NrMFcg', 'permission.asked', REAL_PERM_BASH),
  bashReplied: (reply: string) => ev('evt_1583e79a1001eJ9ML383q2s08A', 'permission.replied', { sessionID: SID, requestID: REAL_PERM_BASH.id, reply }),
  bashDone: ev('evt_1583e7a5d001bashdone0000000', 'message.part.updated', {
    sessionID: SID, part: {
      type: 'tool', tool: 'bash', callID: 'call_bash_1', id: 'prt_1583e7911001gknygoLjRZnSIC', sessionID: SID, messageID: 'msg_1583e7598001cL2OTaSijsAexg',
      state: { status: 'completed', input: { command: 'echo hi > hi.txt', description: '写入 hi.txt' }, output: '(no output)', metadata: { output: '(no output)', exit: 0, truncated: false }, title: 'echo hi > hi.txt', time: { start: 1792481851679, end: 1792481851870 } },
    },
  }),
  bashRejected: ev('evt_1583e9114001bashrejected00', 'message.part.updated', {
    sessionID: SID, part: {
      type: 'tool', tool: 'bash', callID: 'call_bash_1', id: 'prt_1583e7911001gknygoLjRZnSIC', sessionID: SID, messageID: 'msg_1583e7598001cL2OTaSijsAexg',
      state: { status: 'error', input: { command: 'echo hi > hi.txt', description: '写入 hi.txt' }, error: `The user rejected permission to use this specific tool call with the following feedback: ${REJECT_MESSAGE}`, time: { start: 1792481857784, end: 1792481857816 } },
    },
  }),
  bashAborted: ev('evt_1583ef270001bashaborted000', 'message.part.updated', {
    sessionID: SID, part: {
      type: 'tool', tool: 'bash', callID: 'call_bash_1', id: 'prt_1583e7911001gknygoLjRZnSIC', sessionID: SID, messageID: 'msg_1583e7598001cL2OTaSijsAexg',
      state: { status: 'error', input: { command: 'echo hi > hi.txt', description: '写入 hi.txt' }, time: { start: 1792481882704, end: 1792481883015 }, error: 'Tool execution aborted', metadata: { interrupted: true } },
    },
  }),
  abortedError: ev('evt_1583ef26a001b4xgrvLNsipTNB', 'session.error', { sessionID: SID, error: { name: 'MessageAbortedError', data: { message: 'Aborted' } } }),
  editAsked: ev('evt_1583e7b19002v9GxF7rmylAk0B', 'permission.asked', REAL_PERM_EDIT),
  editReplied: (reply: string) => ev('evt_1583e7b37001tKim2uVgQPMBLZ', 'permission.replied', { sessionID: SID, requestID: REAL_PERM_EDIT.id, reply }),
  writeDone: ev('evt_1583e7b38001writedone00000', 'message.part.updated', {
    sessionID: SID, part: {
      type: 'tool', tool: 'write', callID: 'call_write_1', id: 'prt_1583e7b08001k2zylnAdIO5zUf', sessionID: SID, messageID: 'msg_1583e7aa6001faEmNocVsoYu28',
      state: { status: 'completed', input: { filePath: '/tmp/ocproj/a.txt', content: 'hello\n' }, output: 'Wrote file successfully.', metadata: { diagnostics: {}, filepath: '/tmp/ocproj/a.txt', exists: false, truncated: false }, title: 'a.txt', time: { start: 1792481852177, end: 1792481852237 } },
    },
  }),
  textDelta: ev('evt_1583e7c39001ZC40ecJ2y9CUZ2', 'message.part.delta', { sessionID: SID, messageID: 'msg_1583e7be2001BP08oq4R4Ht5dv', partID: 'prt_1583e7c350015O0vtBCbY27QgO', field: 'text', delta: '完成' }),
  textDone: ev('evt_1583e7c3a001textdone0000000', 'message.part.updated', {
    sessionID: SID, part: { id: 'prt_1583e7c350015O0vtBCbY27QgO', messageID: 'msg_1583e7be2001BP08oq4R4Ht5dv', sessionID: SID, type: 'text', text: '完成', time: { start: 1792481852469, end: 1792481852475 } },
  }),
  stepFinish: ev('evt_1583eefce001OexR7EtBkVI3yS', 'message.part.updated', {
    sessionID: SID, part: { id: 'prt_1583eefce001bx37xWDUkYQO1u', reason: 'stop', snapshot: '6af7b8e19c2da9b5d01397bc11477a97f253de3a', messageID: 'msg_1583e7be2001BP08oq4R4Ht5dv', sessionID: SID, type: 'step-finish', tokens: { total: 6, input: 5, output: 1, reasoning: 0, cache: { write: 0, read: 0 } }, cost: 0 },
  }),
  otherSessionAsked: ev('evt_1583e9999001othersession00', 'permission.asked', { ...REAL_PERM_BASH, id: 'per_1583e9999001otherSessionXX', sessionID: 'ses_ea7c16fc3ffeQqE7nD5I2Z3JwJ' }),
};

// ───────────────────────── 进程内假 serve ─────────────────────────

interface Call { method: string; path: string; query: URLSearchParams; body: unknown; auth: string | null }

/**
 * 按真实 1.19.3 行为编排：prompt 后发起 bash（先 asked 后 part）；回复后无论允许或拒绝都继续 write（拒绝不中止本轮）；
 * write 回复后发文本并 idle。abort 不清理待批（与实测一致）。
 */
class FakeServe {
  calls: Call[] = [];
  pending: ServePermissionRequest[] = [];
  streams: ReadableStreamDefaultController<Uint8Array>[] = [];
  /** 第 n 个事件流在发出 cutAfter 个事件后断开。 */
  cutStream: { index: number; cutAfter: number } | null = null;
  failStreamsFrom = Infinity;
  password: string | null = null;
  preExisting: ServePermissionRequest[] = [];
  private enc = new TextEncoder();
  private streamSent = new Map<number, number>();

  readonly fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(input);
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    this.calls.push({ method, path: url.pathname, query: url.searchParams, body, auth: headers.get('authorization') });
    if (this.password && headers.get('authorization') !== `Basic ${Buffer.from(`opencode:${this.password}`).toString('base64')}`) {
      return new Response('Unauthorized', { status: 401, headers: { 'www-authenticate': 'Basic realm="Secure Area"' } });
    }
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });
    const p = url.pathname;
    if (method === 'GET' && p === '/global/health') return json(REAL_HEALTH);
    if (method === 'POST' && p === '/session') return json(REAL_SESSION);
    if (method === 'GET' && p === '/event') return this.openStream(init?.signal ?? undefined);
    if (method === 'GET' && p === '/permission') return json([...this.preExisting, ...this.pending]);
    let m: RegExpExecArray | null;
    if (method === 'POST' && /^\/session\/[^/]+\/prompt_async$/.test(p)) {
      queueMicrotask(() => this.emitAll([E.busy, E.stepStart, E.bashPending, E.bashAsked], [REAL_PERM_BASH]));
      return new Response(null, { status: 204 });
    }
    if (method === 'POST' && (m = /^\/permission\/([^/]+)\/reply$/.exec(p))) {
      const id = decodeURIComponent(m[1] ?? '');
      const reply = String((body as { reply?: unknown }).reply);
      const wasPre = this.preExisting.some((x) => x.id === id);
      this.preExisting = this.preExisting.filter((x) => x.id !== id);
      if (!this.pending.some((x) => x.id === id)) return wasPre ? json(true) : new Response('{"name":"PermissionNotFoundError"}', { status: 404 });
      this.pending = this.pending.filter((x) => x.id !== id);
      queueMicrotask(() => {
        if (id === REAL_PERM_BASH.id) {
          this.emitAll([E.bashReplied(reply), reply === 'reject' ? E.bashRejected : E.bashDone, E.busy, E.editAsked], [REAL_PERM_EDIT]);
        } else if (id === REAL_PERM_EDIT.id) {
          this.emitAll([E.editReplied(reply), E.writeDone, E.busy, E.textDelta, E.textDone, E.stepFinish, E.idleStatus, E.idle], []);
        }
      });
      return json(true);
    }
    if (method === 'POST' && /^\/session\/[^/]+\/abort$/.test(p)) {
      queueMicrotask(() => this.emitAll([E.bashAborted, E.abortedError, E.idleStatus, E.idle], []));
      return json(true);
    }
    return new Response('not found', { status: 404 });
  };

  private openStream(signal?: AbortSignal): Response {
    const index = this.streams.length;
    if (index >= this.failStreamsFrom) {
      this.streams.push(null as unknown as ReadableStreamDefaultController<Uint8Array>);
      return new Response('down', { status: 503 });
    }
    const stream = new ReadableStream<Uint8Array>({
      start: (c) => {
        this.streams.push(c);
        this.streamSent.set(index, 0);
        signal?.addEventListener('abort', () => {
          try {
            c.error(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          } catch {
            // 已关闭
          }
        });
      },
    });
    queueMicrotask(() => this.send(index, E.connected));
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }

  private send(index: number, e: object): void {
    const c = this.streams[index];
    if (!c) return;
    const sent = this.streamSent.get(index) ?? 0;
    if (this.cutStream && this.cutStream.index === index && sent >= this.cutStream.cutAfter) return;
    try {
      // 故意把一个事件拆成两块写入，覆盖 SSE 分块解析
      const text = `data: ${JSON.stringify(e)}\n\n`;
      const mid = Math.floor(text.length / 2);
      c.enqueue(this.enc.encode(text.slice(0, mid)));
      c.enqueue(this.enc.encode(text.slice(mid)));
      this.streamSent.set(index, sent + 1);
      if (this.cutStream && this.cutStream.index === index && sent + 1 >= this.cutStream.cutAfter) c.close();
    } catch {
      // 流已关闭
    }
  }

  emitAll(events: object[], newPending: ServePermissionRequest[]): void {
    this.pending.push(...newPending);
    const index = this.streams.length - 1;
    for (const e of events) this.send(index, e);
  }

  callsTo(method: string, re: RegExp): Call[] {
    return this.calls.filter((c) => c.method === method && re.test(c.path));
  }
}

let idSeq = 0;
const newId = () => `id-${++idSeq}`;

function makeTurn(fake: FakeServe, opts: { approve?: (req: ApprovalRequest) => boolean | Promise<boolean>; signal?: AbortSignal; maxReconnects?: number } = {}) {
  const asked: ApprovalRequest[] = [];
  const events: ServeMappedEvent[] = [];
  const client = new OpencodeServeClient({ baseUrl: 'http://127.0.0.1:35865', directory: ROOT, fetch: fake.fetch });
  const run = runServeTurn({
    client, sessionId: SID, appSessionId: 'app-1', projectRoot: ROOT, prompt: '写文件', signal: opts.signal ?? new AbortController().signal, newId,
    requestApproval: async (req) => {
      asked.push(req);
      return opts.approve ? opts.approve(req) : true;
    },
    onEvent: (e) => events.push(e),
    ...(opts.maxReconnects !== undefined ? { maxReconnects: opts.maxReconnects } : {}),
  });
  return { run, asked, events };
}

// ───────────────────────── 纯函数 ─────────────────────────

test('parseListeningUrl reads the real serve stdout line', () => {
  assert.equal(parseListeningUrl(REAL_LISTENING_LINE), 'http://127.0.0.1:35865');
  assert.equal(parseListeningUrl('Warning: OPENCODE_SERVER_PASSWORD is not set; server is unsecured.'), null);
});

test('serveRules: every mode sends an explicit ruleset; commands always ask unless plan denies; external dirs denied', () => {
  const action = (mode: 'ask' | 'auto-edits' | 'plan', perm: string) => [...serveRules(mode)].reverse().find((r) => r.permission === perm || r.permission === '*')?.action;
  assert.equal(serveRules('ask')[0]?.permission, '*');
  assert.equal(action('ask', 'edit'), 'ask');
  assert.equal(action('ask', 'bash'), 'ask');
  assert.equal(action('auto-edits', 'edit'), 'allow');
  assert.equal(action('auto-edits', 'bash'), 'ask');
  assert.equal(action('plan', 'edit'), 'deny');
  assert.equal(action('plan', 'bash'), 'deny');
  for (const m of ['ask', 'auto-edits', 'plan'] as const) assert.equal(action(m, 'external_directory'), 'deny');
  assert.equal(action('ask', 'read'), 'allow');
});

test('toApprovalRequest maps real bash / edit permission events to v1.3 kinds, always carrying permission + patterns', () => {
  const bash = parsePermissionRequest(REAL_PERM_BASH);
  const edit = parsePermissionRequest(REAL_PERM_EDIT);
  assert.ok(bash && edit);
  const b = toApprovalRequest(bash, { approvalId: 'a1', appSessionId: 'app-1', projectRoot: ROOT });
  assert.deepEqual({ kind: b.kind, command: b.command, toolCallId: b.toolCallId, sessionId: b.sessionId, permission: b.permission, patterns: b.patterns }, { kind: 'command', command: 'echo hi > hi.txt', toolCallId: 'call_bash_1', sessionId: 'app-1', permission: 'bash', patterns: ['echo hi > hi.txt'] });
  const e = toApprovalRequest(edit, { approvalId: 'a2', appSessionId: 'app-1', projectRoot: ROOT });
  assert.equal(e.kind, 'edit');
  assert.equal(e.path, 'a.txt');
  assert.equal(e.permission, 'edit');
  assert.deepEqual(e.patterns, ['a.txt']);
  assert.match(e.diff ?? '', /^\+hello$/m);
  const mk = (permission: string, patterns: string[], metadata: Record<string, unknown> = {}) => {
    const p = parsePermissionRequest({ id: 'per_x', sessionID: SID, permission, patterns, metadata, always: [] });
    assert.ok(p);
    return toApprovalRequest(p, { approvalId: 'a3', appSessionId: 'app-1', projectRoot: ROOT });
  };
  const w = mk('webfetch', ['https://example.com/*']);
  assert.deepEqual({ kind: w.kind, url: w.url, permission: w.permission, toolCallId: w.toolCallId }, { kind: 'webfetch', url: 'https://example.com/*', permission: 'webfetch', toolCallId: 'per_x' });
  assert.equal(mk('webfetch', ['x'], { url: 'https://opencode.ai/docs/cli/' }).url, 'https://opencode.ai/docs/cli/');
  const l = mk('doom_loop', ['read']);
  assert.deepEqual({ kind: l.kind, tool: l.tool }, { kind: 'loop', tool: 'read' });
  assert.match(l.description ?? '', /read/);
  const t = mk('task', ['general'], { description: '调研脚本', subagent_type: 'general' });
  assert.deepEqual({ kind: t.kind, description: t.description, patterns: t.patterns }, { kind: 'subagent', description: '调研脚本', patterns: ['general'] });
  assert.equal(mk('task', ['explore']).description, '启动子 agent：explore');
  const x = mk('external_directory', ['/etc/*']);
  assert.deepEqual({ kind: x.kind, path: x.path, patterns: x.patterns }, { kind: 'external-dir', path: '/etc', patterns: ['/etc/*'] });
  assert.equal(mk('external_directory', ['/etc/*'], { filepath: '/etc/hosts', parentDir: '/etc' }).path, '/etc');
  const o = mk('skill', ['pdf-tools']);
  assert.deepEqual({ kind: o.kind, permission: o.permission, patterns: o.patterns, description: o.description }, { kind: 'other', permission: 'skill', patterns: ['pdf-tools'], description: 'opencode 权限：skill' });
  assert.equal(parsePermissionRequest({ id: 'nope', sessionID: SID }), null);
});

test('createSseParser handles split chunks, CRLF, multi-line data and ignores non-JSON', () => {
  const parse = createSseParser();
  const text = `data: ${JSON.stringify(E.bashAsked)}\r\n\r\n: comment\n\ndata: not json\n\ndata: {"id":"evt_1","type":"x",\ndata: "properties":{}}\n\n`;
  const out: ServeEvent[] = [];
  for (let i = 0; i < text.length; i += 7) out.push(...parse(text.slice(i, i + 7)));
  assert.deepEqual(out.map((e) => e.type), ['permission.asked', 'x']);
  assert.equal(out[0]?.properties.id, REAL_PERM_BASH.id);
});

test('mapServeEvent reuses run-mode parsing for parts and maps deltas, status and errors', () => {
  const pending = mapServeEvent(E.bashPending);
  assert.ok(pending && pending.kind === 'tool');
  assert.equal(pending.status, 'pending');
  const rejected = mapServeEvent(E.bashRejected);
  assert.ok(rejected && rejected.kind === 'tool');
  assert.equal(toolStatus(rejected), 'rejected');
  const aborted = mapServeEvent(E.bashAborted);
  assert.ok(aborted && aborted.kind === 'tool');
  assert.equal(toolStatus(aborted), 'error');
  const done = mapServeEvent(E.writeDone);
  assert.ok(done && done.kind === 'tool');
  assert.equal(done.input.filePath, '/tmp/ocproj/a.txt');
  assert.deepEqual(mapServeEvent(E.textDelta), { kind: 'text-delta', sessionId: SID, partId: 'prt_1583e7c350015O0vtBCbY27QgO', delta: '完成' });
  const fin = mapServeEvent(E.stepFinish);
  assert.ok(fin && fin.kind === 'step-finish');
  assert.equal(fin.tokens, 6);
  const err = mapServeEvent(E.abortedError);
  assert.ok(err && err.kind === 'error');
  assert.equal(err.message, 'Aborted');
  assert.deepEqual(mapServeEvent(E.busy), { kind: 'busy', sessionId: SID });
  assert.deepEqual(mapServeEvent(E.idle), { kind: 'idle', sessionId: SID });
  assert.equal(mapServeEvent(E.heartbeat), null);
});

// ───────────────────────── HTTP 客户端 ─────────────────────────

test('client sends directory query, Basic auth (user opencode) and the session ruleset; 401 surfaces as OpencodeServeError', async () => {
  const fake = new FakeServe();
  fake.password = 'pw';
  const client = new OpencodeServeClient({ baseUrl: 'http://127.0.0.1:35865/', directory: ROOT, password: 'pw', fetch: fake.fetch });
  const sid = await client.createSession({ title: 't', permission: serveRules('ask') });
  assert.equal(sid, SID);
  const call = fake.calls[0];
  assert.ok(call);
  assert.equal(call.query.get('directory'), ROOT);
  assert.equal(call.auth, `Basic ${Buffer.from('opencode:pw').toString('base64')}`);
  assert.deepEqual((call.body as { permission: unknown }).permission, serveRules('ask'));
  const bad = new OpencodeServeClient({ baseUrl: 'http://127.0.0.1:35865', directory: ROOT, password: 'wrong', fetch: fake.fetch });
  await assert.rejects(bad.health(), (e: unknown) => e instanceof OpencodeServeError && e.status === 401);
});

test('attachOpencodeServe checks health and flags 1.19.x as supported', async () => {
  const fake = new FakeServe();
  const r = await attachOpencodeServe({ baseUrl: 'http://127.0.0.1:35865', directory: ROOT, fetch: fake.fetch });
  assert.equal(r.version, '1.19.3');
  assert.equal(r.supported, true);
  assert.equal(fake.calls[0]?.query.get('directory'), null);
});

// ───────────────────────── 逐条审批一轮 ─────────────────────────

test('approves each tool call individually (bash then write) and finishes on idle', async () => {
  const fake = new FakeServe();
  const { run, asked, events } = makeTurn(fake);
  const res = await run;
  assert.equal(res.status, 'idle');
  assert.deepEqual(asked.map((a) => a.kind), ['command', 'edit']);
  assert.equal(asked[0]?.command, 'echo hi > hi.txt');
  assert.equal(asked[1]?.path, 'a.txt');
  assert.deepEqual(res.approvals.map((a) => [a.permission, a.toolCallId, a.approved]), [['bash', 'call_bash_1', true], ['edit', 'call_write_1', true]]);
  const replies = fake.callsTo('POST', /\/permission\/.+\/reply$/).map((c) => c.body);
  assert.deepEqual(replies, [{ reply: 'once' }, { reply: 'once' }]);
  // 先订阅再发消息
  const order = fake.calls.map((c) => `${c.method} ${c.path}`);
  assert.ok(order.indexOf('GET /event') < order.indexOf(`POST /session/${SID}/prompt_async`));
  assert.deepEqual(fake.callsTo('POST', /prompt_async$/)[0]?.body, { parts: [{ type: 'text', text: '写文件' }] });
  assert.ok(events.some((e) => e.kind === 'text-delta' && e.delta === '完成'));
  assert.ok(events.some((e) => e.kind === 'tool' && e.tool === 'write' && toolStatus(e) === 'done'));
  assert.equal(fake.callsTo('POST', /abort$/).length, 0);
});

test('a rejected call is replied with reject + message; the turn continues to the next call (1.19.3 behaviour)', async () => {
  const fake = new FakeServe();
  const { run, asked, events } = makeTurn(fake, { approve: (r) => r.kind !== 'command' });
  const res = await run;
  assert.equal(res.status, 'idle');
  assert.equal(asked.length, 2);
  const replies = fake.callsTo('POST', /\/permission\/.+\/reply$/).map((c) => c.body);
  assert.deepEqual(replies, [{ reply: 'reject', message: REJECT_MESSAGE }, { reply: 'once' }]);
  const bash = events.filter((e) => e.kind === 'tool' && e.tool === 'bash').at(-1);
  assert.ok(bash && bash.kind === 'tool');
  assert.equal(toolStatus(bash), 'rejected');
  assert.ok(!fake.calls.some((c) => (c.body as { reply?: string } | undefined)?.reply === 'always'));
});

test('stop while an approval is pending: rejects every pending permission, then aborts (abort alone leaves it pending)', async () => {
  const fake = new FakeServe();
  const ctrl = new AbortController();
  const { run, asked } = makeTurn(fake, {
    signal: ctrl.signal,
    approve: () => {
      queueMicrotask(() => ctrl.abort());
      return new Promise<boolean>(() => undefined); // 用户迟迟不答
    },
  });
  const res = await run;
  assert.equal(res.status, 'aborted');
  assert.equal(asked.length, 1);
  // 停止后到达的权限请求（假服务器在拒绝后仍继续下一个工具）不再询问用户，直接拒绝
  assert.equal(res.approvals[0]?.permissionId, REAL_PERM_BASH.id);
  assert.ok(res.approvals.every((a) => !a.approved));
  assert.ok(!fake.calls.some((c) => (c.body as { reply?: string } | undefined)?.reply === 'once'));
  const replyIdx = fake.calls.findIndex((c) => c.method === 'POST' && /\/reply$/.test(c.path));
  const abortIdx = fake.calls.findIndex((c) => c.method === 'POST' && /\/abort$/.test(c.path));
  assert.ok(replyIdx !== -1 && abortIdx !== -1 && replyIdx < abortIdx);
  assert.deepEqual(fake.calls[replyIdx]?.body, { reply: 'reject', message: STOP_MESSAGE });
  assert.equal(fake.pending.length, 0);
});

test('already-aborted signal never prompts', async () => {
  const fake = new FakeServe();
  const ctrl = new AbortController();
  ctrl.abort();
  const { run, asked } = makeTurn(fake, { signal: ctrl.signal });
  const res = await run;
  assert.equal(res.status, 'aborted');
  assert.equal(asked.length, 0);
  assert.equal(fake.callsTo('POST', /prompt_async$/).length, 0);
  assert.equal(fake.callsTo('POST', /abort$/).length, 1);
});

test('reconciles permissions pending before subscribing; ignores other sessions; dedupes SSE + list', async () => {
  const fake = new FakeServe();
  const stale = parsePermissionRequest({ ...REAL_PERM_BASH, id: 'per_1583e0000001staleBeforeSub' });
  const other = parsePermissionRequest(E.otherSessionAsked.properties);
  assert.ok(stale && other);
  fake.preExisting = [stale, other];
  const origFetch = fake.fetch;
  let injected = false;
  const wrapped = async (input: string, init?: RequestInit) => {
    const r = await origFetch(input, init);
    if (!injected && new URL(input).pathname.endsWith('/prompt_async')) {
      injected = true;
      queueMicrotask(() => fake.emitAll([E.otherSessionAsked], []));
    }
    return r;
  };
  const client = new OpencodeServeClient({ baseUrl: 'http://x', directory: ROOT, fetch: wrapped });
  const asked: ApprovalRequest[] = [];
  const res = await runServeTurn({
    client, sessionId: SID, appSessionId: 'app-1', projectRoot: ROOT, prompt: 'p', signal: new AbortController().signal, newId,
    requestApproval: async (r) => {
      asked.push(r);
      return true;
    },
  });
  assert.equal(res.status, 'idle');
  assert.deepEqual(res.approvals.map((a) => a.permissionId), ['per_1583e0000001staleBeforeSub', REAL_PERM_BASH.id, REAL_PERM_EDIT.id]);
  assert.equal(asked.length, 3);
  assert.ok(!fake.calls.some((c) => c.path.includes('otherSession')));
});

test('SSE drop mid-turn: reconnects, reconciles the missed permission and still finishes', async () => {
  const fake = new FakeServe();
  // 第 0 个流发出 connected + busy + step-start + bash-pending 后断开，permission.asked 只能靠对账拿到
  fake.cutStream = { index: 0, cutAfter: 4 };
  const { run, asked } = makeTurn(fake);
  const res = await run;
  assert.equal(res.status, 'idle');
  assert.equal(fake.callsTo('GET', /^\/event$/).length, 2);
  assert.deepEqual(asked.map((a) => a.kind), ['command', 'edit']);
  assert.equal(fake.callsTo('POST', /prompt_async$/).length, 1);
});

test('SSE that cannot reconnect ends the turn with an error after maxReconnects', async () => {
  const fake = new FakeServe();
  fake.cutStream = { index: 0, cutAfter: 2 };
  fake.failStreamsFrom = 1;
  const { run } = makeTurn(fake, { maxReconnects: 1 });
  const res = await run;
  assert.equal(res.status, 'error');
  assert.match(res.error ?? '', /503/);
});

test('requestApproval throwing counts as rejection', async () => {
  const fake = new FakeServe();
  const { run } = makeTurn(fake, { approve: () => Promise.reject(new Error('ui gone')) });
  const res = await run;
  assert.deepEqual(res.approvals.map((a) => a.approved), [false, false]);
});

// ───────────────────────── 启动服务器 ─────────────────────────

class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  pid = 4242;
  exitCode: number | null = null;
  killed: string[] = [];
  kill(sig: string) {
    this.killed.push(sig);
    return true;
  }
}

function fakeSpawn() {
  const calls: { cmd: string; args: readonly string[]; opts: Record<string, unknown> }[] = [];
  const child = new FakeChild();
  const fn = ((cmd: string, args: readonly string[], opts: Record<string, unknown>) => {
    calls.push({ cmd, args, opts });
    return child;
  }) as unknown as typeof spawn;
  return { fn, calls, child };
}

test('startOpencodeServe: random port on loopback, no shell, password via env, resolves on the listening line', async () => {
  const sp = fakeSpawn();
  const p = startOpencodeServe({ executable: '/bin/opencode', cwd: ROOT, password: 'pw', env: { PATH: '/bin' }, platform: 'win32', spawnFn: sp.fn, setTimeoutFn: () => 1, clearTimeoutFn: () => undefined });
  sp.child.stdout.write(REAL_LISTENING_LINE.slice(0, 20));
  sp.child.stdout.write(REAL_LISTENING_LINE.slice(20));
  const srv = await p;
  assert.equal(srv.baseUrl, 'http://127.0.0.1:35865');
  const call = sp.calls[0];
  assert.ok(call);
  assert.deepEqual(call.args, ['serve', '--port', '0', '--hostname', '127.0.0.1']);
  assert.equal(call.opts.shell, false);
  assert.equal(call.opts.cwd, ROOT);
  assert.equal((call.opts.env as Record<string, string>).OPENCODE_SERVER_PASSWORD, 'pw');
  srv.close();
  assert.deepEqual(sp.calls[1]?.args, ['/pid', '4242', '/T', '/F']);
});

test('startOpencodeServe rejects on early exit and on timeout (timer injected)', async () => {
  const a = fakeSpawn();
  const p1 = startOpencodeServe({ executable: 'oc', cwd: ROOT, password: 'x', spawnFn: a.fn, setTimeoutFn: () => 1, clearTimeoutFn: () => undefined });
  a.child.stderr.write('boom');
  await new Promise<void>((r) => setImmediate(r));
  a.child.exitCode = 1;
  a.child.emit('exit', 1);
  await assert.rejects(p1, /提前退出（退出码 1）：boom/);

  const b = fakeSpawn();
  let fire: () => void = () => undefined;
  const p2 = startOpencodeServe({ executable: 'oc', cwd: ROOT, password: 'x', platform: 'win32', spawnFn: b.fn, setTimeoutFn: (fn) => { fire = fn; return 1; }, clearTimeoutFn: () => undefined });
  fire();
  await assert.rejects(p2, /启动超时/);
  assert.equal(b.calls[1]?.cmd, 'taskkill');
});
