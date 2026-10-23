import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEND_ATTR } from '../../../../contracts/ui.ts';
import { clip, describeSource, fenceFor, formatSendText, insertBlock, sendAttrs, sourceFromAttrs } from '../../../../src/frontend/lib/context-send.ts';

test('code selection carries path:line range and a fenced block in the file language', () => {
  const text = formatSendText({ kind: 'code', path: 'src/a.ts', startLine: 5, endLine: 3, text: 'const a = 1;\nconst b = 2;\n' });
  assert.equal(text, '`src/a.ts:L3-L5`\n```ts\nconst a = 1;\nconst b = 2;\n```');
});

test('code without selection references the line, or the whole file', () => {
  assert.equal(formatSendText({ kind: 'code', path: 'README.md', startLine: 7, endLine: 7, text: '' }), '`README.md:L7`');
  assert.equal(formatSendText({ kind: 'code', path: 'README.md', startLine: 0, endLine: 0, text: '' }), '@README.md');
});

test('a fence longer than any backtick run in the content is used', () => {
  assert.equal(fenceFor('a ``` b'), '````');
  assert.equal(fenceFor('plain'), '```');
});

test('selection, file, card, commit and branch sources are labelled with their origin', () => {
  assert.equal(formatSendText({ kind: 'selection', text: '第一行\n第二行\n', origin: '泳道看板' }), '来源：泳道看板（选中文本）\n> 第一行\n> 第二行');
  assert.equal(formatSendText({ kind: 'file', path: 'src/main.ts', dir: false }), '@src/main.ts');
  assert.equal(formatSendText({ kind: 'file', path: 'src', dir: true }), '@src/（目录）');
  assert.equal(formatSendText({ kind: 'card', id: 'T-026', title: '代码查看', lane: 'frontend', status: '执行中' }), '任务 T-026「代码查看」（泳道 frontend · 执行中）');
  assert.equal(formatSendText({ kind: 'commit', sha: 'abcdef1234567890', subject: 'feat: x' }), '提交 abcdef1234567890「feat: x」');
  assert.equal(formatSendText({ kind: 'branch', name: 'feat/frontend/T-026-x', sha: 'abc1234', subject: '' }), '分支 feat/frontend/T-026-x @ abc1234');
  assert.equal(describeSource({ kind: 'commit', sha: 'abcdef1234567890', subject: '' }), 'abcdef1');
});

test('long content is clipped with a note', () => {
  const out = clip('x'.repeat(30), 10);
  assert.ok(out.startsWith('x'.repeat(10)));
  assert.match(out, /已截断，共 30 字符/);
});

test('data-send-* attributes round-trip through sendAttrs / sourceFromAttrs', () => {
  const card = { kind: 'card', id: 'T-1', title: 't', lane: 'docs', status: '就绪' } as const;
  const attrs = sendAttrs(card);
  assert.equal(attrs[SEND_ATTR.kind], 'card');
  assert.deepEqual(sourceFromAttrs((a) => attrs[a] ?? null), card);
  const dir = sendAttrs({ kind: 'file', path: 'docs', dir: true });
  assert.deepEqual(sourceFromAttrs((a) => dir[a] ?? null), { kind: 'file', path: 'docs', dir: true });
  assert.equal(sourceFromAttrs(() => null), null);
  assert.equal(sourceFromAttrs((a) => (a === SEND_ATTR.kind ? 'commit' : null)), null);
});

test('insertBlock separates the block from surrounding text with newlines and returns the caret', () => {
  assert.deepEqual(insertBlock('', 0, 0, '@a.ts'), { text: '@a.ts\n', caret: 6 });
  const r = insertBlock('请看', 2, 2, '@a.ts');
  assert.equal(r.text, '请看\n@a.ts\n');
  assert.equal(r.caret, r.text.length);
  assert.equal(insertBlock('x\ny', 2, 2, 'B').text, 'x\nB\ny');
});
