import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LiveSessionCache } from '../../../../src/frontend/lib/live-sessions.ts';

type S = { id: string; messages: string[] };

test('切走运行中的会话保留副本，切回复用；事件写入副本且标记非当前', () => {
  const cache = new LiveSessionCache<S>();
  const running = new Set(['A']);
  const isRunning = (id: string) => running.has(id);
  const a: S = { id: 'A', messages: ['思考中'] };
  const b: S = { id: 'B', messages: [] };
  cache.leave(a, 'B', isRunning);
  assert.deepEqual(cache.target(b, 'A'), { session: a, isCurrent: false });
  cache.target(b, 'A')?.session.messages.push('增量');
  assert.deepEqual(cache.target(b, 'B'), { session: b, isCurrent: true });
  assert.equal(cache.enter('A', isRunning), a);
  assert.deepEqual(a.messages, ['思考中', '增量']);
});

test('未运行的会话不缓存；回合结束清除；运行结束后进入回退到持久化版本', () => {
  const cache = new LiveSessionCache<S>();
  const running = new Set<string>(['A']);
  const isRunning = (id: string) => running.has(id);
  cache.leave({ id: 'C', messages: [] }, 'A', isRunning);
  assert.equal(cache.has('C'), false);
  const a: S = { id: 'A', messages: [] };
  cache.leave(a, 'B', isRunning);
  running.delete('A');
  assert.equal(cache.enter('A', isRunning), undefined);
  cache.finish('A');
  assert.equal(cache.target(null, 'A'), null);
  cache.leave(a, 'A', () => true); // 同一会话重选不缓存
  assert.equal(cache.has('A'), false);
});
