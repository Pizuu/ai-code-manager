import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readFileForView } from '../../../../src/backend/fs/file-view.ts';
import { tempProject } from '../helpers/temp-project.ts';

const small = { maxBytes: 100, previewBytes: 20, binarySniffBytes: 8 };

test('reads a text file inside the project and strips a BOM', async (t) => {
  const root = await tempProject(t, { 'src/a.ts': '\uFEFFconst a = 1;\n' });
  const f = await readFileForView(root, 'src/../src/a.ts');
  assert.deepEqual(f, { relPath: 'src/a.ts', size: 16, kind: 'text', content: 'const a = 1;\n', truncated: false });
});

test('rejects paths outside the project root, including absolute paths', async (t) => {
  const root = await tempProject(t, { 'a.txt': 'x' });
  await assert.rejects(readFileForView(root, '../a.txt'), /E_PATH_ESCAPE/);
  await assert.rejects(readFileForView(root, path.join(os.tmpdir(), 'x.txt')), /E_PATH_ESCAPE/);
  await assert.rejects(readFileForView(root, '.'), /E_VALIDATION/);
});

test('rejects a symlink that escapes the project root', { skip: process.platform === 'win32' ? '需要管理员权限创建符号链接' : false }, async (t) => {
  const outside = await tempProject(t, { 'secret.txt': 'top secret' });
  const root = await tempProject(t, {});
  await fs.symlink(path.join(outside, 'secret.txt'), path.join(root, 'link.txt'));
  await assert.rejects(readFileForView(root, 'link.txt'), /E_PATH_ESCAPE/);
});

test('directories and missing files are refused with error codes', async (t) => {
  const root = await tempProject(t, { 'src/a.ts': 'x' });
  await assert.rejects(readFileForView(root, 'src'), /E_VALIDATION: src 是目录/);
  await assert.rejects(readFileForView(root, 'nope.ts'), /E_NOT_FOUND/);
});

test('binary files are detected and their content is not returned', async (t) => {
  const root = await tempProject(t, { 'img.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]) });
  const f = await readFileForView(root, 'img.png', small);
  assert.equal(f.kind, 'binary');
  assert.equal(f.content, '');
});

test('large files are truncated at the last complete line; oversized files return no content', async (t) => {
  const root = await tempProject(t, { 'mid.txt': 'line-1\nline-2\nline-3\nline-4\nline-5\n', 'huge.txt': 'y'.repeat(101) });
  const mid = await readFileForView(root, 'mid.txt', small);
  assert.equal(mid.kind, 'text');
  assert.equal(mid.truncated, true);
  assert.equal(mid.content, 'line-1\nline-2\n');
  const huge = await readFileForView(root, 'huge.txt', small);
  assert.deepEqual(huge, { relPath: 'huge.txt', size: 101, kind: 'too-large', content: '', truncated: false });
});
