import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesGlob } from '../../../../src/backend/tools/glob.ts';

test('globs without a slash match the file name anywhere', () => {
  assert.equal(matchesGlob('src/a/b.ts', '*.ts'), true);
  assert.equal(matchesGlob('src/a/b.tsx', '*.ts'), false);
});

test('double star matches zero or more directories', () => {
  assert.equal(matchesGlob('src/x.md', 'src/**/*.md'), true);
  assert.equal(matchesGlob('src/a/b/x.md', 'src/**/*.md'), true);
  assert.equal(matchesGlob('docs/x.md', 'src/**/*.md'), false);
});

test('braces and question marks work and dots are literal', () => {
  assert.equal(matchesGlob('a.ts', '*.{ts,js}'), true);
  assert.equal(matchesGlob('a.js', '*.{ts,js}'), true);
  assert.equal(matchesGlob('axts', '*.ts'), false);
  assert.equal(matchesGlob('a1.txt', 'a?.txt'), true);
});
