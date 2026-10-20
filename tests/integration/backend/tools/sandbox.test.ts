import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PathEscapeError, resolveSafe } from '../../../../src/backend/tools/sandbox.ts';

async function tempDirs() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'acm-sandbox-'));
  const root = path.join(base, 'repo');
  const outside = path.join(base, 'outside');
  await fs.mkdir(root);
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'secret.txt'), 'top secret');
  return { base, root, outside };
}

test('rejects a symlink that points outside the project root', async (t) => {
  const { base, root, outside } = await tempDirs();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  try {
    await fs.symlink(outside, path.join(root, 'link'), 'junction');
  } catch {
    t.skip('当前平台不允许创建符号链接');
    return;
  }
  await assert.rejects(resolveSafe(root, 'link/secret.txt'), PathEscapeError);
  await assert.rejects(resolveSafe(root, 'link/new-file.txt'), PathEscapeError);
});

test('allows files that do not exist yet inside the root', async (t) => {
  const { base, root } = await tempDirs();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  assert.equal(await resolveSafe(root, 'new/dir/file.ts'), path.join(root, 'new/dir/file.ts'));
});
