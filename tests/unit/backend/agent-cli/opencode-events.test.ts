import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { accumulateUsage, mapTodoStatus, parseOpencodeLine, toolStatus } from '../../../../src/backend/agent-cli/opencode-events.ts';

const fixture = (name: string) => fs.readFileSync(new URL(`../../../../contracts/fixtures/${name}`, import.meta.url), 'utf8').split('\n').filter(Boolean);

test('parses the real opencode 1.19.3 run stream (text, write tool, steps)', () => {
  const evs = fixture('opencode-run.sample.jsonl').map(parseOpencodeLine);
  assert.deepEqual(evs.map((e) => e.kind), ['step-start', 'text', 'tool', 'step-finish', 'step-start', 'text', 'step-finish']);
  const sid = evs[0] && 'sessionId' in evs[0] ? evs[0].sessionId : null;
  assert.match(sid ?? '', /^ses_/);
  const tool = evs[2];
  assert.ok(tool && tool.kind === 'tool');
  assert.equal(tool.tool, 'write');
  assert.equal(tool.callId, 'call_1');
  assert.equal(toolStatus(tool), 'done');
  assert.equal(tool.input.filePath, 'hello.txt');
  const last = evs[5];
  assert.ok(last && last.kind === 'text');
  assert.equal(last.text, '已写入 hello.txt。');
  const fin = evs[6];
  assert.ok(fin && fin.kind === 'step-finish');
  assert.deepEqual(fin.tokens, { total: 15, input: 10, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0 });
});

test('step_finish tokens: total missing is synthesized from parts; tokens absent → null', () => {
  const synth = parseOpencodeLine('{"type":"step_finish","sessionID":"ses_x","part":{"reason":"stop","type":"step-finish","tokens":{"input":3,"output":2,"reasoning":1,"cache":{"read":4,"write":5}}}}');
  assert.ok(synth.kind === 'step-finish');
  assert.deepEqual(synth.tokens, { total: 15, input: 3, output: 2, reasoning: 1, cacheRead: 4, cacheWrite: 5 });
  const none = parseOpencodeLine('{"type":"step_finish","sessionID":"ses_x","part":{"reason":"stop","type":"step-finish"}}');
  assert.ok(none.kind === 'step-finish');
  assert.equal(none.tokens, null);
  const junk = parseOpencodeLine('{"type":"step_finish","sessionID":"ses_x","part":{"reason":"stop","type":"step-finish","tokens":{"total":"9","input":"a"}}}');
  assert.ok(junk.kind === 'step-finish');
  assert.deepEqual(junk.tokens, { total: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 });
});

test('accumulateUsage sums every field; undefined prev counts as zero', () => {
  const t1 = { total: 15, input: 10, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
  assert.deepEqual(accumulateUsage(undefined, t1), t1);
  const t2 = { total: 7, input: 3, output: 2, reasoning: 1, cacheRead: 1, cacheWrite: 0 };
  assert.deepEqual(accumulateUsage(t1, t2), { total: 22, input: 13, output: 7, reasoning: 1, cacheRead: 1, cacheWrite: 0 });
});

test('permission-rejected tool call maps to rejected', () => {
  const tool = fixture('opencode-run-rejected.sample.jsonl').map(parseOpencodeLine).find((e) => e.kind === 'tool');
  assert.ok(tool && tool.kind === 'tool');
  assert.equal(toolStatus(tool), 'rejected');
});

test('error events, garbage lines and unknown types', () => {
  const err = parseOpencodeLine(fixture('opencode-error.sample.jsonl')[0] ?? '');
  assert.equal(err.kind, 'error');
  assert.match(err.kind === 'error' ? err.message : '', /free models/);
  assert.equal(parseOpencodeLine('Warning: something').kind, 'invalid');
  assert.equal(parseOpencodeLine('{"type":"reasoning","sessionID":"ses_x"}').kind, 'other');
  assert.equal(mapTodoStatus('cancelled'), 'completed');
  assert.equal(mapTodoStatus('weird'), 'pending');
});
