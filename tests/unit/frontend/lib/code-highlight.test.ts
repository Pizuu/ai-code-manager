import assert from 'node:assert/strict';
import test from 'node:test';
import { detectLang, highlightCode, normalizeLang } from '../../../../src/frontend/lib/code-highlight.ts';
import { renderMarkdown } from '../../../../src/frontend/lib/markdown.ts';

test('normalizeLang：别名归一，未知返回 null', () => {
  assert.equal(normalizeLang('ts'), 'typescript');
  assert.equal(normalizeLang('PY'), 'python');
  assert.equal(normalizeLang('yml'), 'yaml');
  assert.equal(normalizeLang('brainfuck'), null);
});

test('detectLang：常见语言启发式识别', () => {
  assert.equal(detectLang('{"a": 1}'), 'json');
  assert.equal(detectLang('def foo(x):\n    return x'), 'python');
  assert.equal(detectLang('npm install\ngit status'), 'bash');
  assert.equal(detectLang('const a = 1;\nconsole.log(a);'), 'javascript');
  assert.equal(detectLang('interface A { x: string }'), 'typescript');
  assert.equal(detectLang('SELECT * FROM t WHERE id = 1'), 'sql');
  assert.equal(detectLang('<div class="a">hi</div>'), 'html');
  assert.equal(detectLang('hello world'), null);
});

test('highlightCode：着色且所有源码文本被转义（不产生可执行 HTML）', () => {
  const html = highlightCode('const s = "<img src=x onerror=alert(1)>"; // <b>', 'javascript');
  assert.match(html, /<span class="tk-kw">const<\/span>/);
  assert.match(html, /<span class="tk-com">/);
  assert.ok(!html.includes('<img'), '字符串里的标签必须被转义');
  assert.ok(!html.includes('<b>'), '注释里的标签必须被转义');
  const stripped = html.replace(/<span class="tk-[a-z]+">|<\/span>/g, '');
  assert.ok(!/[<>]/.test(stripped), '除固定 span 外不得残留尖括号');
});

test('highlightCode：HTML 代码本身也只输出转义文本', () => {
  const html = highlightCode('<script>alert(1)</script>', 'html');
  assert.ok(!html.includes('<script'));
});

test('renderMarkdown：代码块带 lang 类与 data-lang，未标注时自动识别', () => {
  const a = renderMarkdown('```ts\nlet x: number = 1\n```');
  assert.match(a, /<code class="lang-typescript" data-lang="TypeScript">/);
  const b = renderMarkdown('```\ndef f():\n    pass\n```');
  assert.match(b, /class="lang-python"/);
  const c = renderMarkdown('```\nplain text here\n```');
  assert.match(c, /<pre><code>plain text here<\/code><\/pre>/);
});
