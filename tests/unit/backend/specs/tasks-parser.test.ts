import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTasksMarkdown } from '../../../../src/backend/specs/tasks-parser.ts';

const SAMPLE = `# Tasks

## Phase 1: Setup

- [x] T001 [lane:contracts] 定义契约 contracts/ipc.ts
- [ ] T002 [P] [lane:backend] 实现沙箱

### 子标题不算 phase

## Phase 3: User Story 1 - 对话 (Priority: P1)

- [X] T010 [P] [US1] [frontend] Markdown 渲染
- [ ] T011 [US1] [lane:backend] [见 plan] 循环
- 普通列表项
- [ ] X999 不是任务
`;

test('parses ids, completion, [P], story, lane and phase', () => {
  const tasks = parseTasksMarkdown(SAMPLE);
  assert.deepEqual(tasks.map((t) => [t.id, t.done, t.parallel, t.story, t.lane, t.phase]), [
    ['T001', true, false, null, 'contracts', 'Phase 1: Setup'],
    ['T002', false, true, null, 'backend', 'Phase 1: Setup'],
    ['T010', true, true, 'US1', 'frontend', 'Phase 3: User Story 1 - 对话 (Priority: P1)'],
    ['T011', false, false, 'US1', 'backend', 'Phase 3: User Story 1 - 对话 (Priority: P1)'],
  ]);
});

test('keeps unknown bracket text as part of the description and records line numbers', () => {
  const t11 = parseTasksMarkdown(SAMPLE).find((t) => t.id === 'T011');
  assert.equal(t11?.description, '[见 plan] 循环');
  assert.equal(t11?.line, 13);
});

test('supports the @shared lane used for coordinator tasks', () => {
  assert.equal(parseTasksMarkdown('- [ ] T007 [lane:@shared] 工具链')[0]?.lane, '@shared');
});
