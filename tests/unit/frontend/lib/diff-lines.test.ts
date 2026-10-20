import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyDiff, countChanges } from '../../../../src/frontend/lib/diff-lines.ts';

const DIFF = '--- a/README.md\n+++ b/README.md\n@@ -1,2 +1,2 @@\n-# demo\n+# Demo\n keep\n';

test('classifies header, hunk, added, removed and context lines', () => {
  assert.deepEqual(classifyDiff(DIFF).map((l) => l.kind), ['meta', 'meta', 'hunk', 'del', 'add', 'ctx']);
});

test('counts changes without counting file headers', () => {
  assert.deepEqual(countChanges(DIFF), { added: 1, removed: 1 });
});

test('handles an empty diff', () => {
  assert.deepEqual(classifyDiff(''), []);
});
