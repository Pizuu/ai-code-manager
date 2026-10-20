import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSlashCommand, SLASH_COMMANDS, suggestCommands } from '../../../../src/frontend/lib/slash-commands.ts';

test('plain text is not a command', () => {
  assert.deepEqual(parseSlashCommand('解释一下 src'), { kind: 'none' });
});

test('/clear, /help and /model map to local actions', () => {
  assert.deepEqual(parseSlashCommand('/clear'), { kind: 'clear' });
  assert.equal(parseSlashCommand('/help').kind, 'help');
  assert.deepEqual(parseSlashCommand('/model'), { kind: 'model', model: null });
  assert.deepEqual(parseSlashCommand('/model  gpt-4o-mini '), { kind: 'model', model: 'gpt-4o-mini' });
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

test('suggests commands by prefix only before arguments are typed', () => {
  assert.deepEqual(suggestCommands('/pl').map((c) => c.name), ['/plan']);
  assert.equal(suggestCommands('/').length, SLASH_COMMANDS.length);
  assert.deepEqual(suggestCommands('/plan x'), []);
  assert.deepEqual(suggestCommands('hello'), []);
});
