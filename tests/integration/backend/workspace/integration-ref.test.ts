import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBoard, readAgentsConfig } from '../../../../src/backend/workspace/board.ts';
import { readGitSnapshot, resolveIntegrationRef } from '../../../../src/backend/workspace/git-overview.ts';
import { createGitRunner } from '../../../../src/backend/workspace/git.ts';
import { tempProject } from '../helpers/temp-project.ts';
import { gitIn, writeFiles } from '../helpers/temp-repo.ts';

const card = (id: string, lane: string, branch: string, deps: string, status: string) => `# ${id} 任务 ${id}

| 字段 | 值 |
|---|---|
| 泳道 | ${lane} |
| 对应需求 | FR-001 |
| 包含任务号 | T001 |
| 分支 | \`${branch}\` |
| PR 目标 | \`dev\` |
| 前置任务 | ${deps} |
| 状态 | ${status} |
| 执行者 | codex |

## 目标

做 ${id}。

## 验收标准

- [x] 通过
`;

/** 建一个「本地无集成分支、只有 origin/<分支>」的仓库（典型：只 fetch 未 checkout）。 */
async function remoteOnlyRepo(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await tempProject(t, {
    '.agents/lanes.conf': 'contracts contracts/*\nbackend src/backend/*\n',
    '.agents/config.sh': 'MAIN_BRANCH="main"\nINTEGRATION_BRANCH="dev"\nMAX_PARALLEL=4\nBRANCH_PREFIX="feat"\n',
    'docs/tasks/T-001.md': card('T-001', 'contracts', 'feat/contracts/T-001-spec', '无', 'done'),
    'docs/tasks/T-002.md': card('T-002', 'backend', 'feat/backend/T-002-core', 'T-001', 'done'),
    'docs/tasks/BOARD.md': '| 编号 | 标题 | 泳道 | 前置 | 状态 | 执行者 | PR |\n|---|---|---|---|---|---|---|\n| T-001 | 任务 | contracts | 无 | done | codex | — |\n| T-002 | 任务 | backend | T-001 | done | codex | — |\n',
    'README.md': '# demo\n',
  });
  const git = gitIn(root);
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  git('checkout', '-q', '-b', 'dev');
  // T-001 合入 dev 后删除分支
  git('checkout', '-q', '-b', 'feat/contracts/T-001-spec');
  await writeFiles(root, { 'contracts/api.ts': 'export {};\n' });
  git('add', '-A');
  git('commit', '-q', '-m', 'contracts');
  git('checkout', '-q', 'dev');
  git('merge', '--no-ff', '-q', '-m', 'merge: feat/contracts/T-001-spec', 'feat/contracts/T-001-spec');
  git('branch', '-d', 'feat/contracts/T-001-spec');
  // 造一个「远端」：把 dev 推到裸仓库，再删掉本地 dev，只留 origin/dev
  const bare = await tempProject(t, { 'keep.txt': 'x' });
  git('init', '-q', '--bare', bare);
  git('remote', 'add', 'origin', bare);
  git('push', '-q', 'origin', 'dev');
  git('checkout', '-q', '-b', 'work');
  git('branch', '-D', 'dev');
  git('checkout', '-q', 'work');
  return { root, git, bare };
}

test('resolveIntegrationRef prefers the local branch, falls back to origin/<branch>', async (t) => {
  const { root, git } = await remoteOnlyRepo(t);
  const runner = createGitRunner(root);
  // 本地已删 dev，但 origin/dev 还在 → 回退到 origin/dev
  const ref = await resolveIntegrationRef(runner, 'dev');
  assert.equal(ref?.ref, 'origin/dev');
  assert.equal(ref?.remote, true);
  // 不存在的分支 → null
  assert.equal(await resolveIntegrationRef(runner, 'nope'), null);
  // 本地存在时优先本地
  git('branch', 'dev', 'work');
  const local = await resolveIntegrationRef(runner, 'dev');
  assert.equal(local?.ref, 'dev');
  assert.equal(local?.remote, false);
});

test('board falls back to origin/<integration> so merged cards are not falsely flagged', async (t) => {
  const { root } = await remoteOnlyRepo(t);
  const git = createGitRunner(root);
  const snap = await readGitSnapshot(git, root, await readAgentsConfig(root), 'now', (d) => createGitRunner(d));
  assert.equal(snap.available, true);
  assert.equal(snap.integrationRef, 'origin/dev');
  assert.equal(snap.integrationRefRemote, true);
  // 关键：回退后仍能读到 dev 上的合并记录（不回退时为 0）
  assert.equal(snap.merges.length, 1);
  assert.equal(snap.merges[0]?.branch, 'feat/contracts/T-001-spec');

  const b = await buildBoard(root, git, snap, 'now');
  assert.equal(b.integrationRef, 'origin/dev');
  assert.equal(b.integrationRefRemote, true);
  assert.equal(b.integrationMissing, null);
  // T-001 已合入 → 不应报「未合入」
  const t1 = b.cards.find((c) => c.id === 'T-001');
  assert.equal(t1?.status, 'merged');
  assert.equal(t1?.declaredMismatch, false);
  // T-002 确实未合入 → 仍要报，且只有一条
  assert.equal(b.cards.find((c) => c.id === 'T-002')?.declaredMismatch, true);
  assert.equal(b.conflicts.filter((c) => c.includes('未合入')).length, 1);
});

test('board reports one root cause when the integration branch exists nowhere', async (t) => {
  const { root, git: g } = await remoteOnlyRepo(t);
  // 远端也删掉 → 本地与 origin 都没有 dev
  g('remote', 'remove', 'origin');
  const git = createGitRunner(root);
  const snap = await readGitSnapshot(git, root, await readAgentsConfig(root), 'now', (d) => createGitRunner(d));
  assert.equal(snap.integrationRefRemote, false);
  assert.equal(snap.merges.length, 0);

  const b = await buildBoard(root, git, snap, 'now');
  // 根因提示：说明集成分支不可用
  assert.match(b.integrationMissing ?? '', /集成分支 dev 在本地与 origin 均不存在/);
  // 34 条「未合入」合并为一条，且带上根因
  const unmerged = b.conflicts.filter((c) => c.includes('未合入') || c.includes('无法据此判定'));
  assert.equal(unmerged.length, 1);
  assert.match(unmerged[0] ?? '', /集成分支 dev 在本地与 origin 均不存在/);
  assert.match(unmerged[0] ?? '', /T-001/);
});
