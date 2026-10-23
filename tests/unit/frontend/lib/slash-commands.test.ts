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

test('unknown commands return an error with the command list and are case-insensitive for known ones', () => {
  const r = parseSlashCommand('/foo');
  assert.equal(r.kind, 'error');
  assert.match(r.kind === 'error' ? r.text : '', /\/init/);
  assert.deepEqual(parseSlashCommand('/CLEAR'), { kind: 'clear' });
});

test('suggests commands by prefix only before arguments are typed', () => {
  assert.deepEqual(suggestCommands('/mo').map((c) => c.name), ['/model']);
  assert.equal(suggestCommands('/').length, SLASH_COMMANDS.length);
  assert.deepEqual(suggestCommands('/model x'), []);
  assert.deepEqual(suggestCommands('hello'), []);
});

test('helpText lists every registered command', () => {
  const help = helpText();
  for (const c of SLASH_COMMANDS) assert.ok(help.includes(c.usage), c.usage);
});
