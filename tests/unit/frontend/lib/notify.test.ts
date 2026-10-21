import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ApprovalRequest, ReminderItem } from '../../../../contracts/ipc.ts';
import {
  approvalHistoryEntry,
  buildApprovalReminderItems,
  mergeApprovalHistory,
  selectPopupReminderItems,
  unresolvedReminderCount,
  type ApprovalHistoryEntry,
} from '../../../../src/frontend/lib/notify.ts';

const approval = (id: string, patch: Partial<ApprovalRequest> = {}): ApprovalRequest => ({
  id,
  sessionId: 's1',
  toolCallId: `call-${id}`,
  kind: 'command',
  command: `npm run ${id}`,
  shell: 'bash',
  ...patch,
});

const item = (id: string, patch: Partial<ReminderItem> = {}): ReminderItem => ({
  id,
  level: 'P0',
  source: 'approval',
  title: `事项 ${id}`,
  createdAt: '2026-10-21T10:00:00.000Z',
  state: 'active',
  sessionId: 's1',
  approvalId: id,
  ...patch,
});

test('buildApprovalReminderItems：审批恒为 P0，按 approvalId 去重', () => {
  const items = buildApprovalReminderItems([
    approval('a1'),
    approval('a1', { command: '重复投递不应覆盖第一条' }),
    approval('a2', { kind: 'edit', path: 'src/a.ts', diff: '+一行\n-一行' }),
  ], { now: '2026-10-21T10:00:00.000Z' });

  assert.equal(items.length, 2);
  assert.deepEqual(items.map((i) => i.approvalId), ['a1', 'a2']);
  assert.ok(items.every((i) => i.level === 'P0' && i.source === 'approval' && i.state === 'active'));
  assert.equal(items[0]?.body, 'npm run a1');
  assert.match(items[1]?.body ?? '', /src\/a\.ts（\+1 −1 行）/);
});

test('buildApprovalReminderItems：按首次出现时间排队，同时间保持到达顺序', () => {
  const firstSeenAt = new Map([
    ['b', '2026-10-21T10:00:03.000Z'],
    ['a', '2026-10-21T10:00:01.000Z'],
    ['c', '2026-10-21T10:00:02.000Z'],
    ['d', '2026-10-21T10:00:02.000Z'],
  ]);
  const items = buildApprovalReminderItems(
    [approval('b'), approval('a'), approval('c'), approval('d')],
    { firstSeenAt },
  );
  assert.deepEqual(items.map((i) => i.id), ['a', 'c', 'd', 'b']);
});

test('已解决撤下：从待批集合移除后重建结果中不再出现，计数同步下降（FR-505/514）', () => {
  const firstSeenAt = new Map([
    ['a1', '2026-10-21T10:00:00.000Z'],
    ['a2', '2026-10-21T10:00:01.000Z'],
  ]);
  const before = buildApprovalReminderItems([approval('a1'), approval('a2')], { firstSeenAt });
  assert.equal(unresolvedReminderCount(before), 2);

  // 模拟 approval-resolved 后 store 删除 a1；重启后也只按尚待批集合重建。
  const after = buildApprovalReminderItems([approval('a2')], { firstSeenAt });
  assert.deepEqual(after.map((i) => i.id), ['a2']);
  assert.equal(unresolvedReminderCount(after), 1);
  assert.equal(after[0]?.createdAt, '2026-10-21T10:00:01.000Z');
});

test('selectPopupReminderItems：收起与抑制不弹，超上限折叠 overflow', () => {
  const items = ['a', 'b', 'c', 'd', 'e'].map((id) => item(id));
  const picked = selectPopupReminderItems(items, {
    dismissedIds: new Set(['a']),
    suppressedIds: new Set(['b']),
    limit: 2,
  });
  assert.deepEqual(picked.visible.map((i) => i.id), ['c', 'd']);
  assert.deepEqual(picked.overflow.map((i) => i.id), ['e']);
  assert.deepEqual(picked.suppressed.map((i) => i.id), ['b']);
  assert.deepEqual(picked.dismissed.map((i) => i.id), ['a']);
});

test('selectPopupReminderItems：resolved/read 不进弹窗，snoozed 仍未消解', () => {
  const items = [
    item('done', { state: 'resolved' }),
    item('seen', { state: 'read' }),
    item('later', { state: 'snoozed' }),
  ];
  const picked = selectPopupReminderItems(items);
  assert.deepEqual(picked.visible.map((i) => i.id), ['later']);
  assert.equal(unresolvedReminderCount(items), 1);
});

test('approvalHistoryEntry：解决前从请求生成摘要，含会话与决定信息', () => {
  const entry = approvalHistoryEntry(approval('a9', { command: 'npm run test' }), false, 1234, '会话甲');
  assert.equal(entry.id, 'a9');
  assert.equal(entry.sessionId, 's1');
  assert.equal(entry.sessionTitle, '会话甲');
  assert.equal(entry.approved, false);
  assert.equal(entry.at, 1234);
  assert.match(entry.summary, /npm run test/);
});

test('mergeApprovalHistory：同 id 取较新一条，时间倒序并封顶', () => {
  const hist = (id: string, at: number, approved = true): ApprovalHistoryEntry => ({
    id, sessionId: 's1', sessionTitle: '', approved, at, kind: 'command', summary: id,
  });
  const merged = mergeApprovalHistory(
    [hist('old', 1), hist('dup', 5, true)],
    [hist('new', 9), hist('dup', 7, false)],
    2,
  );
  assert.deepEqual(merged.map((e) => e.id), ['new', 'dup']);
  assert.equal(merged[1]?.approved, false);
});

/* ── 历史落盘：每例用带查询串的动态 import 取独立模块实例 ── */

interface NotifyModule {
  listApprovalHistory: () => ApprovalHistoryEntry[];
  recordApprovalHistory: (entry: ApprovalHistoryEntry) => ApprovalHistoryEntry[];
  recordApprovalResolution: (req: ApprovalRequest, approved: boolean, sessionTitle?: string, at?: number) => ApprovalHistoryEntry[];
}

const freshNotify = async (tag: string): Promise<NotifyModule> => {
  const spec = `../../../../src/frontend/lib/notify.ts?test=${tag}`;
  return (await import(spec)) as NotifyModule;
};

interface FakeStorage {
  value: string | null;
  getItem: () => string | null;
  setItem: (_key: string, v: string) => void;
  removeItem: () => void;
}

const makeStorage = (initial: string | null): FakeStorage => {
  const fake: FakeStorage = {
    value: initial,
    getItem: () => fake.value,
    setItem: (_key, v) => { fake.value = v; },
    removeItem: () => { fake.value = null; },
  };
  return fake;
};

const installStorage = (fake: FakeStorage): void => {
  (globalThis as { localStorage?: unknown }).localStorage = fake;
};

test('历史落盘：记录后写 localStorage，重复记录同 id 只保留一条', async () => {
  const mod = await freshNotify('record');
  const fake = makeStorage(null);
  installStorage(fake);
  mod.recordApprovalResolution(approval('r1', { command: 'npm run build' }), true, '会话甲', 100);
  mod.recordApprovalResolution(approval('r1', { command: 'npm run build' }), false, '会话甲', 200);
  const list = mod.listApprovalHistory();
  assert.equal(list.length, 1);
  assert.equal(list[0]?.approved, false);
  const stored = JSON.parse(fake.value ?? '[]') as ApprovalHistoryEntry[];
  assert.equal(stored.length, 1);
  assert.equal(stored[0]?.id, 'r1');
});

test('历史加载校验：损坏条目被丢弃，整体损坏回退空列表', async () => {
  const mod = await freshNotify('mixed');
  const stored: unknown[] = [
    { id: 'ok', sessionId: 's1', sessionTitle: '标题', approved: true, at: 3, kind: 'command', summary: 'x' },
    { id: 'bad-kind', sessionId: 's1', approved: true, at: 2, kind: 'nope', summary: 'x' },
    { id: 'bad-at', sessionId: 's1', approved: true, at: '3', kind: 'command', summary: 'x' },
    null,
    'junk',
  ];
  installStorage(makeStorage(JSON.stringify(stored)));
  assert.deepEqual(mod.listApprovalHistory().map((e) => e.id), ['ok']);

  const corrupt = await freshNotify('corrupt');
  installStorage(makeStorage('{broken'));
  assert.deepEqual(corrupt.listApprovalHistory(), []);
});
