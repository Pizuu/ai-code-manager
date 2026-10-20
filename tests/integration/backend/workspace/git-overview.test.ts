import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readAgentsConfig } from '../../../../src/backend/workspace/board.ts';
import { laneOfBranch, parsePorcelainWorktrees, readGitSnapshot } from '../../../../src/backend/workspace/git-overview.ts';
import { createGitRunner } from '../../../../src/backend/workspace/git.ts';
import { tempProject } from '../helpers/temp-project.ts';
import { laneRepo } from './repo-fixture.ts';

test('reads branches, ahead/behind, merges of deleted branches, worktrees and dirty files', async (t) => {
  const { root, git } = await laneRepo(t);
  const wt = `${root}-wt`;
  t.after(() => fs.rm(wt, { recursive: true, force: true }));
  git('worktree', 'add', '-q', '-b', 'feat/frontend/T-004-more', wt, 'hark-dev');
  await fs.writeFile(path.join(root, 'scratch.txt'), 'dirty');
  const snap = await readGitSnapshot(createGitRunner(root), root, await readAgentsConfig(root), 'now', (d) => createGitRunner(d));
  assert.equal(snap.available, true);
  assert.equal(snap.currentBranch, 'hark-dev');
  assert.equal(snap.integrationAheadOfMain, 2); // 契约提交 + 合并提交
  const br = Object.fromEntries(snap.branches.map((b) => [b.name, b]));
  assert.equal(br['hark-dev']?.kind, 'integration');
  assert.equal(br.main?.kind, 'main');
  assert.equal(br['feat/backend/T-002-core']?.ahead, 2);
  assert.equal(br['feat/backend/T-002-core']?.behind, 0);
  assert.equal(br['feat/backend/T-002-core']?.lane, 'backend');
  assert.equal(br['feat/backend/T-002-core']?.task, 'T-002');
  assert.equal(br['feat/frontend/T-004-more']?.worktree?.endsWith('-wt'), true);
  assert.equal(snap.merges.length, 1);
  assert.equal(snap.merges[0]?.branch, 'feat/contracts/T-001-spec');
  assert.equal(snap.merges[0]?.commitCount, 1);
  assert.equal(snap.worktrees.length, 2);
  assert.equal(snap.worktrees[0]?.isMain, true);
  assert.equal(snap.dirtyCount, 1);
  assert.equal(snap.pullRequests, null);
  assert.equal(snap.ci, null);
  assert.deepEqual(snap.remotes, []);
  assert.ok(snap.commits.length >= 5);
  assert.ok(snap.commits.every((c) => /^[0-9a-f]{40}$/.test(c.sha)));
});

test('non-repository directories produce an unavailable snapshot', async (t) => {
  const root = await tempProject(t, { 'a.txt': 'x' });
  const snap = await readGitSnapshot(createGitRunner(root), root, await readAgentsConfig(root), 'now', (d) => createGitRunner(d));
  assert.equal(snap.available, false);
  assert.match(snap.reason ?? '', /不是 Git 仓库/);
});

test('helpers: branch lane parsing and porcelain worktrees', () => {
  assert.deepEqual(laneOfBranch('feat/docs/T-009-user-docs', 'feat'), { lane: 'docs', task: 'T-009' });
  assert.deepEqual(laneOfBranch('int/T-010-closeout', 'feat'), { lane: '@shared', task: 'T-010' });
  assert.deepEqual(laneOfBranch('main', 'feat'), { lane: null, task: null });
  assert.deepEqual(parsePorcelainWorktrees('worktree /a\nHEAD abc\nbranch refs/heads/dev\n\nworktree /b\nHEAD def\ndetached\n'), [
    { path: '/a', head: 'abc', branch: 'dev' }, { path: '/b', head: 'def', branch: null },
  ]);
});
