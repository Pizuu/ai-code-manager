/**
 * opencode ACP 模式接入 handlers 的集成测试：默认模式（acp）下 opencode 会话走 ACP 子进程
 * （假 ACP agent：tests/unit 的 fake-acp-agent.ts，NDJSON JSON-RPC），启动失败回退 run 模式。
 * 行为确定、无外网；POSIX 专用（shebang 假可执行文件）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AgentEvent, AgentRef, Session } from '../../../../contracts/ipc.ts';
import { AcpProcessManager } from '../../../../src/backend/agent-cli/acp-runner.ts';
import { OPENCODE_EXAMPLE } from '../../../../src/backend/agent-cli/presets.ts';
import { AppState } from '../../../../src/backend/app-state.ts';
import { createHandlers } from '../../../../src/backend/ipc/handlers.ts';
import { SessionStore } from '../../../../src/backend/sessions/session-store.ts';
import { SettingsStore, type KeyCipher } from '../../../../src/backend/settings/settings-store.ts';
import { writeFakeAcpAgent } from '../../../unit/backend/agent-cli/fake-acp-agent.ts';
import { writeFakeOpencodeWithServe } from '../helpers/fake-opencode-serve.ts';
import { FAKE_RUN_SCRIPT } from '../helpers/fake-opencode.ts';
import { tempProject } from '../helpers/temp-project.ts';

const posixOnly = process.platform === 'win32' ? 'shebang 假可执行文件仅在 POSIX 上运行' : false;

const cipher: KeyCipher = {
  isAvailable: () => true,
  encrypt: (p) => Buffer.from([...p].reverse().join('')).toString('base64'),
  decrypt: (e) => [...Buffer.from(e, 'base64').toString()].reverse().join(''),
};

async function setup(t: { after: (fn: () => void | Promise<void>) => void }, opts: { envMode?: string; scenario?: string; permissionMode?: 'ask' | 'auto-edits' | 'plan' } = {}) {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'acm-userdata-'));
  t.after(() => fs.rm(userData, { recursive: true, force: true }));
  const bin = await fs.mkdtemp(path.join(os.tmpdir(), 'acm-bin-'));
  t.after(() => fs.rm(bin, { recursive: true, force: true }));
  if (opts.scenario === 'run-fake') {
    // 只说 run 模式的假 opencode：ACP 握手必失败（回退验证用）
    await writeFakeOpencodeWithServe(bin, FAKE_RUN_SCRIPT);
  } else {
    await writeFakeAcpAgent(bin);
  }
  const root = await tempProject(t, { 'README.md': '# demo\n' });
  const settings = new SettingsStore(path.join(userData, 'settings.json'), cipher);
  await settings.update({ permissionMode: opts.permissionMode ?? 'ask' });
  const sessions = new SessionStore(path.join(userData, 'sessions'));
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
    modeEnv: opts.envMode === undefined ? {} : { AICM_OPENCODE_MODE: opts.envMode },
  });
  await handlers['project:pick']();
  const pub = await handlers['agentCli:save']({
    ...OPENCODE_EXAMPLE, args: [...OPENCODE_EXAMPLE.args], resumeArgs: [...OPENCODE_EXAMPLE.resumeArgs], modelArgs: [...OPENCODE_EXAMPLE.modelArgs],
    model: '', env: [{ name: 'FAKE_ACP_SCENARIO', secret: false, value: opts.scenario ?? 'basic' }],
  });
  const cli = pub.agentClis?.[0];
  assert.ok(cli);
  const agent: AgentRef = `cli:${cli.id}`;
  const idleCount = (sid: string) => events.filter((e) => e.type === 'status' && e.sessionId === sid && !e.running).length;
  const until = async (pred: () => boolean, what: string, timeoutMs = 10_000) => {
    const started = Date.now();
    while (!pred()) {
      if (Date.now() - started > timeoutMs) throw new Error(`timeout: ${what}`);
      await new Promise((r) => setTimeout(r, 5));
    }
  };
  const send = async (text: string): Promise<Session> => {
    const s = await handlers['sessions:create']();
    await handlers['sessions:setAgent'](s.id, agent);
    await handlers['agent:send']({ sessionId: s.id, text });
    await until(() => idleCount(s.id) >= 1, 'idle');
    return handlers['sessions:get'](s.id);
  };
  return { handlers, events, send, acpManager, cli };
}

test('default mode is acp: opencode turn runs over ACP (text + tool calls land in the session)', { skip: posixOnly }, async (t) => {
  const { send, acpManager, cli } = await setup(t);
  const after = await send('hello');
  const assistant = after.messages.at(-1);
  assert.equal(assistant?.content, 'Hello world\n\ndone');
  const bash = assistant?.toolCalls?.find((c) => c.id === 'call_bash');
  assert.equal(bash?.status, 'done');
  const invoke = assistant?.toolCalls?.find((c) => c.name === 'agent_cli');
  assert.equal(invoke?.input.mode, 'acp');
  assert.equal(invoke?.status, 'done');
  assert.equal(after.cliSessions?.[`${cli.id}@acp`], 'ses_fake_1');
  assert.equal(acpManager.size, 1);
});

test('acp startup failure falls back to run mode with a notice event', { skip: posixOnly }, async (t) => {
  const { send, events } = await setup(t, { scenario: 'run-fake', permissionMode: 'auto-edits' });
  const after = await send('写个文件');
  const errs = events.filter((e) => e.type === 'error').map((e) => (e as Extract<AgentEvent, { type: 'error' }>).message);
  assert.ok(errs.some((m) => m.includes('ACP 接入启动失败，已回退')), `期望 ACP 回退提示，实际：${JSON.stringify(errs)}`);
  // 回退后 run 模式正常完成（假 run 的文本与工具事件落盘）
  const assistant = after.messages.at(-1);
  assert.ok((assistant?.content ?? '').includes('已写入 hello.txt'));
});
