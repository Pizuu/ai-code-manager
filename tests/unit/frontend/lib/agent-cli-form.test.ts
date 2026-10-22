import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PublicSettings } from '../../../../contracts/ipc.ts';
import { commandBaseName, configToForm, detectedToForm, formToInput, OPENCODE_FORM_EXAMPLE, OPENCODE_FORM_PRESET, previewCommand, splitLines } from '../../../../src/frontend/lib/agent-cli-form.ts';
import { agentName, agentOptions, agentWho, isCli } from '../../../../src/frontend/lib/agent-label.ts';

test('003: the opencode form preset is blank (type only); the example is opt-in', () => {
  assert.deepEqual(formToInput({ ...OPENCODE_FORM_PRESET, env: [] }), {
    name: 'opencode', preset: 'opencode', command: '', args: [], resumeArgs: [], modelArgs: [], model: '', outputFormat: 'opencode-json', env: [],
  });
});

test('opencode example form → AgentCliInput matches the backend example', () => {
  const input = formToInput({ ...OPENCODE_FORM_PRESET, ...OPENCODE_FORM_EXAMPLE, model: '', env: [{ name: ' ANTHROPIC_API_KEY ', secret: true, value: 'k' }, { name: '', secret: false, value: 'x' }] });
  assert.deepEqual(input, {
    name: 'opencode', preset: 'opencode', command: 'opencode', args: ['run', '--format', 'json', '--dir', '{cwd}'], resumeArgs: ['--session', '{session}'], modelArgs: ['--model', '{model}'],
    model: '', outputFormat: 'opencode-json', env: [{ name: 'ANTHROPIC_API_KEY', secret: true, value: 'k' }],
  });
  assert.deepEqual(splitLines(' a \n\n b\r\n'), ['a', 'b']);
});

test('commandBaseName strips directories, windows suffixes and case', () => {
  assert.equal(commandBaseName('opencode'), 'opencode');
  assert.equal(commandBaseName('/usr/local/bin/opencode'), 'opencode');
  assert.equal(commandBaseName('C:\\Users\\me\\opencode.exe'), 'opencode');
  assert.equal(commandBaseName('C:\\tools\\OPENCODE.CMD'), 'opencode');
  assert.equal(commandBaseName('claude'), 'claude');
});

test('detected opencode becomes the opencode form (example args, opencode-json) so it can reach ACP/serve', () => {
  const f = detectedToForm({ name: 'opencode', command: 'opencode' });
  assert.equal(f.preset, 'opencode');
  assert.equal(f.outputFormat, 'opencode-json');
  assert.equal(f.args, OPENCODE_FORM_EXAMPLE.args);
  assert.equal(f.resumeArgs, OPENCODE_FORM_EXAMPLE.resumeArgs);
  assert.equal(f.modelArgs, OPENCODE_FORM_EXAMPLE.modelArgs);
  assert.equal(f.model, '');
  assert.deepEqual(f.env, []);
  assert.deepEqual(formToInput(f), {
    name: 'opencode', preset: 'opencode', command: 'opencode',
    args: ['run', '--format', 'json', '--dir', '{cwd}'], resumeArgs: ['--session', '{session}'], modelArgs: ['--model', '{model}'],
    model: '', outputFormat: 'opencode-json', env: [],
  });
});

test('detected opencode is recognized from path and .exe forms; detection name/command are kept', () => {
  const f = detectedToForm({ name: 'opencode 1.19.3', command: 'C:\\Users\\me\\AppData\\Roaming\\npm\\opencode.exe' });
  assert.equal(f.preset, 'opencode');
  assert.equal(f.outputFormat, 'opencode-json');
  assert.equal(f.name, 'opencode 1.19.3');
  assert.equal(f.command, 'C:\\Users\\me\\AppData\\Roaming\\npm\\opencode.exe');
});

test('detected non-opencode CLI keeps the generic custom text form', () => {
  const f = detectedToForm({ name: 'Claude Code', command: 'claude' });
  assert.deepEqual(f, { name: 'Claude Code', preset: 'custom', command: 'claude', args: '{prompt}', resumeArgs: '', modelArgs: '', model: '', outputFormat: 'text', env: [] });
  assert.deepEqual(formToInput(f).args, ['{prompt}']);
});

test('saved secret keeps value undefined (unchanged) on round trip; plain values pass through', () => {
  const form = configToForm({ id: 'oc-1', name: 'oc', preset: 'opencode', command: 'opencode', args: ['run'], resumeArgs: [], modelArgs: [], model: 'm', outputFormat: 'opencode-json', env: [{ name: 'K', secret: true, hasValue: true }, { name: 'P', secret: false, value: 'v', hasValue: true }] });
  assert.equal(form.env[0]?.value, undefined);
  assert.deepEqual(formToInput(form).env, [{ name: 'K', secret: true }, { name: 'P', secret: false, value: 'v' }]);
  assert.equal(formToInput(form).id, 'oc-1');
});

test('preview shows model, session and the prompt separator', () => {
  assert.equal(previewCommand({ ...OPENCODE_FORM_PRESET, ...OPENCODE_FORM_EXAMPLE, model: 'anthropic/claude' }, { session: true }), 'opencode run --format json --dir <项目根> --model anthropic/claude --session <会话ID> -- <消息>');
});

test('agent labels and options', () => {
  const s = { provider: 'anthropic', model: 'claude-sonnet-4-5', defaultAgent: 'builtin', agentClis: [{ id: 'oc-1', name: 'opencode', model: '', preset: 'opencode', command: 'opencode', args: [], resumeArgs: [], modelArgs: [], outputFormat: 'opencode-json', env: [] }] } as unknown as PublicSettings;
  assert.deepEqual(agentOptions(s).map((o) => o.ref), ['builtin', 'cli:oc-1']);
  assert.equal(agentName(undefined, s), 'claude-sonnet-4-5');
  assert.equal(agentName('cli:oc-1', s), 'opencode');
  assert.equal(agentName('cli:gone', s), '已删除的 CLI');
  assert.equal(agentWho('cli:oc-1', s), 'opencode');
  assert.equal(isCli('cli:oc-1', s), true);
  assert.equal(isCli(undefined, s), false);
});
