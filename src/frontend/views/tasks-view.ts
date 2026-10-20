/**
 * Tasks 面板（FR-014）：只读展示项目 specs/<功能>/tasks.md，按功能与 Phase 分组。
 */
import type { SpecTask } from '../../../contracts/ipc.ts';
import { api, errorText } from '../api.ts';
import { clear, h } from '../lib/dom.ts';
import { store } from '../store.ts';

function taskRow(t: SpecTask): HTMLElement {
  const box = h('input', { attrs: { type: 'checkbox', disabled: '' } });
  box.checked = t.done;
  return h('div', { class: `task${t.done ? ' done' : ''}`, title: `第 ${t.line} 行` },
    box,
    h('span', { class: 'tid' }, t.id),
    t.parallel ? h('span', { class: 'tag' }, 'P') : null,
    t.story ? h('span', { class: 'tag' }, t.story) : null,
    t.lane ? h('span', { class: 'tag lane' }, t.lane) : null,
    h('span', { class: 'desc' }, t.description));
}

export async function refreshTasks(): Promise<void> {
  store.state.tasks = store.state.project ? await api.invoke('tasks:list') : [];
  store.emit('tasks');
}

export function mountTasksPanel(container: HTMLElement): void {
  const body = h('div');
  const status = h('span', { class: 'grow-text' });
  const refreshBtn = h('button', { class: 'ghost' }, '⟳ 刷新');
  container.append(h('div', { class: 'panel-toolbar' }, status, refreshBtn), body);

  const render = () => {
    clear(body);
    const files = store.state.tasks;
    const all = files.flatMap((f) => f.tasks);
    status.textContent = files.length ? `已完成 ${all.filter((t) => t.done).length} / ${all.length}` : '';
    if (!store.state.project) {
      body.append(h('div', { class: 'empty-hint' }, '打开项目后显示 specs/*/tasks.md 中的任务。'));
      return;
    }
    if (files.length === 0) {
      body.append(h('div', { class: 'empty-hint' }, '该项目没有 specs/*/tasks.md。可用 /specify → /plan → /tasks 生成。'));
      return;
    }
    for (const f of files) {
      const group = h('div', { class: 'task-group' }, h('h4', { title: f.relPath }, f.feature));
      let phase: string | null | undefined;
      for (const t of f.tasks) {
        if (t.phase !== phase) {
          phase = t.phase;
          if (phase) group.append(h('div', { class: 'task-phase' }, phase));
        }
        group.append(taskRow(t));
      }
      body.append(group);
    }
  };
  refreshBtn.addEventListener('click', () => {
    refreshTasks().catch((e: unknown) => { status.textContent = errorText(e); });
  });
  store.on('tasks', render);
  store.on('project', () => {
    refreshTasks().catch((e: unknown) => { status.textContent = errorText(e); });
  });
  render();
}
