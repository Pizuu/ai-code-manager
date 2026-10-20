import { test } from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../../../src/frontend/store.ts';

const info = (id: string, sessionId = 's1') => ({
  id, sessionId, kind: 'shell' as const, program: 'PowerShell', cwd: 'C:\\p',
  startedAt: '2026-10-21T00:00:00.000Z', alive: true,
});

test('终端输出按会话记录，切回会话时仍在', () => {
  store.state.terminals.clear();
  store.setTerminal(info('t1'));
  store.appendTerminalOutput('s1', 't1', 'hello');
  store.appendTerminalOutput('s1', 't1', ' world');
  assert.equal(store.state.terminals.get('s1')?.buffer, 'hello world');
  store.state.terminals.clear();
});

test('重启前的旧终端残事件不影响新终端（terminalId 不匹配即忽略）', () => {
  store.state.terminals.clear();
  store.setTerminal(info('t1'));
  store.appendTerminalOutput('s1', 't1', 'keep');
  // 重启：新终端接管同一会话
  store.setTerminal(info('t2'));
  // 旧终端的迟到事件
  store.appendTerminalOutput('s1', 't1', 'stale');
  store.markTerminalExited('s1', 't1', 0);
  assert.equal(store.state.terminals.get('s1')?.buffer, 'keep');
  assert.equal(store.state.terminals.get('s1')?.alive, true);
  // 新终端自身的退出事件生效
  store.markTerminalExited('s1', 't2', 1);
  assert.equal(store.state.terminals.get('s1')?.alive, false);
  assert.equal(store.state.terminals.get('s1')?.exitCode, 1);
  store.state.terminals.clear();
});

test('清屏只清显示缓冲，不影响进程状态', () => {
  store.state.terminals.clear();
  store.setTerminal(info('t1'));
  store.appendTerminalOutput('s1', 't1', 'x');
  store.clearTerminalOutput('s1');
  assert.equal(store.state.terminals.get('s1')?.buffer, '');
  assert.equal(store.state.terminals.get('s1')?.alive, true);
  store.state.terminals.clear();
});
