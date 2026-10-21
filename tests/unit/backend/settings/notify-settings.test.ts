import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_NOTIFY_SETTINGS } from '../../../../contracts/ipc.ts';
import { sanitizeNotifySettings, SettingsStore, type KeyCipher } from '../../../../src/backend/settings/settings-store.ts';
import { validateNotifySettings, validateSettingsUpdate } from '../../../../src/backend/ipc/validate.ts';

const cipher: KeyCipher = {
  isAvailable: () => true,
  encrypt: (plain) => Buffer.from(plain, 'utf8').toString('base64'),
  decrypt: (b64) => Buffer.from(b64, 'base64').toString('utf8'),
};

async function tempStore(): Promise<SettingsStore> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aicm-notify-settings-'));
  return new SettingsStore(path.join(dir, 'settings.json'), cipher);
}

test('sanitizeNotifySettings：缺省 / 残缺一律回落 DEFAULT 口径，snooze 夹取 1–120', () => {
  assert.deepEqual(sanitizeNotifySettings(undefined), DEFAULT_NOTIFY_SETTINGS);
  assert.deepEqual(sanitizeNotifySettings(null), DEFAULT_NOTIFY_SETTINGS);
  assert.deepEqual(sanitizeNotifySettings('x'), DEFAULT_NOTIFY_SETTINGS);
  const partial = sanitizeNotifySettings({ systemNotify: { P0: false }, snoozeMinutes: 999 });
  assert.equal(partial.systemNotify.P0, false);
  assert.equal(partial.systemNotify.P1, true); // 缺失级别回落默认（开）
  assert.equal(partial.sound.P0, false);
  assert.equal(partial.snoozeMinutes, 120);
});

test('getPublic：未存过 notify 时投影带 DEFAULT 偏好与能力标记 true（T-047）', async () => {
  const store = await tempStore();
  const pub = store.getPublic();
  assert.deepEqual(pub.notify, DEFAULT_NOTIFY_SETTINGS);
  assert.equal(pub.notifyNativeAvailable, true);
  assert.deepEqual(store.getNotifySettings(), DEFAULT_NOTIFY_SETTINGS);
});

test('getPublic：notifyNativeAvailable 如实投影宿主构造时注入的能力（桌面 true / Web 预览 false）', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'aicm-notify-cap-'));
  const file = path.join(dir, 'settings.json');
  const desktop = new SettingsStore(file, cipher, { notifyNativeAvailable: true });
  assert.equal(desktop.getPublic().notifyNativeAvailable, true);
  const web = new SettingsStore(file, cipher, { notifyNativeAvailable: false });
  assert.equal(web.getPublic().notifyNativeAvailable, false);
  // 能力是宿主事实而非设置数据：update 的回传投影同样带注入值，不被设置更新覆盖
  const pub = await web.update({ model: 'm' });
  assert.equal(pub.notifyNativeAvailable, false);
});

test('update(notify)：落盘后重读仍在，投影回传更新后的偏好', async () => {
  const store = await tempStore();
  const next = {
    systemNotify: { P0: false, P1: true, P2: true, P3: false },
    sound: { P0: true, P1: false, P2: false, P3: false },
    snoozeMinutes: 30,
  };
  const pub = await store.update({ notify: next });
  assert.deepEqual(pub.notify, next);
  const file = (store as unknown as { file: string }).file;
  const reloaded = new SettingsStore(file, cipher);
  await reloaded.load();
  assert.deepEqual(reloaded.getNotifySettings(), next);
});

test('validateNotifySettings：完整形状通过，缺级别 / 非布尔 / snooze 越界均 E_VALIDATION', () => {
  const ok = validateNotifySettings(DEFAULT_NOTIFY_SETTINGS);
  assert.deepEqual(ok, DEFAULT_NOTIFY_SETTINGS);
  assert.throws(() => validateNotifySettings({ systemNotify: { P0: true }, sound: DEFAULT_NOTIFY_SETTINGS.sound, snoozeMinutes: 10 }), /E_VALIDATION/);
  assert.throws(() => validateNotifySettings({ ...DEFAULT_NOTIFY_SETTINGS, snoozeMinutes: 0 }), /E_VALIDATION/);
  assert.throws(() => validateNotifySettings(null), /E_VALIDATION/);
});

test('validateSettingsUpdate：带 notify 时透传到 SettingsUpdate', () => {
  const out = validateSettingsUpdate({ notify: DEFAULT_NOTIFY_SETTINGS });
  assert.deepEqual(out.notify, DEFAULT_NOTIFY_SETTINGS);
  assert.equal(validateSettingsUpdate({}).notify, undefined);
});
