/**
 * 右栏标签页（Diff / 终端 / 任务）与权限模式选择器（FR-009）。
 */
import type { PermissionMode } from '../../../contracts/ipc.ts';
import { api, errorText } from '../api.ts';
import { clear, h } from '../lib/dom.ts';
import { store } from '../store.ts';
import { mountDiffPanel } from './diff-view.ts';
import { MODE_LABELS } from './settings-dialog.ts';
import { mountTasksPanel, refreshTasks } from './tasks-view.ts';
import { mountTerminalPanel } from './terminal-view.ts';

type TabId = 'diff' | 'terminal' | 'tasks';

export function mountRightPanel(container: HTMLElement): { show(tab: TabId): void } {
  clear(container);
  const panels: Record<TabId, HTMLElement> = { diff: h('div', { class: 'panel' }), terminal: h('div', { class: 'panel' }), tasks: h('div', { class: 'panel' }) };
  const labels: Record<TabId, string> = { diff: 'Diff', terminal: '终端', tasks: '任务' };
  const counts: Record<TabId, HTMLElement> = { diff: h('span', { class: 'count' }), terminal: h('span', { class: 'count' }), tasks: h('span', { class: 'count' }) };
  const tabs = {} as Record<TabId, HTMLButtonElement>;
  let active: TabId = 'diff';

  const show = (tab: TabId) => {
    active = tab;
    for (const id of Object.keys(panels) as TabId[]) {
      panels[id].hidden = id !== tab;
      tabs[id].classList.toggle('active', id === tab);
    }
    if (tab === 'tasks') void refreshTasks().catch(() => undefined);
  };
  const bar = h('div', { class: 'tabs' });
  for (const id of Object.keys(panels) as TabId[]) {
    tabs[id] = h('button', { class: 'tab', on: { click: () => show(id) } }, labels[id], counts[id]);
    bar.append(tabs[id]);
  }
  container.append(bar, panels.diff, panels.terminal, panels.tasks);
  mountDiffPanel(panels.diff);
  mountTerminalPanel(panels.terminal);
  mountTasksPanel(panels.tasks);

  // 有新的待批准请求时切到对应标签，便于用户看到 diff 或命令
  let knownApprovals = new Set<string>();
  store.on('approvals', () => {
    const pending = [...store.state.approvals.values()];
    const fresh = pending.find((a) => !knownApprovals.has(a.id));
    knownApprovals = new Set(pending.map((a) => a.id));
    if (fresh) show(fresh.kind === 'edit' ? 'diff' : 'terminal');
    const n = pending.filter((a) => a.kind === 'edit').length;
    counts.diff.textContent = n ? String(n) : '';
  });
  store.on('terminal', () => {
    counts.terminal.textContent = active !== 'terminal' && store.state.terminal.length ? '•' : '';
  });
  show('diff');
  return { show };
}

export function createModeSelector(onError: (text: string) => void): HTMLSelectElement {
  const sel = h('select', { title: '权限模式' });
  for (const [value, label] of Object.entries(MODE_LABELS) as Array<[PermissionMode, string]>) sel.append(h('option', { attrs: { value } }, label));
  const sync = () => {
    if (store.state.settings) sel.value = store.state.settings.permissionMode;
  };
  sel.addEventListener('change', async () => {
    try {
      store.state.settings = await api.invoke('settings:set', { permissionMode: sel.value as PermissionMode });
      store.emit('settings');
    } catch (e) {
      onError(errorText(e));
      sync();
    }
  });
  store.on('settings', sync);
  sync();
  return sel;
}
