import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Session } from '../../../../contracts/ipc.ts';
import { SessionStore } from '../../../../src/backend/sessions/session-store.ts';

const FIXTURES = path.resolve(import.meta.dirname, '../../../../contracts/fixtures');

async function store(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'acm-sessions-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  return { dir, s: new SessionStore(dir) };
}

test('round-trips the fixture session exactly, including tool call records (SC-005)', async (t) => {
  const { s, dir } = await store(t);
  const sample = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'session.sample.json'), 'utf8')) as Session;
  await s.save(sample);
  assert.deepEqual(await s.get(sample.id), sample);
  // 重新实例化（模拟重启）后仍可列出
  const again = new SessionStore(dir);
  assert.deepEqual((await again.list()).map((x) => x.id), [sample.id]);
});

test('lists sessions newest first and supports create, clear and delete', async (t) => {
  const { s } = await store(t);
  const a = await s.create('/p');
  const b = await s.create(null);
  await s.save({ ...a, updatedAt: '2999-01-01T00:00:00.000Z', messages: [{ id: 'm', role: 'user', content: 'x', createdAt: '' }] });
  assert.deepEqual((await s.list()).map((x) => x.id), [a.id, b.id]);
  const cleared = await s.clear(a.id);
  assert.equal(cleared.messages.length, 0);
  await s.delete(b.id);
  assert.deepEqual((await s.list()).map((x) => x.id), [a.id]);
  await assert.rejects(s.get(b.id), /E_NOT_FOUND/);
});

test('coalesces a burst of saves into at most two writes, last snapshot wins', async (t) => {
  const { s } = await store(t);
  const created = await s.create(null);
  // 统计实际落盘次数：writeFileAtomic 是 save 队列唯一的写出口，包一层计数
  const raw = s as unknown as { writeFileAtomic: (file: string, payload: string) => Promise<void> };
  const original = raw.writeFileAtomic.bind(s);
  let writes = 0;
  raw.writeFileAtomic = async (file, payload) => {
    writes++;
    await original(file, payload);
  };
  t.after(() => { raw.writeFileAtomic = original; });
  // 同一 tick 内突发 20 次：第一次的写是 I/O（宏任务），后续 save 的登记全是微任务，
  // 必在第一次写完成前登记完并合并为一个待写 payload——落盘恰好 2 次是确定性的。
  const base = await s.get(created.id);
  const jobs: Promise<void>[] = [];
  for (let i = 1; i <= 20; i++) {
    jobs.push(s.save({ ...base, title: `burst-${i}`, messages: [{ id: `m${i}`, role: 'user', content: `c${i}`, createdAt: '' }] }));
  }
  const results = await Promise.allSettled(jobs);
  assert.ok(results.every((r) => r.status === 'fulfilled'), 'every save in the burst must resolve');
  assert.equal(writes, 2);
  const onDisk = await s.get(created.id);
  assert.equal(onDisk.title, 'burst-20');
  assert.equal(onDisk.messages[0]?.content, 'c20');
});

test('snapshots the session at call time: later mutations do not leak into earlier saves', async (t) => {
  const { s } = await store(t);
  const created = await s.create(null);
  const working = await s.get(created.id);
  working.messages.push({ id: 'a', role: 'user', content: 'A', createdAt: '' });
  const p1 = s.save(working); // 快照含 A
  working.messages.push({ id: 'b', role: 'assistant', content: 'B', createdAt: '' });
  const p2 = s.save(working); // 快照含 A+B
  working.messages.push({ id: 'c', role: 'assistant', content: 'C', createdAt: '' }); // 两次调用之后再改，从未保存
  await Promise.all([p1, p2]);
  const onDisk = await s.get(created.id);
  assert.deepEqual(onDisk.messages.map((m) => m.content), ['A', 'B']);
});

test('concurrent saves for different sessions do not interfere', async (t) => {
  const { s } = await store(t);
  const a = await s.create(null);
  const b = await s.create(null);
  const jobs: Promise<void>[] = [];
  for (let i = 1; i <= 10; i++) {
    jobs.push(s.save({ ...a, title: `a-${i}` }));
    jobs.push(s.save({ ...b, title: `b-${i}` }));
  }
  await Promise.all(jobs);
  assert.equal((await s.get(a.id)).title, 'a-10');
  assert.equal((await s.get(b.id)).title, 'b-10');
});

test('a failed write rejects the saves it covered and does not wedge later saves', async (t) => {
  const { s, dir } = await store(t);
  const created = await s.create(null);
  const file = path.join(dir, `${created.id}.json`);
  // 把目标路径占成目录，让原子写的 rename 必然失败
  await fsp.rm(file);
  await fsp.mkdir(file);
  await assert.rejects(s.save({ ...created, title: 'doomed' }));
  await fsp.rmdir(file);
  // 队列未被失败卡死：下一次 save 正常落盘
  await s.save({ ...created, title: 'recovered' });
  assert.equal((await s.get(created.id)).title, 'recovered');
});

test('rejects ids that could escape the sessions directory', async (t) => {
  const { s } = await store(t);
  await assert.rejects(s.get('../settings'), /E_VALIDATION/);
  await assert.rejects(s.delete('..\\x'), /E_VALIDATION/);
});

test('skips corrupt files instead of failing the whole list', async (t) => {
  const { s, dir } = await store(t);
  const ok = await s.create(null);
  await fsp.writeFile(path.join(dir, 's-broken.json'), '{not json');
  const original = console.warn;
  console.warn = () => {};
  t.after(async () => { console.warn = original; });
  assert.deepEqual((await s.list()).map((x) => x.id), [ok.id]);
});
