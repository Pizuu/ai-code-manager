import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentEvent, ApprovalRequest } from '../../../../contracts/ipc.ts';
import { DEFAULT_NOTIFY_SETTINGS } from '../../../../contracts/ipc.ts';
import { ActivateGate } from '../../../../src/backend/notify/activate-gate.ts';
import {
  NotifyService,
  type NativeNotificationPayload,
  type NotificationHandle,
  type Notifier,
} from '../../../../src/backend/notify/notify-service.ts';

type ActivateEvent = Extract<AgentEvent, { type: 'notify-activate' }>;

const activateApproval = (sessionId: string, approvalId: string): ActivateEvent => ({
  type: 'notify-activate',
  target: { kind: 'approval', sessionId, approvalId },
});

function setup() {
  const sent: AgentEvent[] = [];
  const gate = new ActivateGate((e) => sent.push(e));
  return { gate, sent };
}

test('未就绪时到达的激活只暂存、不发送', () => {
  const { gate, sent } = setup();
  gate.activate(activateApproval('s1', 'a1'));
  assert.deepEqual(sent, []);
  assert.equal(gate.isReady, false);
  assert.equal(gate.hasPending, true);
});

test('就绪时补发暂存恰一次，补发后暂存清空', () => {
  const { gate, sent } = setup();
  gate.activate(activateApproval('s1', 'a1'));
  gate.markReady();
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], activateApproval('s1', 'a1'));
  assert.equal(gate.isReady, true);
  assert.equal(gate.hasPending, false);
});

test('二次就绪不重发', () => {
  const { gate, sent } = setup();
  gate.activate(activateApproval('s1', 'a1'));
  gate.markReady();
  gate.markReady();
  assert.equal(sent.length, 1);
});

test('已就绪时到达的激活直发、不暂存', () => {
  const { gate, sent } = setup();
  gate.markReady();
  gate.activate(activateApproval('s1', 'a1'));
  gate.activate(activateApproval('s2', 'a2'));
  assert.equal(sent.length, 2);
  assert.equal(gate.hasPending, false);
});

test('未就绪期间多次激活只补发最新一次', () => {
  const { gate, sent } = setup();
  gate.activate(activateApproval('s1', 'a1'));
  gate.activate(activateApproval('s2', 'a2'));
  gate.activate({ type: 'notify-activate', target: { kind: 'session', sessionId: 's3' } });
  gate.markReady();
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], { type: 'notify-activate', target: { kind: 'session', sessionId: 's3' } });
});

test('无暂存时就绪不发送任何东西', () => {
  const { gate, sent } = setup();
  gate.markReady();
  assert.deepEqual(sent, []);
});

test('页面重载复位后，已投递的激活不重放', () => {
  const { gate, sent } = setup();
  gate.markReady();
  gate.activate(activateApproval('s1', 'a1'));
  assert.equal(sent.length, 1);
  gate.reset();
  assert.equal(gate.isReady, false);
  gate.markReady();
  assert.equal(sent.length, 1);
});

test('页面重载复位后到达的激活重新暂存，新页面就绪时补发', () => {
  const { gate, sent } = setup();
  gate.markReady();
  gate.reset();
  gate.activate(activateApproval('s1', 'a1'));
  assert.deepEqual(sent, []);
  gate.markReady();
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], activateApproval('s1', 'a1'));
});

test('尚未投递的暂存跨重载复位保留，就绪后仍补发（不因重载丢点击）', () => {
  const { gate, sent } = setup();
  gate.activate(activateApproval('s1', 'a1'));
  gate.reset();
  gate.markReady();
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], activateApproval('s1', 'a1'));
});

// ── 与 NotifyService 的接线：通知点击的 emit 经门出口 ──────────────────────────

interface Shown { payload: NativeNotificationPayload; click(): void }

class FakeNotifier implements Notifier {
  readonly shown: Shown[] = [];
  isSupported(): boolean { return true; }
  show(payload: NativeNotificationPayload): NotificationHandle {
    let cb: (() => void) | null = null;
    const rec: Shown = { payload, click: () => cb?.() };
    this.shown.push(rec);
    return { close: () => undefined, onClick: (fn) => { cb = fn; } };
  }
}

test('NotifyService 点击通知：未就绪暂存 → 就绪补发一次且载荷正确', () => {
  const sent: AgentEvent[] = [];
  const gate = new ActivateGate((e) => sent.push(e));
  const notifier = new FakeNotifier();
  let focusCalls = 0;
  const svc = new NotifyService({
    notifier,
    isWindowFocused: () => false,
    focusWindow: () => { focusCalls += 1; },
    emit: (e) => gate.activate(e),
    getSettings: () => DEFAULT_NOTIFY_SETTINGS,
    escalationMs: 60_000,
  });
  const req: ApprovalRequest = {
    id: 'ap-1',
    sessionId: 's1',
    toolCallId: 'tc-1',
    kind: 'command',
    command: 'npm test',
  };
  svc.onApprovalRequest('s1', req, '会话甲');
  assert.equal(notifier.shown.length, 1);
  // 渲染层未就绪时点击：窗口聚焦照常发生，但激活事件只暂存不发出
  notifier.shown[0]!.click();
  assert.equal(focusCalls, 1);
  assert.deepEqual(sent, []);
  // 就绪后补发恰一次
  gate.markReady();
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], activateApproval('s1', 'ap-1'));
  gate.markReady();
  assert.equal(sent.length, 1);
  svc.dispose();
});
