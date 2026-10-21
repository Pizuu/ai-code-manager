import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AgentEvent } from '../../../../contracts/ipc.ts';
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

const cliEntry = (id: string) => ({
  id, name: 'opencode', preset: 'opencode', command: 'opencode',
  args: ['run', '--format', 'json', '--dir', '{cwd}'],
  resumeArgs: ['--session', '{session}'],
  modelArgs: ['--model', '{model}'],
  model: '', outputFormat: 'opencode-json', env: [],
});

/** 设置文件预置给定 id 的 opencode 条目（模拟「删后重加换了 id」后的现存条目），会话则绑已消失的旧 id。 */
async function setup(t: { after: (fn: () => Promise<void>) => void }, clis: Array<ReturnType<typeof cliEntry>>) {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'acm-userdata-'));
  t.after(() => fs.rm(userData, { recursive: true, force: true }));
  const bin = await fs.mkdtemp(path.join(os.tmpdir(), 'acm-bin-'));
  t.after(() => fs.rm(bin, { recursive: true, force: true }));
  await writeFakeOpencode(bin);
  const log = path.join(bin, 'calls.log');
  const root = await tempProject(t, { 'README.md': '# demo\n' });
  await fs.writeFile(path.join(userData, 'settings.json'), JSON.stringify({
    provider: 'openai', baseUrl: '', model: '', permissionMode: 'auto-edits',
    encryptedKeys: {}, lastProjectPath: null, agentClis: clis, defaultAgent: 'builtin',
  }));
  const settings = new SettingsStore(path.join(userData, 'settings.json'), cipher);
  await settings.load();
  const sessions = new SessionStore(path.join(userData, 'sessions'));
  const state = new AppState();
  const events: AgentEvent[] = [];
  const handlers = createHandlers({
    settings, sessions, state, platform: process.platform, emit: (e) => events.push(e), pickDirectory: async () => root,
    resolveDeps: { platform: process.platform, pathEnv: bin, pathExt: '', isFile: async (p) => fs.stat(p).then((s) => s.isFile(), () => false), readText: async () => null },
    cliBaseEnv: { PATH: process.env.PATH ?? '', FAKE_OC_LOG: log },
    // 与 handlers-v11 同口径：钉住 run 模式，避免默认 acp 先试再回退
    modeEnv: { AICM_OPENCODE_MODE: 'run' },
  });
  await handlers['project:pick']();
  const waitIdle = async (sid: string) => {
    const started = Date.now();
    while (!events.some((e) => e.type === 'status' && e.sessionId === sid && !e.running)) {
      if (Date.now() - started > 10_000) throw new Error('timeout waiting idle');
      await new Promise((r) => setTimeout(r, 5));
    }
  };
  return { handlers, events, sessions, log, waitIdle };
}

test('agent:send 自动改绑：绑定的 CLI id 已消失、同名条目恰好一条时自愈并跑完回合', { skip: posixOnly }, async (t) => {
  const { handlers, events, sessions, log, waitIdle } = await setup(t, [cliEntry('opencode-beef00')]);
  const s0 = await handlers['sessions:create']();
  // 直接经 store 预置孤儿绑定（handlers 的 sessions:setAgent 会校验条目存在，造不出孤儿态）
  await sessions.setAgent(s0.id, 'cli:opencode-dead00');

  await handlers['agent:send']({ sessionId: s0.id, text: '写一个 hello.txt' });
  await waitIdle(s0.id);

  // 会话已改绑落盘到现存条目，且发出了 session-updated 事件
  const saved = await sessions.get(s0.id);
  assert.equal(saved.agent, 'cli:opencode-beef00');
  assert.ok(events.some((e) => e.type === 'session-updated' && e.summary.id === s0.id && e.summary.agent === 'cli:opencode-beef00'));
  // 回合真的跑了：假 opencode 被调用一次，且助手回复已落盘
  assert.equal((await readFakeLog(log)).length, 1);
  assert.ok(saved.messages.some((m) => m.role === 'assistant'));
});

test('agent:send 不乱绑：两条同名 opencode 条目时仍抛 E_CLI、会话绑定不变', { skip: posixOnly }, async (t) => {
  const { handlers, sessions } = await setup(t, [cliEntry('opencode-beef00'), cliEntry('opencode-cafe42')]);
  const s0 = await handlers['sessions:create']();
  await sessions.setAgent(s0.id, 'cli:opencode-dead00');

  await assert.rejects(handlers['agent:send']({ sessionId: s0.id, text: '写一个 hello.txt' }), /E_CLI/);
  assert.equal((await sessions.get(s0.id)).agent, 'cli:opencode-dead00');
});
