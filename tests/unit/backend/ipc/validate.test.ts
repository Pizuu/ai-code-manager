import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  asSessionId,
  validateApprovalDecision,
  validateSendRequest,
  validateSettingsUpdate,
  asRelPath,
  asTerminalCloseRequest,
  asTerminalInputRequest,
  asTerminalOpenRequest,
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

test('allow-all (v1.6) is an accepted permission mode', () => {
  assert.deepEqual(validateSettingsUpdate({ permissionMode: 'allow-all' }), { permissionMode: 'allow-all' });
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

test('003: an empty baseUrl clears it; fs:read paths must be non-empty strings', () => {
  assert.deepEqual(validateSettingsUpdate({ baseUrl: '  ', model: '' }), { baseUrl: '', model: '' });
  assert.equal(asRelPath('src/a.ts'), 'src/a.ts');
  assert.throws(() => asRelPath(''), /E_VALIDATION/);
  assert.throws(() => asRelPath(null), /E_VALIDATION/);
  assert.throws(() => asRelPath('x'.repeat(1001)), /E_VALIDATION/);
});

test('v1.6: terminal requests are validated (kind 枚举、sessionId、输入长度)', () => {
  assert.deepEqual(asTerminalOpenRequest({ sessionId: 's-1' }), { sessionId: 's-1', kind: 'shell', restart: false });
  assert.deepEqual(asTerminalOpenRequest({ sessionId: 's-1', kind: 'cli', restart: true }), { sessionId: 's-1', kind: 'cli', restart: true });
  assert.throws(() => asTerminalOpenRequest({ sessionId: 's-1', kind: 'bash -c evil' }), /E_VALIDATION/);
  assert.throws(() => asTerminalOpenRequest({ sessionId: 's-1', restart: 'yes' }), /E_VALIDATION/);
  assert.throws(() => asTerminalOpenRequest({ sessionId: '../etc' }), /E_VALIDATION/);

  assert.deepEqual(asTerminalInputRequest({ sessionId: 's-1', data: 'ls\n' }), { sessionId: 's-1', data: 'ls\n' });
  assert.deepEqual(asTerminalInputRequest({ sessionId: 's-1', data: '' }), { sessionId: 's-1', data: '' });
  assert.throws(() => asTerminalInputRequest({ sessionId: 's-1', data: 123 }), /E_VALIDATION/);
  assert.throws(() => asTerminalInputRequest({ sessionId: 's-1', data: 'x'.repeat(8001) }), /E_VALIDATION/);
  assert.throws(() => asTerminalInputRequest({ sessionId: 's-1', data: 'a\u0000b' }), /E_VALIDATION/);

  assert.deepEqual(asTerminalCloseRequest({ sessionId: 's-1' }), { sessionId: 's-1' });
  assert.throws(() => asTerminalCloseRequest({ sessionId: '' }), /E_VALIDATION/);
});
