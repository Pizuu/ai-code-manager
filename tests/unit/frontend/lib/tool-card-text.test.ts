import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatToolOutput,
  outputLineCount,
  PARAM_VALUE_LIMIT,
  toolLabel,
  toolParamRows,
  toolTarget,
} from '../../../../src/frontend/lib/tool-card-text.ts';

test('toolLabel maps built-in and CLI tool names to Chinese; unknown names fall back', () => {
  assert.equal(toolLabel('read_file'), '读取文件');
  assert.equal(toolLabel('edit_file'), '编辑文件');
  assert.equal(toolLabel('run_command'), '执行命令');
  assert.equal(toolLabel('bash'), '执行命令');
  assert.equal(toolLabel('agent_cli'), '启动外部 CLI');
  assert.equal(toolLabel('todowrite'), '更新待办');
  assert.equal(toolLabel('some_unknown_tool'), 'some_unknown_tool');
});

test('toolTarget picks the key target per tool; empty when there is none', () => {
  assert.equal(toolTarget('read_file', { path: 'src/a.ts' }), 'src/a.ts');
  assert.equal(toolTarget('read', { filePath: 'b.ts' }), 'b.ts');
  assert.equal(toolTarget('run_command', { command: 'npm test' }), 'npm test');
  assert.equal(toolTarget('bash', { command: 'ls' }), 'ls');
  assert.equal(toolTarget('search', { pattern: 'TODO' }), 'TODO');
  assert.equal(toolTarget('grep', { pattern: 'foo' }), 'foo');
  assert.equal(toolTarget('webfetch', { url: 'https://x.dev' }), 'https://x.dev');
  assert.equal(toolTarget('agent_cli', { command: 'opencode run' }), 'opencode run');
  assert.equal(toolTarget('todo_write', { todos: [] }), '');
  assert.equal(toolTarget('list_dir', {}), '');
});

test('toolParamRows labels known keys, keeps unknown keys, and preserves input order', () => {
  const rows = toolParamRows({ path: 'src/a.ts', old_string: 'x', weird_key: 'y' });
  assert.deepEqual(rows, [
    { key: 'path', label: '路径', value: 'src/a.ts' },
    { key: 'old_string', label: '原内容', value: 'x' },
    { key: 'weird_key', label: 'weird_key', value: 'y' },
  ]);
});

test('toolParamRows formats values by type and truncates long ones with the total length', () => {
  const rows = toolParamRows({ n: 42, b: true, nil: null, arr: ['a', 'b'], obj: { k: 1 } });
  assert.equal(rows[0]?.value, '42');
  assert.equal(rows[1]?.value, 'true');
  assert.equal(rows[2]?.value, '（空）');
  assert.equal(rows[3]?.value, 'a、b');
  assert.equal(rows[4]?.value, '{"k":1}');

  const long = 'x'.repeat(PARAM_VALUE_LIMIT + 50);
  const [row] = toolParamRows({ content: long });
  assert.ok(row);
  assert.equal(row.value, `${'x'.repeat(PARAM_VALUE_LIMIT)}…（共 ${PARAM_VALUE_LIMIT + 50} 字符）`);
});

test('formatToolOutput pretty-prints JSON but leaves non-JSON and broken JSON untouched', () => {
  assert.equal(formatToolOutput('{"b":2,"a":1}'), '{\n  "b": 2,\n  "a": 1\n}');
  assert.equal(formatToolOutput('[1,2]'), '[\n  1,\n  2\n]');
  assert.equal(formatToolOutput('plain text'), 'plain text');
  assert.equal(formatToolOutput('{broken'), '{broken');
  assert.equal(formatToolOutput(''), '');
  // JSONL（每行一个 JSON）不得被合并成单个对象
  const jsonl = '{"a":1}\n{"a":2}';
  assert.equal(formatToolOutput(jsonl), jsonl);
});

test('outputLineCount counts lines of the shown text', () => {
  assert.equal(outputLineCount(''), 0);
  assert.equal(outputLineCount('a'), 1);
  assert.equal(outputLineCount('a\nb\nc'), 3);
});
