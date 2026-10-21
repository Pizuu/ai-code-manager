import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatMessage, ChatRole, Session } from '../../../../contracts/ipc.ts';
import { summarizeSession } from '../../../../src/backend/sessions/session-store.ts';

const msg = (role: ChatRole, createdAt: string): ChatMessage => ({ id: `${role}-${createdAt}`, role, content: '', createdAt });

const session = (messages: ChatMessage[]): Session => ({
  schemaVersion: 1,
  id: 's-test',
  title: 't',
  projectPath: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  messages,
  todos: [],
});

test('summarizeSession reports lastTurnMs for a single Q&A pair', () => {
  const s = session([
    msg('user', '2026-01-01T00:00:00.000Z'),
    msg('assistant', '2026-01-01T00:00:42.000Z'),
  ]);
  assert.equal(summarizeSession(s).lastTurnMs, 42000);
});

test('summarizeSession takes the last Q&A pair (wall clock, tool messages included)', () => {
  const s = session([
    msg('user', '2026-01-01T00:00:00.000Z'),
    msg('assistant', '2026-01-01T00:00:05.000Z'),
    msg('user', '2026-01-01T00:01:00.000Z'),
    msg('tool', '2026-01-01T00:01:10.000Z'),
    msg('assistant', '2026-01-01T00:01:30.000Z'),
  ]);
  assert.equal(summarizeSession(s).lastTurnMs, 30000);
});

test('summarizeSession omits lastTurnMs when there is no assistant reply', () => {
  const s = session([msg('user', '2026-01-01T00:00:00.000Z')]);
  const summary = summarizeSession(s);
  assert.equal(summary.lastTurnMs, undefined);
  assert.equal('lastTurnMs' in summary, false);
});

test('summarizeSession omits lastTurnMs for out-of-order or invalid timestamps', () => {
  // assistant 在 user 之前（异常序）：没有「user → assistant」的完整问答
  const reversed = session([
    msg('assistant', '2026-01-01T00:00:00.000Z'),
    msg('user', '2026-01-01T00:00:10.000Z'),
  ]);
  assert.equal(summarizeSession(reversed).lastTurnMs, undefined);
  // 时间戳非法
  const invalid = session([
    msg('user', 'not-a-date'),
    msg('assistant', '2026-01-01T00:00:10.000Z'),
  ]);
  assert.equal(summarizeSession(invalid).lastTurnMs, undefined);
  // 差值 <= 0（同一时刻）
  const zero = session([
    msg('user', '2026-01-01T00:00:10.000Z'),
    msg('assistant', '2026-01-01T00:00:10.000Z'),
  ]);
  assert.equal(summarizeSession(zero).lastTurnMs, undefined);
});
