import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ASSESS_STAGES, BUG_STAGES, assessStageCount, bugStageCount, extractAssessDecision, extractBugVerdict,
} from '../../../src/frontend/lib/speckit.ts';

test('阶段标签常量：bug 3 段、评估 5 段', () => {
  assert.deepEqual([...BUG_STAGES], ['评估', '修复', '验证']);
  assert.deepEqual([...ASSESS_STAGES], ['受理', '调研', '定义', '塑形', '决策']);
});

/* ── bugStageCount ─────────────────────────────────────────── */

test('bugStageCount：空目录 0', () => {
  assert.equal(bugStageCount([]), 0);
});

test('bugStageCount：只有评估产物 1', () => {
  assert.equal(bugStageCount(['assessment.md']), 1);
});

test('bugStageCount：评估 + 修复 2', () => {
  assert.equal(bugStageCount(['assessment.md', 'fix-report.md']), 2);
});

test('bugStageCount：三段齐 3（含 verification 关键字变体）', () => {
  assert.equal(bugStageCount(['assessment.md', 'fix.md', 'test-results.md']), 3);
  assert.equal(bugStageCount(['assess.md', 'fix.md', 'verification.md']), 3);
});

test('bugStageCount：大小写不敏感，无关文件不计，同阶段多文件只计一次', () => {
  assert.equal(bugStageCount(['ASSESSMENT.MD', 'Bug-Assess.md']), 1);
  assert.equal(bugStageCount(['README.md', 'notes.txt']), 0);
});

test('bugStageCount：只有靠后阶段产物时按实际存在的阶段组计数（不虚报前序）', () => {
  assert.equal(bugStageCount(['test-results.md']), 1);
  assert.equal(bugStageCount(['fix.md', 'test.md']), 2);
});

/* ── assessStageCount ──────────────────────────────────────── */

test('assessStageCount：空目录 0、只有受理 1', () => {
  assert.equal(assessStageCount([]), 0);
  assert.equal(assessStageCount(['intake.md']), 1);
});

test('assessStageCount：五段逐段累进到 5', () => {
  const all = ['intake.md', 'research.md', 'define.md', 'shape.md', 'decision.md'];
  assert.equal(assessStageCount(all.slice(0, 2)), 2);
  assert.equal(assessStageCount(all.slice(0, 3)), 3);
  assert.equal(assessStageCount(all.slice(0, 4)), 4);
  assert.equal(assessStageCount(all), 5);
});

test('assessStageCount：decide 变体与 definition 变体都认，大小写不敏感', () => {
  assert.equal(assessStageCount(['intake.md', 'research.md', 'definition.md', 'shape.md', 'decide.md']), 5);
  assert.equal(assessStageCount(['INTAKE.MD', 'Research.md']), 2);
});

/* ── extractBugVerdict ─────────────────────────────────────── */

test('extractBugVerdict：结论行优先于正文兜底（正文的 failed 不盖过结论 verified）', () => {
  const text = '正文先说上次运行 failed，又提到似乎 verified。\n\n结论：verified';
  assert.equal(extractBugVerdict(text), 'verified');
});

test('extractBugVerdict：英文 verdict 行同样优先', () => {
  const text = 'It looked verified at first glance.\nVerdict: partial';
  assert.equal(extractBugVerdict(text), 'partial');
});

test('extractBugVerdict：无结论行时全文兜底，大写可认', () => {
  assert.equal(extractBugVerdict('All smoke tests failed.'), 'failed');
  assert.equal(extractBugVerdict('VERDICT: FAILED'), 'failed');
  assert.equal(extractBugVerdict('status: partial success'), 'partial');
});

test("extractBugVerdict：'unverified' 不误判为 'verified'", () => {
  assert.equal(extractBugVerdict('结果：unverified'), null);
  assert.equal(extractBugVerdict('The report says unverified.'), null);
});

test('extractBugVerdict：结论行里 unverified 在前、真 verified 在后，取后者', () => {
  assert.equal(extractBugVerdict('结论：先前 unverified，复测 verified'), 'verified');
});

test('extractBugVerdict：无结论返回 null', () => {
  assert.equal(extractBugVerdict('一切正常，无异常。'), null);
  assert.equal(extractBugVerdict(''), null);
});

/* ── extractAssessDecision ─────────────────────────────────── */

test('extractAssessDecision：三种结论各一', () => {
  assert.equal(extractAssessDecision('Decision: go'), 'go');
  assert.equal(extractAssessDecision('决策：kill'), 'kill');
  assert.equal(extractAssessDecision('Decision: needs-clarification'), 'needs-clarification');
});

test('extractAssessDecision：needs-clarification 的空格/下划线变体归一', () => {
  assert.equal(extractAssessDecision('decision: needs clarification'), 'needs-clarification');
  assert.equal(extractAssessDecision('Decision: needs_clarification'), 'needs-clarification');
});

test('extractAssessDecision：决策行优先于正文（正文先出现的 go 不盖过决策 kill）', () => {
  const text = '正文里先写了可以 go 一把。\n\n决策：kill';
  assert.equal(extractAssessDecision(text), 'kill');
});

test('extractAssessDecision：同一行 needs-clarification 在前，不被后面的 go 抢先', () => {
  assert.equal(extractAssessDecision('Decision: needs-clarification — do not go yet'), 'needs-clarification');
});

test("extractAssessDecision：'ongoing' / 'good' 不误判为 go", () => {
  assert.equal(extractAssessDecision('This is an ongoing effort and it looks good.'), null);
});

test('extractAssessDecision：无结论行时全文兜底，无结论返回 null', () => {
  assert.equal(extractAssessDecision('经过讨论，最终 kill 掉这个想法。'), 'kill');
  assert.equal(extractAssessDecision('今天天气不错。'), null);
  assert.equal(extractAssessDecision(''), null);
});
