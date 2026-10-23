/**
 * 渲染进程入口：加载初始状态，挂载工作台外框与三个板块（泳道看板 / 任务会话 / Git 分支与集成），
 * 把 agent:event 分发到状态与视图。
 */
import type { AgentEvent, BoardCard, ChatMessage, Session } from '../../contracts/ipc.ts';
import { LiveSessionCache } from './lib/live-sessions.ts';
import { api, errorText } from './api.ts';
import { agentError, sessionErrorEntries, toolCallError } from './lib/error-log.ts';
import { store } from './store.ts';
import { focusBoardCard, mountBoard } from './views/board-view.ts';
import { type ChatView } from './views/chat.ts';
import { mountAgents } from './views/agents-view.ts';
import { mountGit } from './views/git-view.ts';
import { formatSendText } from './lib/context-send.ts';
import { favoriteId, addFavorite, quoteFavoriteId } from './lib/favorites.ts';
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

/** 003：右键「新建会话窗口」——有项目时先新建会话并切换过去（复用 newSession 全流程），再把内容插入新会话输入框（不自动发送）。
 *  兜底不吞内容：无项目时跳过新建；newSession 失败时其内部已 notify 且当前会话不变——两种情况下都回退 sendToSession 插入当前会话。 */
async function sendToNewSession(text: string): Promise<void> {
  if (store.state.project) await newSession();
  sendToSession(text);
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
  if (id === 'wb-agents') return VIEW_TITLES.agents;
  return 'AI Code Manager';
}

/** 运行中会话的前端实时副本（见 lib/live-sessions.ts）：切走后继续接收流式事件，切回时复用，避免思考过程丢失。 */
const liveSessions = new LiveSessionCache<Session>();

function findMessage(session: Session | null | undefined, id: string): ChatMessage | undefined {
  return session?.messages.find((m) => m.id === id);
}

export async function selectSession(id: string): Promise<void> {
  const isRunning = (sid: string) => store.state.running.has(sid);
  liveSessions.leave(store.state.current, id, isRunning);
  const live = liveSessions.enter(id, isRunning);
  store.state.current = live ?? await api.invoke('sessions:get', id);
  store.state.notices = [];
  // P1-6：用持久化消息重建该会话的错误条目（重启后仍能看到「出错」与错误分区）
  store.setErrors(id, sessionErrorEntries(store.state.current.messages));
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
      if (s && s.id === e.summary.id) {
        s.title = e.summary.title;
        // v1.10：回合进行中的累计 token 用量随摘要实时到达，合并进当前会话供 Tokens chip 刷新
        // （chat 订阅 'sessions' 只重渲染标题行，不重建日志）。
        if (e.summary.usage) s.usage = e.summary.usage;
      }
      store.emit('sessions');
      return;
    }
    case 'status':
      if (e.running) store.state.running.add(e.sessionId);
      else { store.state.running.delete(e.sessionId); liveSessions.finish(e.sessionId); }
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
    // v1.6：终端模式——输出与退出按会话记录（不限于当前会话，切回时仍在）。
    case 'terminal-data':
      store.appendTerminalOutput(e.sessionId, e.terminalId, e.data);
      return;
    case 'terminal-exit':
      store.markTerminalExited(e.sessionId, e.terminalId, e.code);
      return;
    // P1-8：git 引用变化 → 重拉看板与 Git 快照
    case 'git-changed':
      void shell.refreshWorkspace();
      return;
    default:
      break;
  }
  // 其余事件作用于当前会话；切走但仍在运行的会话写入其实时副本（不触发界面刷新），切回时内容完整。
  const hit = liveSessions.target(s, e.sessionId);
  if (!hit) return;
  const { session: target, isCurrent } = hit;
  switch (e.type) {
    case 'message-start': {
      if (!findMessage(target, e.message.id)) target.messages.push({ ...e.message });
      if (isCurrent) store.emit('messages');
      break;
    }
    case 'text-delta': {
      const m = findMessage(target, e.messageId);
      if (m) {
        m.content += e.delta;
        if (isCurrent) chat.appendDelta(m.id);
      }
      break;
    }
    case 'tool-call': {
      const m = findMessage(target, e.messageId);
      if (m) {
        const calls = m.toolCalls ?? (m.toolCalls = []);
        const i = calls.findIndex((c) => c.id === e.call.id);
        if (i === -1) calls.push(e.call);
        else calls[i] = e.call;
        if (isCurrent) store.emit('messages');
      }
      // P1-6：工具失败计入该会话的错误条目（「出错」状态 + 错误分区）
      if (e.call.status === 'error') {
        const entry = toolCallError(e.call, m?.createdAt ?? new Date().toISOString());
        if (entry) store.addError(e.sessionId, entry);
      }
      if (isCurrent && e.call.diff) {
        const p = e.call.input.path ?? e.call.input.filePath;
        store.upsertDiff({ toolCallId: e.call.id, path: typeof p === 'string' ? p : '', diff: e.call.diff, status: e.call.status });
      }
      break;
    }
    case 'todos':
      target.todos = e.todos;
      if (isCurrent) store.emit('todos');
      break;
    case 'error':
      // P1-6：Agent 报错计入该会话的错误条目（可追溯）
      store.addError(e.sessionId, agentError(e.sessionId + ':' + e.message.slice(0, 64), e.message, new Date().toISOString()));
      if (isCurrent) chat.notify(e.message);
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
    onSessionView: () => sessionView?.showChat(),
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
    // 先切到看板（视图以 hidden 显隐，隐藏态下 scrollIntoView 无效），再登记定位：看板已挂载，applier 立即消费
    focusCard: (id: string) => { shell.setView('board'); focusBoardCard(id); },
    sendFile: (rel) => sendToSession(formatSendText({ kind: 'file', path: rel, dir: false })),
    onFileState: (states) => shell.setFileStates(states),
    onOpenSettings: () => openSettings('model'),
  });
  chat = sessionView.chat;
  installContextMenu({
    sendNew: sendToNewSession,
    originOf,
    addTodo: async (text, messageId) => {
      const current = store.state.current;
      if (!current || !text.trim()) return;
      try {
        // 待办正文就是选中的文字（或整条消息），点击待办时按正文回到来源消息并高亮
        void messageId;
        const next = await api.invoke('sessions:todos', { sessionId: current.id, todos: [...(current.todos ?? []), { id: crypto.randomUUID(), content: text.trim(), status: 'pending' }] });
        store.state.current = next;
        store.emit('current', 'todos');
        chat.notify('已加入待办', 'info');
      } catch (e) {
        chat.notify(errorText(e));
      }
    },
    addFavorite: async (messageId, quote) => {
      const current = store.state.current;
      if (!current) return;
      const message = messageId ? current.messages.find((m) => m.id === messageId) : undefined;
      const text = (quote ?? message?.content ?? '').trim();
      if (!text) return;
      const id = quote || !message ? quoteFavoriteId(current.id, message?.id, text) : favoriteId(current.id, message.id);
      const added = addFavorite({ id, sessionId: current.id, sessionTitle: current.title, text, at: Date.now(), ...(message ? { messageId: message.id } : {}), ...(quote ? { quote: true } : {}) });
      chat.notify(added ? '已加入收藏' : '已在收藏中', 'info');
    },
    reveal: async (relPath) => {
      try {
        await api.invoke('fs:reveal', relPath);
      } catch (e) {
        chat.notify(errorText(e));
      }
    },
  });
  mountBoard(shell.views.board, { openGit: () => shell.setView('git'), openProject: () => void pickProject(), openCard: (c) => void openCard(c) });
  mountGit(shell.views.git, { openBoard: () => shell.setView('board'), openAgents: () => shell.setView('agents'), openProject: () => void pickProject(), notify: (t) => chat.notify(t, 'info') });
  mountAgents(shell.views.agents, {
    openGit: () => shell.setView('git'),
    openProject: () => void pickProject(),
    openFile: (rel) => {
      shell.setView('session');
      sessionView.openFile(rel);
    },
    openSettings: (tab) => openSettings(tab),
    notify: (t) => chat.notify(t, 'info'),
  });
  api.onEvent(handleEvent);

  const first = sessions[0];
  if (first) await selectSession(first.id);
  else {
    store.state.current = await api.invoke('sessions:create');
    store.state.sessions = [];
    store.emit('current');
  }
  store.emit('settings', 'sessions');
  // 启动恒打开任务会话（用户要求），不再按是否恢复了项目跳泳道看板。
  shell.setView('session');
  void shell.refreshWorkspace();
}

bootstrap().catch((e: unknown) => {
  document.body.textContent = `启动失败：${errorText(e)}`;
});
