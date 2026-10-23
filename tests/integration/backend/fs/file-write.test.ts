import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeTextFile } from '../../../../src/backend/fs/file-write.ts';
import { tempProject } from '../helpers/temp-project.ts';

test('writes UTF-8 text to an existing project file and returns normalized content', async (t) => {
  const root = await tempProject(t, { 'src/a.ts': '旧内容\n' });
  const result = await writeTextFile(root, 'src/../src/a.ts', '新内容\n第二行');
  assert.deepEqual(result, { relPath: 'src/a.ts', size: Buffer.byteLength('新内容\n第二行'), kind: 'text', content: '新内容\n第二行', truncated: false });
  assert.equal(await fs.readFile(path.join(root, 'src/a.ts'), 'utf8'), '新内容\n第二行');
});

test('rejects writes outside the project root and to missing files', async (t) => {
  const root = await tempProject(t, { 'a.txt': 'x' });
  await assert.rejects(writeTextFile(root, '../escape.txt', 'bad'), /E_PATH_ESCAPE/);
  await assert.rejects(writeTextFile(root, 'missing.txt', 'bad'), /E_NOT_FOUND/);
});
