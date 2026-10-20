import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PublicSettings } from '../../../../contracts/ipc.ts';
import { configToForm, formToInput, OPENCODE_FORM_PRESET, previewCommand, splitLines } from '../../../../src/frontend/lib/agent-cli-form.ts';
import { agentName, agentOptions, agentWho, isCli } from '../../../../src/frontend/lib/agent-label.ts';

test('opencode preset form → AgentCliInput matches the backend preset', () => {
  const input = formToInput({ ...OPENCODE_FORM_PRESET, env: [{ name: ' ANTHROPIC_API_KEY ', secret: true, value: 'k' }, { name: '', secret: false, value: 'x' }] });
  assert.deepEqual(input, {
    name: 'opencode', preset: 'opencode', command: 'opencode', args: ['run', '--format', 'json', '--dir', '{cwd}'], resumeArgs: ['--session', '{session}'], modelArgs: ['--model', '{model}'],
    model: '', outputFormat: 'opencode-json', env: [{ name: 'ANTHROPIC_API_KEY', secret: true, value: 'k' }],
  });
  assert.deepEqual(splitLines(' a \n\n b\r\n'), ['a', 'b']);
});

test('saved secret keeps value undefined (unchanged) on round trip; plain values pass through', () => {
  const form = configToForm({ id: 'oc-1', name: 'oc', preset: 'opencode', command: 'opencode', args: ['run'], resumeArgs: [], modelArgs: [], model: 'm', outputFormat: 'opencode-json', env: [{ name: 'K', secret: true, hasValue: true }, { name: 'P', secret: false, value: 'v', hasValue: true }] });
  assert.equal(form.env[0]?.value, undefined);
  assert.deepEqual(formToInput(form).env, [{ name: 'K', secret: true }, { name: 'P', secret: false, value: 'v' }]);
  assert.equal(formToInput(form).id, 'oc-1');
});

test('preview shows model, session and the prompt separator', () => {
  assert.equal(previewCommand({ ...OPENCODE_FORM_PRESET, model: 'anthropic/claude' }, { session: true }), 'opencode run --format json --dir <项目根> --model anthropic/claude --session <会话ID> -- <消息>');
});

test('agent labels and options', () => {
  const s = { provider: 'anthropic', model: 'claude-sonnet-4-5', defaultAgent: 'builtin', agentClis: [{ id: 'oc-1', name: 'opencode', model: '', preset: 'opencode', command: 'opencode', args: [], resumeArgs: [], modelArgs: [], outputFormat: 'opencode-json', env: [] }] } as unknown as PublicSettings;
  assert.deepEqual(agentOptions(s).map((o) => o.ref), ['builtin', 'cli:oc-1']);
  assert.equal(agentName(undefined, s), 'Claude · claude-sonnet-4-5');
  assert.equal(agentName('cli:oc-1', s), 'opencode');
  assert.equal(agentName('cli:gone', s), '已删除的 CLI');
  assert.equal(agentWho('cli:oc-1', s), 'opencode');
  assert.equal(isCli('cli:oc-1', s), true);
  assert.equal(isCli(undefined, s), false);
});
