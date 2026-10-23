/**
 * 契约 v1.4：board:setFeature 切换看板功能（规格）。
 * 覆盖：默认最新、切换后 board:get 跟随、null 回到自动、非法 id 被拒（E_VALIDATION）、
 * 未打开项目时与 board:get 同口径（返回不可用快照，不抛错）。
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
import { tempProject } from '../helpers/temp-project.ts';
import { gitIn } from '../helpers/temp-repo.ts';

const cipher: KeyCipher = {
  isAvailable: () => true,
  encrypt: (p) => Buffer.from(p).toString('base64'),
  decrypt: (e) => Buffer.from(e, 'base64').toString(),
};

const spec = (title: string) => `# Feature Specification: ${title}\n\n**Status**: Draft\n\n- **FR-001**: x\n`;

async function setup(t: { after: (fn: () => Promise<void>) => void }, pick = true) {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'acm-userdata-'));
  t.after(() => fs.rm(userData, { recursive: true, force: true }));
  const root = await tempProject(t, {
    '.agents/lanes.conf': 'contracts contracts/* specs/*\nbackend src/backend/*\nfrontend src/frontend/*\n@shared package.json AGENTS.md\n',
    '.agents/config.sh': 'MAIN_BRANCH="main"\nINTEGRATION_BRANCH="hark-dev"\nMAX_PARALLEL=4\nBRANCH_PREFIX="feat"\n',
    'specs/001-alpha/spec.md': spec('功能甲'),
    'specs/001-alpha/tasks.md': '## Phase 1\n\n- [x] T001 [lane:contracts] a\n',
    'specs/002-beta/spec.md': spec('功能乙'),
    'specs/002-beta/tasks.md': '## Phase 1\n\n- [ ] T001 [lane:contracts] a\n- [ ] T002 [lane:backend] b\n',
    'README.md': '# demo\n',
  });
  const git = gitIn(root);
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  const settings = new SettingsStore(path.join(userData, 'settings.json'), cipher);
  const sessions = new SessionStore(path.join(userData, 'sessions'));
  const state = new AppState();
  const handlers = createHandlers({
    settings, sessions, state, platform: process.platform,
    emit: () => {},
    pickDirectory: async () => root,
  });
  if (pick) await handlers['project:pick']();
  return { handlers, root };
}

test('board:get defaults to the latest feature and lists all features ascending', async (t) => {
  const { handlers } = await setup(t);
  const snap = await handlers['board:get']();
  assert.equal(snap.available, true);
  assert.equal(snap.feature?.id, '002-beta');
  assert.equal(snap.feature?.title, '功能乙');
  assert.deepEqual(snap.features, [
    { id: '001-alpha', title: '功能甲' },
    { id: '002-beta', title: '功能乙' },
  ]);
});

test('board:setFeature switches the feature and board:get follows until reset to auto', async (t) => {
  const { handlers } = await setup(t);
  const switched = await handlers['board:setFeature']({ featureId: '001-alpha' });
  assert.equal(switched.feature?.id, '001-alpha');
  assert.equal(switched.feature?.tasksDone, 1);
  assert.equal(switched.feature?.tasksTotal, 1);

  const after = await handlers['board:get']();
  assert.equal(after.feature?.id, '001-alpha');

  const reset = await handlers['board:setFeature']({ featureId: null });
  assert.equal(reset.feature?.id, '002-beta');
  const afterReset = await handlers['board:get']();
  assert.equal(afterReset.feature?.id, '002-beta');
});

test('board:setFeature rejects unknown and malformed ids', async (t) => {
  const { handlers } = await setup(t);
  await assert.rejects(handlers['board:setFeature']({ featureId: '003-nope' }), /E_VALIDATION/);
  await assert.rejects(handlers['board:setFeature']({ featureId: '../001-alpha' }), /E_VALIDATION/);
  await assert.rejects(handlers['board:setFeature']({ featureId: '001-alpha/tasks' }), /E_VALIDATION/);
  await assert.rejects(handlers['board:setFeature']({ featureId: 'alpha' }), /E_VALIDATION/);
  await assert.rejects(handlers['board:setFeature']({ featureId: 42 as unknown as string }), /E_VALIDATION/);
  await assert.rejects(handlers['board:setFeature']({} as { featureId: string | null }), /E_VALIDATION/);
  await assert.rejects(handlers['board:setFeature']('001-alpha' as unknown as { featureId: string | null }), /E_VALIDATION/);
  // 拒绝不改变当前选择
  const snap = await handlers['board:get']();
  assert.equal(snap.feature?.id, '002-beta');
});

test('board:setFeature without an opened project mirrors board:get (unavailable snapshot, no throw)', async (t) => {
  const { handlers } = await setup(t, false);
  const snap = await handlers['board:setFeature']({ featureId: '001-alpha' });
  assert.equal(snap.available, false);
  assert.match(snap.reason ?? '', /请先打开项目文件夹/);
  assert.deepEqual(snap.features, []);
  const got = await handlers['board:get']();
  assert.equal(got.available, false);
  assert.deepEqual(got.features, []);
});
