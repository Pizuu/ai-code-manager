import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOL_DEFINITIONS } from '../../../../contracts/tools.ts';
import { truncateOutput, validateToolInput } from '../../../../src/backend/tools/executor.ts';

const def = (name: string) => {
  const d = TOOL_DEFINITIONS.find((t) => t.name === name);
  if (!d) throw new Error(name);
  return d;
};

test('validates required parameters, unknown keys and types against the contract schema', () => {
  assert.equal(validateToolInput(def('read_file'), { path: 'a' }), null);
  assert.match(validateToolInput(def('read_file'), {}) ?? '', /缺少必填参数 path/);
  assert.match(validateToolInput(def('read_file'), { path: 'a', foo: 1 }) ?? '', /未知参数 foo/);
  assert.match(validateToolInput(def('read_file'), { path: 'a', offset: 1.5 }) ?? '', /integer/);
  assert.match(validateToolInput(def('run_command'), { command: 42 }) ?? '', /string/);
});

test('truncates long output keeping head and tail', () => {
  const out = truncateOutput('a'.repeat(100) + 'b'.repeat(100), 50);
  assert.ok(out.startsWith('a'.repeat(35)));
  assert.ok(out.endsWith('b'.repeat(15)));
  assert.match(out, /省略 150 字符/);
  assert.equal(truncateOutput('short', 50), 'short');
});
