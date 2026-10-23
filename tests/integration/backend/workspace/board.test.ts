import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBoard, readAgentsConfig } from '../../../../src/backend/workspace/board.ts';
import { readGitSnapshot } from '../../../../src/backend/workspace/git-overview.ts';
import { createGitRunner } from '../../../../src/backend/workspace/git.ts';
import { tempProject } from '../helpers/temp-project.ts';
import { laneDocsRepo, laneRepo } from './repo-fixture.ts';

async function board(root: string) {
  const git = createGitRunner(root);
  const snap = await readGitSnapshot(git, root, await readAgentsConfig(root), 'now', (d) => createGitRunner(d));
  return buildBoard(root, git, snap, 'now');
}

test('derives card states from git: merged (branch deleted), review, ready, blocked', async (t) => {
  const { root } = await laneRepo(t);
  const b = await board(root);
  assert.equal(b.available, true);
  assert.equal(b.integrationBranch, 'hark-dev');
  assert.equal(b.maxParallel, 4);
  const by = Object.fromEntries(b.cards.map((c) => [c.id, c]));
  assert.equal(by['T-001']?.status, 'merged');
  assert.match(by['T-001']?.merge?.short ?? '', /^[0-9a-f]{7}$/);
  assert.equal(by['T-001']?.changedFiles, 1);
  assert.equal(by['T-001']?.laneOk, true);
  assert.equal(by['T-002']?.status, 'review');
  assert.equal(by['T-002']?.ahead, 2);
  assert.equal(by['T-002']?.laneOk, false);
  assert.equal(by['T-003']?.status, 'blocked');
  assert.deepEqual(by['T-003']?.unmetDeps, ['T-002']);
  assert.equal(by['T-004']?.status, 'ready');
  assert.equal(b.feature?.id, '001-demo');
  assert.equal(b.feature?.tasksDone, 1);
  assert.equal(b.feature?.tasksTotal, 2);
});

test('flags BOARD/task-card "done" that git does not confirm', async (t) => {
  const { root } = await laneRepo(t);
  const b = await board(root);
  const t2 = b.cards.find((c) => c.id === 'T-002');
  assert.equal(t2?.declaredMismatch, true);
  assert.equal(b.cards.find((c) => c.id === 'T-001')?.declaredMismatch, false);
  assert.ok(b.conflicts.some((c) => c.startsWith('T-002') && c.includes('未合入')));
  assert.ok(b.conflicts.some((c) => c.includes('越出泳道')));
});

test('lane check exempts the card\'s own paperwork (its task card + BOARD.md) only', async (t) => {
  const { root } = await laneDocsRepo(t);
  const b = await board(root);
  const by = Object.fromEntries(b.cards.map((c) => [c.id, c]));
  const laneConflict = (id: string) => b.conflicts.some((c) => c.startsWith(id) && c.includes('越出泳道'));
  // (1) 本卡任务卡 + BOARD.md + 本泳道文件：文书被豁免，其余文件在泳道内 → 不报越界
  assert.equal(by['T-101']?.changedFiles, 3);
  assert.equal(by['T-101']?.laneOk, true);
  assert.equal(laneConflict('T-101'), false);
  // (2) 他卡任务卡文件不在豁免内 → 仍报越界
  assert.equal(by['T-102']?.laneOk, false);
  assert.equal(laneConflict('T-102'), true);
  // (3) 越界代码文件 → 仍报越界
  assert.equal(by['T-103']?.laneOk, false);
  assert.equal(laneConflict('T-103'), true);
  // 剔除文书后无待检文件 → laneOk 为 null、不报
  assert.equal(by['T-104']?.changedFiles, 2);
  assert.equal(by['T-104']?.laneOk, null);
  assert.equal(laneConflict('T-104'), false);
});

test('projects without lanes.conf get an empty, non-error board', async (t) => {
  const root = await tempProject(t, { 'README.md': 'x' });
  const b = await board(root);
  assert.equal(b.available, false);
  assert.match(b.reason ?? '', /lanes\.conf/);
});
