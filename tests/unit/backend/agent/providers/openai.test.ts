import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { ChatMessage } from '../../../../../contracts/ipc.ts';
import { consumeOpenAIStream, toOpenAIMessages, toOpenAITools } from '../../../../../src/backend/agent/providers/openai.ts';
import { SseParser } from '../../../../../src/backend/agent/providers/sse.ts';
import { TOOL_DEFINITIONS } from '../../../../../contracts/tools.ts';

const FIXTURES = path.resolve(import.meta.dirname, '../../../../../contracts/fixtures');

async function* events(text: string) {
  const p = new SseParser();
  yield* p.push(text);
  yield* p.flush();
}

test('accumulates text and streamed tool call arguments from the fixture', async () => {
  const sample = fs.readFileSync(path.join(FIXTURES, 'openai-stream.sample.txt'), 'utf8');
  const deltas: string[] = [];
  const r = await consumeOpenAIStream(events(sample), (d) => deltas.push(d));
  assert.equal(r.text, '你好，我看看');
  assert.deepEqual(deltas, ['你好', '，我看看']);
  assert.deepEqual(r.toolCalls, [{ id: 'call_a', name: 'list_dir', input: { path: 'src' } }]);
  assert.equal(r.stopReason, 'tool_calls');
});

test('marks invalid tool argument JSON instead of throwing', async () => {
  const text = 'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c","function":{"name":"read_file","arguments":"{bad"}}]}}]}\n\ndata: [DONE]\n\n';
  const r = await consumeOpenAIStream(events(text), () => {});
  assert.match(r.toolCalls[0]?.inputError ?? '', /不是合法 JSON/);
});

test('converts history to chat messages and drops unanswered tool calls', () => {
  const msgs: ChatMessage[] = [
    { id: '1', role: 'user', content: 'hi', createdAt: '' },
    { id: '2', role: 'assistant', content: '', createdAt: '', toolCalls: [
      { id: 'a', name: 'list_dir', input: {}, status: 'done' },
      { id: 'b', name: 'read_file', input: { path: 'x' }, status: 'pending' },
    ] },
    { id: '3', role: 'tool', toolCallId: 'a', content: 'src/', createdAt: '' },
  ];
  const out = toOpenAIMessages('SYS', msgs);
  assert.deepEqual(out, [
    { role: 'system', content: 'SYS' },
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'a', type: 'function', function: { name: 'list_dir', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'a', content: 'src/' },
  ]);
});

test('exposes every contract tool as a function tool', () => {
  const tools = toOpenAITools(TOOL_DEFINITIONS);
  assert.equal(tools.length, TOOL_DEFINITIONS.length);
  assert.equal(tools[0]?.type, 'function');
});
