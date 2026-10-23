import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { builtinConfigProblem, SettingsStore, type KeyCipher } from '../../../../src/backend/settings/settings-store.ts';

/** 假加密器：反转 + base64，足以证明落盘的不是明文。 */
function fakeCipher(available = true): KeyCipher {
  return {
    isAvailable: () => available,
    encrypt: (plain) => Buffer.from([...plain].reverse().join(''), 'utf8').toString('base64'),
    decrypt: (enc) => [...Buffer.from(enc, 'base64').toString('utf8')].reverse().join(''),
  };
}

async function tempFile(t: { after: (fn: () => Promise<void>) => void }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'acm-settings-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return path.join(dir, 'settings.json');
}

test('never exposes the api key through public settings or the file in plain text', async (t) => {
  const file = await tempFile(t);
  const store = new SettingsStore(file, fakeCipher());
  await store.load();
  const pub = await store.update({ apiKey: { provider: 'openai', value: 'sk-SECRET-123' } });
  assert.equal(pub.hasApiKey.openai, true);
  assert.equal(JSON.stringify(pub).includes('sk-SECRET-123'), false);
  assert.equal((await fs.readFile(file, 'utf8')).includes('sk-SECRET-123'), false);
  assert.equal(store.getApiKey('openai'), 'sk-SECRET-123');
});

test('persists settings across instances', async (t) => {
  const file = await tempFile(t);
  const a = new SettingsStore(file, fakeCipher());
  await a.update({ model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1', permissionMode: 'plan' });
  const b = new SettingsStore(file, fakeCipher());
  await b.load();
  assert.equal(b.getPublic().model, 'deepseek-chat');
  assert.equal(b.getPublic().permissionMode, 'plan');
});

test('003: base url and model default to blank and switching provider never fills them in', async (t) => {
  const store = new SettingsStore(await tempFile(t), fakeCipher());
  await store.load();
  const fresh = store.getPublic();
  assert.equal(fresh.baseUrl, '');
  assert.equal(fresh.model, '');
  assert.equal(builtinConfigProblem(store.getActive())?.includes('Base URL、模型'), true);
  let pub = await store.update({ provider: 'anthropic' });
  assert.equal(pub.baseUrl, '');
  assert.equal(pub.model, '');
  await store.update({ baseUrl: 'https://llm.example.test', model: 'm1' });
  assert.equal(builtinConfigProblem(store.getActive()), null);
  pub = await store.update({ provider: 'openai' });
  assert.equal(pub.baseUrl, 'https://llm.example.test');
  pub = await store.update({ model: '', baseUrl: '' });
  assert.equal(pub.model, '');
  assert.match(builtinConfigProblem(store.getActive()) ?? '', /模型/);
});

test('refuses to store a key when encryption is unavailable', async (t) => {
  const store = new SettingsStore(await tempFile(t), fakeCipher(false));
  await assert.rejects(store.update({ apiKey: { provider: 'openai', value: 'k' } }), /E_ENCRYPTION/);
  assert.equal(store.getPublic().hasApiKey.openai, false);
});

test('an empty key value deletes the stored key', async (t) => {
  const store = new SettingsStore(await tempFile(t), fakeCipher());
  await store.update({ apiKey: { provider: 'openai', value: 'k' } });
  const pub = await store.update({ apiKey: { provider: 'openai', value: '' } });
  assert.equal(pub.hasApiKey.openai, false);
  assert.equal(store.getApiKey('openai'), null);
});
