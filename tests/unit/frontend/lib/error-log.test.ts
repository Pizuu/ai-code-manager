import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  agentError,
  errorSectionTitle,
  hasError,
  mergeErrorEntries,
  sessionErrorEntries,
  toolCallError,
} from '../../../../src/frontend/lib/error-log.ts';

test('toolCallError returns an entry only for failed tool calls', () => {
  assert.equal(toolCallError({ id: 'c1', name: 'bash', status: 'done', output: 'ok' }, 'now'), null);
  assert.equal(toolCallError({ id: 'c1', name: 'bash', status: 'running' }, 'now'), null);
  const e = toolCallError({ id: 'c1', name: 'bash', status: 'error', output: 'E_TOOL: boom' }, 'now');
  assert.equal(e?.kind, 'tool');
  assert.equal(e?.text, '工具 bash 执行失败');
  assert.equal(e?.detail, 'E_TOOL: boom');
  assert.equal(e?.id, 'tool:c1');
});

test('toolCallError truncates a very long tool output', () => {
  const e = toolCallError({ id: 'c1', name: 'bash', status: 'error', output: 'x'.repeat(5000) }, 'now');
  assert.equal(e?.detail.length, 2000);
});

test('agentError keeps the first line as the summary and the whole text as detail', () => {
  const e = agentError('a1', 'E_PROVIDER: 模型服务返回 HTTP 500\n堆栈信息', 'now');
  assert.ok(e);
  assert.equal(e.kind, 'agent');
  assert.equal(e.text, 'E_PROVIDER: 模型服务返回 HTTP 500');
  assert.ok(e.detail.includes('堆栈信息'));
});

test('mergeErrorEntries dedupes by id and sorts by time', () => {
  const a = agentError('x', 'later', '2026-01-02T00:00:00Z');
  const b = toolCallError({ id: 'c1', name: 'bash', status: 'error', output: 'boom' }, '2026-01-01T00:00:00Z');
  assert.ok(b);
  const merged = mergeErrorEntries([a], [b]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0]?.id, 'tool:c1');
  // 同 id 覆盖：后者为准
  const b2 = toolCallError({ id: 'c1', name: 'bash', status: 'error', output: 'new' }, '2026-01-01T00:00:00Z');
  assert.ok(b2);
  const merged2 = mergeErrorEntries([b], [b2]);
  assert.equal(merged2.length, 1);
  assert.equal(merged2[0]?.detail, 'new');
});
test('sessionErrorEntries collects failed tool calls across all messages', () => {
  const entries = sessionErrorEntries([
    { id: 'm1', createdAt: '2026-01-01T00:00:00Z', toolCalls: [{ id: 'c1', name: 'read_file', status: 'done' }] },
    { id: 'm2', createdAt: '2026-01-02T00:00:00Z', toolCalls: [{ id: 'c2', name: 'run_command', status: 'error', output: 'E_CMD' }] },
    { id: 'm3', createdAt: '2026-01-03T00:00:00Z' },
  ]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.id, 'tool:c2');
  assert.equal(entries[0]?.at, '2026-01-02T00:00:00Z');
});

test('hasError and errorSectionTitle describe the error partition', () => {
  assert.equal(hasError([]), false);
  const toolErr = toolCallError({ id: 'c1', name: 'bash', status: 'error' }, '2026-01-01T00:00:00Z');
  assert.ok(toolErr);
  const entries = mergeErrorEntries([agentError('a1', 'boom', '2026-01-01T00:00:00Z')], [toolErr]);
  assert.equal(hasError(entries), true);
  assert.equal(errorSectionTitle(entries), '错误与日志（1 条 Agent 错误 · 1 条工具失败）');
  assert.equal(errorSectionTitle([]), '错误与日志');
});
