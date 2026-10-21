import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BoardCardStatus, ReminderItem } from '../../../../contracts/ipc.ts';
import {
  applyReminderTransition,
  buildCardProgress,
  cardReminderId,
  diffReminderSnapshot,
  pendingBadgeCount,
  progressStageIndex,
  recordCardStatusTimes,
  selectExtraPopups,
  selectExtraToasts,
  sessionReminderId,
  type CardProgressInput,
  type CardStatusTime,
  type ObservedSnapshot,
} from '../../../../src/frontend/lib/notify-diff.ts';

const NOW = '2026-10-21T11:00:00.000Z';
const LATER = '2026-10-21T11:05:00.000Z';

function snap(
  cards: Record<string, BoardCardStatus> = {},
  errorSessions: string[] = [],
): ObservedSnapshot {
  return {
    cards: new Map(Object.entries(cards).map(([id, status]) => [id, { status, title: `卡片 ${id}` }])),
    errorSessions: new Map(errorSessions.map((id) => [id, { title: `会话 ${id}`, summary: '出错了：boom' }])),
  };
}

/** 把变迁序列应用到活动集合（模拟喂数器的持有方式）。 */
function run(snaps: ObservedSnapshot[]): Map<string, ReminderItem> {
  const active = new Map<string, ReminderItem>();
  let prev: ObservedSnapshot | null = null;
  for (const s of snaps) {
    applyReminderTransition(active, diffReminderSnapshot(prev, s, NOW));
    prev = s;
  }
  return active;
}

test('基线：首次喂入只建基线，满屏目标状态也产生 0 条事项', () => {
  const t = diffReminderSnapshot(null, snap({ 'T-001': 'blocked', 'T-002': 'review', 'T-003': 'ready' }, ['s1']), NOW);
  assert.deepEqual(t, { added: [], resolvedIds: [] });
});

test('卡片进入 blocked → P1，进入 review → P2，进入 ready → P3', () => {
  const base = snap({ 'T-001': 'active', 'T-002': 'active', 'T-003': 'active' });
  const t = diffReminderSnapshot(base, snap({ 'T-001': 'blocked', 'T-002': 'review', 'T-003': 'ready' }), NOW);
  assert.equal(t.added.length, 3);
  const byId = new Map(t.added.map((i) => [i.id, i]));
  assert.equal(byId.get(cardReminderId('T-001', 'blocked'))?.level, 'P1');
  assert.equal(byId.get(cardReminderId('T-001', 'blocked'))?.source, 'card');
  assert.equal(byId.get(cardReminderId('T-001', 'blocked'))?.cardId, 'T-001');
  assert.equal(byId.get(cardReminderId('T-002', 'review'))?.level, 'P2');
  assert.equal(byId.get(cardReminderId('T-003', 'ready'))?.level, 'P3');
  assert.equal(t.resolvedIds.length, 0);
});

test('持续：同状态重复快照产生 0 条新事项、0 条消解', () => {
  const base = snap({ 'T-001': 'active' });
  const entered = snap({ 'T-001': 'blocked' });
  const active = run([base, entered]);
  assert.equal(active.size, 1);
  const t = diffReminderSnapshot(entered, snap({ 'T-001': 'blocked' }), LATER);
  assert.deepEqual(t, { added: [], resolvedIds: [] });
});

test('离开：状态恢复后事项消解；卡片从快照消失同样消解', () => {
  const base = snap({ 'T-001': 'active', 'T-002': 'active' });
  const entered = snap({ 'T-001': 'blocked', 'T-002': 'review' });
  const left = snap({ 'T-001': 'active' }); // T-001 恢复、T-002 消失
  const t = diffReminderSnapshot(entered, left, LATER);
  assert.deepEqual(t.resolvedIds, [cardReminderId('T-001', 'blocked'), cardReminderId('T-002', 'review')]);
  const active = run([base, entered, left]);
  assert.equal(active.size, 0);
});

test('再次进入：离开后重新进入目标状态可再产生（同 id、视为新事项）', () => {
  const active = run([
    snap({ 'T-001': 'active' }),
    snap({ 'T-001': 'blocked' }),
    snap({ 'T-001': 'active' }),
    snap({ 'T-001': 'blocked' }),
  ]);
  assert.equal(active.size, 1);
  assert.ok(active.has(cardReminderId('T-001', 'blocked')));
});

test('状态间直转：blocked → review 时旧事项消解、新事项产生', () => {
  const t = diffReminderSnapshot(snap({ 'T-001': 'blocked' }), snap({ 'T-001': 'review' }), LATER);
  assert.deepEqual(t.resolvedIds, [cardReminderId('T-001', 'blocked')]);
  assert.deepEqual(t.added.map((i) => i.id), [cardReminderId('T-001', 'review')]);
});

test('非目标状态（active / merged）永不产生事项', () => {
  const t = diffReminderSnapshot(snap({ 'T-001': 'blocked' }), snap({ 'T-001': 'merged', 'T-002': 'active' }), LATER);
  assert.deepEqual(t.added, []);
  assert.deepEqual(t.resolvedIds, [cardReminderId('T-001', 'blocked')]);
});

test('会话出错：进入 → P1（source session），持续不重复，恢复消解，再次出错再产生', () => {
  const t1 = diffReminderSnapshot(snap(), snap({}, ['s1']), NOW);
  assert.equal(t1.added.length, 1);
  assert.equal(t1.added[0]?.level, 'P1');
  assert.equal(t1.added[0]?.source, 'session');
  assert.equal(t1.added[0]?.sessionId, 's1');
  assert.equal(t1.added[0]?.body, '出错了：boom');
  const active = run([snap(), snap({}, ['s1']), snap({}, ['s1']), snap(), snap({}, ['s1'])]);
  assert.equal(active.size, 1);
  assert.ok(active.has(sessionReminderId('s1')));
  const t2 = diffReminderSnapshot(snap({}, ['s1']), snap(), LATER);
  assert.deepEqual(t2.resolvedIds, [sessionReminderId('s1')]);
});

test('呈现集合：弹窗只有 P1；P2 只轻提示；P3 两边都不进（弹窗数恒 0）', () => {
  const active = run([
    snap({ 'T-001': 'active', 'T-002': 'active', 'T-003': 'active' }),
    snap({ 'T-001': 'blocked', 'T-002': 'review', 'T-003': 'ready' }),
  ]);
  const items = [...active.values()];
  assert.deepEqual(selectExtraPopups(items).map((i) => i.level), ['P1']);
  assert.deepEqual(selectExtraToasts(items).map((i) => i.level), ['P2']);
  // SC-004 前端断言：P3 事项产生的弹窗数为 0（也不进轻提示）。
  assert.equal(selectExtraPopups(items.filter((i) => i.level === 'P3')).length, 0);
  assert.equal(selectExtraToasts(items.filter((i) => i.level === 'P3')).length, 0);
  // P1 稍后（snoozed）退出弹窗集合。
  const snoozed = items.map((i) => (i.level === 'P1' ? { ...i, state: 'snoozed' as const } : i));
  assert.equal(selectExtraPopups(snoozed).length, 0);
});

test('progressStageIndex：四段顺序映射，blocked 为异常态 -1', () => {
  assert.equal(progressStageIndex('ready'), 0);
  assert.equal(progressStageIndex('active'), 1);
  assert.equal(progressStageIndex('review'), 2);
  assert.equal(progressStageIndex('merged'), 3);
  assert.equal(progressStageIndex('blocked'), -1);
});

const statusMap = (cards: Record<string, BoardCardStatus>) =>
  new Map(Object.entries(cards).map(([id, status]) => [id, { status }]));

test('recordCardStatusTimes：基线不记录；变迁亲历记录；未变保留；消失清除', () => {
  // 基线（应用启动首次观察）：不写记录。
  const base = recordCardStatusTimes(new Map(), statusMap({ 'T-001': 'active' }), NOW, true);
  assert.equal(base.times.size, 0);
  assert.equal(base.changed, false);
  // 基线后进入新状态：以亲历时间记录。
  const entered = recordCardStatusTimes(base.times, statusMap({ 'T-001': 'review' }), LATER, false);
  assert.deepEqual(entered.times.get('T-001'), { status: 'review', at: LATER });
  assert.equal(entered.changed, true);
  // 状态未变：保留原记录、不算变化。
  const kept = recordCardStatusTimes(entered.times, statusMap({ 'T-001': 'review' }), '2026-10-21T11:09:00.000Z', false);
  assert.deepEqual(kept.times.get('T-001'), { status: 'review', at: LATER });
  assert.equal(kept.changed, false);
  // 卡片消失：记录清除。
  const pruned = recordCardStatusTimes(entered.times, statusMap({}), LATER, false);
  assert.equal(pruned.times.size, 0);
  assert.equal(pruned.changed, true);
});

const progCard = (id: string, patch: Partial<CardProgressInput> = {}): CardProgressInput => ({
  id,
  title: `卡片 ${id}`,
  lane: 'frontend',
  assignee: 'worker',
  status: 'active',
  ahead: null,
  merge: null,
  ...patch,
});

test('buildCardProgress：字段原文直用与排序（受阻→待审查→进行中→待派发）', () => {
  const rows = buildCardProgress([
    progCard('T-003', { status: 'ready', assignee: '（待派发）', ahead: 0 }),
    progCard('T-001', { status: 'blocked', assignee: '', lane: 'backend' }),
    progCard('T-002', { status: 'review', ahead: 3 }),
    progCard('T-004', { status: 'active' }),
  ], new Map());
  assert.deepEqual(rows.map((r) => r.cardId), ['T-001', 'T-002', 'T-004', 'T-003']);
  assert.equal(rows[0]?.blocked, true);
  assert.equal(rows[0]?.stageIndex, -1);
  assert.equal(rows[0]?.assignee, ''); // 空原文照用
  assert.equal(rows[1]?.ahead, 3);
  assert.equal(rows[3]?.assignee, '（待派发）');
});

test('buildCardProgress：时间戳三口径——亲历 / 合入兜底 / 打开前（不编造）', () => {
  const times = new Map<string, CardStatusTime>([
    ['T-001', { status: 'review', at: LATER }],
    ['T-002', { status: 'active', at: LATER }], // 与当前 status 不符 → 不算亲历
  ]);
  const rows = buildCardProgress([
    progCard('T-001', { status: 'review' }),
    progCard('T-002', { status: 'review' }),
    progCard('T-003', { status: 'merged', merge: { time: '2026-10-20T09:00:00.000Z' } }),
    progCard('T-004', { status: 'ready' }),
  ], times);
  const byId = new Map(rows.map((r) => [r.cardId, r]));
  assert.equal(byId.get('T-001')?.statusSinceKind, 'witnessed');
  assert.equal(byId.get('T-001')?.statusSince, LATER);
  assert.equal(byId.get('T-002')?.statusSinceKind, 'preexisting');
  assert.equal(byId.get('T-002')?.statusSince, null);
  assert.equal(byId.get('T-003')?.statusSinceKind, 'merge');
  assert.equal(byId.get('T-003')?.statusSince, '2026-10-20T09:00:00.000Z');
  assert.equal(byId.get('T-004')?.statusSinceKind, 'preexisting');
  assert.equal(byId.get('T-004')?.statusSince, null);
});

test('角标计数口径：P0 待批 + P1 活动（含稍后）+ P2/P3 未读；已读不计', () => {
  const p0: ReminderItem[] = [{
    id: 'ap-1', level: 'P0', source: 'approval', title: '审批', createdAt: NOW, state: 'active', sessionId: 's1', approvalId: 'ap-1',
  }];
  const extras: ReminderItem[] = [
    { id: 'card:T-001:blocked', level: 'P1', source: 'card', title: '受阻', createdAt: NOW, state: 'snoozed', cardId: 'T-001' },
    { id: 'card:T-002:review', level: 'P2', source: 'card', title: '待审查', createdAt: NOW, state: 'read', cardId: 'T-002' },
    { id: 'card:T-003:ready', level: 'P3', source: 'card', title: 'ready', createdAt: NOW, state: 'active', cardId: 'T-003' },
  ];
  assert.equal(pendingBadgeCount(p0, extras), 3);
  assert.equal(pendingBadgeCount([], []), 0);
});
