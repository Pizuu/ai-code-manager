import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_NOTIFY_SETTINGS, type NotifySettings } from '../../../../contracts/ipc.ts';
import {
  notifyNativeAvailable,
  REMINDER_LEVELS,
  resolveNotifySettings,
  validateSnoozeMinutes,
} from '../../../../src/frontend/lib/notify-settings.ts';

test('resolveNotifySettings：整体缺失时等于 FR-512 默认值，且不呈现为全关', () => {
  for (const input of [undefined, null] as const) {
    const r = resolveNotifySettings(input);
    assert.deepEqual(r, DEFAULT_NOTIFY_SETTINGS);
    assert.equal(r.systemNotify.P0, true);
    assert.equal(r.systemNotify.P1, true);
  }
});

test('resolveNotifySettings：返回新对象，不与冻结的默认值常量共享引用', () => {
  const r = resolveNotifySettings(undefined);
  assert.notEqual(r, DEFAULT_NOTIFY_SETTINGS);
  assert.notEqual(r.systemNotify, DEFAULT_NOTIFY_SETTINGS.systemNotify);
  r.systemNotify.P0 = false;
  assert.equal(DEFAULT_NOTIFY_SETTINGS.systemNotify.P0, true);
});

test('resolveNotifySettings：部分字段缺失时逐级补 DEFAULT，已存值不被覆盖', () => {
  const partial = {
    systemNotify: { P0: false, P2: true },
    sound: { P3: true },
  } as unknown as NotifySettings;
  const r = resolveNotifySettings(partial);
  assert.deepEqual(r.systemNotify, { P0: false, P1: true, P2: true, P3: false });
  assert.deepEqual(r.sound, { P0: false, P1: false, P2: false, P3: true });
  assert.equal(r.snoozeMinutes, DEFAULT_NOTIFY_SETTINGS.snoozeMinutes);
});

test('resolveNotifySettings：非布尔开关与不合法稍后时长回退默认值，合法时长保留', () => {
  const dirty = {
    systemNotify: { P0: 'yes', P1: 1, P2: false, P3: false },
    sound: { P0: false, P1: false, P2: false, P3: false },
    snoozeMinutes: 999,
  } as unknown as NotifySettings;
  const r = resolveNotifySettings(dirty);
  assert.equal(r.systemNotify.P0, true);
  assert.equal(r.systemNotify.P1, true);
  assert.equal(r.systemNotify.P2, false);
  assert.equal(r.snoozeMinutes, 10);
  assert.equal(resolveNotifySettings({ ...dirty, snoozeMinutes: 30 }).snoozeMinutes, 30);
});

test('validateSnoozeMinutes：边界 1 与 120 合法，越界 / 小数 / 空值不合法', () => {
  assert.equal(validateSnoozeMinutes(1), 1);
  assert.equal(validateSnoozeMinutes(120), 120);
  assert.equal(validateSnoozeMinutes('45'), 45);
  assert.equal(validateSnoozeMinutes(0), null);
  assert.equal(validateSnoozeMinutes(121), null);
  assert.equal(validateSnoozeMinutes(10.5), null);
  assert.equal(validateSnoozeMinutes(''), null);
  assert.equal(validateSnoozeMinutes('abc'), null);
  assert.equal(validateSnoozeMinutes(undefined), null);
  assert.equal(validateSnoozeMinutes(null), null);
});

test('notifyNativeAvailable：仅明确标记 false 才禁用，缺失字段按可用', () => {
  assert.equal(notifyNativeAvailable({ notifyNativeAvailable: false }), false);
  assert.equal(notifyNativeAvailable({ notifyNativeAvailable: true }), true);
  assert.equal(notifyNativeAvailable({}), true);
  assert.equal(notifyNativeAvailable(undefined), true);
  assert.equal(notifyNativeAvailable(null), true);
});

test('REMINDER_LEVELS：固定为 P0→P3 顺序', () => {
  assert.deepEqual([...REMINDER_LEVELS], ['P0', 'P1', 'P2', 'P3']);
});
