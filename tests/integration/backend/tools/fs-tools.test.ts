import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { listTree } from '../../../../src/backend/fs/file-tree.ts';
import { commitWrite, listDir, prepareEdit, prepareWrite, readFile } from '../../../../src/backend/tools/fs-tools.ts';
import { tempProject } from '../helpers/temp-project.ts';

test('list_dir shows dirs first with a trailing slash and hides ignored dirs', async (t) => {
  const root = await tempProject(t, { 'b.txt': '', 'a/x.ts': '', 'node_modules/p/i.js': '', '.git/HEAD': '' });
  assert.equal(await listDir(root, {}), 'a/\nb.txt');
  const tree = await listTree(root, 'a');
  assert.deepEqual(tree, [{ name: 'x.ts', relPath: 'a/x.ts', kind: 'file' }]);
});

test('read_file numbers lines and pages with offset/limit', async (t) => {
  const root = await tempProject(t, { 'f.txt': 'l1\nl2\nl3\nl4\n' });
  const out = await readFile(root, { path: 'f.txt', offset: 2, limit: 2 });
  assert.match(out, /^\s+2\tl2\n\s+3\tl3\n…（还有 2 行/);
});

test('read_file refuses binaries and paths outside the root', async (t) => {
  const root = await tempProject(t, { 'b.bin': Buffer.from([1, 0, 2]) });
  assert.match(await readFile(root, { path: 'b.bin' }), /二进制/);
  await assert.rejects(readFile(root, { path: '../etc/passwd' }), /E_PATH_ESCAPE/);
});

test('prepareWrite computes a diff without touching disk until commit', async (t) => {
  const root = await tempProject(t, { 'a.txt': 'old\n' });
  const prepared = await prepareWrite(root, { path: 'a.txt', content: 'new\n' });
  assert.match(prepared.diff, /-old\n\+new/);
  assert.equal(await fs.readFile(path.join(root, 'a.txt'), 'utf8'), 'old\n');
  await commitWrite(prepared);
  assert.equal(await fs.readFile(path.join(root, 'a.txt'), 'utf8'), 'new\n');
});

test('commit refuses to overwrite a file changed while awaiting approval', async (t) => {
  const root = await tempProject(t, { 'a.txt': 'v1\n' });
  const prepared = await prepareEdit(root, { path: 'a.txt', old_string: 'v1', new_string: 'v2' });
  await fs.writeFile(path.join(root, 'a.txt'), 'user edit\n');
  await assert.rejects(commitWrite(prepared), /被修改/);
});

test('write_file creates nested directories for new files', async (t) => {
  const root = await tempProject(t);
  const prepared = await prepareWrite(root, { path: 'deep/new/file.md', content: '# hi\n' });
  assert.match(prepared.diff, /^--- \/dev\/null/);
  await commitWrite(prepared);
  assert.equal(await fs.readFile(path.join(root, 'deep/new/file.md'), 'utf8'), '# hi\n');
});
