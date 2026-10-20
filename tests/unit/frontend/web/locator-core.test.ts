import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyText, cssPath, srcFromStack, type ElLike } from '../../../../src/frontend/web/locator-core.ts';

test('srcFromStack skips the DOM factory and returns the first view frame', () => {
  const stack = [
    'Error',
    '    at Document.createElement (http://127.0.0.1:5173/src/frontend/web/locator.ts:20:30)',
    '    at h (http://127.0.0.1:5173/src/frontend/lib/dom.ts:15:23)',
    '    at mountChat (http://127.0.0.1:5173/src/frontend/views/chat.ts:57:22)',
    '    at bootstrap (http://127.0.0.1:5173/src/frontend/main.ts:190:3)',
  ].join('\n');
  assert.equal(srcFromStack(stack), 'src/frontend/views/chat.ts:57');
  assert.equal(srcFromStack('Error\n    at x (http://h/other.js:1:1)'), null);
});

const el = (tag: string, o: Partial<ElLike> = {}): ElLike => ({ tag, id: '', classes: [], nthOfType: 1, sameTypeCount: 1, parent: null, ...o });

test('cssPath stops at an id, drops state classes and adds nth-of-type for siblings', () => {
  const app = el('DIV', { id: 'app' });
  const sx = el('DIV', { classes: ['sx'], parent: app });
  const mid = el('DIV', { classes: ['mid'], parent: sx });
  const btn = el('BUTTON', { classes: ['send', 'on'], nthOfType: 2, sameTypeCount: 2, parent: mid });
  assert.equal(cssPath(btn), '#app > div.sx > div.mid > button.send:nth-of-type(2)');
  assert.equal(cssPath(btn, 2), 'div.mid > button.send:nth-of-type(2)');
  assert.equal(cssPath(el('SPAN', { parent: el('BODY') })), 'span');
});

test('copyText joins file:line and selector', () => {
  assert.equal(copyText('src/frontend/views/chat.ts:57', 'div.comp'), 'src/frontend/views/chat.ts:57  div.comp');
  assert.equal(copyText(null, 'div'), '（未知源文件）  div');
});
