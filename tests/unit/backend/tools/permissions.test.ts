import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, denyMessage } from '../../../../src/backend/tools/permissions.ts';

test('read and meta tools are always allowed', () => {
  for (const mode of ['ask', 'auto-edits', 'plan'] as const) {
    assert.equal(decide(mode, 'read'), 'allow');
    assert.equal(decide(mode, 'meta'), 'allow');
  }
});

test('writes ask in ask mode, pass in auto-edits, are denied in plan mode', () => {
  assert.equal(decide('ask', 'write'), 'ask');
  assert.equal(decide('auto-edits', 'write'), 'allow');
  assert.equal(decide('plan', 'write'), 'deny');
});

test('commands always require approval and are denied in plan mode', () => {
  assert.equal(decide('ask', 'execute'), 'ask');
  assert.equal(decide('auto-edits', 'execute'), 'ask');
  assert.equal(decide('plan', 'execute'), 'deny');
});

test('plan mode denial explains read-only mode', () => {
  assert.match(denyMessage('plan', 'write'), /仅规划/);
});
