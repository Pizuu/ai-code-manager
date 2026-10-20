import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countChecklist, featureStages, mergedBranchName, parseBoardRows, parseSpec, parseTaskCard } from '../../../../src/backend/workspace/cards.ts';
import { deriveStatuses } from '../../../../src/backend/workspace/board.ts';

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
  };
  const s = deriveStatuses(cards, facts);
  assert.equal(s.get('T-001')?.status, 'merged');
  assert.equal(s.get('T-002')?.status, 'review');
  assert.deepEqual(s.get('T-003'), { status: 'blocked', unmet: ['T-002'] });
  assert.deepEqual(s.get('T-004'), { status: 'blocked', unmet: ['T-003'] });
  assert.equal(s.get('T-005')?.status, 'active');
});
