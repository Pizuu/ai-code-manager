import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentEvent, Session } from '../../../../contracts/ipc.ts';
import { beginCliTurn } from '../../../../src/backend/agent-cli/cli-runner.ts';

const makeSession = (): Session => ({
  schemaVersion: 1,
  id: 's-usage',
  title: '',
  projectPath: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  messages: [],
  todos: [],
});

test('beginCliTurn sink pushes usage in session-updated on each step-finish (v1.10 realtime)', async () => {
  const session = makeSession();
  const events: AgentEvent[] = [];
  const persistedUsage: Array<Session['usage']> = [];
  let n = 0;
  const sink = await beginCliTurn(session, '你好', {
    config: { id: 'opencode-x1', name: 'opencode' },
    projectRoot: '/proj',
    emit: (e) => events.push(e),
    persist: async (s) => { persistedUsage.push(s.usage ? { ...s.usage } : undefined); },
    newId: () => `id-${++n}`,
    now: () => '2026-01-01T00:00:01.000Z',
    sessionKey: 'opencode-x1',
    infoToolCallId: () => 'invoke-1',
  });

  const updates = () => events.filter((e) => e.type === 'session-updated');
  // 回合刚开始（用户消息落盘）的 session-updated 不带 usage
  assert.equal(updates().length >= 1, true);
  assert.equal(updates().every((e) => e.type === 'session-updated' && e.summary.usage === undefined), true);

  // 回合进行中：第一个 step-finish 后，usage 立刻随 session-updated 推出（不等回合结束）
  sink.handle({ kind: 'step-finish', sessionId: null, reason: 'tool-calls', tokens: { total: 15, input: 10, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0 } });
  await sink.save(); // save 串行链：等这一次落盘即等到了 step-finish 触发的那次
  const withUsage = updates().filter((e) => e.type === 'session-updated' && e.summary.usage !== undefined);
  assert.equal(withUsage.length >= 1, true);
  const first = withUsage[0];
  assert.ok(first && first.type === 'session-updated');
  assert.deepEqual(first.summary.usage, { total: 15, input: 10, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0 });
  assert.deepEqual(session.usage, { total: 15, input: 10, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0 });
  assert.deepEqual(persistedUsage[persistedUsage.length - 1], { total: 15, input: 10, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0 });

  // 第二个 step-finish 累加后再次推送新总数
  sink.handle({ kind: 'step-finish', sessionId: null, reason: 'stop', tokens: { total: 5, input: 3, output: 2, reasoning: 0, cacheRead: 0, cacheWrite: 0 } });
  await sink.save();
  const last = updates()[updates().length - 1];
  assert.ok(last && last.type === 'session-updated');
  assert.deepEqual(last.summary.usage, { total: 20, input: 13, output: 7, reasoning: 0, cacheRead: 0, cacheWrite: 0 });
});
