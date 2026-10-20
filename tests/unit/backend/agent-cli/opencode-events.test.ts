import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mapTodoStatus, parseOpencodeLine, toolStatus } from '../../../../src/backend/agent-cli/opencode-events.ts';

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
  assert.equal(fin.tokens, 15);
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
