/** 轻量 toast：右下角短暂浮出，自动消失，不进入会话日志。 */
let host: HTMLElement | null = null;

export function toast(text: string, kind: 'info' | 'error' = 'info', ms = 2600): void {
  if (!host || !host.isConnected) {
    host = document.createElement('div');
    host.className = 'toast-host';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.append(host);
  }
  const el = document.createElement('div');
  el.className = `toast${kind === 'error' ? ' toast-error' : ''}`;
  el.textContent = text;
  host.append(el);
  window.setTimeout(() => {
    el.classList.add('toast-out');
    window.setTimeout(() => el.remove(), 200);
  }, ms);
}
