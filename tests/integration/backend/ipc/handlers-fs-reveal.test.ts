/**
 * 在资源管理器中显示（契约 v1.15）的 IPC 集成测试：`fs:reveal` 通道。
 * 无项目抛 E_NO_PROJECT；项目内路径以绝对路径交给注入的 revealPath；越界路径抛 E_PATH_ESCAPE 且不调用 revealPath（宪法 十一）。
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
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'acm-reveal-ipc-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const revealed: string[] = [];
  const state = new AppState();
  const handlers = createHandlers({
    settings: new SettingsStore(path.join(base, 'settings.json'), cipher),
    sessions: new SessionStore(path.join(base, 'sessions')),
    state, platform: process.platform,
    emit: () => {},
    pickDirectory: async () => null,
    revealPath: (p) => { revealed.push(p); },
  });
  const root = path.join(base, 'project');
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'src', 'a.ts'), '');
  return { handlers, state, root, revealed };
}

test('fs:reveal 无项目打开时抛 E_NO_PROJECT', async (t) => {
  const { handlers } = await setup(t);
  await assert.rejects(() => handlers['fs:reveal']('src/a.ts'), /E_NO_PROJECT/);
});

test('fs:reveal 项目内文件交给 revealPath，越界路径拒绝且不调用', async (t) => {
  const { handlers, state, root, revealed } = await setup(t);
  state.setProject(root);
  await handlers['fs:reveal']('src/a.ts');
  assert.deepEqual(revealed, [path.join(root, 'src', 'a.ts')]);
  await assert.rejects(() => handlers['fs:reveal']('../outside.txt'), /E_PATH_ESCAPE|路径/);
  assert.equal(revealed.length, 1);
});
