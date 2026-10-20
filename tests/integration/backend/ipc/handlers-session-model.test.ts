/**
 * 契约 v1.5：CLI 模型切换的 handlers 集成测试。
 * - agent:setSessionModel：写入 / 清除会话级覆盖、落盘持久化、非法会话 / 非法 model 被拒。
 * - agentCli:models：假 opencode 可执行脚本的 `models` 输出解析；非 opencode / 失败 / 不存在一律空数组。
 * - 叠加生效：ACP 轮次中 session/set_model 收到的应是会话覆盖（假 ACP agent 以 FAKE_ACP_ECHO_MODEL 回显）。
 * POSIX 专用（shebang 假可执行文件），无外网、行为确定。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AgentEvent, AgentRef } from '../../../../contracts/ipc.ts';
import { AcpProcessManager } from '../../../../src/backend/agent-cli/acp-runner.ts';
import { OPENCODE_EXAMPLE } from '../../../../src/backend/agent-cli/presets.ts';
import { AppState } from '../../../../src/backend/app-state.ts';
import { createHandlers } from '../../../../src/backend/ipc/handlers.ts';
import { SessionStore } from '../../../../src/backend/sessions/session-store.ts';
import { SettingsStore, type KeyCipher } from '../../../../src/backend/settings/settings-store.ts';
import { writeFakeAcpAgent } from '../../../unit/backend/agent-cli/fake-acp-agent.ts';
import { tempProject } from '../helpers/temp-project.ts';

const posixOnly = process.platform === 'win32' ? 'shebang 假可执行文件仅在 POSIX 上运行' : false;

const cipher: KeyCipher = {
  isAvailable: () => true,
  encrypt: (p) => Buffer.from([...p].reverse().join('')).toString('base64'),
  decrypt: (e) => [...Buffer.from(e, 'base64').toString()].reverse().join(''),
};

const FAKE_MODELS_SCRIPT = [
  '#!/usr/bin/env node',
  "const mode = process.env.FAKE_MODELS_MODE || 'ok';",
  "if (process.argv[2] === '--version') { console.log('1.19.3'); process.exit(0); }",
  "if (process.argv[2] === 'models') {",
  "  if (mode === 'fail') { console.error('boom'); process.exit(1); }",
  "  console.log('opencode/big-pickle');",
  "  console.log('anthropic/claude-sonnet-4-5');",
  "  console.log('');",
  "  console.log('anthropic/claude-sonnet-4-5');",
  "  console.log('not a model line');",
  "  console.log('openai/gpt-5.2');",
  '  process.exit(0);',
  '}',
  'process.exit(2);',
  '',
].join('\n');

type Ctx = Awaited<ReturnType<typeof setup>>;

async function setup(t: { after: (fn: () => void | Promise<void>) => void }, opts: { acp?: boolean } = {}) {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'acm-userdata-'));
  t.after(() => fs.rm(userData, { recursive: true, force: true }));
  const bin = await fs.mkdtemp(path.join(os.tmpdir(), 'acm-bin-'));
  t.after(() => fs.rm(bin, { recursive: true, force: true }));
  if (opts.acp) await writeFakeAcpAgent(bin);
  else await fs.writeFile(path.join(bin, 'opencode'), FAKE_MODELS_SCRIPT, { mode: 0o755 });
  const root = await tempProject(t, { 'README.md': '# demo\n' });
  const settings = new SettingsStore(path.join(userData, 'settings.json'), cipher);
  const sessionsDir = path.join(userData, 'sessions');
  const sessions = new SessionStore(sessionsDir);
  const state = new AppState();
  const events: AgentEvent[] = [];
  const acpManager = new AcpProcessManager({ platform: process.platform });
  t.after(() => acpManager.closeAll());
  const handlers = createHandlers({
    settings, sessions, state, platform: process.platform,
    emit: (e) => events.push(e),
    pickDirectory: async () => root,
    acpManager,
    resolveDeps: { platform: process.platform, pathEnv: bin, pathExt: '', isFile: async (p) => fs.stat(p).then((s) => s.isFile(), () => false), readText: async () => null },
    cliBaseEnv: { PATH: process.env.PATH ?? '' },
    modeEnv: {},
  });
  await handlers['project:pick']();
  return { handlers, sessions, sessionsDir, events };
}

async function saveOpencode(ctx: Ctx, env: { name: string; value: string }[], model = '') {
  const pub = await ctx.handlers['agentCli:save']({
    ...OPENCODE_EXAMPLE,
    args: [...OPENCODE_EXAMPLE.args], resumeArgs: [...OPENCODE_EXAMPLE.resumeArgs], modelArgs: [...OPENCODE_EXAMPLE.modelArgs],
    model, env: env.map((e) => ({ name: e.name, secret: false, value: e.value })),
  });
  const cli = pub.agentClis?.[0];
  assert.ok(cli);
  return cli;
}

test('agent:setSessionModel writes, persists and clears the session model override', { skip: posixOnly }, async (t) => {
  const { handlers, sessionsDir } = await setup(t);
  const s = await handlers['sessions:create']();
  assert.equal(s.cliModel, undefined);

  const updated = await handlers['agent:setSessionModel']({ sessionId: s.id, model: ' anthropic/claude-sonnet-4-5 ' });
  assert.equal(updated.cliModel, 'anthropic/claude-sonnet-4-5');
  assert.equal((await handlers['sessions:get'](s.id)).cliModel, 'anthropic/claude-sonnet-4-5');
  // 落盘：全新 SessionStore 实例读同一目录仍能看到覆盖
  assert.equal((await new SessionStore(sessionsDir).get(s.id)).cliModel, 'anthropic/claude-sonnet-4-5');

  const cleared = await handlers['agent:setSessionModel']({ sessionId: s.id, model: null });
  assert.equal(cleared.cliModel, undefined);
  assert.equal((await new SessionStore(sessionsDir).get(s.id)).cliModel, undefined);

  // 空串同样按清除处理
  await handlers['agent:setSessionModel']({ sessionId: s.id, model: 'openai/gpt-5.2' });
  const cleared2 = await handlers['agent:setSessionModel']({ sessionId: s.id, model: '  ' });
  assert.equal(cleared2.cliModel, undefined);
});

test('agent:setSessionModel rejects unknown sessions and invalid models', { skip: posixOnly }, async (t) => {
  const { handlers } = await setup(t);
  const s = await handlers['sessions:create']();
  await assert.rejects(handlers['agent:setSessionModel']({ sessionId: 's-no-such-1', model: 'a/b' }), /E_NOT_FOUND/);
  await assert.rejects(handlers['agent:setSessionModel']({ sessionId: 'bad id!', model: null }), /E_VALIDATION/);
  await assert.rejects(
    handlers['agent:setSessionModel']({ sessionId: s.id, model: 42 as unknown as string }),
    /E_VALIDATION/,
  );
  await assert.rejects(handlers['agent:setSessionModel']({ sessionId: s.id, model: 'x'.repeat(201) }), /E_VALIDATION/);
  // 被拒后会话未被写入
  assert.equal((await handlers['sessions:get'](s.id)).cliModel, undefined);
});

test('agentCli:models parses a fake opencode `models` run', { skip: posixOnly }, async (t) => {
  const ctx = await setup(t);
  const cli = await saveOpencode(ctx, [{ name: 'FAKE_MODELS_MODE', value: 'ok' }]);
  const { models } = await ctx.handlers['agentCli:models'](cli.id);
  assert.deepEqual(models, ['opencode/big-pickle', 'anthropic/claude-sonnet-4-5', 'openai/gpt-5.2']);
});

test('agentCli:models returns [] for non-opencode entries, failing exes and unknown ids', { skip: posixOnly }, async (t) => {
  const ctx = await setup(t);
  // 非 opencode（custom / text）条目：直接空数组
  const pub = await ctx.handlers['agentCli:save']({
    name: 'generic', preset: 'custom', command: 'claude', args: ['{prompt}'], resumeArgs: [], modelArgs: [], model: '', outputFormat: 'text', env: [],
  });
  const generic = pub.agentClis?.[0];
  assert.ok(generic);
  assert.deepEqual(await ctx.handlers['agentCli:models'](generic.id), { models: [] });
  // opencode 条目但 `models` 非零退出：空数组不抛错
  const failing = await saveOpencode(ctx, [{ name: 'FAKE_MODELS_MODE', value: 'fail' }]);
  assert.deepEqual(await ctx.handlers['agentCli:models'](failing.id), { models: [] });
  // 不存在的 id：空数组不抛错
  assert.deepEqual(await ctx.handlers['agentCli:models']('no-such-cli'), { models: [] });
});

async function sendAndWait(ctx: Ctx, cliId: string, override?: string): Promise<string> {
  const { handlers, events } = ctx;
  const agent: AgentRef = `cli:${cliId}`;
  const s = await handlers['sessions:create']();
  await handlers['sessions:setAgent'](s.id, agent);
  if (override !== undefined) await handlers['agent:setSessionModel']({ sessionId: s.id, model: override });
  await handlers['agent:send']({ sessionId: s.id, text: 'hi' });
  const started = Date.now();
  while (!events.some((e) => e.type === 'status' && e.sessionId === s.id && !e.running)) {
    if (Date.now() - started > 10_000) throw new Error('timeout: turn idle');
    await new Promise((r) => setTimeout(r, 5));
  }
  const after = await handlers['sessions:get'](s.id);
  return after.messages.at(-1)?.content ?? '';
}

test('ACP turn receives the CLI config model when the session has no override', { skip: posixOnly }, async (t) => {
  const ctx = await setup(t, { acp: true });
  const cli = await saveOpencode(ctx, [
    { name: 'FAKE_ACP_SCENARIO', value: 'basic' },
    { name: 'FAKE_ACP_ECHO_MODEL', value: '1' },
  ], 'prov-a/config-model');
  const content = await sendAndWait(ctx, cli.id);
  assert.ok(content.includes('MODEL:prov-a/config-model'), `实际内容：${content}`);
});

test('ACP turn receives the session override model (set_model overlay wins over config)', { skip: posixOnly }, async (t) => {
  const ctx = await setup(t, { acp: true });
  const cli = await saveOpencode(ctx, [
    { name: 'FAKE_ACP_SCENARIO', value: 'basic' },
    { name: 'FAKE_ACP_ECHO_MODEL', value: '1' },
  ], 'prov-a/config-model');
  const content = await sendAndWait(ctx, cli.id, 'prov-b/session-model');
  assert.ok(content.includes('MODEL:prov-b/session-model'), `实际内容：${content}`);
  assert.ok(!content.includes('MODEL:prov-a/config-model'), `实际内容：${content}`);
});
