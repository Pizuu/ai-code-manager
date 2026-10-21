import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { countChecklist, featureStages, mergedBranchName, parseBoardRows, parseSpec, parseTaskCard } from '../../../../src/backend/workspace/cards.ts';
import { buildBoard, deriveStatuses, directRefsFromCommits } from '../../../../src/backend/workspace/board.ts';
import { parseIntegrationLog } from '../../../../src/backend/workspace/git-overview.ts';
import type { GitRunner } from '../../../../src/backend/workspace/git.ts';
import type { GitSnapshot } from '../../../../contracts/ipc.ts';

const CARD = `# T-008 Diff/终端/Tasks/会话/斜杠命令

| 字段 | 值 |
|---|---|
| 泳道 | frontend |
| 对应需求 | FR-007, FR-008, FR-012（specs/001-agent-desktop/spec.md） |
| 包含任务号 | T026, T027（来自 tasks.md） |
| 分支 | \`feat/frontend/T-008-panels-commands\` |
| PR 目标 | \`dev\` |
| 前置任务 | T-007 |
| 状态 | done |
| 执行者 | claude |

## 目标

右栏三个标签页。

## 验收标准

- [x] 单测通过
- [ ] check-lane 全绿
`;

test('parses a task card', () => {
  const c = parseTaskCard('T-008.md', CARD);
  assert.ok(c);
  assert.equal(c.id, 'T-008');
  assert.equal(c.title, 'Diff/终端/Tasks/会话/斜杠命令');
  assert.equal(c.lane, 'frontend');
  assert.deepEqual(c.frs, ['FR-007', 'FR-008', 'FR-012']);
  assert.deepEqual(c.specTaskIds, ['T026', 'T027']);
  assert.equal(c.branch, 'feat/frontend/T-008-panels-commands');
  assert.equal(c.prTarget, 'dev');
  assert.deepEqual(c.deps, ['T-007']);
  assert.equal(c.declaredStatus, 'done');
  assert.equal(c.goal, '右栏三个标签页。');
  assert.deepEqual(c.acceptance, [{ done: true, text: '单测通过' }, { done: false, text: 'check-lane 全绿' }]);
});

test('parses BOARD rows, spec info, checklists and merge subjects', () => {
  const rows = parseBoardRows('| 编号 | 标题 | 泳道 | 前置 | 状态 | 执行者 | PR |\n|---|---|---|---|---|---|---|\n| T-001 | 冻结 | contracts | 无 | done | coordinator | x |\n');
  assert.equal(rows.get('T-001')?.declaredStatus, 'done');
  const spec = parseSpec('# Feature Specification: 演示\n\n**Status**: Draft\n\n- Q: a → A: b\n- **FR-001**: x\n- **FR-002**: y\n- **SC-001**: z\n');
  assert.deepEqual(spec, { title: '演示', status: 'Draft', frCount: 2, scCount: 1, clarifications: 1 });
  assert.deepEqual(countChecklist('- [x] a\n- [ ] b\n  - [X] c\n'), { done: 2, open: 1 });
  assert.equal(mergedBranchName('merge: feat/backend/T-004-foundation'), 'feat/backend/T-004-foundation');
  assert.equal(mergedBranchName("Merge branch 'int/T-002-toolchain' into dev"), 'int/T-002-toolchain');
  assert.equal(mergedBranchName('Merge pull request #12 from me/feat-x'), 'me/feat-x');
  const stages = featureStages({ constitution: '**版本**：1.1.0', spec, hasPlan: true, checklists: [{ done: 3, open: 1 }], hasTasks: true, analysis: '| A1 | x | y | z | w | v |' });
  assert.equal(stages.find((s) => s.key === 'checklists')?.detail, '3/4');
  assert.equal(stages.find((s) => s.key === 'constitution')?.detail, 'v1.1.0');
  assert.equal(stages.find((s) => s.key === 'analyze')?.detail, '1 项发现');
});

test('derives statuses from git facts (merged even after branch deletion, chained blocks)', () => {
  const mk = (id: string, branch: string | null, deps: string[] = []) => ({ id, title: id, lane: 'backend', frs: [], frsLabel: '—', specTaskIds: [], branch, prTarget: null, deps, declaredStatus: '', assignee: null, goal: '', acceptance: [] });
  const cards = [mk('T-001', 'feat/a/T-001-x'), mk('T-002', 'feat/a/T-002-y', ['T-001']), mk('T-003', null, ['T-002']), mk('T-004', null, ['T-003']), mk('T-005', 'feat/a/T-005-z', ['T-001'])];
  const facts = {
    merged: new Map([['feat/a/T-001-x', { sha: 'a', short: 'a', time: 't' }]]),
    branches: new Map([['feat/a/T-002-y', { ahead: 2, behind: 0, worktree: null, time: 't', mergedIntoIntegration: false }], ['feat/a/T-005-z', { ahead: 0, behind: 1, worktree: null, time: 't', mergedIntoIntegration: true }]]),
    directRefs: new Map<string, { sha: string; short: string; time: string }>(),
  };
  const s = deriveStatuses(cards, facts);
  assert.equal(s.get('T-001')?.status, 'merged');
  assert.equal(s.get('T-002')?.status, 'review');
  assert.deepEqual(s.get('T-003'), { status: 'blocked', unmet: ['T-002'] });
  assert.deepEqual(s.get('T-004'), { status: 'blocked', unmet: ['T-003'] });
  assert.equal(s.get('T-005')?.status, 'active');
});

test('extracts direct refs from integration commit subjects (latest wins, strict id shape)', () => {
  const commits = [
    { sha: 's3', short: 's3', time: 't3', subject: 'docs(tasks): T-048 收尾（done）' },
    { sha: 's2', short: 's2', time: 't2', subject: 'feat(frontend): 附件托盘——T-048、T-049' },
    { sha: 's1', short: 's1', time: 't1', subject: 'chore: 提到 T-1234 与 T501 不应命中' },
  ];
  const refs = directRefsFromCommits(commits);
  // 同一卡多笔取最新一笔（入参新 → 旧序）：T-048 取收尾提交 s3，而非实现提交 s2
  assert.deepEqual(refs.get('T-048'), { sha: 's3', short: 's3', time: 't3' });
  // 一笔标题同时引用多卡，逐个登记
  assert.deepEqual(refs.get('T-049'), { sha: 's2', short: 's2', time: 't2' });
  // T-1234 不得部分命中成 T-123；无横线的 T501（spec 任务号形态）不命中
  assert.equal(refs.size, 2);
  // 集成分支 log 行解析（%H␟%cI␟%s）
  const parsed = parseIntegrationLog('abc1234deadbeef\x1f2026-10-21T10:00:00+08:00\x1ffeat: x\n');
  assert.deepEqual(parsed, [{ sha: 'abc1234deadbeef', short: 'abc1234', time: '2026-10-21T10:00:00+08:00', subject: 'feat: x' }]);
  assert.deepEqual(parseIntegrationLog(''), []);
});

test('derives merged from direct commit refs only when no branch is in flight', () => {
  const mk = (id: string, branch: string | null, deps: string[] = []) => ({ id, title: id, lane: 'backend', frs: [], frsLabel: '—', specTaskIds: [], branch, prTarget: null, deps, declaredStatus: '', assignee: null, goal: '', acceptance: [] });
  const cards = [
    mk('T-101', 'feat/a/T-101-x'), // 声明的分支从未建过（直提流水线）+ 有直提引用 → merged
    mk('T-102', null), // 无任何证据 → 不许升 merged（判定不放水）
    mk('T-103', 'feat/a/T-103-y'), // 在途分支 ahead>0 + 有直提引用 → 分支口径优先 review
    mk('T-104', 'feat/a/T-104-z'), // branch merge 记录（原口径）→ merged
    mk('T-105', 'feat/a/T-105-w'), // 在途分支 ahead=0 + 有直提引用 → active，不误升
  ];
  const facts = {
    merged: new Map([['feat/a/T-104-z', { sha: 'm', short: 'm', time: 'tm' }]]),
    branches: new Map([
      ['feat/a/T-103-y', { ahead: 2, behind: 0, worktree: null, time: 't', mergedIntoIntegration: false }],
      ['feat/a/T-105-w', { ahead: 0, behind: 0, worktree: null, time: 't', mergedIntoIntegration: false }],
    ]),
    directRefs: new Map([
      ['T-101', { sha: 'd1', short: 'd1', time: 'td1' }],
      ['T-103', { sha: 'd3', short: 'd3', time: 'td3' }],
      ['T-105', { sha: 'd5', short: 'd5', time: 'td5' }],
    ]),
  };
  const s = deriveStatuses(cards, facts);
  assert.equal(s.get('T-101')?.status, 'merged');
  assert.equal(s.get('T-102')?.status, 'ready');
  assert.equal(s.get('T-103')?.status, 'review');
  assert.equal(s.get('T-104')?.status, 'merged');
  assert.equal(s.get('T-105')?.status, 'active');
});

const SEP = '\x1f';
const NEWER = { sha: 'b'.repeat(40), time: '2026-10-21T10:00:00+08:00', subject: 'docs(tasks): T-101 收尾（done）' };
const OLDER = { sha: 'a'.repeat(40), time: '2026-10-20T09:00:00+08:00', subject: 'feat(backend): 直提实现——T-101' };
const DIRECT_LOG = [NEWER, OLDER].map((c) => [c.sha, c.time, c.subject].join(SEP)).join('\n');

const DIRECT_CARD = (id: string, title: string, branch: string) => `# ${id} ${title}

| 字段 | 值 |
|---|---|
| 泳道 | backend |
| 分支 | \`${branch}\` |
| 状态 | done |
| 执行者 | coordinator |

## 目标

直提证据验证。

## 验收标准

- [x] 完成
`;

function stubGit(logText: string): GitRunner {
  return async (args) => (args[0] === 'log'
    ? { ok: true, stdout: logText, stderr: '', code: 0 }
    : { ok: true, stdout: '', stderr: '', code: 0 });
}

function stubSnapshot(): GitSnapshot {
  return {
    available: true, generatedAt: '2026-10-21T00:00:00.000Z', currentBranch: 'manus',
    integrationBranch: 'manus', mainBranch: 'main', integrationRef: 'manus', integrationRefRemote: false,
    integrationHead: null, mainHead: null, integrationAheadOfMain: 0, mainAheadOfIntegration: 0,
    branches: [], commits: [], merges: [], mainMerges: [], worktrees: [], tags: [], remotes: [],
    dirtyCount: 0, pullRequests: null, ci: null,
  };
}

test('buildBoard: done card with direct commit refs is merged (no mismatch, merge falls back to ref); done card without any evidence still mismatches', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'acm-board-direct-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const files: Record<string, string> = {
    '.agents/config.sh': 'MAIN_BRANCH=main\nINTEGRATION_BRANCH=manus\nBRANCH_PREFIX=feat\nMAX_PARALLEL=4\n',
    '.agents/lanes.conf': 'backend src/backend/**\n@shared docs/**\n',
    'docs/tasks/T-101.md': DIRECT_CARD('T-101', '直提完成的卡', 'feat/backend/T-101-direct'),
    'docs/tasks/T-102.md': DIRECT_CARD('T-102', '无证据的卡', 'feat/backend/T-102-noref'),
    'docs/tasks/BOARD.md': '| 编号 | 标题 | 泳道 | 前置 | 状态 | 执行者 | PR |\n|---|---|---|---|---|---|---|\n| T-101 | 直提完成的卡 | backend | 无 | done | coordinator | x |\n| T-102 | 无证据的卡 | backend | 无 | done | coordinator | x |\n',
  };
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
  }
  const board = await buildBoard(root, stubGit(DIRECT_LOG), stubSnapshot(), '2026-10-21T12:00:00.000Z');
  assert.equal(board.available, true);
  const c101 = board.cards.find((c) => c.id === 'T-101');
  const c102 = board.cards.find((c) => c.id === 'T-102');
  assert.ok(c101 && c102);
  // (a) 直提证据：status merged、声明不一致消失、merge 记录回退为最新一笔引用提交（收尾）
  assert.equal(c101.status, 'merged');
  assert.equal(c101.declaredMismatch, false);
  assert.deepEqual(c101.merge, { sha: NEWER.sha, short: NEWER.sha.slice(0, 7), time: NEWER.time });
  assert.equal(c101.lastActivity, NEWER.time);
  // (b) 无任何证据的 done 卡：照旧 mismatch 并进冲突清单（判定不放水）
  assert.equal(c102.status, 'ready');
  assert.equal(c102.declaredMismatch, true);
  assert.equal(c102.merge, null);
  assert.equal(board.conflicts.length, 1);
  assert.match(board.conflicts[0] ?? '', /T-102/);
});
