import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  asSessionId,
  validateApprovalDecision,
  validateSendRequest,
  validateSettingsUpdate,
} from '../../../../src/backend/ipc/validate.ts';

test('accepts a valid settings update and strips trailing slashes from baseUrl', () => {
  const out = validateSettingsUpdate({ provider: 'anthropic', baseUrl: 'https://api.anthropic.com/', model: ' m ', apiKey: { provider: 'anthropic', value: ' k ' } });
  assert.deepEqual(out, { provider: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'm', apiKey: { provider: 'anthropic', value: 'k' } });
});

test('rejects unknown providers, non-http urls and wrong types', () => {
  assert.throws(() => validateSettingsUpdate({ provider: 'gemini' }), /E_VALIDATION/);
  assert.throws(() => validateSettingsUpdate({ baseUrl: 'file:///etc/passwd' }), /E_VALIDATION/);
  assert.throws(() => validateSettingsUpdate({ permissionMode: 'yolo' }), /E_VALIDATION/);
  assert.throws(() => validateSettingsUpdate(null), /E_VALIDATION/);
});

test('session ids cannot contain path separators', () => {
  assert.equal(asSessionId('s-abc-123'), 's-abc-123');
  for (const bad of ['../x', 'a/b', 'a\\b', '', 'x'.repeat(65)]) assert.throws(() => asSessionId(bad), /E_VALIDATION/);
});

test('send requests require non-empty text', () => {
  assert.deepEqual(validateSendRequest({ sessionId: 's-1', text: 'hi' }), { sessionId: 's-1', text: 'hi' });
  assert.throws(() => validateSendRequest({ sessionId: 's-1', text: '   ' }), /E_VALIDATION/);
});

test('approval decisions require a boolean', () => {
  assert.deepEqual(validateApprovalDecision({ approvalId: 'a', approved: false }), { approvalId: 'a', approved: false });
  assert.throws(() => validateApprovalDecision({ approvalId: 'a', approved: 'yes' }), /E_VALIDATION/);
});
