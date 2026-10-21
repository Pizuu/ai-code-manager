import { test } from 'node:test';
import assert from 'node:assert/strict';
import { helpText, parseSlashCommand, SLASH_COMMANDS, suggestCommands } from '../../../../src/frontend/lib/slash-commands.ts';

test('plain text is not a command', () => {
  assert.deepEqual(parseSlashCommand('解释一下 src'), { kind: 'none' });
});

test('/clear, /help and /model map to local actions', () => {
  assert.deepEqual(parseSlashCommand('/clear'), { kind: 'clear' });
  assert.equal(parseSlashCommand('/help').kind, 'help');
  assert.deepEqual(parseSlashCommand('/model'), { kind: 'model', model: null });
  assert.deepEqual(parseSlashCommand('/model  my-model '), { kind: 'model', model: 'my-model' });
});

test('/init asks the agent to write AGENTS.md via write_file', () => {
  const r = parseSlashCommand('/init');
  assert.equal(r.kind, 'prompt');
  assert.match(r.kind === 'prompt' ? r.prompt : '', /AGENTS\.md[\s\S]*write_file/);
});

test('/specify requires a description and embeds it with Spec Kit instructions', () => {
  assert.equal(parseSlashCommand('/specify').kind, 'error');
  const r = parseSlashCommand('/specify 增加登录功能');
  assert.equal(r.kind, 'prompt');
  const prompt = r.kind === 'prompt' ? r.prompt : '';
  assert.match(prompt, /speckit-specify/);
  assert.match(prompt, /需求：增加登录功能/);
});

test('/plan, /tasks and /implement produce Spec Kit prompts; /implement accepts task ids', () => {
  for (const cmd of ['/plan', '/tasks', '/implement']) assert.equal(parseSlashCommand(cmd).kind, 'prompt', cmd);
  const r = parseSlashCommand('/implement T003 T004');
  assert.match(r.kind === 'prompt' ? r.prompt : '', /T003 T004/);
});

test('unknown commands return an error with the command list and are case-insensitive for known ones', () => {
  const r = parseSlashCommand('/foo');
  assert.equal(r.kind, 'error');
  assert.match(r.kind === 'error' ? r.text : '', /\/specify/);
  assert.deepEqual(parseSlashCommand('/CLEAR'), { kind: 'clear' });
});

test('/speckit-bug-assess parses the wizard format and builds an evaluation-only prompt', () => {
  const r = parseSlashCommand('/speckit-bug-assess "登录页点击\'保存\'后 崩溃" slug=login-crash');
  assert.equal(r.kind, 'prompt');
  const prompt = r.kind === 'prompt' ? r.prompt : '';
  assert.match(prompt, /speckit-bug-assess\/SKILL\.md/);
  assert.match(prompt, /不直接修改代码/);
  assert.match(prompt, /\.specify\/bugs\/login-crash\//);
  assert.match(prompt, /症状：登录页点击'保存'后 崩溃（slug=login-crash）/);
});

test('/speckit-assess-intake parses the wizard format and builds a five-stage prompt', () => {
  const r = parseSlashCommand('/speckit-assess-intake "让用户离线工作、重连后自动同步" slug=offline-mode');
  assert.equal(r.kind, 'prompt');
  const prompt = r.kind === 'prompt' ? r.prompt : '';
  assert.match(prompt, /speckit-assess-intake\/SKILL\.md/);
  assert.match(prompt, /受理 → 调研 → 定义 → 塑形 → 决策/);
  assert.match(prompt, /\.specify\/assessments\/offline-mode\//);
  assert.match(prompt, /go \/ needs-clarification \/ kill/);
  assert.match(prompt, /想法：让用户离线工作、重连后自动同步（slug=offline-mode）/);
});

test('bug/assess commands accept unquoted hand-typed text around slug=', () => {
  const r = parseSlashCommand('/speckit-bug-assess 登录页 崩溃 slug=login-crash');
  assert.equal(r.kind, 'prompt');
  assert.match(r.kind === 'prompt' ? r.prompt : '', /症状：登录页 崩溃（slug=login-crash）/);
});

test('bug/assess commands require both body and slug', () => {
  for (const input of [
    '/speckit-bug-assess "只有症状没有 slug"',
    '/speckit-bug-assess slug=only-slug',
    '/speckit-bug-assess',
    '/speckit-assess-intake "只有想法没有 slug"',
    '/speckit-assess-intake slug=only-slug',
    '/speckit-assess-intake "" slug=empty-body',
    '/speckit-assess-intake',
  ]) {
    const r = parseSlashCommand(input);
    assert.equal(r.kind, 'error', input);
    assert.match(r.kind === 'error' ? r.text : '', /用法：\/speckit-/, input);
  }
});

test('suggestCommands and helpText include the two extension commands', () => {
  assert.deepEqual(suggestCommands('/speckit-').map((c) => c.name), ['/speckit-bug-assess', '/speckit-assess-intake']);
  const help = helpText();
  assert.match(help, /\/speckit-bug-assess "症状" slug=<slug>/);
  assert.match(help, /\/speckit-assess-intake "想法" slug=<slug>/);
});

test('suggests commands by prefix only before arguments are typed', () => {
  assert.deepEqual(suggestCommands('/pl').map((c) => c.name), ['/plan']);
  assert.equal(suggestCommands('/').length, SLASH_COMMANDS.length);
  assert.deepEqual(suggestCommands('/plan x'), []);
  assert.deepEqual(suggestCommands('hello'), []);
});
