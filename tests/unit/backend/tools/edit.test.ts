import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEdit } from '../../../../src/backend/tools/edit.ts';

test('replaces a unique occurrence', () => {
  assert.deepEqual(applyEdit('a b c', 'b', 'B'), { ok: true, content: 'a B c', replacements: 1 });
});

test('rejects missing, ambiguous, empty and no-op edits', () => {
  assert.equal(applyEdit('abc', 'x', 'y').ok, false);
  const amb = applyEdit('x x', 'x', 'y');
  assert.equal(amb.ok, false);
  assert.match(amb.ok ? '' : amb.error, /2 次/);
  assert.equal(applyEdit('abc', '', 'y').ok, false);
  assert.equal(applyEdit('abc', 'a', 'a').ok, false);
});

test('replace_all replaces every occurrence', () => {
  assert.deepEqual(applyEdit('x x x', 'x', 'y', true), { ok: true, content: 'y y y', replacements: 3 });
});

test('matches LF edits inside CRLF files and keeps CRLF', () => {
  const r = applyEdit('one\r\ntwo\r\nthree\r\n', 'one\ntwo', 'ONE\nTWO');
  assert.deepEqual(r, { ok: true, content: 'ONE\r\nTWO\r\nthree\r\n', replacements: 1 });
});

test('does not interpret $ patterns in the replacement', () => {
  const r = applyEdit('price', 'price', '$& $1');
  assert.deepEqual(r, { ok: true, content: '$& $1', replacements: 1 });
});
