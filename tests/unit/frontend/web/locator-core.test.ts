import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampBarPosition, copyText, cssPath, formatRecord, formatRecords, isToggleKey, markerLabel, srcFromStack, type ElLike,
} from '../../../../src/frontend/web/locator-core.ts';

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

test('formatRecord: 有备注插入「备注 + 」，空备注不留占位', () => {
  assert.equal(formatRecord(1, '修改', '修改按钮颜色', 'div.comp'), '1. 修改 + 修改按钮颜色 + div.comp');
  assert.equal(formatRecord(2, '删除', '', 'src/frontend/views/chat.ts:57  div.comp'), '2. 删除 + src/frontend/views/chat.ts:57  div.comp');
  assert.equal(formatRecord(3, '删除', '移除无效卡片', 'x'), '3. 删除 + 移除无效卡片 + x');
});

test('formatRecords 逐行输出并按当前顺序从 1 重新编号', () => {
  const recs = [
    { action: '修改' as const, note: '备注', selector: 'a' },
    { action: '删除' as const, note: '', selector: 'b' },
    { action: '修改' as const, note: '', selector: 'c' },
  ];
  assert.equal(formatRecords(recs), '1. 修改 + 备注 + a\n2. 删除 + b\n3. 修改 + c');
  assert.equal(formatRecords([recs[0]!, recs[2]!]), '1. 修改 + 备注 + a\n2. 修改 + c');
  assert.equal(formatRecords([]), '');
});

test('markerLabel: 无备注只显示操作，有备注显示「操作：备注」', () => {
  assert.equal(markerLabel('修改', ''), '修改');
  assert.equal(markerLabel('删除', '多余'), '删除：多余');
});

test('isToggleKey 只认 Alt+Q，Esc 与其他组合键都不是开关', () => {
  const k = (code: string, o: Partial<{ altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }> = {}) =>
    ({ code, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...o });
  assert.equal(isToggleKey(k('KeyQ', { altKey: true })), true);
  assert.equal(isToggleKey(k('Escape')), false);
  assert.equal(isToggleKey(k('KeyQ')), false);
  assert.equal(isToggleKey(k('KeyQ', { altKey: true, ctrlKey: true })), false);
  assert.equal(isToggleKey(k('KeyQ', { altKey: true, shiftKey: true })), false);
  assert.equal(isToggleKey(k('KeyW', { altKey: true })), false);
});

test('clampBarPosition: 默认在点击点右侧，右侧不够翻到左侧，底部避让并夹在视口内', () => {
  assert.deepEqual(clampBarPosition(100, 200, 300, 40, 1280, 800), { left: 112, top: 196 });
  // 右侧放不下 → 翻到点击点左侧
  assert.deepEqual(clampBarPosition(1200, 200, 300, 40, 1280, 800), { left: 888, top: 196 });
  // 底部放不下 → 上移到视口内（展开编辑器后高度变大）
  assert.deepEqual(clampBarPosition(100, 780, 300, 80, 1280, 800), { left: 112, top: 712 });
  // 视口比操作条还窄 / 矮 → 贴边 margin
  assert.deepEqual(clampBarPosition(50, 5, 300, 900, 200, 800), { left: 8, top: 8 });
});
