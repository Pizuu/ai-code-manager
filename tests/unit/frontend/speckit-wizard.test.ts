import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SPECKIT_ACTIONS, buildInstruction, getSpeckitAction,
} from '../../../src/frontend/lib/speckit-wizard.ts';

/* ── 动作定义 ─────────────────────────────────────────────── */

test('六个动作齐全且讲解三段与字段定义完整', () => {
  assert.deepEqual(SPECKIT_ACTIONS.map((a) => a.id), ['specify', 'plan', 'tasks', 'implement', 'bug', 'assess']);
  for (const a of SPECKIT_ACTIONS) {
    assert.ok(a.buttonText.length > 0, a.id);
    assert.ok(a.commandPrefix.startsWith('/'), a.id);
    assert.ok(a.scene.length > 0 && a.actors.length > 0 && a.explain.length > 0, a.id);
    assert.ok(a.fields.length > 0, a.id);
    assert.equal(getSpeckitAction(a.id), a);
  }
});

/* ── 正常拼装 ─────────────────────────────────────────────── */

test('specify：前缀 + 功能描述（首尾空白被裁）', () => {
  assert.deepEqual(
    buildInstruction('specify', { description: '  给任务会话加收藏夹  ' }),
    { ok: true, text: '/specify 给任务会话加收藏夹' },
  );
});

test('plan：有约束拼参数、无约束只出命令本身', () => {
  assert.deepEqual(buildInstruction('plan', { constraints: '用 Vite + SQLite' }), { ok: true, text: '/plan 用 Vite + SQLite' });
  assert.deepEqual(buildInstruction('plan', { constraints: '' }), { ok: true, text: '/plan' });
  assert.deepEqual(buildInstruction('plan', {}), { ok: true, text: '/plan' });
});

test('tasks：补充要求选填', () => {
  assert.deepEqual(buildInstruction('tasks', { notes: '测试任务也要' }), { ok: true, text: '/tasks 测试任务也要' });
  assert.deepEqual(buildInstruction('tasks', { notes: '   ' }), { ok: true, text: '/tasks' });
});

test('implement：范围限定选填', () => {
  assert.deepEqual(buildInstruction('implement', { scope: '只做准备与基础阶段' }), { ok: true, text: '/implement 只做准备与基础阶段' });
  assert.deepEqual(buildInstruction('implement', {}), { ok: true, text: '/implement' });
});

test('bug：症状加引号 + slug 拼接', () => {
  assert.deepEqual(
    buildInstruction('bug', { symptom: '提交空密码时登录表单崩溃', slug: 'login-crash' }),
    { ok: true, text: '/speckit-bug-assess "提交空密码时登录表单崩溃" slug=login-crash' },
  );
});

test('assess：想法加引号 + slug 拼接', () => {
  assert.deepEqual(
    buildInstruction('assess', { idea: '让用户离线工作、重连后自动同步', slug: 'offline-mode' }),
    { ok: true, text: '/speckit-assess-intake "让用户离线工作、重连后自动同步" slug=offline-mode' },
  );
});

test('引号内文本含双引号时统一替换为单引号', () => {
  assert.deepEqual(
    buildInstruction('bug', { symptom: '点击"保存"后白屏', slug: 'save-blank' }),
    { ok: true, text: `/speckit-bug-assess "点击'保存'后白屏" slug=save-blank` },
  );
});

/* ── 必填校验 ─────────────────────────────────────────────── */

test('specify：功能描述缺失/纯空白报错不出指令', () => {
  const cases: Record<string, string>[] = [{}, { description: '' }, { description: '  \n ' }];
  for (const values of cases) {
    const r = buildInstruction('specify', values);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /功能描述/);
  }
});

test('bug：症状或 slug 任一缺失报错', () => {
  assert.equal(buildInstruction('bug', { slug: 'x' }).ok, false);
  assert.equal(buildInstruction('bug', { symptom: '崩溃' }).ok, false);
  assert.equal(buildInstruction('bug', {}).ok, false);
});

test('assess：想法或 slug 任一缺失报错', () => {
  assert.equal(buildInstruction('assess', { slug: 'x' }).ok, false);
  assert.equal(buildInstruction('assess', { idea: '做个插件系统' }).ok, false);
});

/* ── slug 校验 ────────────────────────────────────────────── */

test('slug 非法：大写/下划线/连字符开头/空格/中文一律拒绝', () => {
  for (const slug of ['Login-Crash', 'login_crash', '-login', 'log in', '登录崩溃']) {
    const r = buildInstruction('bug', { symptom: '崩溃', slug });
    assert.equal(r.ok, false, slug);
    if (!r.ok) assert.match(r.error, /slug/);
  }
});

test('slug 合法边界：单字符、纯数字、连续连字符可过', () => {
  for (const slug of ['a', '0', 'a--b', 'abc-123']) {
    assert.equal(buildInstruction('assess', { idea: '想法', slug }).ok, true, slug);
  }
});
