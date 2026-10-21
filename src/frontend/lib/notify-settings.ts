/**
 * 提醒偏好（功能 005，T-050）的纯逻辑：缺省合并、能力判定与稍后时长校验。
 *
 * 设置里存的 `PublicSettings.notify` 可能缺失或字段不全（老设置文件没有 v1.13 字段），
 * 呈现与保存一律先经 `resolveNotifySettings` 以 `DEFAULT_NOTIFY_SETTINGS` 补齐——
 * 缺失绝不呈现为全关（FR-512 默认值口径：系统通知 P0 / P1 开、P2 / P3 关，声音关，稍后 10 分钟）。
 */
import {
  DEFAULT_NOTIFY_SETTINGS,
  type NotifySettings,
  type PublicSettings,
  type ReminderLevel,
} from '../../../contracts/ipc.ts';

/** 提醒级别的固定呈现顺序（P0 最高优先）。 */
export const REMINDER_LEVELS: readonly ReminderLevel[] = ['P0', 'P1', 'P2', 'P3'];

/** 级别 → 分区内标注文案（该级管的事项：审批 / 受阻·出错 / 待审查 / 新 ready）。 */
export const REMINDER_LEVEL_LABELS: Readonly<Record<ReminderLevel, string>> = {
  P0: 'P0 · 审批',
  P1: 'P1 · 受阻 / 出错',
  P2: 'P2 · 待审查',
  P3: 'P3 · 新 ready',
};

/** 「稍后提醒时长」的可改边界（分钟，任务卡 T-050 口径）。 */
export const SNOOZE_MIN_MINUTES = 1;
export const SNOOZE_MAX_MINUTES = 120;

/**
 * 校验稍后时长：接受整数分钟或其字符串形态，须落在 [SNOOZE_MIN_MINUTES, SNOOZE_MAX_MINUTES]；
 * 合法返回分钟数，否则返回 null（空串、小数、越界、非数字一律不合法）。
 */
export function validateSnoozeMinutes(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n)) return null;
  return n >= SNOOZE_MIN_MINUTES && n <= SNOOZE_MAX_MINUTES ? n : null;
}

function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * 缺省合并：把可能缺失 / 字段不全的存量偏好补成完整的 `NotifySettings`。
 * 任一级别开关缺失或不是布尔值时取默认值；稍后时长不合法时取默认 10 分钟。
 * 返回全新对象（默认值常量是冻结的，不得直接引用回去修改）。
 */
export function resolveNotifySettings(input: NotifySettings | null | undefined): NotifySettings {
  const d = DEFAULT_NOTIFY_SETTINGS;
  const src: Partial<NotifySettings> = input && typeof input === 'object' ? input : {};
  const pick = (
    rec: Partial<Record<ReminderLevel, boolean>> | undefined,
    fallback: Record<ReminderLevel, boolean>,
  ): Record<ReminderLevel, boolean> => {
    const out = {} as Record<ReminderLevel, boolean>;
    for (const lv of REMINDER_LEVELS) out[lv] = boolOr(rec?.[lv], fallback[lv]);
    return out;
  };
  return {
    systemNotify: pick(src.systemNotify, d.systemNotify),
    sound: pick(src.sound, d.sound),
    snoozeMinutes: validateSnoozeMinutes(src.snoozeMinutes) ?? d.snoozeMinutes,
  };
}

/**
 * 系统（原生）通知能力判定：只有后端明确标记不可用（`notifyNativeAvailable === false`，
 * 典型为 Web 预览）才算不可用；字段缺失（老后端）按可用处理，不误伤桌面端。
 */
export function notifyNativeAvailable(
  settings: Pick<PublicSettings, 'notifyNativeAvailable'> | null | undefined,
): boolean {
  return settings?.notifyNativeAvailable !== false;
}
