import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { PathEscapeError, resolveInsideRoot, toRelPosix } from '../../../../src/backend/tools/sandbox.ts';

const P = path.posix;
const W = path.win32;

test('resolves relative paths inside a posix root', () => {
  assert.equal(resolveInsideRoot('/repo', 'src/a.ts', P), '/repo/src/a.ts');
  assert.equal(resolveInsideRoot('/repo', './src/../README.md', P), '/repo/README.md');
  assert.equal(resolveInsideRoot('/repo', '', P), '/repo');
  assert.equal(resolveInsideRoot('/repo', '.', P), '/repo');
});

test('allows names that merely start with two dots', () => {
  assert.equal(resolveInsideRoot('/repo', '..config/x', P), '/repo/..config/x');
});

test('rejects parent traversal and absolute paths outside the root (posix)', () => {
  for (const bad of ['..', '../secret.txt', 'src/../../etc/passwd', '/etc/passwd', '/repo-other/x', '/repo/../x']) {
    assert.throws(() => resolveInsideRoot('/repo', bad, P), PathEscapeError, bad);
  }
});

test('accepts an absolute path that is inside the root', () => {
  assert.equal(resolveInsideRoot('/repo', '/repo/src/x.ts', P), '/repo/src/x.ts');
});

test('rejects NUL bytes', () => {
  assert.throws(() => resolveInsideRoot('/repo', 'a\0b', P), PathEscapeError);
});

test('rejects other drives, UNC paths and traversal on win32', () => {
  const root = 'C:\\work\\repo';
  for (const bad of ['D:\\x.txt', 'D:x.txt', '\\\\server\\share\\x', '..\\secret', 'C:\\work\\other\\x', 'src\\..\\..\\x']) {
    assert.throws(() => resolveInsideRoot(root, bad, W), PathEscapeError, bad);
  }
});

test('treats win32 paths case-insensitively and accepts forward slashes', () => {
  const root = 'C:\\work\\repo';
  assert.equal(resolveInsideRoot(root, 'c:\\WORK\\repo\\src\\a.ts', W), 'c:\\WORK\\repo\\src\\a.ts');
  assert.equal(resolveInsideRoot(root, 'src/a.ts', W), 'C:\\work\\repo\\src\\a.ts');
});

test('toRelPosix uses forward slashes and "." for the root', () => {
  assert.equal(toRelPosix('C:\\r', 'C:\\r\\a\\b.ts', W), 'a/b.ts');
  assert.equal(toRelPosix('/r', '/r', P), '.');
});
