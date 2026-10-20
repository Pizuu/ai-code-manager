/**
 * 渲染进程入口：加载初始状态，挂载工作台外框与三个板块（泳道看板 / 任务会话 / Git 分支与集成），
 * 把 agent:event 分发到状态与视图。
 */
import type { AgentEvent, BoardCard, ChatMessage, Session } from '../../contracts/ipc.ts';
import { api, errorText } from './api.ts';
import { store } from './store.ts';
import { mountBoard } from './views/board-view.ts';
import type { ChatView } from './views/chat.ts';
import { mountGit } from './views/git-view.ts';
import { builtinMissing } from './lib/agent-config.ts';
import { formatSendText } from './lib/context-send.ts';
import { installContextMenu } from './views/context-menu.ts';
import { mountSessionView, type SessionView } from './views/session-view.ts';
import { openSettings } from './views/settings-dialog.ts';
import { mountShell, VIEW_TITLES, type ShellView } from './views/shell.ts';

let chat: ChatView;
let shell: ShellView;
let sessionView: SessionView;

/** 003：把带来源标注的内容插入任务会话输入框并切到任务会话（不自动发送）。 */
function sendToSession(text: string): void {
  shell.setView('session');
  sessionView.showChat();
  chat.insertBlock(text);
}

/** 右键选中文本的来源区域中文名。 */
function originOf(el: Element): string {
  if (el.closest('#settings-dialog')) return '设置';
  if (el.closest('.explorer')) return '项目结构';
  if (el.closest('.wh')) return '页头';
  if (el.closest('.codev')) return '代码查看';
  if (el.closest('.ctxp')) return '任务会话 · 上下文';
  if (el.closest('.slist')) return '任务会话 · 会话列表';
  if (el.closest('.chat')) return '任务会话 · 对话';
  const id = el.closest('.ws-view')?.id;
  if (id === 'wb-board') return VIEW_TITLES.board;
  if (id === 'wb-git') return VIEW_TITLES.git;
  return 'AI Code Manager';
}

function findMessage(id: string): ChatMessage | undefined {
  return store.state.current?.messages.find((m) => m.id === id);
}

export async function selectSession(id: string): Promise<void> {
  store.state.current = await api.invoke('sessions:get', id);
  store.state.notices = [];
  store.emit('current', 'todos');
}

async function newSession(): Promise<void> {
  try {
    const s = await api.invoke('sessions:create');
    store.state.sessions.unshift({ id: s.id, title: s.title, projectPath: s.projectPath, updatedAt: s.updatedAt, messageCount: 0, ...(s.agent ? { agent: s.agent } : {}) });
    store.emit('sessions');
    await selectSession(s.id);
    shell.setView('session');
    sessionView.showChat();
  } catch (e) {
    chat.notify(errorText(e));
  }
}

async function pickProject(): Promise<void> {
  try {
    const p = await api.invoke('project:pick');
    if (p) {
      store.state.project = p;
      store.emit('project');
    }
  } catch (e) {
    chat.notify(errorText(e));
  }
}

/** 看板卡片 → 任务会话：已有标题含该任务号的会话就打开，否则新建并预填消息（首条消息成为标题，从而关联任务上下文）。 */
async function openCard(card: BoardCard): Promise<void> {
  const existing = store.state.sessions.find((s) => s.title.includes(card.id));
  if (existing) {
    await selectSession(existing.id);
    shell.setView('session');
    sessionView.showChat();
    return;
  }
  await newSession();
  chat.insertText(`${card.id} ${card.title}：`);
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
      // 结束后以持久化版本为准（带回 CLI 会话 ID 等主进程写入的字段）
      if (!e.running && s && s.id === e.sessionId) {
        void api.invoke('sessions:get', s.id).then((fresh) => {
          if (store.state.current?.id === fresh.id && !store.state.running.has(fresh.id)) {
            store.state.current = fresh;
            store.emit('current');
          }
        }, () => undefined);
      }
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
      if (e.call.diff) {
        const p = e.call.input.path ?? e.call.input.filePath;
        store.upsertDiff({ toolCallId: e.call.id, path: typeof p === 'string' ? p : '', diff: e.call.diff, status: e.call.status });
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

  shell = mountShell(document.getElementById('app') as HTMLElement, {
    onNewSession: () => void newSession(),
    onOpenSettings: () => openSettings(),
    onFileClick: (rel) => {
      shell.setView('session');
      sessionView.openFile(rel);
    },
    onError: (t) => chat.notify(t),
  });
  sessionView = mountSessionView(shell.views.session, {
    selectSession,
    newSession,
    openBoard: () => shell.setView('board'),
    sendFile: (rel) => sendToSession(formatSendText({ kind: 'file', path: rel, dir: false })),
  });
  chat = sessionView.chat;
  installContextMenu({ send: sendToSession, originOf });
  mountBoard(shell.views.board, { openGit: () => shell.setView('git'), openProject: () => void pickProject(), openCard: (c) => void openCard(c) });
  mountGit(shell.views.git, { openBoard: () => shell.setView('board'), openProject: () => void pickProject(), notify: (t) => chat.notify(t, 'info') });
  api.onEvent(handleEvent);

  const first = sessions[0];
  if (first) await selectSession(first.id);
  else {
    store.state.current = await api.invoke('sessions:create');
    store.state.sessions = [];
    store.emit('current');
  }
  store.emit('settings', 'sessions');
  shell.setView(project ? 'board' : 'session');
  void shell.refreshWorkspace();
  const usesCli = (settings.defaultAgent ?? 'builtin') !== 'builtin';
  // 003：配置默认空白，内置 agent 未配置时打开设置
  if (!usesCli && builtinMissing(settings).length) openSettings();
}

bootstrap().catch((e: unknown) => {
  document.body.textContent = `启动失败：${errorText(e)}`;
});
