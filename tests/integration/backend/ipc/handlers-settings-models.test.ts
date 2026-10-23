/**
 * API 模型列表（契约 v1.16）的 IPC 集成测试：`settings:models`。
 * 未配置 baseUrl / Key 时返回空列表与说明；配置后用注入的 fetch 拉取；请求失败不抛错而返回 error。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AppState } from '../../../../src/backend/app-state.ts';
import { createHandlers } from '../../../../src/backend/ipc/handlers.ts';
import { SessionStore } from '../../../../src/backend/sessions/session-store.ts';
import { SettingsStore, type KeyCipher } from '../../../../src/backend/settings/settings-store.ts';

const cipher: KeyCipher = {
  isAvailable: () => true,
  encrypt: (p) => Buffer.from(p, 'utf8').toString('base64'),
  decrypt: (e) => Buffer.from(e, 'base64').toString('utf8'),
};

async function setup(t: { after: (fn: () => Promise<void>) => void }, status = 200) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'acm-models-ipc-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const handlers = createHandlers({
    settings: new SettingsStore(path.join(base, 'settings.json'), cipher),
    sessions: new SessionStore(path.join(base, 'sessions')),
    state: new AppState(), platform: process.platform,
    emit: () => {},
    pickDirectory: async () => null,
    modelsFetch: (async () => new Response(JSON.stringify({ data: [{ id: 'm-b' }, { id: 'm-a' }] }), { status })) as typeof fetch,
  });
  return handlers;
}

test('settings:models 未配置时返回空列表与说明', async (t) => {
  const handlers = await setup(t);
  const r = await handlers['settings:models']();
  assert.deepEqual(r.models, []);
  assert.match(r.error ?? '', /Base URL|Key/);
});

test('settings:models 配置后返回排序后的模型；HTTP 失败返回 error', async (t) => {
  const handlers = await setup(t);
  await handlers['settings:set']({ provider: 'openai', baseUrl: 'https://llm.example/v1', apiKey: { provider: 'openai', value: 'k' } });
  assert.deepEqual(await handlers['settings:models'](), { models: ['m-a', 'm-b'] });
  const failing = await setup(t, 500);
  await failing['settings:set']({ provider: 'openai', baseUrl: 'https://llm.example/v1', apiKey: { provider: 'openai', value: 'k' } });
  const r = await failing['settings:models']();
  assert.deepEqual(r.models, []);
  assert.match(r.error ?? '', /HTTP 500/);
});
