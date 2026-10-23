import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reaskCutIndex } from '../../../src/backend/sessions/reask.ts';

const m = (role: string, content: string) => ({ role, content });

test('hits: last user followed by assistant/tool messages cuts at that user', () => {
  const messages = [
    m('user', '第一个问题'),
    m('assistant', '回答一'),
    m('user', '第二个问题'),
    m('assistant', ''),
    m('tool', '工具结果'),
    m('assistant', '回答二'),
  ];
  assert.equal(reaskCutIndex(messages, '第二个问题'), 2);
});

test('hits: last user is the final message', () => {
  const messages = [m('assistant', '开场白'), m('user', '问题')];
  assert.equal(reaskCutIndex(messages, '问题'), 1);
});

test('misses: last user text differs', () => {
  const messages = [m('user', '旧问题'), m('assistant', '回答')];
  assert.equal(reaskCutIndex(messages, '新问题'), -1);
});

test('misses: strict equality (trailing space differs)', () => {
  const messages = [m('user', '问题 '), m('assistant', '回答')];
  assert.equal(reaskCutIndex(messages, '问题'), -1);
});

test('misses: no user message at all', () => {
  const messages = [m('assistant', '开场白'), m('tool', '结果')];
  assert.equal(reaskCutIndex(messages, '问题'), -1);
});

test('misses: empty message list', () => {
  assert.equal(reaskCutIndex([], '问题'), -1);
});

test('misses: same text earlier but the last user differs', () => {
  const messages = [
    m('user', '重复的问题'),
    m('assistant', '回答一'),
    m('user', '另一个问题'),
    m('assistant', '回答二'),
  ];
  assert.equal(reaskCutIndex(messages, '重复的问题'), -1);
});
