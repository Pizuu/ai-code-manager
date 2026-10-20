/**
 * T127（任务卡 T-034）：opencode serve 模式（实验开关）接入 handlers 的集成测试。
 * 假 opencode 可执行文件（helpers/fake-opencode-serve.ts）在 127.0.0.1 随机端口起 HTTP/SSE 服务器，行为确定、无外网。
 * 覆盖：两种模式的选择、permission.asked 各种类映射（契约 v1.3）、只回 once/reject、停止即拒绝（先 reject 再 abort）、
 * serve 启动失败回退 run 模式、设置不经 IPC 泄露。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AgentEvent, AgentRef, ApprovalRequest, PermissionMode, Session } from '../../../../contracts/ipc.ts';
import { OPENCODE_EXAMPLE } from '../../../../src/backend/agent-cli/presets.ts';
import { OpencodeServeManager, parseServeModel, resolveOpencodeMode, serveSessionKey } from '../../../../src/backend/agent-cli/serve-runner.ts';
import { AppState } from '../../../../src/backend/app-state.ts';
import { createHandlers } from '../../../../src/backend/ipc/handlers.ts';
import { SessionStore } from '../../../../src/backend/sessions/session-store.ts';
import { SettingsStore, type KeyCipher } from '../../../../src/backend/settings/settings-store.ts';
import { FAKE_RUN_SCRIPT } from '../helpers/fake-opencode.ts';
import { readLog, writeFakeOpencodeWithServe, type FakeLogEntry } from '../helpers/fake-opencode-serve.ts';
import { tempProject } from '../helpers/temp-project.ts';

const posixOnly = process.platform === 'win32' ? 'shebang 假可执行文件仅在 POSIX 上运行' : false;

const cipher: KeyCipher = {
  isAvailable: () => true,
  encrypt: (p) => Buffer.from([...p].reverse().join('')).toString('base64'),
  decrypt: (e) => [...Buffer.from(e, 'base64').toString()].reverse().join(''),
};

interface SetupOpts {
  mode?: PermissionMode;
  /** AICM_OPENCODE_MODE；undefined = 不设置。 */
  envMode?: string;
  extraEnv?: Record<string, string>;
}

async function setup(t: { after: (fn: () => void | Promise<void>) => void }, opts: SetupOpts = {}) {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'acm-userdata-'));
  t.after(() => fs.rm(userData, { recursive: true, force: true }));
  const bin = await fs.mkdtemp(path.join(os.tmpdir(), 'acm-bin-'));
  t.after(() => fs.rm(bin, { recursive: true, force: true }));
  await writeFakeOpencodeWithServe(bin, FAKE_RUN_SCRIPT);
  const log = path.join(bin, 'calls.log');
  const root = await tempProject(t, { 'README.md': '# demo\n' });
  const settings = new SettingsStore(path.join(userData, 'settings.json'), cipher);
  await settings.update({ permissionMode: opts.mode ?? 'ask' });
  const sessions = new SessionStore(path.join(userData, 'sessions'));
  const state = new AppState();
  const events: AgentEvent[] = [];
  const serveManager = new OpencodeServeManager({ platform: process.platform, timeoutMs: 10_000 });
  t.after(() => serveManager.closeAll());
  // 自动审批：approvalPolicy 返回 true/false/undefined（undefined = 保持等待）
  let approvalPolicy: (a: ApprovalRequest) => boolean | undefined = () => true;
  const emit = (e: AgentEvent) => {
    events.push(e);
    if (e.type === 'approval-request') {
      const d = approvalPolicy(e.approval);
      if (d !== undefined) setImmediate(() => void handlers['agent:approve']({ approvalId: e.approval.id, approved: d }));
    }
  };
  const handlers = createHandlers({
    settings, sessions, state, platform: process.platform, emit, pickDirectory: async () => root, serveManager,
    resolveDeps: { platform: process.platform, pathEnv: bin, pathExt: '', isFile: async (p) => fs.stat(p).then((s) => s.isFile(), () => false), readText: async () => null },
    cliBaseEnv: { PATH: process.env.PATH ?? '', FAKE_OC_LOG: log, ...(opts.extraEnv ?? {}) },
    modeEnv: opts.envMode === undefined ? {} : { AICM_OPENCODE_MODE: opts.envMode },
  });
  await handlers['project:pick']();
  const pub = await handlers['agentCli:save']({
    ...OPENCODE_EXAMPLE, args: [...OPENCODE_EXAMPLE.args], resumeArgs: [...OPENCODE_EXAMPLE.resumeArgs], modelArgs: [...OPENCODE_EXAMPLE.modelArgs],
    model: 'fake/model-x', env: [{ name: 'FAKE_SECRET', secret: true, value: 'sk-SUPER-SECRET' }],
  });
  const cli = pub.agentClis?.[0];
  assert.ok(cli);
  const agent: AgentRef = `cli:${cli.id}`;
  const until = async (pred: () => boolean, what: string, timeoutMs = 10_000) => {
    const started = Date.now();
    while (!pred()) {
      if (Date.now() - started > timeoutMs) throw new Error(`timeout: ${what}`);
      await new Promise((r) => setTimeout(r, 5));
    }
  };
  const idleCount = (sid: string) => events.filter((e) => e.type === 'status' && e.sessionId === sid && !e.running).length;
  const newSession = async (): Promise<Session> => {
    const s = await handlers['sessions:create']();
    await handlers['sessions:setAgent'](s.id, agent);
    return s;
  };
  const send = async (s: Session, text: string, n = 1) => {
    await handlers['agent:send']({ sessionId: s.id, text });
    await until(() => idleCount(s.id) >= n, `idle #${n}`);
    return handlers['sessions:get'](s.id);
  };
  const approvals = () => events.filter((e): e is Extract<AgentEvent, { type: 'approval-request' }> => e.type === 'approval-request').map((e) => e.approval);
  const serveCalls = async (method: string, re: RegExp): Promise<FakeLogEntry[]> => (await readLog(log)).filter((l) => l.serve && l.method === method && re.test(l.path ?? ''));
  return {
    handlers, events, root, log, cli, agent, settings, sessions, state, serveManager, until, newSession, send, approvals, serveCalls, idleCount, userData,
    setPolicy: (p: (a: ApprovalRequest) => boolean | undefined) => {
      approvalPolicy = p;
    },
  };
}

// ───────────────────────── 纯函数 ─────────────────────────

test('resolveOpencodeMode: env wins (run|serve), then internal setting, default run; parseServeModel', () => {
  assert.equal(resolveOpencodeMode({}, undefined), 'run');
  assert.equal(resolveOpencodeMode({}, 'serve'), 'serve');
  assert.equal(resolveOpencodeMode({}, 'bogus'), 'run');
  assert.equal(resolveOpencodeMode({ AICM_OPENCODE_MODE: 'SERVE' }, undefined), 'serve');
  assert.equal(resolveOpencodeMode({ AICM_OPENCODE_MODE: 'run' }, 'serve'), 'run');
  assert.equal(resolveOpencodeMode({ AICM_OPENCODE_MODE: 'weird' }, 'serve'), 'serve');
  assert.deepEqual(parseServeModel('openai/gpt-x'), { providerID: 'openai', modelID: 'gpt-x' });
  assert.deepEqual(parseServeModel('a/b/c'), { providerID: 'a', modelID: 'b/c' });
  assert.equal(parseServeModel(''), undefined);
  assert.equal(parseServeModel('noslash'), undefined);
  assert.equal(serveSessionKey('oc-1', 'auto-edits'), 'oc-1@serve-auto-edits');
});

// ───────────────────────── 模式选择 ─────────────────────────

test('default (no env, no setting) stays on run mode: no serve process, per-turn command-line approval', { skip: posixOnly }, async (t) => {
  const { newSession, send, log, approvals, serveManager } = await setup(t);
  const s = await newSession();
  const after = await send(s, '写个文件');
  const lines = await readLog(log);
  assert.equal(lines.some((l) => l.serve), false);
  assert.ok(lines.some((l) => l.argv?.[0] === 'run'));
  assert.equal(serveManager.size, 0);
  assert.deepEqual(approvals().map((a) => a.kind), ['command']);
  assert.match(approvals()[0]?.command ?? '', /OPENCODE_PERMISSION/);
  assert.equal(after.messages.at(-1)?.toolCalls?.find((c) => c.name === 'agent_cli')?.status, 'done');
});

test('serve mode via AICM_OPENCODE_MODE=serve: password-protected loopback server, explicit ruleset, per-call approvals, reused server and session', { skip: posixOnly }, async (t) => {
  const { newSession, send, log, approvals, serveCalls, root, cli, serveManager, events } = await setup(t, { envMode: 'serve', mode: 'ask' });
  const s = await newSession();
  const after = await send(s, '先 perm:bash 再 perm:edit');

  const lines = await readLog(log);
  const start = lines.filter((l) => l.start);
  assert.equal(start.length, 1);
  assert.deepEqual(start[0]?.argv, ['serve', '--port', '0', '--hostname', '127.0.0.1']);
  assert.equal(start[0]?.hasPassword, true);
  assert.equal(start[0]?.permEnv, null, 'serve 模式不使用 OPENCODE_PERMISSION');
  assert.equal(start[0]?.secretSet, true, 'CLI 配置的环境变量传给 serve 进程');
  assert.equal(lines.some((l) => l.argv?.[0] === 'run'), false, '没有走 run 模式');
  assert.ok(lines.filter((l) => l.serve && l.method).every((l) => l.auth), '所有请求都带 Basic 认证');
  assert.ok(lines.filter((l) => l.serve && l.method && l.path !== '/global/health').every((l) => l.directory === root), '实例路由带 ?directory=项目根');

  const created = await serveCalls('POST', /^\/session$/);
  assert.equal(created.length, 1);
  const rules = (created[0]?.body as { permission: Array<{ permission: string; action: string }> }).permission;
  assert.deepEqual(rules.find((r) => r.permission === 'external_directory')?.action, 'deny');
  assert.deepEqual(rules.find((r) => r.permission === 'bash')?.action, 'ask');
  assert.deepEqual(rules.find((r) => r.permission === 'edit')?.action, 'ask');
  const prompt = await serveCalls('POST', /prompt_async$/);
  assert.deepEqual((prompt[0]?.body as { model?: unknown }).model, { providerID: 'fake', modelID: 'model-x' });

  // 没有「每轮批准命令行」，只有逐条审批
  assert.deepEqual(approvals().map((a) => a.kind), ['command', 'edit']);
  assert.equal(approvals()[0]?.command, 'echo hi');
  assert.equal(approvals()[1]?.path, 'a.txt');
  const replies = await serveCalls('POST', /\/reply$/);
  assert.deepEqual(replies.map((r) => (r.body as { reply: string }).reply), ['once', 'once']);

  const msg = after.messages.at(-1);
  assert.equal(msg?.role, 'assistant');
  assert.equal(msg?.content, '完成', 'delta 与整段 text 去重');
  assert.equal(msg?.toolCalls?.find((c) => c.name === 'agent_cli')?.status, 'done');
  assert.equal(msg?.toolCalls?.find((c) => c.id === 'call_1')?.status, 'done');
  assert.equal(msg?.toolCalls?.find((c) => c.id === 'call_2')?.status, 'done');
  assert.equal(after.cliSessions?.[serveSessionKey(cli.id, 'ask')], 'ses_fake0001');
  assert.equal(after.cliSessions?.[cli.id], undefined, '不覆盖 run 模式的续接键');
  assert.equal(events.some((e) => e.type === 'error'), false);

  // 第二轮：复用服务器与 opencode 会话
  await send(s, '再来 perm:bash', 2);
  assert.equal((await readLog(log)).filter((l) => l.start).length, 1);
  assert.equal((await serveCalls('POST', /^\/session$/)).length, 1);
  assert.equal((await serveCalls('POST', /prompt_async$/)).length, 2);
  assert.equal(serveManager.size, 1);
});

test('serve mode via backend-only setting (not exposed over IPC); env run overrides it', { skip: posixOnly }, async (t) => {
  const ctx = await setup(t, { mode: 'auto-edits' });
  await ctx.settings.setOpencodeMode('serve');
  const pub = await ctx.handlers['settings:get']();
  assert.equal('opencodeMode' in pub, false, 'PublicSettings 不含内部开关（需要 contracts v1.4）');
  assert.equal((await fs.readFile(path.join(ctx.userData, 'settings.json'), 'utf8')).includes('"opencodeMode": "serve"'), true);
  const s = await ctx.newSession();
  await ctx.send(s, 'perm:bash');
  assert.equal((await readLog(ctx.log)).filter((l) => l.start).length, 1);
  const rules = ((await ctx.serveCalls('POST', /^\/session$/))[0]?.body as { permission: Array<{ permission: string; action: string }> }).permission;
  assert.equal(rules.filter((r) => r.permission === 'edit').at(-1)?.action, 'allow', '自动批准编辑：edit allow');
  assert.equal(rules.filter((r) => r.permission === 'bash').at(-1)?.action, 'ask', '命令永远逐条审批');

  const ctx2 = await setup(t, { envMode: 'run' });
  await ctx2.settings.setOpencodeMode('serve');
  const s2 = await ctx2.newSession();
  await ctx2.send(s2, 'hi');
  assert.equal((await readLog(ctx2.log)).some((l) => l.serve), false);
});

// ───────────────────────── 权限种类映射 ─────────────────────────

test('every permission.asked kind maps to the v1.3 ApprovalKind with permission + patterns; replies are once/reject, never always', { skip: posixOnly }, async (t) => {
  const { newSession, send, approvals, serveCalls, setPolicy } = await setup(t, { envMode: 'serve' });
  // 拒绝 external-dir 与 other，其余批准
  setPolicy((a) => a.kind !== 'external-dir' && a.kind !== 'other');
  const s = await newSession();
  const after = await send(s, 'perm:bash perm:edit perm:webfetch perm:doom_loop perm:task perm:external_directory perm:skill');
  const got = approvals();
  assert.deepEqual(got.map((a) => a.kind), ['command', 'edit', 'webfetch', 'loop', 'subagent', 'external-dir', 'other']);
  assert.deepEqual(got.map((a) => a.permission), ['bash', 'edit', 'webfetch', 'doom_loop', 'task', 'external_directory', 'skill']);
  for (const a of got) {
    assert.ok(Array.isArray(a.patterns) && a.patterns.length > 0, `${a.kind} 带 patterns`);
    assert.equal(a.sessionId, s.id);
    assert.match(a.toolCallId, /^call_\d$/);
  }
  const [bash, edit, web, loop, sub, ext, other] = got;
  assert.equal(bash?.command, 'echo hi');
  assert.equal(edit?.path, 'a.txt');
  assert.match(edit?.diff ?? '', /\+hello/);
  assert.equal(web?.url, 'https://opencode.ai/docs/cli/');
  assert.equal(loop?.tool, 'read');
  assert.match(loop?.description ?? '', /read/);
  assert.equal(sub?.description, '调研 README 中的脚本');
  assert.deepEqual(sub?.patterns, ['general']);
  assert.equal(ext?.path, '/etc');
  assert.deepEqual(ext?.patterns, ['/etc/*']);
  assert.deepEqual(other?.patterns, ['pdf-tools']);
  assert.equal(other?.description, 'opencode 权限：skill');

  const replies = (await serveCalls('POST', /\/reply$/)).map((r) => (r.body as { reply: string }).reply);
  assert.deepEqual(replies, ['once', 'once', 'once', 'once', 'once', 'reject', 'reject']);
  assert.equal(replies.includes('always'), false);
  const calls = after.messages.at(-1)?.toolCalls ?? [];
  assert.equal(calls.find((c) => c.id === 'call_6')?.status, 'rejected');
  assert.equal(calls.find((c) => c.id === 'call_7')?.status, 'rejected');
  assert.equal(calls.find((c) => c.id === 'call_3')?.status, 'done');
  assert.match(String(calls.find((c) => c.name === 'agent_cli')?.output), /7 次审批（拒绝 2）/);
});

test('plan mode in serve: edit and bash denied by ruleset, plan agent used', { skip: posixOnly }, async (t) => {
  const { newSession, send, serveCalls } = await setup(t, { envMode: 'serve', mode: 'plan' });
  const s = await newSession();
  await send(s, '规划一下');
  const body = (await serveCalls('POST', /^\/session$/))[0]?.body as { agent?: string; permission: Array<{ permission: string; action: string }> };
  assert.equal(body.agent, 'plan');
  assert.equal(body.permission.filter((r) => r.permission === 'edit').at(-1)?.action, 'deny');
  assert.equal(body.permission.filter((r) => r.permission === 'bash').at(-1)?.action, 'deny');
  assert.equal(body.permission.filter((r) => r.permission === 'external_directory').at(-1)?.action, 'deny');
  assert.equal(((await serveCalls('POST', /prompt_async$/))[0]?.body as { agent?: string }).agent, 'plan');
});

// ───────────────────────── 停止即拒绝 ─────────────────────────

test('stop while an approval is pending counts as reject: approval-resolved false, reject replied before abort', { skip: posixOnly }, async (t) => {
  const { handlers, newSession, until, approvals, serveCalls, events, setPolicy, idleCount, log, sessions } = await setup(t, { envMode: 'serve' });
  setPolicy(() => undefined); // 不回答，保持等待
  const s = await newSession();
  await handlers['agent:send']({ sessionId: s.id, text: 'perm:bash perm:edit' });
  await until(() => approvals().length === 1, 'first approval');
  await handlers['agent:stop'](s.id);
  await until(() => idleCount(s.id) >= 1, 'idle after stop');

  const ap = approvals()[0];
  assert.ok(ap);
  assert.ok(events.some((e) => e.type === 'approval-resolved' && e.approvalId === ap.id && !e.approved));
  const lines = (await readLog(log)).filter((l) => l.serve && l.method === 'POST');
  const replyIdx = lines.findIndex((l) => /\/reply$/.test(l.path ?? ''));
  const abortIdx = lines.findIndex((l) => /\/abort$/.test(l.path ?? ''));
  assert.ok(replyIdx >= 0 && abortIdx > replyIdx, '先 reject 再 abort');
  // 1.19.x 的 reject 不结束本轮，假模型会继续请求下一条权限；停止流程把它们也全部 reject，绝不 once / always
  const replies = await serveCalls('POST', /\/reply$/);
  assert.ok(replies.length >= 1);
  assert.ok(replies.every((r) => (r.body as { reply: string }).reply === 'reject'));
  assert.ok(replies.every((r) => (r.body as { message?: string }).message === '用户已停止 agent。'));
  const pendingAfter = await serveCalls('GET', /^\/permission$/);
  assert.ok(pendingAfter.length >= 1, '停止时对账了待批清单');
  assert.equal(approvals().length, 1, '停止后不再发起新的审批');
  assert.equal(events.some((e) => e.type === 'error' && e.sessionId === s.id), false, '停止导致的 MessageAbortedError 不报错');
  const saved = await sessions.get(s.id);
  const calls = saved.messages.at(-1)?.toolCalls ?? [];
  assert.equal(calls.find((c) => c.name === 'agent_cli')?.status, 'rejected');
  assert.equal(calls.find((c) => c.id === 'call_1')?.status, 'rejected');
});

// ───────────────────────── 启动失败回退 ─────────────────────────

test('serve fails to start → clear error event, then falls back to run mode for the same turn', { skip: posixOnly }, async (t) => {
  const { newSession, send, log, events, approvals, serveManager } = await setup(t, { envMode: 'serve', mode: 'auto-edits', extraEnv: { FAKE_SERVE_FAIL: '1' } });
  const s = await newSession();
  const after = await send(s, '写个文件');
  const err = events.find((e) => e.type === 'error');
  assert.ok(err && err.type === 'error');
  assert.match(err.message, /serve 模式（实验）启动失败，已回退到 run 模式/);
  assert.match(err.message, /提前退出|port in use/);
  assert.equal(err.message.includes('sk-SUPER-SECRET'), false);
  const lines = await readLog(log);
  assert.ok(lines.some((l) => l.argv?.[0] === 'run'), 'run 模式已执行');
  assert.equal(approvals().length, 0, 'auto-edits 的 run 模式无需每轮批准');
  // 用户消息只记录一次
  assert.equal(after.messages.filter((m) => m.role === 'user').length, 1);
  assert.equal(after.messages.at(-1)?.toolCalls?.find((c) => c.name === 'agent_cli')?.status, 'done');
  assert.equal(serveManager.size, 0, '失败的服务器不缓存');
});

test('unsupported serve version also falls back to run mode and releases the server', { skip: posixOnly }, async (t) => {
  const { newSession, send, log, events, serveManager } = await setup(t, { envMode: 'serve', mode: 'auto-edits', extraEnv: { FAKE_SERVE_VERSION: '2.0.0' } });
  const s = await newSession();
  await send(s, 'hi');
  assert.ok(events.some((e) => e.type === 'error' && /版本 2\.0\.0 不在已验证的 1\.19\.x 范围内/.test(e.message)));
  assert.ok((await readLog(log)).some((l) => l.argv?.[0] === 'run'));
  assert.equal(serveManager.size, 0);
});
