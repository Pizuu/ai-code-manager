import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAnsi, segmentStyle, xterm256 } from '../../../../src/frontend/lib/ansi.ts';

test('plain text becomes a single segment without styles', () => {
  const segs = parseAnsi('hello world\n');
  assert.equal(segs.length, 1);
  assert.equal(segs[0]?.text, 'hello world\n');
  assert.equal(segs[0]?.fg, undefined);
  assert.equal(segmentStyle(segs[0] as never), '');
});

test('SGR colors are applied to the text that follows', () => {
  const segs = parseAnsi('\x1b[31mred\x1b[0m plain');
  assert.equal(segs.length, 2);
  assert.equal(segs[0]?.text, 'red');
  assert.equal(segs[0]?.fg, '#e06c75');
  assert.equal(segs[1]?.text, ' plain');
  assert.equal(segs[1]?.fg, undefined);
});

test('bold, dim, underline and italic flags are kept', () => {
  const segs = parseAnsi('\x1b[1;2;4;3mstyled\x1b[0m');
  assert.equal(segs[0]?.bold, true);
  assert.equal(segs[0]?.dim, true);
  assert.equal(segs[0]?.underline, true);
  assert.equal(segs[0]?.italic, true);
  const style = segmentStyle(segs[0] as never);
  assert.match(style, /font-weight:600/);
  assert.match(style, /opacity:\.7/);
  assert.match(style, /text-decoration:underline/);
  assert.match(style, /font-style:italic/);
});

test('bright colors and 256-color / truecolor sequences are resolved', () => {
  assert.equal(parseAnsi('\x1b[91mbright\x1b[0m')[0]?.fg, '#ff7b86');
  assert.equal(parseAnsi('\x1b[38;5;196m256\x1b[0m')[0]?.fg, '#ff0000');
  assert.equal(parseAnsi('\x1b[38;2;10;20;30mrgb\x1b[0m')[0]?.fg, '#0a141e');
  assert.equal(parseAnsi('\x1b[48;5;21mbg\x1b[0m')[0]?.bg, '#0000ff');
});

test('cursor movement and OSC sequences are dropped, text is kept', () => {
  const segs = parseAnsi('\x1b[2J\x1b[Hclear\x1b]0;title\x07done');
  assert.equal(segs.map((s) => s.text).join(''), 'cleardone');
});

test('CRLF and lone CR are normalized to line breaks', () => {
  const segs = parseAnsi('a\r\nb\rc');
  assert.equal(segs.map((s) => s.text).join(''), 'a\nb\nc');
});

test('xterm256 palette covers base, cube and grayscale entries', () => {
  assert.equal(xterm256(0), '#3b4048');
  assert.equal(xterm256(9), '#ff7b86');
  assert.equal(xterm256(196), '#ff0000');
  assert.equal(xterm256(16), '#000000');
  assert.equal(xterm256(231), '#ffffff');
  assert.equal(xterm256(255), '#eeeeee');
  // 越界索引回退到默认前景色，不抛错
  assert.equal(typeof xterm256(999), 'string');
});

test('empty input yields no segments', () => {
  assert.deepEqual(parseAnsi(''), []);
});
