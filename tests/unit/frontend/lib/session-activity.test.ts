import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activityLabels,
  activityTarget,
  activityTotal,
  sessionActivity,
  type ActivityInput,
} from '../../../../src/frontend/lib/session-activity.ts';

const base = (over: Partial<ActivityInput> = {}): ActivityInput => ({
  running: new Set<string>(),
  pending: 0,
  toolCalls: [],
  ...over,
});

test('sessionActivity counts running sessions, pending approvals and errored tool calls', () => {
  const a = sessionActivity(base({
    running: new Set(['s1', 's2']),
    pending: 3,
    toolCalls: [{ status: 'error' }, { status: 'done' }, { status: 'error' }],
  }));
  assert.deepEqual(a, { running: 2, pending: 3, errors: 2 });
  assert.equal(activityTotal(a), 7);
});

test('sessionActivity accepts an array of running session ids', () => {
  const a = sessionActivity(base({ running: ['s1', 's2', 's3'] }));
  assert.equal(a.running, 3);
});

test('activityTotal and activityLabels are zero when there is no activity', () => {
  const a = sessionActivity(base());
  assert.equal(activityTotal(a), 0);
  assert.deepEqual(activityLabels(a), []);
});

test('activityLabels lists only the non-zero kinds', () => {
  const a = sessionActivity(base({ running: new Set(['s1']), pending: 2, toolCalls: [{ status: 'error' }] }));
  assert.deepEqual(activityLabels(a), ['1 运行中', '2 待批准', '1 错误']);
});

test('activityTarget jumps to the first running session', () => {
  const input = { ...base({ running: new Set(['s7', 's8']) }), currentSessionId: 'c1', approvalSessionIds: [] as string[] };
  assert.equal(activityTarget('running', input), 's7');
  assert.equal(activityTarget('running', { ...input, running: new Set<string>() }), null);
});

test('activityTarget jumps to the session that owns the pending approval', () => {
  const input = { ...base({ pending: 1 }), currentSessionId: 'c1', approvalSessionIds: ['s3'] };
  assert.equal(activityTarget('pending', input), 's3');
  assert.equal(activityTarget('pending', { ...input, approvalSessionIds: [] }), null);
});

test('activityTarget for errors points at the current session, or null when nothing failed', () => {
  const withErr = { ...base({ toolCalls: [{ status: 'error' }] }), currentSessionId: 'c9', approvalSessionIds: [] as string[] };
  assert.equal(activityTarget('errors', withErr), 'c9');
  const noErr = { ...base(), currentSessionId: 'c9', approvalSessionIds: [] as string[] };
  assert.equal(activityTarget('errors', noErr), null);
  // 出错但没有当前会话 → 无目标
  assert.equal(activityTarget('errors', { ...withErr, currentSessionId: null }), null);
});
