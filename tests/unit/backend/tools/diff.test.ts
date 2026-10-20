import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUnifiedDiff, diffStats, splitLines } from '../../../../src/backend/tools/diff.ts';

test('returns an empty string when contents are identical', () => {
  assert.equal(createUnifiedDiff('a\nb\n', 'a\nb\n', 'x.txt'), '');
});

test('produces a single-line replacement hunk', () => {
  const diff = createUnifiedDiff('# demo\n', '# Demo\n', 'README.md');
  assert.equal(diff, '--- a/README.md\n+++ b/README.md\n@@ -1,1 +1,1 @@\n-# demo\n+# Demo\n');
});

test('uses /dev/null and a 0,0 old range for new files', () => {
  const diff = createUnifiedDiff(null, 'one\ntwo\n', 'new.txt');
  assert.match(diff, /^--- \/dev\/null\n\+\+\+ b\/new\.txt\n@@ -0,0 \+1,2 @@\n\+one\n\+two\n$/);
});

test('keeps three lines of context and splits distant changes into hunks', () => {
  const oldLines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`);
  const newLines = [...oldLines];
  newLines[1] = 'CHANGED2';
  newLines[17] = 'CHANGED18';
  const diff = createUnifiedDiff(oldLines.join('\n') + '\n', newLines.join('\n') + '\n', 'f.txt');
  const headers = diff.split('\n').filter((l) => l.startsWith('@@'));
  assert.deepEqual(headers, ['@@ -1,5 +1,5 @@', '@@ -15,6 +15,6 @@']);
});

test('reports insertion position for pure additions', () => {
  const diff = createUnifiedDiff('a\nb\n', 'a\nNEW\nb\n', 'f.txt');
  assert.match(diff, /@@ -1,2 \+1,3 @@\n a\n\+NEW\n b\n/);
});

test('counts added and removed lines', () => {
  const diff = createUnifiedDiff('a\nb\nc\n', 'a\nB\nc\nd\n', 'f.txt');
  assert.deepEqual(diffStats(diff), { added: 2, removed: 1 });
});

test('treats CRLF and LF lines as equal content', () => {
  assert.deepEqual(splitLines('a\r\nb\r\n'), ['a', 'b']);
  assert.equal(createUnifiedDiff('a\r\nb\r\n', 'a\nb\n', 'f.txt'), '');
});
