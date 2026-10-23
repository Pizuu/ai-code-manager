import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GitSnapshot } from '../../../../contracts/ipc.ts';
import { GEOM, layoutGraph } from '../../../../src/frontend/lib/git-graph.ts';

const c = (sha: string, parents: string[], subject = sha) => ({ sha, short: sha.slice(0, 7), parents, author: 'a', time: '2026-10-20T10:00:00+08:00', subject, refs: [] });
// 新 → 旧：main=A；dev = A → B(合入 feat/x，二父 X1) → C；feat/y 从 C 分出 Y1（未合入）
const snap: GitSnapshot = {
  available: true, generatedAt: 'now', currentBranch: 'dev', integrationBranch: 'dev', mainBranch: 'main', integrationHead: 'ccccccc', mainHead: 'aaaaaaa',
  integrationRef: 'dev', integrationRefRemote: false,
  integrationAheadOfMain: 3, mainAheadOfIntegration: 0,
  branches: [
    { name: 'main', sha: 'aaaaaaa1', short: 'aaaaaaa', time: '', subject: '', kind: 'main', lane: null, task: null, ahead: 0, behind: 3, mergedIntoIntegration: true, worktree: null, current: false },
    { name: 'dev', sha: 'ccccccc1', short: 'ccccccc', time: '', subject: '', kind: 'integration', lane: null, task: null, ahead: 0, behind: 0, mergedIntoIntegration: true, worktree: null, current: true },
    { name: 'feat/frontend/T-2-y', sha: 'yyyyyyy1', short: 'yyyyyyy', time: '', subject: '', kind: 'worker', lane: 'frontend', task: 'T-2', ahead: 1, behind: 0, mergedIntoIntegration: false, worktree: null, current: false },
  ],
  commits: [c('yyyyyyy1', ['ccccccc1']), c('ccccccc1', ['bbbbbbb1']), c('bbbbbbb1', ['aaaaaaa1', 'xxxxxxx1'], 'merge: feat/backend/T-1-x'), c('xxxxxxx1', ['aaaaaaa1']), c('aaaaaaa1', [])],
  merges: [{ sha: 'bbbbbbb1', short: 'bbbbbbb', time: '', subject: 'merge: feat/backend/T-1-x', branch: 'feat/backend/T-1-x', tip: 'xxxxxxx', commitCount: 1 }],
  mainMerges: [], worktrees: [], tags: [], remotes: [], dirtyCount: 0, pullRequests: null, ci: null,
};

test('rows: main, integration, deleted merged branch restored from merge parent, open branch', () => {
  const lay = layoutGraph(snap, 1000);
  assert.deepEqual(lay.rows.map((r) => [r.name, r.state, r.own.length]), [['main', 'open', 1], ['dev', 'open', 2], ['feat/backend/T-1-x', 'merged', 1], ['feat/frontend/T-2-y', 'open', 1]]);
  assert.equal(lay.rows[2]?.label, 'T-1 · 已合入');
  assert.equal(lay.rows[2]?.color, '#6D8170');
  assert.equal(lay.rows[3]?.color, '#B47C59');
  assert.equal(lay.height, GEOM.T + 4 * GEOM.RH + 4);
});

test('nodes are ordered left to right by topo order and merges are marked', () => {
  const lay = layoutGraph(snap, 1000);
  const xs = lay.nodes.map((n) => n.x);
  assert.deepEqual([...xs].sort((a, b) => a - b), xs);
  const merge = lay.nodes.find((n) => n.sha === 'bbbbbbb1');
  assert.equal(merge?.isMerge, true);
  assert.equal(merge?.showSha, true);
  assert.equal(merge?.y, GEOM.T + GEOM.RH);
  assert.ok(lay.texts.some((t) => t.text.startsWith('HEAD · dev ccccccc')));
  assert.ok(lay.texts.some((t) => t.text.includes('dev → main 尚未发起')));
  // 分出与合入各有一条曲线
  assert.ok(lay.edges.filter((e) => e.d.includes(' C')).length >= 2);
});
