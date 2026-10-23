import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeMessageWithAttachments, splitMessageAttachments, type MessageAttachment } from '../../../../src/frontend/lib/message-attachments.ts';

const att = (path: string): MessageAttachment => ({ name: path.split(/[\\/]/).pop() as string, path });

test('split: 无附件原文直通（不 trim 正文）', () => {
  const r = splitMessageAttachments('你好，帮我看下这段代码。\n第二行  ');
  assert.equal(r.text, '你好，帮我看下这段代码。\n第二行  ');
  assert.deepEqual(r.attachments, []);
});

test('split: 正文 + 单附件', () => {
  const r = splitMessageAttachments('请分析这个文件\n@src/app.ts');
  assert.equal(r.text, '请分析这个文件');
  assert.deepEqual(r.attachments, [{ name: 'app.ts', path: 'src/app.ts' }]);
});

test('split: 正文 + 多附件（顺序保持）', () => {
  const r = splitMessageAttachments('对比这两份\n@uploads/a.pdf\n@src/b.ts');
  assert.equal(r.text, '对比这两份');
  assert.deepEqual(r.attachments, [
    { name: 'a.pdf', path: 'uploads/a.pdf' },
    { name: 'b.ts', path: 'src/b.ts' },
  ]);
});

test('split: 仅附件无正文时 text 为空', () => {
  const r = splitMessageAttachments('@uploads/only.png');
  assert.equal(r.text, '');
  assert.deepEqual(r.attachments, [{ name: 'only.png', path: 'uploads/only.png' }]);
});

test('split: @ 行在正文中部不拆', () => {
  const content = '先看这个\n@src/mid.ts\n后面还有说明';
  const r = splitMessageAttachments(content);
  assert.equal(r.text, content);
  assert.deepEqual(r.attachments, []);
});

test('split: 中部 @ 行保留、仅尾随块被拆', () => {
  const r = splitMessageAttachments('说明\n@src/mid.ts\n结尾附件如下\n@uploads/end.pdf');
  assert.equal(r.text, '说明\n@src/mid.ts\n结尾附件如下');
  assert.deepEqual(r.attachments, [{ name: 'end.pdf', path: 'uploads/end.pdf' }]);
});

test('split: 正文以空行隔开附件块（拆出后 text 无尾随空行）', () => {
  const r = splitMessageAttachments('正文一段\n\n\n@uploads/a.pdf\n@uploads/b.pdf');
  assert.equal(r.text, '正文一段');
  assert.deepEqual(r.attachments.map((a) => a.path), ['uploads/a.pdf', 'uploads/b.pdf']);
});

test('split: 附件块被空行打断时只拆尾部连续段', () => {
  const r = splitMessageAttachments('正文\n@uploads/first.pdf\n\n@uploads/second.pdf');
  assert.equal(r.text, '正文\n@uploads/first.pdf');
  assert.deepEqual(r.attachments.map((a) => a.path), ['uploads/second.pdf']);
});

test('split: Windows 反斜杠 path 的 basename', () => {
  const r = splitMessageAttachments('看这个\n@uploads\\报告.pdf');
  assert.equal(r.text, '看这个');
  assert.deepEqual(r.attachments, [{ name: '报告.pdf', path: 'uploads\\报告.pdf' }]);
});

test('split: 含空格的行不是引用行', () => {
  const content = '正文\n@not a ref';
  const r = splitMessageAttachments(content);
  assert.equal(r.text, content);
  assert.deepEqual(r.attachments, []);
});

test('compose: 空文本只出引用块（无前导换行）', () => {
  assert.equal(composeMessageWithAttachments('', [att('uploads/a.pdf')]), '@uploads/a.pdf');
  assert.equal(composeMessageWithAttachments('   ', [att('uploads/a.pdf')]), '@uploads/a.pdf');
});

test('compose: 无附件返回原 text', () => {
  assert.equal(composeMessageWithAttachments('原文  ', []), '原文  ');
});

test('compose: 正文去尾随空白后拼引用块', () => {
  assert.equal(
    composeMessageWithAttachments('正文\n\n', [att('uploads/a.pdf'), att('src/b.ts')]),
    '正文\n@uploads/a.pdf\n@src/b.ts',
  );
});

test('往返一致性：split(compose(t, atts)) 还原 t 与 atts', () => {
  const atts = [att('uploads/a.pdf'), att('src/dir/b.ts')];
  const r = splitMessageAttachments(composeMessageWithAttachments('帮我看看这两个文件', atts));
  assert.equal(r.text, '帮我看看这两个文件');
  assert.deepEqual(r.attachments, atts);
  const only = splitMessageAttachments(composeMessageWithAttachments('', atts));
  assert.equal(only.text, '');
  assert.deepEqual(only.attachments, atts);
});

test('带空格的路径引用行可拆出（斜杠/扩展名判据）', () => {
  const r = splitMessageAttachments('看一下这个文件\n@uploads/我的 文件.pdf');
  assert.equal(r.text, '看一下这个文件');
  assert.deepEqual(r.attachments, [{ name: '我的 文件.pdf', path: 'uploads/我的 文件.pdf' }]);
});

test('@某人 一句话式正文行不误拆', () => {
  const c = '安排一下\n@张三 明天把报告发我';
  const r = splitMessageAttachments(c);
  assert.equal(r.text, c);
  assert.deepEqual(r.attachments, []);
});
