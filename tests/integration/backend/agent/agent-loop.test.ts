import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AgentEvent, ApprovalRequest, Session } from '../../../../contracts/ipc.ts';
import { DEFAULT_SESSION_TITLE, runAgentTurn, type AgentDeps } from '../../../../src/backend/agent/agent-loop.ts';
import type { Provider, ProviderRequest, ProviderResult } from '../../../../src/backend/agent/providers/types.ts';
import { tempProject } from '../helpers/temp-project.ts';

/** 按脚本依次返回结果的假 provider，并记录收到的历史。 */
function scriptedProvider(script: Array<{ text: string; toolCalls?: ProviderResult['toolCalls'] }>) {
  const seen: ProviderRequest[] = [];
  const provider: Provider = {
    id: 'openai',
    async stream(req, onText) {
      seen.push({ ...req, messages: req.messages.map((m) => ({ ...m })) });
      const step = script.shift();
      if (!step) throw new Error('script exhausted');
      for (const ch of step.text) onText(ch);
      return { text: step.text, toolCalls: step.toolCalls ?? [], stopReason: null };
    },
  };
  return { provider, seen };
}

function newSession(): Session {
  return { schemaVersion: 1, id: 's-1', title: DEFAULT_SESSION_TITLE, projectPath: null, createdAt: '', updatedAt: '', messages: [], todos: [] };
}

function deps(root: string, provider: Provider, approve: boolean, overrides: Partial<AgentDeps> = {}) {
  const events: AgentEvent[] = [];
  const approvals: ApprovalRequest[] = [];
  let persisted = 0;
  let n = 0;
  const d: AgentDeps = {
    provider, model: 'm', mode: 'ask', projectRoot: root, system: 'S',
    signal: new AbortController().signal,
    emit: (e) => events.push(e),
    requestApproval: async (r) => { approvals.push(r); return approve; },
    persist: async () => { persisted++; },
    newId: () => `id${++n}`,
    now: () => '2026-10-20T00:00:00.000Z',
    ...overrides,
  };
  return { d, events, approvals, persisted: () => persisted };
}

test('runs a read → edit (approved) → answer loop and records everything in the session', async (t) => {
  const root = await tempProject(t, { 'README.md': '# demo\n' });
  const { provider, seen } = scriptedProvider([
    { text: '先看看。', toolCalls: [{ id: 'c1', name: 'read_file', input: { path: 'README.md' } }] },
    { text: '', toolCalls: [{ id: 'c2', name: 'edit_file', input: { path: 'README.md', old_string: '# demo', new_string: '# Demo' } }] },
    { text: '改好了。' },
  ]);
  const session = newSession();
  const { d, events, approvals, persisted } = deps(root, provider, true);
  await runAgentTurn(session, '把标题改成 Demo', d);

  assert.equal(await fs.readFile(path.join(root, 'README.md'), 'utf8'), '# Demo\n');
  assert.equal(session.title, '把标题改成 Demo');
  assert.equal(session.projectPath, root);
  assert.deepEqual(session.messages.map((m) => m.role), ['user', 'assistant', 'tool', 'assistant', 'tool', 'assistant']);
  assert.equal(session.messages[3]?.toolCalls?.[0]?.status, 'done');
  assert.match(session.messages[3]?.toolCalls?.[0]?.diff ?? '', /\+# Demo/);
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0]?.sessionId, 's-1');
  assert.ok(events.some((e) => e.type === 'tool-call' && e.call.status === 'awaiting-approval'));
  assert.equal(events.filter((e) => e.type === 'text-delta').map((e) => (e.type === 'text-delta' ? e.delta : '')).join(''), '先看看。改好了。');
  assert.ok(persisted() >= 3);
  // 第三次请求的历史里包含两条工具结果
  assert.equal(seen[2]?.messages.filter((m) => m.role === 'tool').length, 2);
});

test('a rejected edit is reported back to the model and the file is unchanged', async (t) => {
  const root = await tempProject(t, { 'README.md': '# demo\n' });
  const { provider, seen } = scriptedProvider([
    { text: '', toolCalls: [{ id: 'c1', name: 'write_file', input: { path: 'README.md', content: 'x' } }] },
    { text: '好的，不改。' },
  ]);
  const session = newSession();
  await runAgentTurn(session, 'go', deps(root, provider, false).d);
  assert.equal(await fs.readFile(path.join(root, 'README.md'), 'utf8'), '# demo\n');
  assert.equal(session.messages[1]?.toolCalls?.[0]?.status, 'rejected');
  assert.match(seen[1]?.messages.at(-1)?.content ?? '', /用户拒绝/);
});

test('stops after MAX_TOOL_TURNS and emits an error', async (t) => {
  const root = await tempProject(t, { 'a.txt': 'x' });
  const endless: Provider = {
    id: 'openai',
    async stream() { return { text: '', toolCalls: [{ id: `c${Math.random()}`, name: 'list_dir', input: {} }], stopReason: null }; },
  };
  const { d, events } = deps(root, endless, true);
  await runAgentTurn(newSession(), 'loop', d);
  assert.ok(events.some((e) => e.type === 'error' && /25 轮/.test(e.message)));
});

test('an aborted signal skips remaining tool calls and records them as stopped', async (t) => {
  const root = await tempProject(t, { 'a.txt': 'x' });
  const ac = new AbortController();
  const { provider } = scriptedProvider([
    { text: '', toolCalls: [{ id: 'c1', name: 'run_command', input: { command: 'echo 1' } }, { id: 'c2', name: 'list_dir', input: {} }] },
  ]);
  const session = newSession();
  const { d } = deps(root, provider, false, {
    signal: ac.signal,
    requestApproval: async () => { ac.abort(); return false; },
  });
  await runAgentTurn(session, 'go', d);
  const calls = session.messages[1]?.toolCalls ?? [];
  assert.deepEqual(calls.map((c) => c.status), ['rejected', 'rejected']);
  assert.equal(session.messages.filter((m) => m.role === 'tool').length, 2);
});
