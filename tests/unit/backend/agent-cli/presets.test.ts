import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OPENCODE_PRESET } from '../../../../src/backend/agent-cli/presets.ts';

test('003: the opencode preset only carries its type; every field value is blank', () => {
  assert.equal(OPENCODE_PRESET.preset, 'opencode');
  assert.equal(OPENCODE_PRESET.outputFormat, 'opencode-json');
  assert.equal(OPENCODE_PRESET.command, '');
  assert.equal(OPENCODE_PRESET.model, '');
  assert.deepEqual([...OPENCODE_PRESET.args, ...OPENCODE_PRESET.resumeArgs, ...OPENCODE_PRESET.modelArgs, ...OPENCODE_PRESET.env], []);
});
