/**
 * 渲染进程入口：加载初始状态、挂载视图、把 agent:event 分发到状态与视图。
 */
import type { AgentEvent, ChatMessage, Session } from '../../contracts/ipc.ts';
import { api, errorText } from './api.ts';
import { store } from './store.ts';
import { mountChat, type ChatView } from './views/chat.ts';
import { openSettings } from './views/settings-dialog.ts';
import { mountSidebar } from './views/sidebar.ts';

let chat: ChatView;

function findMessage(id: string): ChatMessage | undefined {
  return store.state.current?.messages.find((m) => m.id === id);
}

export async function selectSession(id: string): Promise<void> {
  store.state.current = await api.invoke('sessions:get', id);
  store.state.notices = [];
  store.emit('current', 'todos');
}

function handleEvent(e: AgentEvent): void {
  const s: Session | null = store.state.current;
  switch (e.type) {
    case 'session-updated': {
      const i = store.state.sessions.findIndex((x) => x.id === e.summary.id);
      if (i === -1) store.state.sessions.unshift(e.summary);
      else store.state.sessions[i] = e.summary;
      store.state.sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      if (s && s.id === e.summary.id) s.title = e.summary.title;
      store.emit('sessions');
      return;
    }
    case 'status':
      if (e.running) store.state.running.add(e.sessionId);
      else store.state.running.delete(e.sessionId);
      store.emit('running');
      return;
    case 'approval-request':
      store.state.approvals.set(e.approval.id, e.approval);
      store.emit('approvals');
      return;
    case 'approval-resolved':
      store.state.approvals.delete(e.approvalId);
      store.emit('approvals');
      return;
    case 'terminal':
      store.appendTerminal({ toolCallId: e.toolCallId, stream: e.stream, data: e.data });
      return;
    default:
      break;
  }
  if (!s || e.sessionId !== s.id) return; // 其余事件只作用于当前会话
  switch (e.type) {
    case 'message-start': {
      s.messages.push({ ...e.message });
      store.emit('messages');
      break;
    }
    case 'text-delta': {
      const m = findMessage(e.messageId);
      if (m) {
        m.content += e.delta;
        chat.appendDelta(m.id);
      }
      break;
    }
    case 'tool-call': {
      const m = findMessage(e.messageId);
      if (m) {
        const calls = m.toolCalls ?? (m.toolCalls = []);
        const i = calls.findIndex((c) => c.id === e.call.id);
        if (i === -1) calls.push(e.call);
        else calls[i] = e.call;
        store.emit('messages');
      }
      if (e.call.diff && (e.call.name === 'write_file' || e.call.name === 'edit_file')) {
        store.upsertDiff({
          toolCallId: e.call.id,
          path: typeof e.call.input.path === 'string' ? e.call.input.path : '',
          diff: e.call.diff,
          status: e.call.status,
        });
      }
      break;
    }
    case 'todos':
      s.todos = e.todos;
      store.emit('todos');
      break;
    case 'error':
      chat.notify(e.message);
      break;
    default:
      break;
  }
}

async function bootstrap(): Promise<void> {
  const [settings, project, sessions] = await Promise.all([
    api.invoke('settings:get'),
    api.invoke('project:current'),
    api.invoke('sessions:list'),
  ]);
  Object.assign(store.state, { settings, project, sessions });

  chat = mountChat(document.getElementById('chat') as HTMLElement);
  mountSidebar(document.getElementById('sidebar') as HTMLElement, {
    insertText: (t) => chat.insertText(t),
    notify: (t) => chat.notify(t),
  });
  api.onEvent(handleEvent);

  const first = sessions[0];
  if (first) await selectSession(first.id);
  else {
    store.state.current = await api.invoke('sessions:create');
    store.state.sessions = [];
    store.emit('current');
  }
  store.emit('settings', 'project', 'sessions');
  if (!settings.hasApiKey[settings.provider]) openSettings();
}

bootstrap().catch((e: unknown) => {
  document.body.textContent = `启动失败：${errorText(e)}`;
});
