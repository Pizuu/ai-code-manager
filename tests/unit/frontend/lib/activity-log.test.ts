import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ApprovalRequest } from '../../../../contracts/ipc.ts';
import { activityStats, appendEntry, approvalSummary, clip, filterEntries, makeEntry, parseEntries } from '../../../../src/frontend/lib/activity-log.ts';

test('追加记录超出上限时丢最早的', () => {
  let list = [makeEntry('sent', 's1', 'a', '2026-10-24T01:00:00Z')];
  list = appendEntry(list, makeEntry('received', 's1', 'b', '2026-10-24T01:01:00Z'), 2);
  list = appendEntry(list, makeEntry('error', 's1', 'c', '2026-10-24T01:02:00Z'), 2);
  assert.deepEqual(list.map((e) => e.text), ['b', 'c']);
});

test('筛选：只看当前项目会话、按类别 / 会话 / 关键字，最新在前', () => {
  const list = [
    makeEntry('sent', 's1', '你好', '2026-10-24T01:00:00Z'),
    makeEntry('approval-request', 's1', '执行命令 · npm test', '2026-10-24T01:02:00Z', 'a1'),
    makeEntry('approval-approved', 's2', '执行命令 · ls', '2026-10-24T01:03:00Z', 'a2'),
    makeEntry('received', 'other', '别的项目', '2026-10-24T01:04:00Z'),
  ];
  const ids = new Set(['s1', 's2']);
  assert.deepEqual(filterEntries(list, { sessionIds: ids }).map((e) => e.sessionId), ['s2', 's1', 's1']);
  assert.equal(filterEntries(list, { sessionIds: ids, group: 'approval' }).length, 2);
  assert.equal(filterEntries(list, { sessionIds: ids, sessionId: 's1' }).length, 2);
  assert.deepEqual(filterEntries(list, { sessionIds: ids, q: 'npm' }).map((e) => e.approvalId), ['a1']);
  assert.equal(filterEntries(list, { sessionIds: new Set() }).length, 0);
});

test('同一时刻按追加顺序倒序', () => {
  const at = '2026-10-24T01:00:00Z';
  const list = [makeEntry('sent', 's1', '1', at), makeEntry('run-start', 's1', '2', at), makeEntry('received', 's1', '3', at)];
  assert.deepEqual(filterEntries(list, { sessionIds: new Set(['s1']) }).map((e) => e.text), ['3', '2', '1']);
});

test('计数只算当前项目', () => {
  const list = [makeEntry('sent', 's1', 'x'), makeEntry('received', 's1', 'y'), makeEntry('approval-rejected', 's1', 'z'), makeEntry('sent', 'o', 'w')];
  assert.deepEqual(activityStats(list, new Set(['s1'])), { sent: 1, received: 1, approved: 0, rejected: 1, requested: 0, errors: 0 });
});

test('审批摘要与截断', () => {
  const a = { id: 'a', sessionId: 's', toolCallId: 't', kind: 'command', command: 'npm  run\ncheck' } as ApprovalRequest;
  assert.equal(approvalSummary(a), '执行命令 · npm run check');
  assert.equal(clip('x'.repeat(10), 5), 'xxxx…');
});

test('落盘数据容错', () => {
  assert.deepEqual(parseEntries(null), []);
  assert.deepEqual(parseEntries('{bad'), []);
  const ok = makeEntry('sent', 's1', 'a');
  assert.deepEqual(parseEntries(JSON.stringify([ok, { id: 1 }, { ...ok, kind: 'nope' }])), [ok]);
});
