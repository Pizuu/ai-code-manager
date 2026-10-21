/**
 * opencode ACP 接入（acp-client / acp-runner）：假 ACP agent 子进程（fake-acp-agent.ts，NDJSON JSON-RPC），无网络、行为确定。
 * 覆盖：initialize + session/new + prompt 全链路、权限三态选 optionId、模式自动裁决、session/load 恢复与失败转新会话、
 * session/cancel、权限待答时停止、进程中途退出、fs/* 回 -32601、版本/协议/未登录的启动失败。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AgentEvent, ApprovalRequest, Session } from '../../../../contracts/ipc.ts';
import { AcpPeer, AcpProcessExitError, startAcpProcess } from '../../../../src/backend/agent-cli/acp-client.ts';
import {
  AcpProcessManager, AcpStartupError, acpAutoDecision, acpSessionKey, parseAcpPermissionRequest, parseAcpUsageUsed,
  prepareAcpTurn, runAcpCliTurn, runAcpTurn, selectPermissionOption, toAcpApprovalRequest,
  type AcpPermissionOption, type AcpTurnRunDeps,
} from '../../../../src/backend/agent-cli/acp-runner.ts';
import type { CliRuntimeConfig } from '../../../../src/backend/agent-cli/cli-runner.ts';
import type { OpencodeEvent } from '../../../../src/backend/agent-cli/opencode-events.ts';
import { writeFakeAcpAgent } from './fake-acp-agent.ts';

const posixOnly = process.platform === 'win32' ? 'shebang 假可执行文件仅在 POSIX 上运行' : false;
const ROOT = '/tmp/acp-proj';
const NOW = '2026-10-20T00:00:00.000Z';

// 项目根须真实存在（版本探测与子进程 spawn 都以它为 cwd）
await fs.mkdir(ROOT, { recursive: true });

let idSeq = 0;
const nextId = () => `id-${++idSeq}`;

async function fakeExe(t: { after: (fn: () => void | Promise<void>) => void }): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'acp-bin-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return writeFakeAcpAgent(dir);
}

function config(env: Record<string, string>, model = ''): CliRuntimeConfig {
  return { id: 'oc-acp', name: 'opencode', preset: 'opencode', args: [], resumeArgs: [], modelArgs: [], model, outputFormat: 'opencode-json', env };
}

async function acquire(t: { after: (fn: () => void | Promise<void>) => void }, env: Record<string, string>, opts: { storedSessionId?: string; model?: string; appSessionId?: string } = {}) {
  const exe = await fakeExe(t);
  const manager = new AcpProcessManager({ platform: process.platform });
  t.after(() => manager.closeAll());
  const handle = await manager.acquire({
    appSessionId: opts.appSessionId ?? 'sess-1',
    config: config(env, opts.model ?? ''),
    executable: exe,
    projectRoot: ROOT,
    baseEnv: { PATH: process.env.PATH ?? '' },
    ...(opts.storedSessionId ? { storedSessionId: opts.storedSessionId } : {}),
  });
  return { manager, handle, exe };
}

async function until(pred: () => boolean, what: string, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timeout: ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

type ToolEv = Extract<OpencodeEvent, { kind: 'tool' }>;

// ───────────────────────── 全链路 ─────────────────────────

test('ACP 全链路（引擎层）：文本增量、工具生命周期合并、end_turn 收尾', { skip: posixOnly }, async (t) => {
  const { handle } = await acquire(t, { FAKE_ACP_SCENARIO: 'basic' });
  const texts: string[] = [];
  const tools: ToolEv[] = [];
  const res = await runAcpTurn({
    handle, appSessionId: 'sess-1', projectRoot: ROOT, prompt: 'hello', mode: 'ask',
    signal: new AbortController().signal, newId: nextId,
    requestApproval: async () => 'once',
    onTextDelta: (_p, d) => texts.push(d),
    onEvent: (ev) => {
      if (ev.kind === 'tool') tools.push(ev);
    },
  });
  assert.equal(res.status, 'done');
  assert.deepEqual(texts, ['Hello ', 'world', 'done']);
  assert.deepEqual(tools.map((x) => x.status), ['pending', 'running', 'completed']);
  const last = tools.at(-1);
  assert.equal(last?.tool, 'bash');
  assert.equal(last?.callId, 'call_bash');
  assert.equal(last?.output, 'hi\n');
  assert.deepEqual(last?.input, { command: 'echo hi' });
  assert.deepEqual(res.approvals, []);
});

test('ACP usage_update：used 经 onUsage 上报（累计口径，逐条原样转发，最后一值为准）', { skip: posixOnly }, async (t) => {
  const { handle } = await acquire(t, { FAKE_ACP_SCENARIO: 'basic' });
  const usages: number[] = [];
  const res = await runAcpTurn({
    handle, appSessionId: 'sess-1', projectRoot: ROOT, prompt: 'hello', mode: 'ask',
    signal: new AbortController().signal, newId: nextId,
    requestApproval: async () => 'once',
    onTextDelta: () => undefined,
    onEvent: () => undefined,
    onUsage: (used) => usages.push(used),
  });
  assert.equal(res.status, 'done');
  // fake basic 场景先后发 used:10 与 used:4242：引擎不累加、不去重，原样上报，覆盖语义在适配层
  assert.deepEqual(usages, [10, 4242]);
  assert.equal(parseAcpUsageUsed({ used: 4242 }), 4242);
  assert.equal(parseAcpUsageUsed({ used: '4242' }), null);
  assert.equal(parseAcpUsageUsed({}), null);
  assert.equal(parseAcpUsageUsed({ used: Number.NaN }), null);
});

test('ACP 全链路（适配层）：消息落盘、工具记录、cliSessions 写回、invoke 完成', { skip: posixOnly }, async (t) => {
  const exe = await fakeExe(t);
  const manager = new AcpProcessManager({ platform: process.platform });
  t.after(() => manager.closeAll());
  const env = { FAKE_ACP_SCENARIO: 'basic' };
  const events: AgentEvent[] = [];
  const deps: AcpTurnRunDeps = {
    config: config(env), executable: exe, projectRoot: ROOT, mode: 'ask',
    signal: new AbortController().signal, manager,
    emit: (e) => events.push(e),
    requestApproval: async () => true,
    persist: async () => undefined,
    newId: nextId, now: () => NOW,
    baseEnv: { PATH: process.env.PATH ?? '' },
  };
  const session: Session = {
    schemaVersion: 1, id: 'sess-1', title: '新会话', projectPath: null,
    createdAt: NOW, updatedAt: NOW, messages: [], todos: [],
  };
  const prepared = await prepareAcpTurn(session, deps);
  assert.equal(prepared.acpSessionId, 'ses_fake_1');
  assert.equal(prepared.version, '1.19.3');
  await runAcpCliTurn(session, 'hello', prepared, deps);
  const assistant = session.messages.at(-1);
  assert.equal(assistant?.role, 'assistant');
  assert.equal(assistant?.content, 'Hello world\n\ndone');
  const bash = assistant?.toolCalls?.find((c) => c.id === 'call_bash');
  assert.equal(bash?.name, 'bash');
  assert.equal(bash?.status, 'done');
  assert.equal(bash?.output, 'hi\n');
  const invoke = assistant?.toolCalls?.find((c) => c.name === 'agent_cli');
  assert.equal(invoke?.status, 'done');
  assert.match(invoke?.output ?? '', /会话 ses_fake_1/);
  assert.equal(session.cliSessions?.[acpSessionKey('oc-acp')], 'ses_fake_1');
  assert.ok(events.some((e) => e.type === 'text-delta'));
});

// ───────────────────────── 权限 ─────────────────────────

async function permScenario(t: { after: (fn: () => void | Promise<void>) => void }, opts: {
  env?: Record<string, string>;
  mode?: 'ask' | 'auto-edits' | 'plan';
  answer?: 'once' | 'always' | 'reject';
  approvalImpl?: (req: ApprovalRequest) => Promise<'once' | 'always' | 'reject'>;
}) {
  const { handle } = await acquire(t, { FAKE_ACP_SCENARIO: 'permission', ...(opts.env ?? {}) });
  const texts: string[] = [];
  const seen: ApprovalRequest[] = [];
  const res = await runAcpTurn({
    handle, appSessionId: 'sess-1', projectRoot: ROOT, prompt: 'go', mode: opts.mode ?? 'ask',
    signal: new AbortController().signal, newId: nextId,
    requestApproval: async (req) => {
      seen.push(req);
      if (opts.approvalImpl) return opts.approvalImpl(req);
      return opts.answer ?? 'once';
    },
    onTextDelta: (_p, d) => texts.push(d),
    onEvent: () => undefined,
  });
  return { res, texts, seen };
}

test('权限：审批答「一次」→ allow_once，ApprovalRequest 为 command 形状', { skip: posixOnly }, async (t) => {
  const { res, texts, seen } = await permScenario(t, { answer: 'once' });
  assert.equal(res.status, 'done');
  assert.ok(texts.join('').includes('"optionId":"opt-allow-once"'));
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.kind, 'command');
  assert.equal(seen[0]?.command, 'ls -la');
  assert.equal(seen[0]?.toolCallId, 'call_perm');
  assert.equal(seen[0]?.permission, 'execute');
  assert.deepEqual(res.approvals, [{ toolCallId: 'call_perm', permission: 'execute', approved: true, auto: false }]);
});

test('权限：审批答「总是」→ allow_always；选项缺失时按规则回退', { skip: posixOnly }, async (t) => {
  const a = await permScenario(t, { answer: 'always' });
  assert.ok(a.texts.join('').includes('"optionId":"opt-allow-always"'));
  // 无 allow_always 时「总是」回退 allow_once
  const b = await permScenario(t, { answer: 'always', env: { FAKE_ACP_PERM_OPTIONS: 'no-always' } });
  assert.ok(b.texts.join('').includes('"optionId":"opt-allow-once"'));
  // 无 allow_once 时「一次」回退 allow_always
  const c = await permScenario(t, { answer: 'once', env: { FAKE_ACP_PERM_OPTIONS: 'no-once' } });
  assert.ok(c.texts.join('').includes('"optionId":"opt-allow-always"'));
});

test('权限：审批答「拒绝」→ reject_once', { skip: posixOnly }, async (t) => {
  const { res, texts } = await permScenario(t, { answer: 'reject' });
  assert.equal(res.status, 'done');
  assert.ok(texts.join('').includes('"optionId":"opt-reject-once"'));
  assert.deepEqual(res.approvals, [{ toolCallId: 'call_perm', permission: 'execute', approved: false, auto: false }]);
});

test('权限：plan 模式 execute 自动拒绝、auto-edits 模式 edit 自动允许（均不打扰用户）', { skip: posixOnly }, async (t) => {
  const plan = await permScenario(t, {
    mode: 'plan',
    approvalImpl: async () => {
      throw new Error('不应调用审批');
    },
  });
  assert.ok(plan.texts.join('').includes('"optionId":"opt-reject-once"'));
  assert.deepEqual(plan.res.approvals, [{ toolCallId: 'call_perm', permission: 'execute', approved: false, auto: true }]);

  const auto = await permScenario(t, {
    mode: 'auto-edits',
    env: { FAKE_ACP_PERM_KIND: 'edit' },
    approvalImpl: async () => {
      throw new Error('不应调用审批');
    },
  });
  assert.ok(auto.texts.join('').includes('"optionId":"opt-allow-once"'));
  assert.deepEqual(auto.res.approvals, [{ toolCallId: 'call_perm', permission: 'edit', approved: true, auto: true }]);
});

test('权限：审批通道抛错 → 回 cancelled，不默认批准', { skip: posixOnly }, async (t) => {
  const { res, texts } = await permScenario(t, {
    approvalImpl: async () => {
      throw new Error('ui gone');
    },
  });
  assert.ok(texts.join('').includes('"outcome":"cancelled"'));
  assert.deepEqual(res.approvals, [{ toolCallId: 'call_perm', permission: 'execute', approved: false, auto: false }]);
});

// ───────────────────────── session/load 恢复 ─────────────────────────

test('session/load：有存储 ID 且 agent 支持时恢复原会话', { skip: posixOnly }, async (t) => {
  const { handle } = await acquire(t, { FAKE_ACP_SCENARIO: 'basic' }, { storedSessionId: 'ses_old_123' });
  assert.equal(handle.acpSessionId, 'ses_old_123');
});

test('session/load：恢复失败弃旧开新；agent 不声明 loadSession 时直接开新', { skip: posixOnly }, async (t) => {
  const failed = await acquire(t, { FAKE_ACP_SCENARIO: 'basic', FAKE_ACP_LOAD_FAIL: '1' }, { storedSessionId: 'ses_old_123', appSessionId: 'sess-2' });
  assert.equal(failed.handle.acpSessionId, 'ses_fake_1');
  const noCap = await acquire(t, { FAKE_ACP_SCENARIO: 'basic', FAKE_ACP_LOAD: '0' }, { storedSessionId: 'ses_old_123', appSessionId: 'sess-3' });
  assert.equal(noCap.handle.acpSessionId, 'ses_fake_1');
});

// ───────────────────────── 停止 / 异常 ─────────────────────────

test('停止：prompt 进行中 abort → 发 session/cancel，stopReason=cancelled 收尾为 aborted', { skip: posixOnly }, async (t) => {
  const { handle } = await acquire(t, { FAKE_ACP_SCENARIO: 'cancel' });
  const controller = new AbortController();
  const texts: string[] = [];
  const run = runAcpTurn({
    handle, appSessionId: 'sess-1', projectRoot: ROOT, prompt: 'go', mode: 'ask',
    signal: controller.signal, newId: nextId,
    requestApproval: async () => 'once',
    onTextDelta: (_p, d) => texts.push(d),
    onEvent: () => undefined,
  });
  await until(() => texts.join('').includes('working'), 'agent 开始工作');
  controller.abort();
  const res = await run;
  assert.equal(res.status, 'aborted');
});

test('停止：权限待答时 abort → 待答先回 cancelled，本轮 aborted', { skip: posixOnly }, async (t) => {
  const { handle } = await acquire(t, { FAKE_ACP_SCENARIO: 'permission-hang' });
  const controller = new AbortController();
  const texts: string[] = [];
  let approvalCalled = false;
  const run = runAcpTurn({
    handle, appSessionId: 'sess-1', projectRoot: ROOT, prompt: 'go', mode: 'ask',
    signal: controller.signal, newId: nextId,
    requestApproval: async () => {
      approvalCalled = true;
      return new Promise<'once'>(() => undefined); // 永不返回，靠 abort 解围
    },
    onTextDelta: (_p, d) => texts.push(d),
    onEvent: () => undefined,
  });
  await until(() => approvalCalled, '审批已弹出');
  controller.abort();
  const res = await run;
  assert.equal(res.status, 'aborted');
  assert.ok(texts.join('').includes('"outcome":"cancelled"'));
  assert.deepEqual(res.approvals, [{ toolCallId: 'call_perm', permission: 'execute', approved: false, auto: false }]);
});

test('进程中途退出：本轮以错误收尾，文案带 stderr 尾巴', { skip: posixOnly }, async (t) => {
  const { handle } = await acquire(t, { FAKE_ACP_SCENARIO: 'die' });
  const res = await runAcpTurn({
    handle, appSessionId: 'sess-1', projectRoot: ROOT, prompt: 'go', mode: 'ask',
    signal: new AbortController().signal, newId: nextId,
    requestApproval: async () => 'once',
    onTextDelta: () => undefined,
    onEvent: () => undefined,
  });
  assert.equal(res.status, 'error');
  assert.match(res.error ?? '', /进程已退出（退出码 3）/);
  assert.match(res.error ?? '', /fake acp boom/);
});

test('peer：进程被杀时在途请求以 AcpProcessExitError 拒绝', { skip: posixOnly }, async (t) => {
  const exe = await fakeExe(t);
  const { peer, child } = startAcpProcess(
    { executable: exe, cwd: ROOT, env: { ...process.env, FAKE_ACP_SCENARIO: 'hang' } },
    {},
  );
  t.after(() => peer.close());
  const init = await peer.request<{ protocolVersion: number }>('initialize', { protocolVersion: 1 });
  assert.equal(init.protocolVersion, 1);
  const pending = peer.request('session/prompt', { sessionId: 'ses_x', prompt: [{ type: 'text', text: 'hi' }] });
  const expectation = assert.rejects(pending, (e: unknown) => e instanceof AcpProcessExitError);
  child.kill('SIGKILL');
  await expectation;
  assert.ok(peer.exited);
});

test('fs/* 客户端方法：回 -32601（不声明 fs 能力）', { skip: posixOnly }, async (t) => {
  const { handle } = await acquire(t, { FAKE_ACP_SCENARIO: 'fsask' });
  const texts: string[] = [];
  const res = await runAcpTurn({
    handle, appSessionId: 'sess-1', projectRoot: ROOT, prompt: 'go', mode: 'ask',
    signal: new AbortController().signal, newId: nextId,
    requestApproval: async () => 'once',
    onTextDelta: (_p, d) => texts.push(d),
    onEvent: () => undefined,
  });
  assert.equal(res.status, 'done');
  assert.ok(texts.join('').includes('FSRESULT:ERR:-32601'));
});

test('同一会话同时只允许一个在途 prompt：busy 时新轮次直接错误', { skip: posixOnly }, async (t) => {
  const { handle } = await acquire(t, { FAKE_ACP_SCENARIO: 'basic' });
  handle.busy = true;
  const res = await runAcpTurn({
    handle, appSessionId: 'sess-1', projectRoot: ROOT, prompt: 'go', mode: 'ask',
    signal: new AbortController().signal, newId: nextId,
    requestApproval: async () => 'once',
    onTextDelta: () => undefined,
    onEvent: () => undefined,
  });
  assert.equal(res.status, 'error');
  assert.match(res.error ?? '', /正忙/);
  handle.busy = false;
});

// ───────────────────────── 启动失败 ─────────────────────────

test('启动失败：版本不达门禁 / 协议版本不符 / 未登录（-32000）均抛 AcpStartupError', { skip: posixOnly }, async (t) => {
  const exe = await fakeExe(t);
  const tryAcquire = (env: Record<string, string>) => {
    const manager = new AcpProcessManager({ platform: process.platform });
    t.after(() => manager.closeAll());
    return manager.acquire({
      appSessionId: `sess-${Math.random()}`, config: config(env), executable: exe, projectRoot: ROOT,
      baseEnv: { PATH: process.env.PATH ?? '' },
    });
  };
  await assert.rejects(tryAcquire({ FAKE_ACP_VERSION: '1.18.30' }), (e: unknown) => e instanceof AcpStartupError && /门禁/.test(e.message));
  await assert.rejects(tryAcquire({ FAKE_ACP_PROTO: '2' }), (e: unknown) => e instanceof AcpStartupError && /协议版本/.test(e.message));
  await assert.rejects(tryAcquire({ FAKE_ACP_AUTH: '1' }), (e: unknown) => e instanceof AcpStartupError && /opencode auth login/.test(e.message));
});

test('启动：配置了 model 时尽力 set_model（假 agent 接受后正常建会话）', { skip: posixOnly }, async (t) => {
  const { handle } = await acquire(t, { FAKE_ACP_SCENARIO: 'basic' }, { model: 'fake/model-x' });
  assert.equal(handle.acpSessionId, 'ses_fake_1');
});

// ───────────────────────── 纯函数 ─────────────────────────

const OPTS: AcpPermissionOption[] = [
  { optionId: 'a1', name: 'Allow once', kind: 'allow_once' },
  { optionId: 'a2', name: 'Always allow', kind: 'allow_always' },
  { optionId: 'r1', name: 'Reject', kind: 'reject_once' },
  { optionId: 'r2', name: 'Always reject', kind: 'reject_always' },
];

test('selectPermissionOption：三态答案的优先级与回退', () => {
  assert.equal(selectPermissionOption(OPTS, 'once')?.optionId, 'a1');
  assert.equal(selectPermissionOption(OPTS, 'always')?.optionId, 'a2');
  assert.equal(selectPermissionOption(OPTS, 'reject')?.optionId, 'r1');
  assert.equal(selectPermissionOption(OPTS.filter((o) => o.kind !== 'allow_always'), 'always')?.optionId, 'a1');
  assert.equal(selectPermissionOption(OPTS.filter((o) => o.kind !== 'allow_once'), 'once')?.optionId, 'a2');
  assert.equal(selectPermissionOption(OPTS.filter((o) => o.kind !== 'reject_once'), 'reject')?.optionId, 'r2');
  assert.equal(selectPermissionOption(OPTS.filter((o) => o.kind.startsWith('allow')), 'reject'), null);
  assert.equal(selectPermissionOption([], 'once'), null);
});

test('acpAutoDecision：三模式 × 权限类别矩阵', () => {
  assert.equal(acpAutoDecision('ask', 'execute'), 'ask');
  assert.equal(acpAutoDecision('ask', 'edit'), 'ask');
  assert.equal(acpAutoDecision('ask', 'read'), 'ask');
  assert.equal(acpAutoDecision('auto-edits', 'edit'), 'allow');
  assert.equal(acpAutoDecision('auto-edits', 'delete'), 'allow');
  assert.equal(acpAutoDecision('auto-edits', 'execute'), 'ask');
  assert.equal(acpAutoDecision('auto-edits', 'read'), 'ask');
  assert.equal(acpAutoDecision('plan', 'edit'), 'reject');
  assert.equal(acpAutoDecision('plan', 'execute'), 'reject');
  assert.equal(acpAutoDecision('plan', 'move'), 'reject');
  assert.equal(acpAutoDecision('plan', 'read'), 'allow');
  assert.equal(acpAutoDecision('plan', 'search'), 'allow');
  assert.equal(acpAutoDecision('plan', 'fetch'), 'ask');
});

test('acpAutoDecision：allow-all（v1.6）一律自动允许，不打扰用户', () => {
  for (const kind of ['edit', 'delete', 'move', 'execute', 'read', 'search', 'fetch', 'other']) {
    assert.equal(acpAutoDecision('allow-all', kind), 'allow');
  }
});

test('toAcpApprovalRequest / parseAcpPermissionRequest：形状映射', () => {
  const perm = parseAcpPermissionRequest({
    sessionId: 'ses_1',
    toolCall: { toolCallId: 'call_1', title: 'Run ls', kind: 'execute', rawInput: { command: 'ls' } },
    options: OPTS,
  });
  assert.ok(perm);
  const req = toAcpApprovalRequest(perm, { approvalId: 'ap_1', appSessionId: 'app_1', projectRoot: ROOT });
  assert.equal(req.kind, 'command');
  assert.equal(req.command, 'ls');
  assert.equal(req.permission, 'execute');
  assert.equal(req.toolCallId, 'call_1');

  const edit = parseAcpPermissionRequest({
    sessionId: 'ses_1',
    toolCall: { toolCallId: 'call_2', title: 'Edit a.txt', kind: 'edit', rawInput: { filePath: '/tmp/acp-proj/a.txt', oldString: 'old', newString: 'new' } },
    options: OPTS,
  });
  assert.ok(edit);
  const editReq = toAcpApprovalRequest(edit, { approvalId: 'ap_2', appSessionId: 'app_1', projectRoot: ROOT });
  assert.equal(editReq.kind, 'edit');
  assert.equal(editReq.path, 'a.txt');
  assert.match(editReq.diff ?? '', /\+new/);

  assert.equal(parseAcpPermissionRequest({ sessionId: 'ses_1', toolCall: {} }), null);
  assert.equal(parseAcpPermissionRequest(null), null);
  // AcpPeer 导出仅为类型完整性（peer 级测试在上方）
  assert.equal(typeof AcpPeer, 'function');
});
