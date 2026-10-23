import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, renderInline, renderMarkdown } from '../../../../src/frontend/lib/markdown.ts';

test('escapes raw HTML from model output (no script or event handlers survive)', () => {
  const out = renderMarkdown('<script>alert(1)</script>\n<img src=x onerror="alert(2)">');
  assert.equal(out.includes('<script>'), false);
  assert.equal(out.includes('<img'), false);
  assert.match(out, /&lt;script&gt;/);
  assert.match(out, /onerror=&quot;/);
});

test('only http(s) links become anchors; javascript: stays text', () => {
  assert.match(renderInline('[ok](https://example.com/a?b=1&c=2)'), /<a href="https:\/\/example\.com\/a\?b=1&amp;c=2" target="_blank" rel="noreferrer noopener">ok<\/a>/);
  assert.equal(renderInline('[x](javascript:alert(1))').includes('<a'), false);
});

test('a link url cannot break out of the href attribute', () => {
  const out = renderInline('[x](https://e.com/"onmouseover="alert(1))');
  assert.equal(/href="[^"]*"onmouseover/.test(out), false);
});

test('renders fenced code blocks escaped, including an unclosed block while streaming', () => {
  assert.equal(renderMarkdown('```ts\nconst a = 1 < 2;\n```'), '<pre><code class="lang-typescript" data-lang="TypeScript"><span class="tk-kw">const</span> a = <span class="tk-num">1</span> &lt; <span class="tk-num">2</span>;</code></pre>');
  assert.match(renderMarkdown('```\npartial'), /<pre><code>partial<\/code><\/pre>/);
});

test('renders headings, lists, quotes, tables and inline formatting', () => {
  const out = renderMarkdown('# 标题\n\n- **粗** 和 *斜*\n- `a<b`\n\n1. one\n2. two\n\n> 引用\n\n| a | b |\n|---|---|\n| 1 | 2 |');
  assert.match(out, /<h3>标题<\/h3>/);
  assert.match(out, /<ul><li><strong>粗<\/strong> 和 <em>斜<\/em><\/li><li><code>a&lt;b<\/code><\/li><\/ul>/);
  assert.match(out, /<ol><li>one<\/li><li>two<\/li><\/ol>/);
  assert.match(out, /<blockquote>引用<\/blockquote>/);
  assert.match(out, /<table><thead><tr><th>a<\/th><th>b<\/th><\/tr><\/thead><tbody><tr><td>1<\/td><td>2<\/td><\/tr><\/tbody><\/table>/);
});

test('code spans are not formatted further', () => {
  assert.equal(renderInline('`**not bold**`'), '<code>**not bold**</code>');
});

test('escapeHtml covers quotes and ampersands', () => {
  assert.equal(escapeHtml(`<a href="x" title='y'>&</a>`), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
});
