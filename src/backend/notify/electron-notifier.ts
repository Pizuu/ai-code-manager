/**
 * 系统通知的生产实现：Electron Notification（T-047）。
 * 单独成文件隔离 electron 依赖——notify-service.ts 与其单测不 import electron。
 */
import { Notification } from 'electron';
import type { NotificationHandle, NativeNotificationPayload, Notifier } from './notify-service.ts';

export function createElectronNotifier(): Notifier {
  return {
    isSupported: () => Notification.isSupported(),
    show(payload: NativeNotificationPayload): NotificationHandle {
      const n = new Notification({
        title: payload.title,
        ...(payload.subtitle ? { subtitle: payload.subtitle } : {}),
        body: payload.body,
        silent: payload.silent,
      });
      let clickCb: (() => void) | null = null;
      n.on('click', () => clickCb?.());
      n.show();
      return {
        close: () => n.close(),
        onClick: (cb) => { clickCb = cb; },
      };
    },
  };
}
