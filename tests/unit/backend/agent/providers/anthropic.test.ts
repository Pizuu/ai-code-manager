import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { ChatMessage } from '../../../../../contracts/ipc.ts';
import { anthropicMessagesUrl, consumeAnthropicStream, toAnthropicMessages } from '../../../../../src/backend/agent/providers/anthropic.ts';
import { SseParser } from '../../../../../src/backend/agent/providers/sse.ts';

const FIXTURES = path.resolve(import.meta.dirname, '../../../../../contracts/fixtures');

async function* events(text: string) {
  const p = new SseParser();
  yield* p.push(text);
  yield* p.flush();
}

test('accumulates text and input_json_delta from the fixture', async () => {
  const sample = fs.readFileSync(path.join(FIXTURES, 'anthropic-stream.sample.txt'), 'utf8');
  const r = await consumeAnthropicStream(events(sample), () => {});
  assert.equal(r.text, '你好');
  assert.deepEqual(r.toolCalls, [{ id: 'toolu_1', name: 'read_file', input: { path: 'README.md' } }]);
  assert.equal(r.stopReason, 'tool_use');
});

test('stream error events become E_PROVIDER errors', async () => {
  const text = 'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n';
  await assert.rejects(consumeAnthropicStream(events(text), () => {}), /E_PROVIDER: Overloaded/);
});

test('groups consecutive tool results into one user turn and merges following user text', () => {
  const msgs: ChatMessage[] = [
    { id: '1', role: 'user', content: 'go', createdAt: '' },
    { id: '2', role: 'assistant', content: 'ok', createdAt: '', toolCalls: [
      { id: 't1', name: 'list_dir', input: {}, status: 'done' },
      { id: 't2', name: 'read_file', input: { path: 'a' }, status: 'done' },
    ] },
    { id: '3', role: 'tool', toolCallId: 't1', content: 'r1', createdAt: '' },
    { id: '4', role: 'tool', toolCallId: 't2', content: 'r2', createdAt: '' },
    { id: '5', role: 'user', content: 'next', createdAt: '' },
  ];
  const out = toAnthropicMessages(msgs);
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((m) => m.role), ['user', 'assistant', 'user']);
  assert.deepEqual(out[2]?.content.map((b) => b.type), ['tool_result', 'tool_result', 'text']);
});

test('builds the messages url with or without a /v1 suffix', () => {
  assert.equal(anthropicMessagesUrl('https://api.anthropic.com'), 'https://api.anthropic.com/v1/messages');
  assert.equal(anthropicMessagesUrl('https://proxy.example.com/v1/'), 'https://proxy.example.com/v1/messages');
});
