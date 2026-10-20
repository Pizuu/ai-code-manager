import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executableBaseName, normalizeCliRuntimeFields } from '../../../../src/backend/agent-cli/normalize.ts';
import { OPENCODE_EXAMPLE } from '../../../../src/backend/agent-cli/presets.ts';

test('executableBaseName strips directories, windows suffixes and case', () => {
  assert.equal(executableBaseName('opencode'), 'opencode');
  assert.equal(executableBaseName('/usr/local/bin/opencode'), 'opencode');
  assert.equal(executableBaseName('C:\\Users\\me\\opencode.exe'), 'opencode');
  assert.equal(executableBaseName('C:\\tools\\OPENCODE.CMD'), 'opencode');
  assert.equal(executableBaseName('claude'), 'claude');
  assert.equal(executableBaseName('/opt/bin/codex'), 'codex');
});

test('detect-added opencode (fingerprint) upgrades to the official example invocation', () => {
  const out = normalizeCliRuntimeFields({ command: 'opencode', preset: 'custom', args: ['{prompt}'], resumeArgs: [], modelArgs: [], outputFormat: 'text' });
  assert.equal(out.preset, 'opencode');
  assert.equal(out.outputFormat, 'opencode-json');
  assert.deepEqual(out.args, [...OPENCODE_EXAMPLE.args]);
  assert.deepEqual(out.resumeArgs, [...OPENCODE_EXAMPLE.resumeArgs]);
  assert.deepEqual(out.modelArgs, [...OPENCODE_EXAMPLE.modelArgs]);
});

test('fingerprint upgrade also applies to path / .exe forms of opencode', () => {
  const out = normalizeCliRuntimeFields({ command: 'C:\\npm\\opencode.exe', preset: 'custom', args: ['{prompt}'], resumeArgs: [], modelArgs: [], outputFormat: 'text' });
  assert.equal(out.preset, 'opencode');
  assert.equal(out.outputFormat, 'opencode-json');
  assert.deepEqual(out.args, [...OPENCODE_EXAMPLE.args]);
});

test('opencode with user-edited args only normalizes preset/outputFormat and keeps its args', () => {
  const out = normalizeCliRuntimeFields({ command: 'opencode', preset: 'custom', args: ['run', '--format', 'json', '{prompt}'], resumeArgs: [], modelArgs: [], outputFormat: 'text' });
  assert.equal(out.preset, 'opencode');
  assert.equal(out.outputFormat, 'opencode-json');
  assert.deepEqual(out.args, ['run', '--format', 'json', '{prompt}']);
  assert.deepEqual(out.resumeArgs, []);
  assert.deepEqual(out.modelArgs, []);
});

test('opencode already stored properly keeps its own args untouched', () => {
  const out = normalizeCliRuntimeFields({ command: 'opencode', preset: 'opencode', args: ['run'], resumeArgs: ['--session', '{session}'], modelArgs: ['--model', '{model}'], outputFormat: 'opencode-json' });
  assert.deepEqual(out, { preset: 'opencode', args: ['run'], resumeArgs: ['--session', '{session}'], modelArgs: ['--model', '{model}'], outputFormat: 'opencode-json' });
});

test('non-opencode entries are returned unchanged, even when fingerprint-shaped', () => {
  const input = { command: 'claude', preset: 'custom' as const, args: ['{prompt}'], resumeArgs: [] as string[], modelArgs: [] as string[], outputFormat: 'text' as const };
  const out = normalizeCliRuntimeFields(input);
  assert.deepEqual(out, { preset: 'custom', args: ['{prompt}'], resumeArgs: [], modelArgs: [], outputFormat: 'text' });
});

test('normalization does not mutate the stored entry', () => {
  const input = { command: 'opencode', preset: 'custom' as const, args: ['{prompt}'], resumeArgs: [] as string[], modelArgs: [] as string[], outputFormat: 'text' as const };
  normalizeCliRuntimeFields(input);
  assert.deepEqual(input, { command: 'opencode', preset: 'custom', args: ['{prompt}'], resumeArgs: [], modelArgs: [], outputFormat: 'text' });
});
