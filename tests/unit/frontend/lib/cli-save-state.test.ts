import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentCliConfig } from '../../../../contracts/ipc.ts';
import { CLI_SAVE_EMPTY_TITLE, cliSaveState } from '../../../../src/frontend/lib/cli-save-state.ts';
import { store } from '../../../../src/frontend/store.ts';

const oneCli = [{
  id: 'opencode-1', name: 'opencode', preset: 'opencode', command: 'opencode',
  args: [], resumeArgs: [], modelArgs: [], model: '', outputFormat: 'jsonl', env: [],
} as unknown as AgentCliConfig];

test('cliSaveState：空列表 → 禁用 + title 提示', () => {
  assert.deepEqual(cliSaveState([]), { disabled: true, title: CLI_SAVE_EMPTY_TITLE });
  assert.equal(CLI_SAVE_EMPTY_TITLE, '先添加一个 Agent CLI');
});

test('cliSaveState：未加载（undefined / null）按空列表处理 → 禁用 + title 提示', () => {
  assert.deepEqual(cliSaveState(undefined), { disabled: true, title: CLI_SAVE_EMPTY_TITLE });
  assert.deepEqual(cliSaveState(null), { disabled: true, title: CLI_SAVE_EMPTY_TITLE });
});

test('cliSaveState：非空列表 → 可用 + 无 title', () => {
  assert.deepEqual(cliSaveState(oneCli), { disabled: false, title: null });
});

test('cliSaveState：空 ↔ 非空两个方向的变迁都翻转（新增第一条 / 删到空）', () => {
  assert.equal(cliSaveState([]).disabled, true);
  assert.equal(cliSaveState(oneCli).disabled, false);
  assert.equal(cliSaveState(oneCli).title, null);
  assert.equal(cliSaveState([]).disabled, true);
  assert.equal(cliSaveState([]).title, CLI_SAVE_EMPTY_TITLE);
});

test('store.off：解绑后 emit 不再触发订阅（T-052 对话框关闭解绑的机制底座）', () => {
  let calls = 0;
  const fn = () => { calls += 1; };
  store.on('settings', fn);
  store.emit('settings');
  assert.equal(calls, 1);
  store.off('settings', fn);
  store.emit('settings');
  assert.equal(calls, 1);
});
