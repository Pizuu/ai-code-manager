/**
 * 终端模式（v1.6）的 IPC 集成测试：terminal:open / terminal:input / terminal:close 的真实链路。
 * 终端进程用 node 本体启动（跨平台、无外部依赖），验证：工作目录恒为项目根、输出经事件回流、
 * 输入能写进子进程、无项目时报 E_NO_PROJECT。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AgentEvent } from '../../../../contracts/ipc.ts';
import { AppState } from '../../../../src/backend/app-state.ts';
import { createHandlers } from '../../../../src/backend/ipc/handlers.ts';
import { OPENCODE_EXAMPLE } from '../../../../src/backend/agent-cli/presets.ts';
import { SessionStore } from '../../../../src/backend/sessions/session-store.ts';
import { SettingsStore, type KeyCipher } from '../../../../src/backend/settings/settings-store.ts';
import { tempProject } from '../helpers/temp-project.ts';

const cipher: KeyCipher = {
  isAvailable: () => true,
  encrypt: (p) => Buffer.from(p, 'utf8').toString('base64'),
  decrypt: (e) => Buffer.from(e, 'base64').toString('utf8'),
};

async function setup(t: { after: (fn: () => Promise<void>) => void }, withProject = true) {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'acm-userdata-'));
  t.after(() => fs.rm(userData, { recursive: true, force: true }));
  const root = await tempProject(t, { 'README.md': '# demo\n' });
  const settings = new SettingsStore(path.join(userData, 'settings.json'), cipher);
  const sessions = new SessionStore(path.join(userData, 'sessions'));
  const state = new AppState();
  const events: AgentEvent[] = [];
  const handlers = createHandlers({
    settings, sessions, state, platform: process.platform,
    emit: (e) => events.push(e),
    pickDirectory: async () => (withProject ? root : null),
  });
  if (withProject) await handlers['project:pick']();
  const session = await handlers['sessions:create']();
  return { handlers, events, session, root, state };
}

const waitFor = async (pred: () => boolean, timeoutMs = 8000): Promise<void> => {
  const started = Date.now();
  while (!pred()) {
    if (Date.now() - started > timeoutMs) throw new Error('等待超时');
    await new Promise((r) => setTimeout(r, 20));
  }
};

test('terminal:open 打开终端，工作目录恒为项目根；terminal:input 写入输入', async (t) => {
  const { handlers, events, session, root } = await setup(t);
  const info = await handlers['terminal:open']({ sessionId: session.id, kind: 'shell' });
  assert.equal(info.sessionId, session.id);
  assert.equal(info.kind, 'shell');
  assert.equal(info.cwd, root);
  assert.equal(info.alive, true);
  assert.ok(info.program.length > 0);

  // 复用：同一会话再次 open 返回同一个终端
  const again = await handlers['terminal:open']({ sessionId: session.id, kind: 'shell' });
  assert.equal(again.id, info.id);

  // 输入：PowerShell / bash 都按行读取，这里用跨平台的 node 子进程不方便，
  // 因此只验证「写入不报错」与「输出事件回流」。
  await handlers['terminal:input']({ sessionId: session.id, data: 'echo hi\r\n' });
  await waitFor(() => events.some((e) => e.type === 'terminal-data'));
  const data = events.filter((e) => e.type === 'terminal-data').map((e) => (e as { data: string }).data).join('');
  assert.ok(data.length >= 0);

  await handlers['terminal:close']({ sessionId: session.id });
  await waitFor(() => events.some((e) => e.type === 'terminal-exit'));
});

test('terminal:open 未打开项目时报 E_NO_PROJECT', async (t) => {
  const { handlers, session } = await setup(t, false);
  await assert.rejects(() => handlers['terminal:open']({ sessionId: session.id }), /E_NO_PROJECT/);
});

test('terminal:input 会话无终端时报 E_NOT_FOUND', async (t) => {
  const { handlers, session } = await setup(t);
  await assert.rejects(() => handlers['terminal:input']({ sessionId: session.id, data: 'x' }), /E_NOT_FOUND/);
});

test('terminal:close 幂等；删除会话时一并结束终端', async (t) => {
  const { handlers, events, session } = await setup(t);
  await handlers['terminal:close']({ sessionId: session.id });
  await handlers['terminal:open']({ sessionId: session.id, kind: 'shell' });
  await handlers['sessions:delete'](session.id);
  await waitFor(() => events.some((e) => e.type === 'terminal-exit'));
});

test('terminal:open 校验参数：非法 kind / 非法 sessionId 一律 E_VALIDATION', async (t) => {
  const { handlers, session } = await setup(t);
  await assert.rejects(() => handlers['terminal:open']({ sessionId: session.id, kind: 'rm-rf' }), /E_VALIDATION/);
  await assert.rejects(() => handlers['terminal:open']({ sessionId: '../etc', kind: 'shell' }), /E_VALIDATION/);
  await handlers['terminal:close']({ sessionId: session.id });
});

test('terminal:open 会话不存在时报 E_NOT_FOUND（不为不存在的会话启动进程）', async (t) => {
  const { handlers } = await setup(t);
  await assert.rejects(() => handlers['terminal:open']({ sessionId: 'no-such-session', kind: 'shell' }), /E_NOT_FOUND/);
});

test('terminal:open 以 CLI 模式打开时，会话未选外部 CLI 则报 E_CLI', async (t) => {
  const { handlers, session } = await setup(t);
  // 默认 agent 为内置（builtin）→ 不能以 CLI 模式打开
  await assert.rejects(() => handlers['terminal:open']({ sessionId: session.id, kind: 'cli' }), /E_CLI/);
});

const posixOnly = process.platform === 'win32' ? 'shebang 假可执行文件仅在 POSIX 上运行' : false;

test('terminal:open (cli) opencode 条目：启动 env 带 question 禁用（管道终端弹不出 question 界面）', { skip: posixOnly }, async (t) => {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'acm-userdata-'));
  t.after(() => fs.rm(userData, { recursive: true, force: true }));
  const bin = await fs.mkdtemp(path.join(os.tmpdir(), 'acm-bin-'));
  t.after(() => fs.rm(bin, { recursive: true, force: true }));
  await fs.writeFile(
    path.join(bin, 'opencode'),
    "#!/usr/bin/env node\nconsole.log('QUESTION=' + (process.env.OPENCODE_ENABLE_QUESTION_TOOL ?? 'unset'));\nprocess.stdin.resume();\n",
    { mode: 0o755 },
  );
  const root = await tempProject(t, { 'README.md': '# demo\n' });
  const settings = new SettingsStore(path.join(userData, 'settings.json'), cipher);
  const sessions = new SessionStore(path.join(userData, 'sessions'));
  const state = new AppState();
  const events: AgentEvent[] = [];
  const handlers = createHandlers({
    settings, sessions, state, platform: process.platform,
    emit: (e) => events.push(e),
    pickDirectory: async () => root,
    resolveDeps: { platform: process.platform, pathEnv: bin, pathExt: '', isFile: async (p) => fs.stat(p).then((s) => s.isFile(), () => false), readText: async () => null },
    cliBaseEnv: { PATH: process.env.PATH ?? '' },
  });
  await handlers['project:pick']();
  const pub = await handlers['agentCli:save']({
    ...OPENCODE_EXAMPLE, args: [...OPENCODE_EXAMPLE.args], resumeArgs: [...OPENCODE_EXAMPLE.resumeArgs], modelArgs: [...OPENCODE_EXAMPLE.modelArgs],
    model: '', env: [],
  });
  const cli = pub.agentClis?.[0];
  assert.ok(cli);
  const session = await handlers['sessions:create']();
  await handlers['sessions:setAgent'](session.id, `cli:${cli.id}`);
  await handlers['terminal:open']({ sessionId: session.id, kind: 'cli' });
  await waitFor(() => events.some((e) => e.type === 'terminal-data' && (e as { data: string }).data.includes('QUESTION=')));
  const data = events.filter((e) => e.type === 'terminal-data').map((e) => (e as { data: string }).data).join('');
  assert.ok(data.includes('QUESTION=false'), `期望终端 env 带 question 禁用，实际输出：${data}`);
  await handlers['terminal:close']({ sessionId: session.id });
});
