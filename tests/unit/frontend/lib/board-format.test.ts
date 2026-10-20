import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { BoardCard, BoardSnapshot } from '../../../../contracts/ipc.ts';
import { cardLines, countBy, filterCards, frShort, laneRows, uniqueAssignees } from '../../../../src/frontend/lib/board-format.ts';

const snap = JSON.parse(fs.readFileSync(new URL('../../../../contracts/fixtures/board.sample.json', import.meta.url), 'utf8')) as BoardSnapshot;
const merged = snap.cards[0] as BoardCard;
const ready = snap.cards[1] as BoardCard;

test('card lines follow the prototype rules for each status', () => {
  assert.deepEqual(cardLines(merged, snap), { hot: false, r3: '无 PR（本地分支） · 已合入 hark-dev', r4: 'merge 34a277a · 27 个文件 · lane ✓', r4Class: 'grn' });
  assert.equal(cardLines(ready, snap).r3, 'T-010 已合入 ✓');
  const active = { ...ready, status: 'review' as const, ahead: 3, changedFiles: 0, laneOk: false };
  assert.deepEqual(cardLines(active, snap), { hot: true, r3: '无 PR（本地分支） · 领先 hark-dev 3 提交', r4: '暂无改动 · lane ✗ 越界', r4Class: 'acc' });
  const blocked = { ...ready, status: 'blocked' as const, unmetDeps: ['T-009', 'T-010'] };
  assert.equal(cardLines(blocked, snap).r3, '等待 T-009、T-010 合入 hark-dev');
  assert.equal(cardLines(blocked, snap).r4Class, 'amb');
});

test('FR short label, filters, counts and lane rows', () => {
  assert.equal(frShort(merged), 'FR-001');
  assert.equal(frShort({ ...merged, frs: ['FR-1', 'FR-2', 'FR-3', 'FR-4'] }), 'FR-1 / FR-2 +2');
  assert.equal(frShort(ready), '无 FR');
  assert.equal(filterCards(snap.cards, { q: 'e2e', lane: '', agent: '', done: true }).length, 1);
  assert.equal(filterCards(snap.cards, { q: '', lane: '', agent: '', done: false }).length, 1);
  assert.equal(filterCards(snap.cards, { q: '', lane: '', agent: 'coordinator', done: true }).length, 1);
  assert.equal(countBy(snap.cards, 'merged'), 1);
  assert.deepEqual(laneRows(snap), ['contracts', 'backend', '@shared']);
  assert.deepEqual(uniqueAssignees(snap.cards), ['coordinator', '（待派发）']);
});
