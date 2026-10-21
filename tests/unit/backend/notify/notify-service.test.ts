import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentEvent, ApprovalRequest, NotifySettings } from '../../../../contracts/ipc.ts';
import { DEFAULT_NOTIFY_SETTINGS } from '../../../../contracts/ipc.ts';
import {
  NotifyService,
  type NativeNotificationPayload,
  type NotificationHandle,
  type Notifier,
  type NotifyClock,
} from '../../../../src/backend/notify/notify-service.ts';

class FakeClock implements NotifyClock {
  private t = 0;
  private seq = 0;
  private timers = new Map<number, { at: number; cb: () => void }>();
  now(): number { return this.t; }
  setTimeout(cb: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.timers.set(id, { at: this.t + ms, cb });
    return id;
  }
  clearTimeout(h: unknown): void { this.timers.delete(h as number); }
  advance(ms: number): void {
    const target = this.t + ms;
    for (;;) {
      const due = [...this.timers.entries()].filter(([, x]) => x.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      this.timers.delete(due[0]);
      this.t = due[1].at;
      due[1].cb();
    }
    this.t = target;
  }
  get pending(): number { return this.timers.size; }
}

interface Shown { payload: NativeNotificationPayload; closed: boolean; click(): void }
class FakeNotifier implements Notifier {
  readonly shown: Shown[] = [];
  supported = true;
  isSupported(): boolean { return this.supported; }
  show(payload: NativeNotificationPayload): NotificationHandle {
    let cb: (() => void) | null = null;
    const rec: Shown = { payload, closed: false, click: () => cb?.() };
    this.shown.push(rec);
    return { close: () => { rec.closed = true; }, onClick: (fn) => { cb = fn; } };
  }
}

function setup(opts: { focused?: boolean; settings?: NotifySettings } = {}) {
  const notifier = new FakeNotifier();
  const clock = new FakeClock();
  const events: AgentEvent[] = [];
  let focused = opts.focused ?? false;
  let focusCalls = 0;
  let settings = opts.settings ?? DEFAULT_NOTIFY_SETTINGS;
  const svc = new NotifyService({
    notifier,
    clock,
    isWindowFocused: () => focused,
    focusWindow: () => { focusCalls++; focused = true; },
    emit: (e) => events.push(e),
    getSettings: () => settings,
  });
  return {
    svc, notifier, clock, events,
    setFocused: (v: boolean) => { focused = v; },
    setSettings: (s: NotifySettings) => { settings = s; },
    focusCalls: () => focusCalls,
  };
}

const req = (id: string, over: Partial<ApprovalRequest> = {}): ApprovalRequest => ({
  id, sessionId: 's1', toolCallId: 'tc1', kind: 'command',
  command: 'npm run build\n--watch', shell: 'powershell.exe', ...over,
});

test('P0：窗口不在前台时发一条系统通知，标题含种类、副标题含会话名、正文含命令首行与 shell', () => {
  const { svc, notifier } = setup();
  svc.onApprovalRequest('s1', req('a1'), '修登录');
  assert.equal(notifier.shown.length, 1);
  const p = notifier.shown[0]!.payload;
  assert.match(p.title, /执行命令/);
  assert.match(p.subtitle ?? '', /修登录/);
  assert.match(p.body, /npm run build/);
  assert.match(p.body, /powershell\.exe/);
  assert.equal(p.silent, true); // 默认声音全关 → 静音
});

test('去重：同一 approvalId 重复投递只发一次（FR-504）', () => {
  const { svc, notifier } = setup();
  svc.onApprovalRequest('s1', req('a1'));
  svc.onApprovalRequest('s1', req('a1'));
  assert.equal(notifier.shown.length, 1);
});

test('窗口聚焦时不发系统通知', () => {
  const { svc, notifier } = setup({ focused: true });
  svc.onApprovalRequest('s1', req('a1'));
  assert.equal(notifier.shown.length, 0);
});

test('3 分钟升级恰一次：初始一条 + 升级一条，之后不再发（FR-506）', () => {
  const { svc, notifier, clock } = setup();
  svc.onApprovalRequest('s1', req('a1'));
  assert.equal(notifier.shown.length, 1);
  clock.advance(3 * 60 * 1000 - 1);
  assert.equal(notifier.shown.length, 1);
  clock.advance(1);
  assert.equal(notifier.shown.length, 2);
  assert.match(notifier.shown[1]!.payload.title, /等待 3 分钟/);
  clock.advance(10 * 60 * 1000);
  assert.equal(notifier.shown.length, 2);
});

test('升级兜底：产生时聚焦未发，3 分钟后已失焦则升级发出', () => {
  const { svc, notifier, clock, setFocused } = setup({ focused: true });
  svc.onApprovalRequest('s1', req('a1'));
  assert.equal(notifier.shown.length, 0);
  setFocused(false);
  clock.advance(3 * 60 * 1000);
  assert.equal(notifier.shown.length, 1);
  assert.match(notifier.shown[0]!.payload.title, /等待 3 分钟/);
});

test('解决后不再升级，且已发通知被关掉、定时器清净', () => {
  const { svc, notifier, clock } = setup();
  svc.onApprovalRequest('s1', req('a1'));
  svc.onApprovalResolved('s1', 'a1');
  assert.equal(notifier.shown[0]!.closed, true);
  assert.equal(clock.pending, 0);
  clock.advance(10 * 60 * 1000);
  assert.equal(notifier.shown.length, 1);
});

test('解决后同一 id 的新审批可再发（去重状态已删）', () => {
  const { svc, notifier } = setup();
  svc.onApprovalRequest('s1', req('a1'));
  svc.onApprovalResolved('s1', 'a1');
  svc.onApprovalRequest('s1', req('a1'));
  assert.equal(notifier.shown.length, 2);
});

test('偏好关掉 P0 系统通知：不发、不升级', () => {
  const off: NotifySettings = {
    ...DEFAULT_NOTIFY_SETTINGS,
    systemNotify: { ...DEFAULT_NOTIFY_SETTINGS.systemNotify, P0: false },
  };
  const { svc, notifier, clock } = setup({ settings: off });
  svc.onApprovalRequest('s1', req('a1'));
  clock.advance(10 * 60 * 1000);
  assert.equal(notifier.shown.length, 0);
});

test('环境不支持系统通知时静默降级不抛错（FR-513）', () => {
  const { svc, notifier, clock } = setup();
  notifier.supported = false;
  svc.onApprovalRequest('s1', req('a1'));
  clock.advance(10 * 60 * 1000);
  assert.equal(notifier.shown.length, 0);
});

test('点击审批通知：聚焦窗口 + notify-activate 载荷为 approval 目标（FR-503 / FR-508）', () => {
  const { svc, notifier, events, focusCalls } = setup();
  svc.onApprovalRequest('s1', req('a1'), '修登录');
  notifier.shown[0]!.click();
  assert.equal(focusCalls(), 1);
  assert.deepEqual(events, [{ type: 'notify-activate', target: { kind: 'approval', sessionId: 's1', approvalId: 'a1' } }]);
});

test('P1 会话出错：发一条、持续不重复、点击回传 session 目标', () => {
  const { svc, notifier, events, focusCalls } = setup();
  svc.onSessionError('s1', '模型请求失败：超时\n堆栈略', '修登录');
  svc.onSessionError('s1', '模型请求失败：超时');
  assert.equal(notifier.shown.length, 1);
  assert.match(notifier.shown[0]!.payload.body, /模型请求失败：超时/);
  assert.doesNotMatch(notifier.shown[0]!.payload.body, /堆栈/);
  notifier.shown[0]!.click();
  assert.equal(focusCalls(), 1);
  assert.deepEqual(events, [{ type: 'notify-activate', target: { kind: 'session', sessionId: 's1' } }]);
});

test('P1 恢复后可再发；偏好关掉 P1 不发', () => {
  const { svc, notifier, setSettings } = setup();
  svc.onSessionError('s1', 'boom');
  svc.onSessionRecovered('s1');
  svc.onSessionError('s1', 'boom again');
  assert.equal(notifier.shown.length, 2);
  setSettings({ ...DEFAULT_NOTIFY_SETTINGS, systemNotify: { ...DEFAULT_NOTIFY_SETTINGS.systemNotify, P1: false } });
  svc.onSessionRecovered('s1');
  svc.onSessionError('s1', 'boom third');
  assert.equal(notifier.shown.length, 2);
});

test('会话删除：清其升级定时器与出错通知，别的会话不受影响', () => {
  const { svc, notifier, clock } = setup();
  svc.onApprovalRequest('s1', req('a1'));
  svc.onApprovalRequest('s2', req('a2', { sessionId: 's2' }));
  svc.onSessionError('s1', 'boom');
  svc.onSessionDeleted('s1');
  assert.equal(clock.pending, 1); // 只剩 s2 的升级计时
  clock.advance(3 * 60 * 1000);
  // s1 的初始通知 + s2 的初始通知 + s1 出错通知 + s2 升级通知 = 4；s1 不再升级
  assert.equal(notifier.shown.length, 4);
  assert.match(notifier.shown[3]!.payload.title, /等待 3 分钟/);
});

test('声音偏好开时 silent=false', () => {
  const on: NotifySettings = { ...DEFAULT_NOTIFY_SETTINGS, sound: { ...DEFAULT_NOTIFY_SETTINGS.sound, P0: true } };
  const { svc, notifier } = setup({ settings: on });
  svc.onApprovalRequest('s1', req('a1'));
  assert.equal(notifier.shown[0]!.payload.silent, false);
});

test('edit 类审批正文含路径与 diff 增删行数', () => {
  const { svc, notifier } = setup();
  svc.onApprovalRequest('s1', req('a9', {
    kind: 'edit', path: 'src/a.ts', command: undefined, shell: undefined,
    diff: '--- a\n+++ b\n+new\n-old\n+new2',
  }));
  const p = notifier.shown[0]!.payload;
  assert.match(p.title, /修改文件/);
  assert.match(p.body, /src\/a\.ts/);
  assert.match(p.body, /\+2 \/ -1/);
});
