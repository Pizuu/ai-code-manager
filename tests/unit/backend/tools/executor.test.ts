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

test('run_command：免审批（allow-all）不请求审批直接执行；每次询问（ask）仍挂起审批', async () => {
  const { executeTool } = await import('../../../../src/backend/tools/executor.ts');
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const root = await mkdtemp(path.join(tmpdir(), 'exec-perm-'));
  const asked: string[] = [];
  const ctx = (mode: 'ask' | 'allow-all') => ({
    projectRoot: root, mode, signal: new AbortController().signal,
    requestApproval: async (req: { kind: string }) => { asked.push(`${mode}:${req.kind}`); return false; },
    onTerminal: () => undefined, onTodos: () => undefined,
  });
  const call = { id: 'c1', name: 'run_command', input: { command: 'echo hi' } };
  const free = await executeTool(call, ctx('allow-all'));
  assert.equal(free.status, 'done');
  assert.match(free.output, /hi/);
  assert.deepEqual(asked, []);
  const gated = await executeTool(call, ctx('ask'));
  assert.equal(gated.status, 'rejected');
  assert.deepEqual(asked, ['ask:command']);
});
