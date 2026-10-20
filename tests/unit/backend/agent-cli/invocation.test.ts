import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildArgs, describePermission, expandTemplate, formatCommandLine, needsTurnApproval, opencodePermission, permissionEnv } from '../../../../src/backend/agent-cli/invocation.ts';
import { OPENCODE_EXAMPLE } from '../../../../src/backend/agent-cli/presets.ts';

const cfg = { ...OPENCODE_EXAMPLE, args: [...OPENCODE_EXAMPLE.args], resumeArgs: [...OPENCODE_EXAMPLE.resumeArgs], modelArgs: [...OPENCODE_EXAMPLE.modelArgs] };

test('first turn: base args + prompt after --, cwd substituted, no session', () => {
  const args = buildArgs({ config: cfg, prompt: '-rf 删除？', cwd: 'C:\\Users\\me\\my proj', cliSessionId: null, mode: 'ask' });
  assert.deepEqual(args, ['run', '--format', 'json', '--dir', 'C:\\Users\\me\\my proj', '--', '-rf 删除？']);
});

test('resume turn adds --session and model args', () => {
  const args = buildArgs({ config: { ...cfg, model: 'anthropic/claude-sonnet-4-5' }, prompt: 'hi', cwd: '/p', cliSessionId: 'ses_1', mode: 'auto-edits' });
  assert.deepEqual(args, ['run', '--format', 'json', '--dir', '/p', '--model', 'anthropic/claude-sonnet-4-5', '--session', 'ses_1', '--', 'hi']);
});

test('plan mode uses the opencode plan agent; prompt placeholder is honoured', () => {
  assert.deepEqual(buildArgs({ config: cfg, prompt: 'x', cwd: '/p', cliSessionId: null, mode: 'plan' }).slice(-4), ['--agent', 'plan', '--', 'x']);
  const custom = { preset: 'custom' as const, args: ['ask', '{prompt}'], resumeArgs: [], modelArgs: [], model: '', outputFormat: 'text' as const };
  assert.deepEqual(buildArgs({ config: custom, prompt: 'p q', cwd: '/p', cliSessionId: null, mode: 'plan' }), ['ask', 'p q']);
  assert.deepEqual(expandTemplate(['{cwd}/{model}', 'lit'], { prompt: '', model: 'm', session: '', cwd: '/r' }), ['/r/m', 'lit']);
});

test('permission mapping keeps constitution IX semantics', () => {
  assert.deepEqual(opencodePermission('plan'), { edit: 'deny', bash: 'deny' });
  assert.deepEqual(opencodePermission('auto-edits'), { edit: 'allow', bash: 'deny' });
  assert.deepEqual(opencodePermission('ask'), { edit: 'allow', bash: 'allow' });
  assert.equal(needsTurnApproval('ask'), true);
  assert.equal(needsTurnApproval('auto-edits'), false);
  assert.deepEqual(JSON.parse(permissionEnv(cfg, 'plan').OPENCODE_PERMISSION ?? '{}'), { edit: 'deny', bash: 'deny' });
  assert.deepEqual(permissionEnv({ ...cfg, outputFormat: 'text' }, 'plan'), {});
  assert.match(describePermission(cfg, 'auto-edits'), /编辑文件 允许，执行命令 禁止/);
});

test('formats a display command line with platform quoting', () => {
  assert.equal(formatCommandLine('C:\\bin\\opencode.exe', ['run', 'a b', 'it"s'], 'win32'), 'C:\\bin\\opencode.exe run "a b" "it\\"s"');
  assert.equal(formatCommandLine('/usr/bin/opencode', ['run', "it's"], 'linux'), "/usr/bin/opencode run 'it'\\''s'");
});
