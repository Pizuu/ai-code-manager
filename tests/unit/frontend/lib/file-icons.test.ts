import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileIconKind } from '../../../../src/frontend/lib/file-icons.ts';

test('目录按展开状态区分', () => {
  assert.equal(fileIconKind('src', true), 'dir');
  assert.equal(fileIconKind('src', true, true), 'dir-open');
});

test('按扩展名适配常见文件类型', () => {
  assert.equal(fileIconKind('src/frontend/main.ts'), 'code');
  assert.equal(fileIconKind('a/b.PY'), 'code');
  assert.equal(fileIconKind('index.html'), 'markup');
  assert.equal(fileIconKind('styles.css'), 'style');
  assert.equal(fileIconKind('fixtures/x.json'), 'data');
  assert.equal(fileIconKind('specs/005/spec.md'), 'doc');
  assert.equal(fileIconKind('logo.svg'), 'image');
  assert.equal(fileIconKind('scripts/verify.sh'), 'shell');
  assert.equal(fileIconKind('dist/app.asar'), 'archive');
  assert.equal(fileIconKind('schema.sql'), 'db');
  assert.equal(fileIconKind('guide.pdf'), 'pdf');
});

test('特殊文件名优先于扩展名', () => {
  assert.equal(fileIconKind('package.json'), 'package');
  assert.equal(fileIconKind('package-lock.json'), 'lock');
  assert.equal(fileIconKind('.gitignore'), 'git');
  assert.equal(fileIconKind('tsconfig.json'), 'config');
  assert.equal(fileIconKind('vite.config.ts'), 'config');
  assert.equal(fileIconKind('.env.local'), 'config');
  assert.equal(fileIconKind('.eslintrc.json'), 'config');
  assert.equal(fileIconKind('tests/unit/a.test.ts'), 'test');
  assert.equal(fileIconKind('LICENSE'), 'doc');
});

test('未知或无扩展名回落为通用文件', () => {
  assert.equal(fileIconKind('bin/run'), 'file');
  assert.equal(fileIconKind('x.unknownext'), 'file');
  assert.equal(fileIconKind('C:\\repo\\notes.txt'), 'doc');
});
