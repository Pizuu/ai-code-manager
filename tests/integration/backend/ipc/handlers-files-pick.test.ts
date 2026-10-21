/**
 * 系统文件选择（契约 v1.12）的 IPC 集成测试：`files:pick` 通道。
 * 真实对话框由 main.ts 注入 `pickFiles`（Electron dialog），此处注入假实现验证透传口径：
 * 注入时原样返回选中的绝对路径数组；未注入时返回空数组（按取消处理，测试 / Web 环境安全）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AppState } from '../../../../src/backend/app-state.ts';
import { createHandlers, type HandlerDeps } from '../../../../src/backend/ipc/handlers.ts';
import { SessionStore } from '../../../../src/backend/sessions/session-store.ts';
import { SettingsStore, type KeyCipher } from '../../../../src/backend/settings/settings-store.ts';

const cipher: KeyCipher = {
  isAvailable: () => true,
  encrypt: (p) => Buffer.from(p, 'utf8').toString('base64'),
  decrypt: (e) => Buffer.from(e, 'base64').toString('utf8'),
};

async function setup(t: { after: (fn: () => Promise<void>) => void }, pickFiles?: HandlerDeps['pickFiles']) {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'acm-userdata-'));
  t.after(() => fs.rm(userData, { recursive: true, force: true }));
  const settings = new SettingsStore(path.join(userData, 'settings.json'), cipher);
  const sessions = new SessionStore(path.join(userData, 'sessions'));
  const state = new AppState();
  const handlers = createHandlers({
    settings, sessions, state, platform: process.platform,
    emit: () => {},
    pickDirectory: async () => null,
    ...(pickFiles ? { pickFiles } : {}),
  });
  return { handlers };
}

test('files:pick 注入 pickFiles 时原样返回选中的文件绝对路径数组', async (t) => {
  const picked = ['/tmp/demo/a.txt', '/tmp/demo/b.md'];
  const { handlers } = await setup(t, async () => picked);
  assert.deepEqual(await handlers['files:pick'](), picked);
});

test('files:pick 未注入 pickFiles 时返回空数组（按取消处理）', async (t) => {
  const { handlers } = await setup(t);
  assert.deepEqual(await handlers['files:pick'](), []);
});
