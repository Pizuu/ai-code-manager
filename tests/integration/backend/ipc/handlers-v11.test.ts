import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AgentEvent, AgentRef, PermissionMode } from '../../../../contracts/ipc.ts';
import { OPENCODE_EXAMPLE } from '../../../../src/backend/agent-cli/presets.ts';
import { AppState } from '../../../../src/backend/app-state.ts';
import { createHandlers } from '../../../../src/backend/ipc/handlers.ts';
import { SessionStore } from '../../../../src/backend/sessions/session-store.ts';
import { SettingsStore, type KeyCipher } from '../../../../src/backend/settings/settings-store.ts';
import { readFakeLog, writeFakeOpencode } from '../helpers/fake-opencode.ts';
import { tempProject } from '../helpers/temp-project.ts';

const posixOnly = process.platform === 'win32' ? 'shebang 假可执行文件仅在 POSIX 上运行' : false;

const cipher: KeyCipher = {
  isAvailable: () => true,
  encrypt: (p) => Buffer.from([...p].reverse().join('')).toString('base64'),
  decrypt: (e) => [...Buffer.from(e, 'base64').toString()].reverse().join(''),
};

async function setup(t: { after: (fn: () => Promise<void>) => void }, mode: PermissionMode = 'auto-edits') {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'acm-userdata-'));
  t.after(() => fs.rm(userData, { recursive: true, force: true }));
  const bin = await fs.mkdtemp(path.join(os.tmpdir(), 'acm-bin-'));
  t.after(() => fs.rm(bin, { recursive: true, force: true }));
  await writeFakeOpencode(bin);
  const log = path.join(bin, 'calls.log');
  const root = await tempProject(t, { 'README.md': '# demo\n' });
  const settings = new SettingsStore(path.join(userData, 'settings.json'), cipher);
  await settings.update({ permissionMode: mode });
  const sessions = new SessionStore(path.join(userData, 'sessions'));
  const state = new AppState();
  const events: AgentEvent[] = [];
  const handlers = createHandlers({
    settings, sessions, state, platform: process.platform, emit: (e) => events.push(e), pickDirectory: async () => root,
    resolveDeps: { platform: process.platform, pathEnv: bin, pathExt: '', isFile: async (p) => fs.stat(p).then((s) => s.isFile(), () => false), readText: async () => null },
    cliBaseEnv: { PATH: process.env.PATH ?? '', FAKE_OC_LOG: log },
    // 本套件测 run 模式行为：钉住模式，避免默认 acp 时先试 ACP 再回退（平添回退提示事件）
    modeEnv: { AICM_OPENCODE_MODE: 'run' },
  });
  await handlers['project:pick']();
  const pub = await handlers['agentCli:save']({
    ...OPENCODE_EXAMPLE, args: [...OPENCODE_EXAMPLE.args], resumeArgs: [...OPENCODE_EXAMPLE.resumeArgs], modelArgs: [...OPENCODE_EXAMPLE.modelArgs],
    env: [{ name: 'FAKE_SECRET', secret: true, value: 'sk-SUPER-SECRET' }, { name: 'FAKE_PLAIN', secret: false, value: 'visible' }],
  });
  const cli = pub.agentClis?.[0];
  assert.ok(cli);
  const agent: AgentRef = `cli:${cli.id}`;
  const waitFor = (pred: (e: AgentEvent) => boolean, timeoutMs = 10_000) => new Promise<AgentEvent>((resolve, reject) => {
    const started = Date.now();
    const check = setInterval(() => {
      const e = events.find(pred);
      if (e) { clearInterval(check); resolve(e); } else if (Date.now() - started > timeoutMs) { clearInterval(check); reject(new Error('timeout')); }
    }, 5);
  });
  const idleCount = (sid: string) => events.filter((e) => e.type === 'status' && e.sessionId === sid && !e.running).length;
  const waitIdle = async (sid: string, n: number) => {
    const started = Date.now();
    while (idleCount(sid) < n) {
      if (Date.now() - started > 10_000) throw new Error('timeout waiting idle');
      await new Promise((r) => setTimeout(r, 5));
    }
  };
  return { handlers, events, root, log, cli, agent, waitFor, waitIdle, sessions, settings, userData };
}

test('agent CLI settings never leak secret env values (SC-105)', { skip: posixOnly }, async (t) => {
  const { handlers, cli, userData } = await setup(t);
  assert.deepEqual(cli.env, [{ name: 'FAKE_SECRET', secret: true, hasValue: true }, { name: 'FAKE_PLAIN', secret: false, value: 'visible', hasValue: true }]);
  const pub = await handlers['settings:get']();
  assert.equal(JSON.stringify(pub).includes('sk-SUPER-SECRET'), false);
  assert.equal((await fs.readFile(path.join(userData, 'settings.json'), 'utf8')).includes('sk-SUPER-SECRET'), false);
  // 省略 value = 保持原密文
  const again = await handlers['agentCli:save']({ ...cli, env: [{ name: 'FAKE_SECRET', secret: true }] });
  assert.equal(again.agentClis?.[0]?.env[0]?.hasValue, true);
  await assert.rejects(handlers['agentCli:save']({ ...cli, command: 'a\nb' }), /E_VALIDATION/);
  await assert.rejects(handlers['agentCli:save']({ ...cli, env: [{ name: 'BAD-NAME', secret: false, value: '' }] }), /E_VALIDATION/);
  const check = await handlers['agentCli:check'](cli.id);
  assert.equal(check.ok, true);
  assert.equal(check.version, '1.19.3');
});

test('full opencode conversation: stream, tools, diff, terminal, todos, resume with --session (SC-103)', { skip: posixOnly }, async (t) => {
  const { handlers, events, root, log, agent, cli, waitIdle, sessions } = await setup(t);
  const s0 = await handlers['sessions:create']();
  const s = await handlers['sessions:setAgent'](s0.id, agent);
  assert.equal(s.agent, agent);
  await handlers['agent:send']({ sessionId: s.id, text: '写一个 hello.txt' });
  await waitIdle(s.id, 1);

  const calls = await readFakeLog(log);
  assert.equal(calls.length, 1);
  const first = calls[0];
  assert.ok(first);
  assert.deepEqual(first.argv, ['run', '--format', 'json', '--dir', root, '--', '写一个 hello.txt']);
  assert.equal(await fs.realpath(first.cwd), await fs.realpath(root));
  assert.deepEqual(JSON.parse(first.perm ?? '{}'), { edit: 'allow', bash: 'deny' });
  assert.equal(first.secretSet, true);
  assert.equal(first.plain, 'visible');

  const deltas = events.filter((e) => e.type === 'text-delta').map((e) => (e.type === 'text-delta' ? e.delta : '')).join('');
  assert.equal(deltas, '好的，\n\n已写入 hello.txt。');
  const write = events.find((e) => e.type === 'tool-call' && e.call.name === 'write');
  assert.ok(write && write.type === 'tool-call');
  assert.equal(write.call.status, 'done');
  assert.equal(write.call.input.path, 'hello.txt');
  assert.match(write.call.diff ?? '', /\+hi/);
  assert.ok(events.some((e) => e.type === 'terminal' && e.data === 'ok\n'));
  const todos = events.find((e) => e.type === 'todos');
  assert.ok(todos && todos.type === 'todos');
  assert.deepEqual(todos.todos.map((x) => x.status), ['completed', 'in_progress']);
  assert.equal(JSON.stringify(events).includes('sk-SUPER-SECRET'), false);

  const saved = await sessions.get(s.id);
  // v1.8：两步 step_finish（{input:0,output:0} 与 {total:15,input:10,output:5}）累加落盘
  assert.deepEqual(saved.usage, { total: 15, input: 10, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0 });
  const sid = saved.cliSessions?.[cli.id];
  assert.match(sid ?? '', /^ses_fake/);
  const assistant = saved.messages.find((m) => m.role === 'assistant');
  assert.equal(assistant?.agent, agent);
  assert.ok(assistant?.toolCalls?.some((c) => c.name === 'agent_cli' && c.status === 'done'));

  await handlers['agent:send']({ sessionId: s.id, text: '继续' });
  await waitIdle(s.id, 2);
  const second = (await readFakeLog(log))[1];
  assert.ok(second);
  assert.deepEqual(second.argv.slice(-4), ['--session', sid, '--', '继续']);
  assert.equal((await sessions.get(s.id)).cliSessions?.[cli.id], sid);
});

test('ask mode requires approving the command line; rejection never spawns', { skip: posixOnly }, async (t) => {
  const { handlers, log, agent, waitFor, waitIdle } = await setup(t, 'ask');
  const s = await handlers['sessions:setAgent']((await handlers['sessions:create']()).id, agent);
  await handlers['agent:send']({ sessionId: s.id, text: 'hi' });
  const req = await waitFor((e) => e.type === 'approval-request');
  assert.ok(req.type === 'approval-request');
  assert.equal(req.approval.kind, 'command');
  assert.match(req.approval.command ?? '', /--format json/);
  assert.match(req.approval.command ?? '', /执行命令 允许/);
  await handlers['agent:approve']({ approvalId: req.approval.id, approved: false });
  await waitIdle(s.id, 1);
  assert.equal((await readFakeLog(log)).length, 0);

  await handlers['agent:send']({ sessionId: s.id, text: 'hi again' });
  const req2 = await waitFor((e) => e.type === 'approval-request' && e.approval.id !== req.approval.id);
  assert.ok(req2.type === 'approval-request');
  await handlers['agent:approve']({ approvalId: req2.approval.id, approved: true });
  await waitIdle(s.id, 2);
  const calls = await readFakeLog(log);
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0]?.perm ?? '{}'), { edit: 'allow', bash: 'allow' });
});

test('plan mode denies edits and commands and uses the plan agent', { skip: posixOnly }, async (t) => {
  const { handlers, log, agent, waitIdle } = await setup(t, 'plan');
  const s = await handlers['sessions:setAgent']((await handlers['sessions:create']()).id, agent);
  await handlers['agent:send']({ sessionId: s.id, text: 'hi' });
  await waitIdle(s.id, 1);
  const c = (await readFakeLog(log))[0];
  assert.deepEqual(JSON.parse(c?.perm ?? '{}'), { edit: 'deny', bash: 'deny' });
  assert.deepEqual(c?.argv.slice(-4), ['--agent', 'plan', '--', 'hi']);
});

test('stop kills the running CLI and keeps received output', { skip: posixOnly }, async (t) => {
  const { handlers, events, agent, waitFor, waitIdle, sessions } = await setup(t);
  const s = await handlers['sessions:setAgent']((await handlers['sessions:create']()).id, agent);
  await handlers['agent:send']({ sessionId: s.id, text: 'slow job' });
  await waitFor((e) => e.type === 'text-delta' && e.delta.includes('开始长任务'));
  await assert.rejects(handlers['sessions:setAgent'](s.id, 'builtin'), /E_BUSY/);
  const t0 = Date.now();
  await handlers['agent:stop'](s.id);
  await waitIdle(s.id, 1);
  assert.ok(Date.now() - t0 < 5000);
  const saved = await sessions.get(s.id);
  const a = saved.messages.find((m) => m.role === 'assistant');
  assert.equal(a?.content, '开始长任务…');
  assert.equal(a?.toolCalls?.find((c) => c.name === 'agent_cli')?.status, 'rejected');
  assert.equal(events.some((e) => e.type === 'error'), false);
});

test('CLI errors: error events, non-zero exit with stderr, and missing executable with install hint (FR-114)', { skip: posixOnly }, async (t) => {
  const { handlers, events, agent, cli, waitIdle, settings } = await setup(t);
  const s = await handlers['sessions:setAgent']((await handlers['sessions:create']()).id, agent);
  await handlers['agent:send']({ sessionId: s.id, text: 'please fail' });
  await waitIdle(s.id, 1);
  assert.ok(events.some((e) => e.type === 'error' && e.message.includes('Model not found')));
  await handlers['agent:send']({ sessionId: s.id, text: 'crash now' });
  await waitIdle(s.id, 2);
  assert.ok(events.some((e) => e.type === 'error' && /退出码 3/.test(e.message) && e.message.includes('boom')));

  await settings.saveAgentCli({ ...cli, command: 'definitely-not-installed-oc', env: [] });
  await assert.rejects(handlers['agent:send']({ sessionId: s.id, text: 'hi' }), (err: Error) => /E_CLI/.test(err.message) && /npm install -g opencode-ai/.test(err.message));
  const check = await handlers['agentCli:check'](cli.id);
  assert.equal(check.ok, false);
  assert.match(check.message, /opencode\.ai\/docs/);
});

test('board:get / git:get without a project and default agent for new sessions', { skip: posixOnly }, async (t) => {
  const { handlers, agent } = await setup(t);
  const b = await handlers['board:get']();
  assert.equal(b.available, false); // 临时项目没有 lanes.conf
  const g = await handlers['git:get']();
  assert.equal(g.available, false);
  await handlers['settings:set']({ defaultAgent: agent });
  const s = await handlers['sessions:create']();
  assert.equal(s.agent, agent);
  await assert.rejects(handlers['settings:set']({ defaultAgent: 'cli:nope' }), /E_VALIDATION/);
  await assert.rejects(handlers['sessions:setAgent'](s.id, 'cli:nope'), /E_VALIDATION/);
  const pub = await handlers['agentCli:delete'](agent.slice(4));
  assert.equal(pub.defaultAgent, 'builtin');
});
