/**
 * 看板功能（规格）选择（契约 v1.4）：readFeature 的定向选择 / 无效回退，
 * 以及 listFeatures 的 id 升序与标题链（parseSpec 标题 || spec.md 一级标题 || id）。
 * 只读文件系统，不需要 git 仓库。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { listFeatureDirs, listFeatures, readFeature } from '../../../../src/backend/workspace/board.ts';

async function tempSpecs(
  t: { after: (fn: () => Promise<void>) => void },
  files: Record<string, string>,
): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'acm-specs-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
  }
  return root;
}

const STRICT = '# Feature Specification: 严格格式标题\n\n**Status**: Draft\n';
const PLAIN = '# 普通一级标题\n\n正文。\n';
const TASKS = '## Phase 1: Setup\n\n- [x] T001 [lane:contracts] a\n- [ ] T002 [lane:backend] b\n';

async function threeFeatures(t: { after: (fn: () => Promise<void>) => void }): Promise<string> {
  return tempSpecs(t, {
    'specs/001-strict/spec.md': STRICT,
    'specs/001-strict/tasks.md': TASKS,
    'specs/002-plain/spec.md': PLAIN,
    'specs/003-nospec/tasks.md': TASKS,
    'specs/README.md': '# 不是功能目录\n',
    'specs/12-short/spec.md': STRICT,
  });
}

test('listFeatureDirs: only NNN-* dirs, ascending', async (t) => {
  const root = await threeFeatures(t);
  assert.deepEqual(await listFeatureDirs(root), ['001-strict', '002-plain', '003-nospec']);
});

test('listFeatures: titles follow the parseSpec || heading || id chain', async (t) => {
  const root = await threeFeatures(t);
  assert.deepEqual(await listFeatures(root), [
    { id: '001-strict', title: '严格格式标题' },
    { id: '002-plain', title: '普通一级标题' },
    { id: '003-nospec', title: '003-nospec' },
  ]);
});

test('readFeature: defaults to the latest feature', async (t) => {
  const root = await threeFeatures(t);
  const f = await readFeature(root);
  assert.equal(f?.id, '003-nospec');
  assert.equal(f?.title, '003-nospec');
});

test('readFeature: honors a valid selection, with that feature\'s own task counts', async (t) => {
  const root = await threeFeatures(t);
  const f = await readFeature(root, '001-strict');
  assert.equal(f?.id, '001-strict');
  assert.equal(f?.title, '严格格式标题');
  assert.equal(f?.tasksDone, 1);
  assert.equal(f?.tasksTotal, 2);
});

test('readFeature: unknown / stale / traversal selections fall back to the latest', async (t) => {
  const root = await threeFeatures(t);
  for (const bad of ['999-nope', '002-plain ', '../001-strict', 'specs/001-strict', null, undefined, '']) {
    const f = await readFeature(root, bad);
    assert.equal(f?.id, '003-nospec', `selection ${JSON.stringify(bad)} should fall back`);
  }
});

test('readFeature / listFeatures: no specs at all', async (t) => {
  const root = await tempSpecs(t, { 'README.md': 'x' });
  assert.equal(await readFeature(root), null);
  assert.equal(await readFeature(root, '001-strict'), null);
  assert.deepEqual(await listFeatures(root), []);
});
