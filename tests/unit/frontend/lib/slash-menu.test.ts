import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SLASH_COMMANDS, type SlashCommandInfo } from '../../../../src/frontend/lib/slash-commands.ts';
import { commandHasArgs, filledTextFor, isPrimedText, wrapIndex } from '../../../../src/frontend/lib/slash-menu.ts';

const byName = (name: string): SlashCommandInfo => {
  const cmd = SLASH_COMMANDS.find((c) => c.name === name);
  assert.ok(cmd, `命令表应含 ${name}`);
  return cmd;
};

test('wrapIndex: 下移一格', () => {
  assert.equal(wrapIndex(0, 1, 10), 1);
  assert.equal(wrapIndex(4, 1, 10), 5);
});

test('wrapIndex: 上移一格', () => {
  assert.equal(wrapIndex(5, -1, 10), 4);
  assert.equal(wrapIndex(1, -1, 3), 0);
});

test('wrapIndex: 首尾循环（末尾下移回首、首位上移到末）', () => {
  assert.equal(wrapIndex(9, 1, 10), 0);
  assert.equal(wrapIndex(0, -1, 10), 9);
});

test('wrapIndex: 单条恒 0（任意 delta）', () => {
  assert.equal(wrapIndex(0, 1, 1), 0);
  assert.equal(wrapIndex(0, -1, 1), 0);
  assert.equal(wrapIndex(0, 7, 1), 0);
});

test('wrapIndex: 空集返回 -1（count 为 0 或负数）', () => {
  assert.equal(wrapIndex(0, 1, 0), -1);
  assert.equal(wrapIndex(3, -1, 0), -1);
  assert.equal(wrapIndex(0, 1, -2), -1);
});

test('wrapIndex: delta 跨多步', () => {
  assert.equal(wrapIndex(1, 25, 10), 6);
  assert.equal(wrapIndex(2, -13, 10), 9);
  assert.equal(wrapIndex(0, 10, 10), 0);
});

test('wrapIndex: index 先归一化再移', () => {
  assert.equal(wrapIndex(15, 0, 10), 5);
  assert.equal(wrapIndex(-3, 0, 10), 7);
  assert.equal(wrapIndex(12, 1, 10), 3);
});

test('commandHasArgs: 现有命令表逐条（带参 1 条 / 无参 3 条）', () => {
  // 注：Spec Kit 六命令已随专页下线（2026-10-21），命令表现剩 4 条。
  const expected: Record<string, boolean> = {
    '/init': false,
    '/clear': false,
    '/model': true,
    '/help': false,
  };
  assert.equal(SLASH_COMMANDS.length, Object.keys(expected).length, '命令表条数与断言表同步');
  for (const cmd of SLASH_COMMANDS) {
    assert.equal(commandHasArgs(cmd), expected[cmd.name], `${cmd.name} 的带参判定`);
  }
  assert.equal(SLASH_COMMANDS.filter(commandHasArgs).length, 1);
  assert.equal(SLASH_COMMANDS.filter((c) => !commandHasArgs(c)).length, 3);
});

test('filledTextFor: 带参命令尾随一个空格（光标落在参数位）', () => {
  assert.equal(filledTextFor(byName('/model')), '/model ');
});

test('filledTextFor: 无参命令不加空格', () => {
  assert.equal(filledTextFor(byName('/clear')), '/clear');
  assert.equal(filledTextFor(byName('/help')), '/help');
});

test('filledTextFor: 全表与 commandHasArgs 口径一致', () => {
  for (const cmd of SLASH_COMMANDS) {
    assert.equal(filledTextFor(cmd), cmd.name + (commandHasArgs(cmd) ? ' ' : ''), cmd.name);
  }
});

test('isPrimedText: 命令名本身 / 尾随空格 / 带参数均为预置有效', () => {
  assert.equal(isPrimedText('/clear', '/clear'), true);
  assert.equal(isPrimedText('/clear', '/clear '), true);
  assert.equal(isPrimedText('/model', '/model '), true);
  assert.equal(isPrimedText('/model', '/model gpt-5'), true);
  assert.equal(isPrimedText('/specify', '/specify 需求 一 二'), true);
  assert.equal(isPrimedText('/model', '/model\tgpt-5'), true);
});

test('isPrimedText: 文本被清空 → 取消', () => {
  assert.equal(isPrimedText('/clear', ''), false);
  assert.equal(isPrimedText('/clear', ' '), false);
});

test('isPrimedText: 命令名被改动（更长 / 更短 / 换命令）→ 取消', () => {
  assert.equal(isPrimedText('/clear', '/clearx'), false);
  assert.equal(isPrimedText('/clear', '/clea'), false);
  assert.equal(isPrimedText('/model', '/modelx gpt-5'), false);
  assert.equal(isPrimedText('/clear', '/help'), false);
});

test('isPrimedText: 不以该命令开头的普通文本 → 取消', () => {
  assert.equal(isPrimedText('/clear', '普通文本'), false);
  assert.equal(isPrimedText('/clear', 'clear'), false);
  assert.equal(isPrimedText('/clear', '看一下 /clear 的实现'), false);
  assert.equal(isPrimedText('/clear', ' /clear'), false);
});
