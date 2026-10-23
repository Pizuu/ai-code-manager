/**
 * 上传真实文件（契约 v1.14）的 IPC 集成测试：`files:import` 通道。
 * 无项目打开抛 E_NO_PROJECT（与其它 requireProject 通道同口径）；打开项目后把真实
 * 临时文件复制进 <root>/uploads/ 并返回相对路径；入参非字符串数组抛 E_VALIDATION。
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

async function setup(t: { after: (fn: () => Promise<void>) => void }) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'acm-import-ipc-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const settings = new SettingsStore(path.join(base, 'settings.json'), cipher);
  const sessions = new SessionStore(path.join(base, 'sessions'));
  const state = new AppState();
  const handlers = createHandlers({
    settings, sessions, state, platform: process.platform,
    emit: () => {},
    pickDirectory: async () => null,
  });
  const root = path.join(base, 'project');
  await fs.mkdir(root, { recursive: true });
  return { handlers, state, root, base };
}

test('files:import 无项目打开时抛 E_NO_PROJECT', async (t) => {
  const { handlers } = await setup(t);
  await assert.rejects(() => handlers['files:import'](['/tmp/whatever.txt']), /E_NO_PROJECT/);
});

test('files:import 打开项目后复制进 uploads 并返回相对路径；入参非法抛 E_VALIDATION', async (t) => {
  const { handlers, state, root, base } = await setup(t);
  state.setProject(root);
  const src = path.join(base, 'note.txt');
  await fs.writeFile(src, 'imported');
  assert.deepEqual(await handlers['files:import']([src]), ['uploads/note.txt']);
  assert.equal(await fs.readFile(path.join(root, 'uploads', 'note.txt'), 'utf8'), 'imported');
  await assert.rejects(() => handlers['files:import']('not-an-array' as unknown as string[]), /E_VALIDATION/);
});
