/**
 * 渲染进程入口：加载初始状态，挂载工作台外框与三个板块（泳道看板 / 任务会话 / Git 分支与集成），
 * 把 agent:event 分发到状态与视图。
 */
import type { AgentEvent, BoardCard, ChatMessage, Session } from '../../contracts/ipc.ts';
import { api, errorText } from './api.ts';
import { agentError, sessionErrorEntries, toolCallError } from './lib/error-log.ts';
import { recordApprovalResolution } from './lib/notify.ts';
import { store } from './store.ts';
import { focusBoardCard, mountBoard } from './views/board-view.ts';
import { decideApproval, type ChatView } from './views/chat.ts';
import { mountAgents } from './views/agents-view.ts';
import { mountSpeckit } from './views/speckit-view.ts';
import { mountGit } from './views/git-view.ts';
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

/** 003：右键「新建会话窗口」——有项目时先新建会话并切换过去（复用 newSession 全流程），再把内容插入新会话输入框（不自动发送）。
 *  兜底不吞内容：无项目时跳过新建；newSession 失败时其内部已 notify 且当前会话不变——两种情况下都回退 sendToSession 插入当前会话。 */
async function sendToNewSession(text: string): Promise<void> {
  if (store.state.project) await newSession();
  sendToSession(text);
}

/** Spec Kit 向导：把向导生成的对话指令真实发送到任务会话（无当前会话时先新建，失败处理沿用 newSession 现状），发送成功后切到任务会话；发送失败抛给向导就地提示、不切视图。 */
async function sendInstruction(text: string): Promise<void> {
  if (!store.state.current) await newSession();
  await chat.sendText(text);
  shell.setView('session');
  sessionView.showChat();
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

function findMessage(id: string): ChatMessage | undefined {
  return store.state.current?.messages.find((m) => m.id === id);
}

export async function selectSession(id: string): Promise<void> {
  store.state.current = await api.invoke('sessions:get', id);
  store.state.notices = [];
  // P1-6：用持久化消息重建该会话的错误条目（重启后仍能看到「出错」与错误分区）
  store.setErrors(id, sessionErrorEntries(store.state.current.messages));
  store.emit('current', 'todos');
}

/** T-048：切到指定会话（提醒「查看」与 notify-activate 的 session 落点共用）。 */
async function jumpToSession(sessionId: string): Promise<void> {
  try {
    shell.setView('session');
    sessionView.showChat();
    if (store.state.current?.id !== sessionId) await selectSession(sessionId);
    shell.setView('session');
    sessionView.showChat();
  } catch (e) {
    chat.notify(errorText(e));
  }
}

/** T-048：切到审批所属会话并定位审批卡。切会话后对话要先完成一轮渲染，定位分两拍兜底重试。 */
async function jumpToApproval(sessionId: string, approvalId: string): Promise<void> {
  await jumpToSession(sessionId);
  const run = () => { chat.focusApproval(approvalId); };
  requestAnimationFrame(run);
  setTimeout(run, 80);
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
    case 'approval-resolved': {
      // T-048：先从待批表取回请求本体生成历史摘要（删表后就取不到了），再删表撤下弹窗 / 待处理条目。
      const req = store.state.approvals.get(e.approvalId);
      if (req) {
        const sessionTitle = store.state.sessions.find((x) => x.id === req.sessionId)?.title
          ?? (s?.id === req.sessionId ? s.title : '');
        recordApprovalResolution(req, e.approved, sessionTitle);
      }
      store.state.approvals.delete(e.approvalId);
      store.emit('approvals');
      return;
    }
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
    // v1.13 / T-048：提醒激活（系统通知点击回传）——按落点跳转定位；card 落点复用看板既有定位通路。
    case 'notify-activate': {
      const target = e.target;
      if (target.kind === 'approval') void jumpToApproval(target.sessionId, target.approvalId);
      else if (target.kind === 'session') void jumpToSession(target.sessionId);
      else {
        shell.setView('board');
        focusBoardCard(target.cardId);
      }
      return;
    }
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
      // P1-6：工具失败计入该会话的错误条目（「出错」状态 + 错误分区）
      if (e.call.status === 'error') {
        const entry = toolCallError(e.call, m?.createdAt ?? new Date().toISOString());
        if (entry) store.addError(e.sessionId, entry);
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
      // P1-6：Agent 报错计入该会话的错误条目（可追溯）
      store.addError(e.sessionId, agentError(e.sessionId + ':' + e.message.slice(0, 64), e.message, new Date().toISOString()));
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
    // P0-3：点击活动徽标 / 状态栏计数 → 跳到该会话
    onJumpToSession: (id) => {
      shell.setView('session');
      sessionView.showChat();
      void selectSession(id).catch((e: unknown) => chat.notify(errorText(e)));
    },
    notifyDecide: (approvalId, approved) => decideApproval(approvalId, approved),
    notifyView: (approvalId) => {
      const req = store.state.approvals.get(approvalId);
      if (req) void jumpToApproval(req.sessionId, approvalId);
    },
    isApprovalCardVisible: (approvalId) => chat.isApprovalCardVisible(approvalId),
  });
  sessionView = mountSessionView(shell.views.session, {
    selectSession,
    newSession,
    openBoard: () => shell.setView('board'),
    // 先切到看板（视图以 hidden 显隐，隐藏态下 scrollIntoView 无效），再登记定位：看板已挂载，applier 立即消费
    focusCard: (id: string) => { shell.setView('board'); focusBoardCard(id); },
    sendFile: (rel) => sendToSession(formatSendText({ kind: 'file', path: rel, dir: false })),
  });
  chat = sessionView.chat;
  installContextMenu({ sendNew: sendToNewSession, originOf });
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
  mountSpeckit(shell.views.speckit, {
    sendInstruction,
    openProject: () => void pickProject(),
    // 与顶栏规格下拉同款口径：setFeature 已返回完整快照，不再叠加 refreshWorkspace。
    setFeature: async (featureId) => {
      store.state.board = await api.invoke('board:setFeature', { featureId });
      store.emit('workspace');
    },
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
