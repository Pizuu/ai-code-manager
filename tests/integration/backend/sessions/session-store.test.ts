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
