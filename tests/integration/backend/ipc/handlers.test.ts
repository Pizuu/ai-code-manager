import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AgentEvent } from '../../../../contracts/ipc.ts';
import type { Provider, ProviderRequest } from '../../../../src/backend/agent/providers/types.ts';
import { AppState } from '../../../../src/backend/app-state.ts';
import { createHandlers } from '../../../../src/backend/ipc/handlers.ts';
import { SessionStore } from '../../../../src/backend/sessions/session-store.ts';
import { SettingsStore, type KeyCipher } from '../../../../src/backend/settings/settings-store.ts';
import { tempProject } from '../helpers/temp-project.ts';

const cipher: KeyCipher = {
  isAvailable: () => true,
  encrypt: (p) => Buffer.from(p).toString('base64'),
  decrypt: (e) => Buffer.from(e, 'base64').toString(),
};

async function setup(t: { after: (fn: () => Promise<void>) => void }, steps: Array<Awaited<ReturnType<Provider['stream']>>>) {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'acm-userdata-'));
  t.after(() => fs.rm(userData, { recursive: true, force: true }));
  const root = await tempProject(t, { 'README.md': '# demo\n', 'AGENTS.md': '规则：用中文。' });
  const settings = new SettingsStore(path.join(userData, 'settings.json'), cipher);
  const sessions = new SessionStore(path.join(userData, 'sessions'));
  const state = new AppState();
  const events: AgentEvent[] = [];
  const requests: ProviderRequest[] = [];
  const configs: Array<{ baseUrl: string; apiKey: string }> = [];
  const handlers = createHandlers({
    settings, sessions, state, platform: process.platform,
    emit: (e) => events.push(e),
    pickDirectory: async () => root,
    providerFactory: (_id, config) => {
      configs.push(config);
      return { id: 'openai', async stream(req) { requests.push(req); const s = steps.shift(); if (!s) throw new Error('no step'); return s; } };
    },
  });
  const idle = (sessionId: string) => new Promise<void>((resolve) => {
    const check = setInterval(() => {
      if (events.some((e) => e.type === 'status' && e.sessionId === sessionId && !e.running)) { clearInterval(check); resolve(); }
    }, 5);
  });
  const waitFor = (pred: (e: AgentEvent) => boolean) => new Promise<AgentEvent>((resolve) => {
    const check = setInterval(() => { const e = events.find(pred); if (e) { clearInterval(check); resolve(e); } }, 5);
  });
  return { handlers, events, requests, configs, root, idle, waitFor, sessions };
}

test('rejects sending without an api key, then runs a full turn once configured', async (t) => {
  const { handlers, requests, configs, idle, root } = await setup(t, [{ text: '你好', toolCalls: [], stopReason: 'stop' }]);
  const project = await handlers['project:pick']();
  assert.equal(project?.root, root);
  const session = await handlers['sessions:create']();
  await assert.rejects(handlers['agent:send']({ sessionId: session.id, text: 'hi' }), /E_NO_API_KEY/);

  const pub = await handlers['settings:set']({ apiKey: { provider: 'openai', value: 'sk-1' } });
  assert.equal(JSON.stringify(pub).includes('sk-1'), false);
  await handlers['agent:send']({ sessionId: session.id, text: 'hi' });
  await idle(session.id);

  assert.equal(configs[0]?.apiKey, 'sk-1');
  assert.match(requests[0]?.system ?? '', /规则：用中文/);
  const saved = await handlers['sessions:get'](session.id);
  assert.deepEqual(saved.messages.map((m) => m.role), ['user', 'assistant']);
  assert.equal(saved.title, 'hi');
});

test('approval round-trip through agent:approve writes the file', async (t) => {
  const { handlers, idle, waitFor, root } = await setup(t, [
    { text: '', toolCalls: [{ id: 'c1', name: 'edit_file', input: { path: 'README.md', old_string: '# demo', new_string: '# Demo' } }], stopReason: 'tool_calls' },
    { text: '完成', toolCalls: [], stopReason: 'stop' },
  ]);
  await handlers['project:pick']();
  await handlers['settings:set']({ apiKey: { provider: 'openai', value: 'k' } });
  const s = await handlers['sessions:create']();
  await handlers['agent:send']({ sessionId: s.id, text: 'edit' });
  const ev = await waitFor((e) => e.type === 'approval-request');
  assert.equal(ev.type, 'approval-request');
  if (ev.type !== 'approval-request') return;
  await assert.rejects(handlers['agent:send']({ sessionId: s.id, text: 'again' }), /E_BUSY/);
  await handlers['agent:approve']({ approvalId: ev.approval.id, approved: true });
  await idle(s.id);
  assert.equal(await fs.readFile(path.join(root, 'README.md'), 'utf8'), '# Demo\n');
});

test('agent:stop rejects the pending approval and leaves the file untouched', async (t) => {
  const { handlers, idle, waitFor, events, root } = await setup(t, [
    { text: '', toolCalls: [{ id: 'c1', name: 'write_file', input: { path: 'README.md', content: 'x' } }], stopReason: 'tool_calls' },
  ]);
  await handlers['project:pick']();
  await handlers['settings:set']({ apiKey: { provider: 'openai', value: 'k' } });
  const s = await handlers['sessions:create']();
  await handlers['agent:send']({ sessionId: s.id, text: 'go' });
  await waitFor((e) => e.type === 'approval-request');
  await handlers['agent:stop'](s.id);
  await idle(s.id);
  assert.ok(events.some((e) => e.type === 'approval-resolved' && !e.approved));
  assert.equal(await fs.readFile(path.join(root, 'README.md'), 'utf8'), '# demo\n');
});

test('fs:tree and tasks:list are scoped to the opened project and validate input', async (t) => {
  const { handlers } = await setup(t, []);
  await assert.rejects(handlers['fs:tree'](''), /E_NO_PROJECT/);
  await handlers['project:pick']();
  const tree = await handlers['fs:tree']('');
  assert.deepEqual(tree.map((n) => n.name), ['AGENTS.md', 'README.md']);
  await assert.rejects(handlers['fs:tree']('..'), /E_PATH_ESCAPE/);
  await assert.rejects(handlers['sessions:get']('../x'), /E_VALIDATION/);
  assert.deepEqual(await handlers['tasks:list'](), []);
});
