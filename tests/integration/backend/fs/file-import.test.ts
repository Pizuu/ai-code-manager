/**
 * 上传真实文件（契约 v1.14）的集成测试：`importFiles` 把项目外文件复制进 <root>/uploads/。
 * 口径：整批先全量校验后复制（任一源无效整批抛错、不落任何文件）；重名依次加 -1/-2
 * 后缀（扩展名前）；源已在 uploads/ 内且就是目标本身时原样返回不复制。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { importFiles } from '../../../../src/backend/fs/file-import.ts';

interface Fixture {
  root: string;
  outside: string;
}

async function setup(t: { after: (fn: () => Promise<void>) => void }): Promise<Fixture> {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'acm-import-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'project');
  const outside = path.join(base, 'outside');
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(outside, { recursive: true });
  return { root, outside };
}

async function write(dir: string, name: string, content: string): Promise<string> {
  const p = path.join(dir, name);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, content);
  return p;
}

test('基本复制：两个文件按入参顺序返回 uploads 相对路径，内容一致', async (t) => {
  const { root, outside } = await setup(t);
  const a = await write(outside, 'a.txt', 'hello');
  const b = await write(outside, 'sub/b.md', '# title');
  const rel = await importFiles(root, [a, b]);
  assert.deepEqual(rel, ['uploads/a.txt', 'uploads/b.md']);
  assert.equal(await fs.readFile(path.join(root, 'uploads', 'a.txt'), 'utf8'), 'hello');
  assert.equal(await fs.readFile(path.join(root, 'uploads', 'b.md'), 'utf8'), '# title');
});

test('重名冲突：目标已存在异内容时依次加 -1、-2 后缀（扩展名前）', async (t) => {
  const { root, outside } = await setup(t);
  await write(root, 'uploads/a.txt', 'original');
  const one = await write(outside, 'one/a.txt', 'one');
  const two = await write(outside, 'two/a.txt', 'two');
  assert.deepEqual(await importFiles(root, [one]), ['uploads/a-1.txt']);
  assert.deepEqual(await importFiles(root, [two]), ['uploads/a-2.txt']);
  assert.equal(await fs.readFile(path.join(root, 'uploads', 'a.txt'), 'utf8'), 'original');
  assert.equal(await fs.readFile(path.join(root, 'uploads', 'a-1.txt'), 'utf8'), 'one');
  assert.equal(await fs.readFile(path.join(root, 'uploads', 'a-2.txt'), 'utf8'), 'two');
});

test('同批嵌套同名：同批第二个同名文件自动加后缀，内容各归其位', async (t) => {
  const { root, outside } = await setup(t);
  const x1 = await write(outside, 'd1/x.txt', 'first');
  const x2 = await write(outside, 'd2/x.txt', 'second');
  const rel = await importFiles(root, [x1, x2]);
  assert.deepEqual(rel, ['uploads/x.txt', 'uploads/x-1.txt']);
  assert.equal(await fs.readFile(path.join(root, 'uploads', 'x.txt'), 'utf8'), 'first');
  assert.equal(await fs.readFile(path.join(root, 'uploads', 'x-1.txt'), 'utf8'), 'second');
});

test('源不存在：整批抛 E_NOT_FOUND 且不复制任何文件（校验先行）', async (t) => {
  const { root, outside } = await setup(t);
  const ok = await write(outside, 'ok.txt', 'ok');
  const missing = path.join(outside, 'missing.txt');
  await assert.rejects(() => importFiles(root, [ok, missing]), /E_NOT_FOUND/);
  await assert.rejects(() => fs.stat(path.join(root, 'uploads')), /ENOENT/);
});

test('源是目录：整批抛 E_VALIDATION', async (t) => {
  const { root, outside } = await setup(t);
  await assert.rejects(() => importFiles(root, [outside]), /E_VALIDATION/);
});

test('源已在 uploads 内：原样返回其相对路径，不复制、不生成后缀文件', async (t) => {
  const { root } = await setup(t);
  const inside = await write(root, 'uploads/keep.txt', 'keep');
  const rel = await importFiles(root, [inside]);
  assert.deepEqual(rel, ['uploads/keep.txt']);
  const names = await fs.readdir(path.join(root, 'uploads'));
  assert.deepEqual(names, ['keep.txt']);
});

test('空列表：返回空数组且不创建 uploads 目录', async (t) => {
  const { root } = await setup(t);
  assert.deepEqual(await importFiles(root, []), []);
  await assert.rejects(() => fs.stat(path.join(root, 'uploads')), /ENOENT/);
});
