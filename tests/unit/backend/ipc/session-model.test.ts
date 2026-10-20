/**
 * 契约 v1.5（CLI 模型切换）的纯函数部分：
 * - asSessionModelInput：agent:setSessionModel 的参数校验（null / 空串 = 清除、长度上限、类型）。
 * - effectiveCliRuntime：会话级覆盖叠加到 CLI runtime 配置（startCliTurn 三路共用的唯一叠加点）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Session } from '../../../../contracts/ipc.ts';
import type { CliRuntimeConfig } from '../../../../src/backend/agent-cli/cli-runner.ts';
import { effectiveCliRuntime } from '../../../../src/backend/ipc/handlers.ts';
import { asSessionModelInput } from '../../../../src/backend/ipc/validate.ts';

const SID = 's-abc-123';

test('asSessionModelInput accepts a model and trims it', () => {
  assert.deepEqual(asSessionModelInput({ sessionId: SID, model: '  anthropic/claude-sonnet-4-5 ' }), {
    sessionId: SID,
    model: 'anthropic/claude-sonnet-4-5',
  });
});

test('asSessionModelInput maps null / missing / blank model to clear (null)', () => {
  assert.deepEqual(asSessionModelInput({ sessionId: SID, model: null }), { sessionId: SID, model: null });
  assert.deepEqual(asSessionModelInput({ sessionId: SID }), { sessionId: SID, model: null });
  assert.deepEqual(asSessionModelInput({ sessionId: SID, model: '' }), { sessionId: SID, model: null });
  assert.deepEqual(asSessionModelInput({ sessionId: SID, model: '   ' }), { sessionId: SID, model: null });
});

test('asSessionModelInput rejects non-string model, overlong model and bad sessionId', () => {
  assert.throws(() => asSessionModelInput({ sessionId: SID, model: 42 }), /E_VALIDATION/);
  assert.throws(() => asSessionModelInput({ sessionId: SID, model: 'x'.repeat(201) }), /E_VALIDATION/);
  assert.throws(() => asSessionModelInput({ sessionId: 'bad id!', model: null }), /E_VALIDATION/);
  assert.throws(() => asSessionModelInput('nope'), /E_VALIDATION/);
  // 恰好在上限内（trim 后 200）可接受
  assert.equal(asSessionModelInput({ sessionId: SID, model: ` ${'x'.repeat(200)} ` }).model?.length, 200);
});

const runtime: CliRuntimeConfig = {
  id: 'cli-1',
  name: 'opencode',
  preset: 'opencode',
  args: ['run'],
  resumeArgs: [],
  modelArgs: ['--model', '{model}'],
  model: 'prov-a/config-model',
  outputFormat: 'opencode-json',
  env: {},
};

const sessionWith = (cliModel?: string): Session => ({
  schemaVersion: 1,
  id: SID,
  title: 't',
  projectPath: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  messages: [],
  todos: [],
  ...(cliModel !== undefined ? { cliModel } : {}),
});

test('effectiveCliRuntime overlays session cliModel over the CLI config model', () => {
  const out = effectiveCliRuntime(runtime, sessionWith('prov-b/session-model'));
  assert.equal(out.model, 'prov-b/session-model');
  // 其余字段保持不变，且不改原对象
  assert.equal(out.id, runtime.id);
  assert.deepEqual(out.args, runtime.args);
  assert.equal(runtime.model, 'prov-a/config-model');
});

test('effectiveCliRuntime returns the runtime untouched without an override', () => {
  assert.equal(effectiveCliRuntime(runtime, sessionWith()), runtime);
  assert.equal(effectiveCliRuntime(runtime, sessionWith('')), runtime);
  assert.equal(effectiveCliRuntime(runtime, sessionWith('   ')), runtime);
});
