import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AppState } from '../../../../src/backend/app-state.ts';
import { createHandlers } from '../../../../src/backend/ipc/handlers.ts';
import { SessionStore } from '../../../../src/backend/sessions/session-store.ts';
import { SettingsStore, type KeyCipher } from '../../../../src/backend/settings/settings-store.ts';
import { tempProject } from '../helpers/temp-project.ts';
import { gitIn, writeFiles } from '../helpers/temp-repo.ts';

const cipher: KeyCipher = {
  isAvailable: () => true,
  encrypt: (p) => Buffer.from(p).toString('base64'),
  decrypt: (e) => Buffer.from(e, 'base64').toString(),
};

/** 临时仓库：main 与 topic 两个分支，file.txt 内容不同；handlers 已打开该项目（pick=false 时不打开）。 */
async function setup(t: { after: (fn: () => Promise<void>) => void }, pick = true) {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'acm-userdata-'));
  t.after(() => fs.rm(userData, { recursive: true, force: true }));
  const root = await tempProject(t, { 'file.txt': 'base\n' });
  const git = gitIn(root);
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  git('checkout', '-q', '-b', 'topic');
  await writeFiles(root, { 'file.txt': 'topic\n' });
  git('add', '-A');
  git('commit', '-q', '-m', 'topic');
  git('checkout', '-q', 'main');
  const settings = new SettingsStore(path.join(userData, 'settings.json'), cipher);
  const sessions = new SessionStore(path.join(userData, 'sessions'));
  const state = new AppState();
  const handlers = createHandlers({
    settings, sessions, state, platform: process.platform,
    emit: () => {},
    pickDirectory: async () => root,
  });
  if (pick) await handlers['project:pick']();
  return { handlers, root, git };
}

test('git:checkout switches the branch and returns the fresh snapshot', async (t) => {
  const { handlers, git } = await setup(t);
  const before = await handlers['git:get']();
  assert.equal(before.currentBranch, 'main');
  const snap = await handlers['git:checkout']('topic');
  assert.equal(snap.available, true);
  assert.equal(snap.currentBranch, 'topic');
  assert.equal(git('rev-parse', '--abbrev-ref', 'HEAD').trim(), 'topic');
  // 已在目标分支：直接返回当前快照，不重复 checkout
  const again = await handlers['git:checkout']('topic');
  assert.equal(again.currentBranch, 'topic');
});

test('git:checkout propagates git refusal as E_GIT with stderr', async (t) => {
  const { handlers, root, git } = await setup(t);
  // 未提交改动会被 topic 分支的 file.txt 覆盖 → git 拒绝切换
  await writeFiles(root, { 'file.txt': 'dirty\n' });
  await assert.rejects(handlers['git:checkout']('topic'), /E_GIT: error: Your local changes/);
  assert.equal(git('rev-parse', '--abbrev-ref', 'HEAD').trim(), 'main');
});

test('git:checkout validates the branch name', async (t) => {
  const { handlers } = await setup(t);
  await assert.rejects(handlers['git:checkout'](''), /E_VALIDATION/);
  await assert.rejects(handlers['git:checkout']('   '), /E_VALIDATION/);
  await assert.rejects(handlers['git:checkout']('-topic'), /E_VALIDATION/);
  await assert.rejects(handlers['git:checkout']('a b'), /E_VALIDATION/);
  await assert.rejects(handlers['git:checkout'](42), /E_VALIDATION/);
});

test('git:checkout requires an opened project', async (t) => {
  const { handlers } = await setup(t, false);
  await assert.rejects(handlers['git:checkout']('topic'), /E_NO_PROJECT/);
});
