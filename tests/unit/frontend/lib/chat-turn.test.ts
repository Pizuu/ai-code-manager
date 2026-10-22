/**
 * 对话回合纯计算的单元测试：思考区摘要文案、展开判定、头像文字。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ToolCallRecord, ToolCallStatus } from '../../../../contracts/ipc.ts';
import {
  avatarText, countThink, hasPendingApproval, thinkCountText, thinkLastAction, thinkShouldOpen, thinkStatusText,
} from '../../../../src/frontend/lib/chat-turn.ts';

function call(status: ToolCallStatus, name = 'read_file', input: Record<string, unknown> = { path: 'a.ts' }): ToolCallRecord {
  return { id: `c-${status}-${name}`, name, input, status };
}

test('countThink: 按状态分类计数，waiting 兜底未列出的状态', () => {
  const c = countThink([
    call('done'), call('done'), call('running'), call('awaiting-approval'),
    call('error'), call('rejected'), call('pending'),
  ]);
  assert.deepEqual(c, { total: 7, done: 2, running: 1, pending: 1, waiting: 1, failed: 1, rejected: 1 });
  assert.deepEqual(countThink([]), { total: 0, done: 0, running: 0, pending: 0, waiting: 0, failed: 0, rejected: 0 });
});

test('hasPendingApproval: 只有待批准的调用才要求展开思考区', () => {
  assert.equal(hasPendingApproval([call('done')]), false);
  assert.equal(hasPendingApproval([call('done'), call('awaiting-approval')]), true);
  assert.equal(hasPendingApproval([]), false);
});

test('thinkCountText: 数量文案（单条不带「个」前缀差异）', () => {
  assert.equal(thinkCountText([]), '');
  assert.equal(thinkCountText([call('done')]), '1 个工具调用');
  assert.equal(thinkCountText([call('done'), call('done')]), '2 个工具调用');
});

test('thinkStatusText: 只列非零状态，按重要度排序', () => {
  assert.equal(thinkStatusText([]), '');
  assert.equal(thinkStatusText([call('done')]), '1 完成');
  assert.equal(thinkStatusText([call('done'), call('awaiting-approval'), call('error')]), '1 待批准 · 1 失败 · 1 完成');
  assert.equal(thinkStatusText([call('running'), call('pending')]), '1 进行中 · 1 等待中');
});

test('thinkShouldOpen: 展开判定优先级（待批准 / 正在思考 / 用户显式选择 / sticky / 折叠）', () => {
  // 有待批准的调用 → 强制展开（批准按钮不能被折叠藏起来）
  assert.equal(thinkShouldOpen({ pending: true, streaming: false, sticky: false }), true);
  // 正在思考（流式输出中）且用户未显式收起过 → 自动展开，思考过程可见
  assert.equal(thinkShouldOpen({ pending: false, streaming: true, sticky: false }), true);
  // 正在思考但用户曾显式收起过 → 尊重用户选择
  assert.equal(thinkShouldOpen({ pending: false, streaming: true, sticky: false, explicit: false }), false);
  // 空闲、未选 / 未 sticky → 折叠（默认干净）
  assert.equal(thinkShouldOpen({ pending: false, streaming: false, sticky: false }), false);
  // 曾因待批准自动展开过（sticky）→ 保持展开，避免批准后卡片突然消失
  assert.equal(thinkShouldOpen({ pending: false, streaming: false, sticky: true }), true);
});

test('thinkLastAction: 最近一次操作的目标；取不到目标时只给工具名', () => {
  assert.equal(thinkLastAction([]), '');
  assert.equal(thinkLastAction([call('done', 'read_file', { path: 'src/a.ts' })]), '读取文件 src/a.ts');
  assert.equal(thinkLastAction([call('done', 'read_file', {})]), '读取文件');
  // 只看最后一个
  assert.equal(
    thinkLastAction([call('done', 'read_file', { path: 'x.ts' }), call('done', 'write', { path: 'y.ts' })]),
    '写入文件 y.ts',
  );
});

test('avatarText: 取短名首字符，空名回退 AI', () => {
  assert.equal(avatarText('claude'), 'C');
  assert.equal(avatarText('opencode'), 'O');
  assert.equal(avatarText('  '), 'AI');
  assert.equal(avatarText(''), 'AI');
});
