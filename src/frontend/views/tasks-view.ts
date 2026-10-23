/**
 * Spec 任务（FR-014）：读取项目 specs/<功能>/tasks.md（只读），在任务会话右列显示。
 */
import { api } from '../api.ts';
import { store } from '../store.ts';

export async function refreshTasks(): Promise<void> {
  store.state.tasks = store.state.project ? await api.invoke('tasks:list') : [];
  store.emit('tasks');
}
