/**
 * 对话区（FR-004/005/011）：消息列表（流式 Markdown + 工具卡片）、待办、输入框与停止按钮。
 */
import type { ChatMessage } from '../../../contracts/ipc.ts';
import { api, errorText } from '../api.ts';
import { clear, h, setTrustedHtml } from '../lib/dom.ts';
import { renderMarkdown } from '../lib/markdown.ts';
import { parseSlashCommand, suggestCommands } from '../lib/slash-commands.ts';
import { store } from '../store.ts';
import { renderToolCard, type DiffRenderer } from './tool-card.ts';

export interface ChatHooks {
  renderDiff?: DiffRenderer;
  /** 头部额外控件（例如权限模式选择器）。 */
  headerExtras?: HTMLElement[];
}

export interface ChatView {
  renderAll(): void;
  appendDelta(messageId: string): void;
  insertText(text: string): void;
  notify(text: string, kind?: 'notice' | 'info'): void;
}

export async function decideApproval(approvalId: string, approved: boolean): Promise<void> {
  try {
    await api.invoke('agent:approve', { approvalId, approved });
  } catch (e) {
    store.state.notices.push({ afterMessageId: null, kind: 'notice', text: errorText(e) });
    store.emit('messages');
  }
}

export function mountChat(container: HTMLElement, hooks: ChatHooks = {}): ChatView {
  clear(container);
  const title = h('div', { class: 'title' });
  const runningDot = h('span', { class: 'running-dot', title: 'Agent 运行中' });
  const header = h('div', { class: 'chat-header' }, title, runningDot, ...(hooks.headerExtras ?? []));
  const list = h('div', { class: 'messages' });
  const todos = h('div', { class: 'todos' });
  const textarea = h('textarea', { attrs: { placeholder: '向 Agent 提问，或输入 / 查看命令（Enter 发送，Shift+Enter 换行）' } });
  const sendBtn = h('button', { class: 'primary' }, '发送');
  const stopBtn = h('button', { class: 'danger' }, '停止');
  const hint = h('span', { class: 'hint' });
  const slashMenu = h('div', { class: 'slash-menu' });
  slashMenu.hidden = true;
  const composer = h('div', { class: 'composer' }, h('div', { class: 'composer-inner' }, slashMenu, textarea, h('div', { class: 'composer-row' }, hint, stopBtn, sendBtn)));
  container.append(header, list, todos, composer);

  const pendingDeltas = new Set<string>();
  let frame = 0;

  const messageEl = (m: ChatMessage): HTMLElement | null => {
    if (m.role === 'tool') return null;
    if (m.role === 'user') return h('div', { class: 'msg user', attrs: { 'data-id': m.id } }, h('div', { class: 'bubble' }, m.content));
    const body = h('div', { class: 'md' });
    setTrustedHtml(body, renderMarkdown(m.content));
    const el = h('div', { class: 'msg assistant', attrs: { 'data-id': m.id } }, body);
    for (const call of m.toolCalls ?? []) {
      const approval = [...store.state.approvals.values()].find((a) => a.toolCallId === call.id);
      el.append(renderToolCard(call, approval, (id, ok) => void decideApproval(id, ok), hooks.renderDiff));
    }
    return el;
  };

  const noticeEl = (text: string, kind: 'notice' | 'info') => h('div', { class: `msg ${kind}` }, h('div', { class: 'bubble' }, text));

  const renderTodos = () => {
    clear(todos);
    const items = store.state.current?.todos ?? [];
    todos.hidden = items.length === 0;
    const icon = { pending: '○', in_progress: '◐', completed: '●' } as const;
    for (const t of items) todos.append(h('div', { class: `todo ${t.status}` }, h('span', {}, icon[t.status]), h('span', {}, t.content)));
  };

  const renderHeader = () => {
    const s = store.state.current;
    title.textContent = s ? s.title : '';
    const running = store.isRunning();
    runningDot.hidden = !running;
    stopBtn.hidden = !running;
    sendBtn.disabled = running || !s;
    const settings = store.state.settings;
    hint.textContent = !settings?.hasApiKey[settings.provider]
      ? '尚未配置 API Key：点击左下角「设置」'
      : store.state.project ? `项目：${store.state.project.name}` : '未打开项目（仅对话，文件与命令工具不可用）';
  };

  const renderAll = () => {
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
    clear(list);
    const s = store.state.current;
    const visible = s?.messages.filter((m) => m.role !== 'tool') ?? [];
    if (!s || (visible.length === 0 && store.state.notices.length === 0)) {
      list.append(h('div', { class: 'empty-hint' },
        h('h3', {}, '开始一个任务'),
        h('p', {}, '例如：「解释这个项目的结构」「给 README 加上安装说明」「运行测试并修复失败」。'),
        h('p', {}, '输入 / 查看 /init、/specify、/plan、/tasks、/implement 等命令。')));
    }
    for (const n of store.state.notices.filter((x) => x.afterMessageId === null && visible.length === 0)) list.append(noticeEl(n.text, n.kind));
    for (const m of visible) {
      const el = messageEl(m);
      if (el) list.append(el);
      for (const n of store.state.notices.filter((x) => x.afterMessageId === m.id)) list.append(noticeEl(n.text, n.kind));
    }
    const lastId = visible[visible.length - 1]?.id;
    for (const n of store.state.notices.filter((x) => x.afterMessageId === null && visible.length > 0)) {
      n.afterMessageId = lastId ?? null;
      list.append(noticeEl(n.text, n.kind));
    }
    renderHeader();
    renderTodos();
    if (nearBottom) list.scrollTop = list.scrollHeight;
  };

  /** 流式增量按帧合并渲染（SC-006）。 */
  const appendDelta = (messageId: string) => {
    pendingDeltas.add(messageId);
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
      for (const id of pendingDeltas) {
        const m = store.state.current?.messages.find((x) => x.id === id);
        const body = list.querySelector(`.msg[data-id="${CSS.escape(id)}"] .md`);
        if (m && body) setTrustedHtml(body, renderMarkdown(m.content));
      }
      pendingDeltas.clear();
      if (nearBottom) list.scrollTop = list.scrollHeight;
    });
  };

  const notify = (text: string, kind: 'notice' | 'info' = 'notice') => {
    const last = store.state.current?.messages.filter((m) => m.role !== 'tool').at(-1);
    store.state.notices.push({ afterMessageId: last?.id ?? null, kind, text });
    renderAll();
  };

  const renderSlashMenu = () => {
    const items = suggestCommands(textarea.value);
    clear(slashMenu);
    slashMenu.hidden = items.length === 0;
    for (const c of items) slashMenu.append(h('div', {}, h('b', {}, c.usage), c.description));
  };

  /** 斜杠命令（FR-013）：本地动作在此执行；返回要发送给 Agent 的文本，或 null 表示已处理。 */
  const runSlash = async (text: string): Promise<string | null> => {
    const r = parseSlashCommand(text);
    const s = store.state.current;
    switch (r.kind) {
      case 'none': return text;
      case 'prompt': return r.prompt;
      case 'help': notify(r.text, 'info'); return null;
      case 'error': notify(r.text); return null;
      case 'clear':
        if (s) {
          store.state.current = await api.invoke('sessions:clear', s.id);
          store.state.notices = [];
          store.emit('current', 'todos');
        }
        return null;
      case 'model': {
        const settings = store.state.settings;
        if (r.model === null) {
          notify(`当前模型：${settings?.model ?? '未知'}（${settings?.provider === 'anthropic' ? 'Anthropic' : 'OpenAI 兼容'}）`, 'info');
          return null;
        }
        store.state.settings = await api.invoke('settings:set', { model: r.model });
        store.emit('settings');
        notify(`已切换模型为 ${r.model}，下一条消息生效。`, 'info');
        return null;
      }
    }
  };

  const send = async () => {
    const raw = textarea.value.trim();
    const s = store.state.current;
    if (!raw || !s) return;
    textarea.value = '';
    renderSlashMenu();
    let text: string | null;
    try {
      text = await runSlash(raw);
    } catch (e) {
      notify(errorText(e));
      return;
    }
    if (text === null) return;
    // 乐观追加用户消息（主进程会写入同样内容；切换会话时以持久化版本为准）
    const local: ChatMessage = { id: `local-${Date.now()}`, role: 'user', content: text, createdAt: new Date().toISOString() };
    s.messages.push(local);
    renderAll();
    try {
      await api.invoke('agent:send', { sessionId: s.id, text });
    } catch (e) {
      s.messages.splice(s.messages.indexOf(local), 1);
      textarea.value = raw;
      notify(errorText(e));
    }
  };

  textarea.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) {
      ev.preventDefault();
      void send();
    }
  });
  textarea.addEventListener('input', renderSlashMenu);
  sendBtn.addEventListener('click', () => void send());
  stopBtn.addEventListener('click', () => {
    const s = store.state.current;
    if (s) void api.invoke('agent:stop', s.id).catch((e: unknown) => notify(errorText(e)));
  });

  store.on('current', renderAll);
  store.on('messages', renderAll);
  store.on('approvals', renderAll);
  store.on('running', renderHeader);
  store.on('settings', renderHeader);
  store.on('project', renderHeader);
  store.on('todos', renderTodos);
  renderAll();

  return {
    renderAll,
    appendDelta,
    notify,
    insertText: (text) => {
      textarea.setRangeText(text, textarea.selectionStart, textarea.selectionEnd, 'end');
      textarea.focus();
    },
  };
}
