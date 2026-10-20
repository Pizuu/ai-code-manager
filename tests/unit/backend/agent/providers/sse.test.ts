import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SseParser } from '../../../../../src/backend/agent/providers/sse.ts';

test('parses events split across arbitrary chunk boundaries', () => {
  const p = new SseParser();
  const out = [
    ...p.push('event: a\nda'),
    ...p.push('ta: {"x":1}\n'),
    ...p.push('\ndata: [DONE]\n\n'),
  ];
  assert.deepEqual(out, [{ event: 'a', data: '{"x":1}' }, { event: null, data: '[DONE]' }]);
});

test('joins multi-line data, ignores comments and handles CRLF', () => {
  const p = new SseParser();
  assert.deepEqual(p.push(': ping\r\ndata: a\r\ndata: b\r\n\r\n'), [{ event: null, data: 'a\nb' }]);
});

test('flush returns a trailing event without blank line', () => {
  const p = new SseParser();
  assert.deepEqual(p.push('data: tail'), []);
  assert.deepEqual(p.flush(), [{ event: null, data: 'tail' }]);
});
