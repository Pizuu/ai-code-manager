import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findIgnoringSpace, locateCandidates, locateText, stripMarkdown } from '../../../../src/frontend/lib/text-locate.ts';

test('findIgnoringSpace: 忽略空白与换行，返回原始偏移', () => {
  const hay = '前文 修复 登录\n页面 的问题。后文';
  const r = findIgnoringSpace(hay, '修复登录 页面的问题');
  assert.ok(r);
  assert.equal(hay.slice(r.start, r.end), '修复 登录\n页面 的问题');
  assert.equal(findIgnoringSpace(hay, '不存在'), null);
  assert.equal(findIgnoringSpace(hay, '   '), null);
});

test('stripMarkdown: 去掉强调、行内代码、标题、列表与链接语法', () => {
  assert.equal(stripMarkdown('## 标题\n- **加粗** 和 `code`\n[链接](http://x)'), '标题\n加粗 和 code\n链接');
});

test('locateText: 渲染后文本匹配 Markdown 原文；整段不中时退回首行', () => {
  const rendered = '标题加粗 和 code第二段';
  assert.ok(locateText(rendered, '## 标题\n**加粗** 和 `code`'));
  const r = locateText('第一行内容在这里', '第一行内容\n后面被改写的第二行');
  assert.ok(r);
  assert.equal('第一行内容在这里'.slice(r.start, r.end), '第一行内容');
  assert.equal(locateText('abc', ''), null);
});

test('locateCandidates: 去重、去空', () => {
  assert.deepEqual(locateCandidates('plain'), ['plain']);
  assert.equal(locateCandidates('**a**\nb').length, 3);
});
