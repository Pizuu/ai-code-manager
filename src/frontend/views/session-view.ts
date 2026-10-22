/**
 * 任务会话板块（FR-109、FR-111，ADR 0005）：原型 renderSession() 的三列 .sx——
 * 左列 .slist = 本机会话列表；中列 section.chat = 对话（chat.ts）；右列 .ctxp = 会话 / 任务上下文。
 * 会话标题含任务号（如 T-015）且看板中有该卡时，右列显示原型的「任务上下文」，否则显示「会话上下文」。
 * 003：中列 = 对话 + 文件窗格并列（T-037）；文件窗格含已打开文件的标签条（code-view.ts，T-039 起可编辑，未保存显示圆点），未打开文件时隐藏。
 * 会话置顶只是本机界面偏好，存 localStorage（不经 IPC）。
 * v1.6（ADR 0010）曾有中列顶部「对话 / 终端」分段切换；现已删除切换条，界面恒为对话模式
 * （终端列与 mountTerminal 本体保留、恒隐藏）。
 */
import type { AgentRef, BoardCard, SessionSummary, TodoItem } from '../../../contracts/ipc.ts';
import { api, errorText } from '../api.ts';
import { agentName } from '../lib/agent-label.ts';
import { PR_LINE, STATUS_META } from '../lib/board-format.ts';
import { sendAttrs } from '../lib/context-send.ts';
import { countChanges } from '../lib/diff-lines.ts';
import { clear, h } from '../lib/dom.ts';
import { favoriteMessageId, listFavorites, onFavoritesChanged, removeFavorite, updateFavorite } from '../lib/favorites.ts';
import { icon } from '../lib/icons.ts';
import { store } from '../store.ts';
import { decideApproval, MODE_LABELS, mountChat, type ChatView } from './chat.ts';
import { mountCodeView } from './code-view.ts';
import { renderDiff } from './diff-view.ts';
import { mountTerminal } from './terminal-view.ts';
import { refreshTasks } from './tasks-view.ts';
import { STATUS_LABELS } from './tool-card.ts';

/** 最后一个回答耗时格式：<1s 显示 '<1s'；<60s 如 '42s'；<60min 如 '3m 05s'（秒补零）；>=60min 如 '1h 12m'。 */
function fmtDuration(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 1) return '<1s';
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ${String(sec % 60).padStart(2, '0')}s`;
  return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`;
}

export interface SessionHooks {
  selectSession(id: string): Promise<void>;
  newSession(): Promise<void>;
  openBoard(): void;
  /** 在看板中定位并高亮指定任务卡（任务上下文头部任务号点击）。 */
  focusCard(id: string): void;
  /** 代码查看器「发送到任务会话」（整个文件引用）。 */
  sendFile(relPath: string): void;
  onFileState?(states: ReadonlyArray<{ path: string; mode: 'readonly' | 'editing'; dirty: boolean }>): void;
  onOpenSettings?(): void;
}

export interface SessionView {
  chat: ChatView;
  /** 打开（或激活）只读文件标签。 */
  openFile(relPath: string): void;
  /** 切回「对话」标签。 */
  showChat(): void;
  /** 兼容保留：界面恒为对话模式，调用等同 showChat。 */
  showTerminal(): void;
}

/** 同时保留的文件标签上限，超出关闭最早打开的。 */
const MAX_FILE_TABS = 8;
const PINNED_KEY = 'acm.pinnedSessions';
type RelatedFile = { path: string; author: 'assistant' | 'user'; at: string };

function loadPinned(): Set<string> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(PINNED_KEY) ?? '[]');
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

/** 会话标题中的任务号 → 看板任务卡。 */
export function linkedCardFor(title: string | undefined, cards: readonly BoardCard[]): BoardCard | null {
  const id = title ? /\bT-\d{3}\b/.exec(title)?.[0] : undefined;
  return id ? (cards.find((c) => c.id === id) ?? null) : null;
}

export function mountSessionView(container: HTMLElement, hooks: SessionHooks): SessionView {
  clear(container);
  let query = '';
  const linkedCard = () => linkedCardFor(store.state.current?.title, store.state.board?.available ? store.state.board.cards : []);

  // ── 左列 ──
  const search = h('input', { class: 'inp', attrs: { placeholder: '搜索会话' } });
  // 新建会话按钮（原 chat 标题行迁入 .hd 右端）：.hd 为 flex 两端对齐，标题居左、本按钮靠右。
  const newBtn = h('button', { class: 'circ acc', title: '新建会话', on: { click: () => void hooks.newSession() } }, icon('plus'));
  const pinned = loadPinned();
  const togglePin = (id: string) => {
    if (pinned.has(id)) pinned.delete(id);
    else pinned.add(id);
    localStorage.setItem(PINNED_KEY, JSON.stringify([...pinned]));
    renderList();
  };
  const list = h('div');
  const todoDock = h('div', { class: 'slist-todos' });
  let todoDockOpen = false;
  const slist = h('div', { class: 'slist' },
    h('div', { class: 'hd' }, h('span', {}, '任务会话'), newBtn), search, list);

  const chatCol = h('section', { class: 'chat' });
  const termCol = h('section', { class: 'termv-wrap' });
  const codePane = h('section', { class: 'codev' });
  const ftabs = h('div', { class: 'ftabs', attrs: { role: 'tablist' } });
  const filePane = h('div', { class: 'fpane' }, ftabs, codePane);
  filePane.hidden = true;
  // 标签栏隐藏了滚动条：竖向滚轮转为横向滚动（触控板横滑原生可用）
  ftabs.addEventListener('wheel', (ev) => {
    if (Math.abs(ev.deltaY) <= Math.abs(ev.deltaX) || ftabs.scrollWidth <= ftabs.clientWidth) return;
    ftabs.scrollLeft += ev.deltaY;
    ev.preventDefault();
  }, { passive: false });
  const midBody = h('div', { class: 'midbody split' }, chatCol, termCol, filePane);
  const mid = h('div', { class: 'mid' }, midBody);
  const ctxp = h('aside', { class: 'ctxp' });
  const sx = h('div', { class: 'sx' }, slist, mid, ctxp);
  container.append(sx);
  const code = mountCodeView(codePane, { sendFile: hooks.sendFile, onDirty: () => renderTabs() });

  // ── 文件窗格标签页（与对话并列）──
  const files: string[] = [];
  let active: string | null = null; // null = 未打开文件
  let fileFocusSnapshot: { slist: boolean; chat: boolean; terminal: boolean; context: boolean } | null = null;
  const syncFileFocus = () => {
    if (files.length > 0) {
      if (!fileFocusSnapshot) fileFocusSnapshot = { slist: Boolean(slist.hidden), chat: Boolean(chatCol.hidden), terminal: Boolean(termCol.hidden), context: Boolean(ctxp.hidden) };
      slist.hidden = true;
      chatCol.hidden = true;
      termCol.hidden = true;
      ctxp.hidden = true;
      sx.classList.add('file-focus');
      return;
    }
    if (!fileFocusSnapshot) return;
    slist.hidden = fileFocusSnapshot.slist;
    chatCol.hidden = fileFocusSnapshot.chat;
    termCol.hidden = fileFocusSnapshot.terminal;
    ctxp.hidden = fileFocusSnapshot.context;
    fileFocusSnapshot = null;
    sx.classList.remove('file-focus');
  };
  const exitFileFocus = () => {
    if (!fileFocusSnapshot) return;
    slist.hidden = fileFocusSnapshot.slist;
    chatCol.hidden = fileFocusSnapshot.chat;
    termCol.hidden = fileFocusSnapshot.terminal;
    ctxp.hidden = fileFocusSnapshot.context;
    fileFocusSnapshot = null;
    sx.classList.remove('file-focus');
  };
  const renderTabs = () => {
    filePane.hidden = files.length === 0;
    sx.classList.toggle('has-file', files.length > 0);
    syncFileFocus();
    const tab = (label: string, on: boolean, onClick: () => void, title: string, onClose?: () => void, dirty = false) => {
      const el = h('div', { class: `ft${on ? ' on' : ''}`, title, attrs: { role: 'tab' }, on: { click: onClick } }, h('span', { class: 'nm' }, label), dirty ? h('span', { class: 'dirty', title: '未保存' }) : null);
      if (onClose) el.append(h('button', { class: 'x', title: '关闭', attrs: { type: 'button' }, on: { click: (ev) => { ev.stopPropagation(); onClose(); } } }, '✕'));
      return el;
    };
    ftabs.replaceChildren(
      ...files.map((f) => {
        const el = tab(f.split('/').pop() ?? f, active === f, () => setActive(f), code.isDirty(f) ? `${f}（未保存）` : f, () => closeFile(f), code.isDirty(f));
        for (const [k, v] of Object.entries(sendAttrs({ kind: 'file', path: f, dir: false }))) el.setAttribute(k, v);
        return el;
      }));
    ftabs.querySelector('.ft.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    hooks.onFileState?.(files.map((path) => ({
      path,
      mode: active === path && code.isDirty(path) ? 'editing' : 'readonly',
      dirty: code.isDirty(path),
    })));
  };
  const setActive = (f: string | null) => {
    const changed = active !== f;
    active = f;
    renderTabs();
    if (f && changed) {
      const diff = [...store.state.diffs].reverse().find((item) => item.path === f);
      if (diff) code.showDiff(f, diff.diff);
      else void code.show(f);
    }
  };
  const openFile = (f: string) => {
    if (!files.includes(f)) {
      files.push(f);
      if (files.length > MAX_FILE_TABS) {
        // 超出上限时关闭最早打开且无未保存修改的标签
        const k = files.findIndex((x) => !code.isDirty(x));
        if (k !== -1 && k < files.length - 1) code.discard(files.splice(k, 1)[0] as string);
      }
      active = null; // 强制重新读取
    }
    setActive(f);
  };
  const closeFile = (f: string) => {
    const i = files.indexOf(f);
    if (i === -1) return;
    if (code.isDirty(f) && !confirm(`「${f.split('/').pop() ?? f}」有未保存的修改，关闭后将丢失。确定关闭？`)) return;
    code.discard(f);
    files.splice(i, 1);
    if (active === f) setActive(files[i] ?? files[i - 1] ?? null);
    else renderTabs();
  };
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented || !active) return;
    if (document.querySelector('dialog[open], .ctxmenu:not([hidden]), .slash-menu:not([hidden])')) return;
    event.preventDefault();
    closeFile(active);
  });
  renderTabs();

  const chat = mountChat(chatCol, {
    renderDiff,
    onOpenAttachment: openFile,
    onOpenSettings: hooks.onOpenSettings,
    onNewSession: () => void hooks.newSession(),
    onToggleList: () => slist.toggleAttribute('hidden'),
    // 对话区红点点击跳出错会话：与会话列表条目点击同路（selectSession）。
    onJumpToSession: (id) => { void hooks.selectSession(id).catch((e: unknown) => chat.notify(errorText(e))); },
    linkedCard,
  });

  // ── 恒对话模式：终端列本体保留、恒隐藏（切换条已删除，不再有模式状态） ──
  const terminal = mountTerminal(termCol, { notify: (t, k) => chat.notify(t, k) });

  const applyMode = (): void => {
    chatCol.hidden = fileFocusSnapshot !== null;
    termCol.hidden = true;
    terminal.focus();
  };

  // 切换会话时同样恒为对话模式（忽略任何存量模式记录）。
  store.on('current', () => applyMode());

  const statusOf = (s: SessionSummary): string => {
    if (store.state.running.has(s.id)) return '回答中';
    // P1-6：有错误条目的会话标为「出错」，一眼可见（右侧分区可查详情）
    if (store.errorsOf(s.id).length) return '出错';
    return '回答完成';
  };

  // ── 删除两步确认（防误删）：首次点 ✕ 只进入待确认态（✕ 变红 + 底部行右下角出现提醒），
  // 再次点 ✕ 或点提醒才执行删除；3.5 秒无操作自动取消，全局只保留一个待确认条目。 ──
  let pendingDelId: string | null = null;
  let pendingDelTimer: ReturnType<typeof setTimeout> | null = null;
  const clearPendingDel = () => {
    pendingDelId = null;
    if (pendingDelTimer !== null) {
      clearTimeout(pendingDelTimer);
      pendingDelTimer = null;
    }
  };
  const armPendingDel = (id: string) => {
    clearPendingDel();
    pendingDelId = id;
    pendingDelTimer = setTimeout(() => {
      pendingDelTimer = null;
      pendingDelId = null;
      renderList();
    }, 3500);
  };
  /** 真正执行删除（原 confirm 后的同一流程）：调 sessions:delete → 同步列表 → 删的是当前会话时选中下一条或新建。 */
  const executeDelete = async (s: SessionSummary) => {
    clearPendingDel();
    try {
      await api.invoke('sessions:delete', s.id);
      const wasCurrent = store.state.current?.id === s.id;
      store.state.sessions = store.state.sessions.filter((x) => x.id !== s.id);
      store.emit('sessions');
      if (wasCurrent) {
        const next = store.state.sessions[0];
        if (next) await hooks.selectSession(next.id);
        else await hooks.newSession();
      }
    } catch (e) {
      chat.notify(errorText(e));
    }
  };

  const renderTodoDock = () => {
    const sessionTodos = new Map(store.state.sessions.map((session) => [session.id, session.todos ?? []]));
    const current = store.state.current;
    if (current) sessionTodos.set(current.id, current.todos);
    const entries = [...sessionTodos.entries()].flatMap(([sessionId, todos]) => todos.map((todo) => ({ sessionId, todo })));
    const save = (sessionId: string, next: TodoItem[]) => {
      const normalized = next.map((todo) => ({ ...todo, content: todo.content.trim() }));
      void api.invoke('sessions:todos', { sessionId, todos: normalized }).then((updated) => {
        sessionTodos.set(updated.id, updated.todos);
        if (store.state.current?.id !== updated.id) {
          const summary = store.state.sessions.find((session) => session.id === updated.id);
          if (summary) summary.todos = updated.todos;
        }
        if (store.state.current?.id === updated.id) store.state.current = updated;
        store.emit('current', 'todos');
      }).catch((e: unknown) => chat.notify(errorText(e)));
    };
    const rows = entries.map(({ sessionId, todo }) => {
      const check = h('button', { class: `todo-check${todo.status === 'completed' ? ' done' : ''}`, attrs: { type: 'button' }, title: '切换完成状态' }, todo.status === 'completed' ? '✓' : '○');
      check.addEventListener('click', () => save(sessionId, (sessionTodos.get(sessionId) ?? []).map((x) => x.id === todo.id ? { ...x, status: x.status === 'completed' ? 'pending' : 'completed' } : x)));
      const edit = h('button', { class: 'todo-edit', attrs: { type: 'button', 'aria-label': '编辑待办' }, title: '编辑待办文本' }, '✎');
      edit.addEventListener('click', (event) => {
        event.stopPropagation();
        const value = window.prompt('编辑项目待办（首尾空格会自动去除）', todo.content);
        if (value === null) return;
        const content = value.trim();
        if (!content) { chat.notify('待办文本不能为空', 'info'); return; }
        save(sessionId, (sessionTodos.get(sessionId) ?? []).map((x) => x.id === todo.id ? { ...x, content } : x));
      });
      const del = h('button', { class: 'todo-delete', attrs: { type: 'button' }, title: '删除待办' }, '×');
      del.addEventListener('click', () => save(sessionId, (sessionTodos.get(sessionId) ?? []).filter((x) => x.id !== todo.id)));
      const owner = store.state.sessions.find((session) => session.id === sessionId)?.title ?? '当前会话';
      const content = h('span', { class: 'todo-content', title: `${owner}：跳转到来源对话`, on: { click: async () => {
        try {
          if (store.state.current?.id !== sessionId) await hooks.selectSession(sessionId);
          const source = todo.content.trim();
          if (store.state.current?.id !== sessionId) return;
          if (chat.focusText(source)) return;
          // 渲染文字匹配不到（如 Markdown 原文）时退回按原始内容找（用户与助手消息都算）
          const normalizedSource = source.replace(/\s+/g, ' ');
          const message = normalizedSource
            ? [...(store.state.current?.messages ?? [])].reverse().find((item) => (item.role === 'user' || item.role === 'assistant')
              && item.content.replace(/\s+/g, ' ').includes(normalizedSource))
            : undefined;
          if (message) chat.focusMessage(message.id, source);
        } catch (e) {
          chat.notify(errorText(e));
        }
      } } }, `${todo.content.trim()} · ${owner}`);
      return h('div', { class: `todo-row${todo.status === 'completed' ? ' todo-done' : ''}` }, check, content, edit, del);
    });
    const completed = entries.filter(({ todo }) => todo.status === 'completed').length;
    const title = h('button', { class: 'todo-dock-title', attrs: { type: 'button', 'aria-expanded': String(todoDockOpen) }, title: '展开项目待办卡片' }, h('span', {}, '项目待办'), h('span', { class: 'todo-dock-count' }, `${completed}/${entries.length}`), icon('caret', 14));
    title.addEventListener('click', () => { todoDockOpen = !todoDockOpen; renderTodoDock(); });
    const head = h('div', { class: 'todo-dock-head' }, title);
    const card = h('div', { class: 'todo-dock-card' });
    card.hidden = !todoDockOpen;
    card.append(...(rows.length ? rows : [h('div', { class: 'mute todo-empty' }, '暂无项目待办')]));
    todoDock.replaceChildren(head, card);
  };

  const renderList = () => {
    const cur = store.state.current?.id;
    const q = query.trim().toLowerCase();
    const items = store.state.sessions.filter((s) => !q || s.title.toLowerCase().includes(q));
    // 置顶的排在前面，其余保持原顺序（sort 稳定）
    items.sort((a, b) => Number(pinned.has(b.id)) - Number(pinned.has(a.id)));
    // 新建按钮 title 标注当前使用中的默认 agent（settings 未加载时退回 plain 文案）；
    // renderList 的订阅含 'settings'，切换默认 agent 后随之刷新（口径与原 chat 标题行一致）。
    const st = store.state.settings;
    newBtn.title = st ? `新建会话（使用中：${agentName(undefined, st)}）` : '新建会话';
    // 各会话的收藏条数（favorites 库按 sessionId 聚合），底部行右下角展示
    const favCounts = new Map<string, number>();
    for (const f of listFavorites()) favCounts.set(f.sessionId, (favCounts.get(f.sessionId) ?? 0) + 1);
    clear(list);
    if (!items.length) list.append(h('div', { class: 'mute pad8' }, q ? '无匹配会话' : '暂无会话'));
    for (const s of items) {
      const armed = pendingDelId === s.id;
      const del = h('button', { class: `del${armed ? ' armed' : ''}`, title: armed ? '再次点击确认删除' : '删除会话' }, '✕');
      const isPinned = pinned.has(s.id);
      const pin = h('button', { class: `pin${isPinned ? ' on' : ''}`, title: isPinned ? '取消置顶' : '置顶', attrs: { type: 'button', 'aria-pressed': String(isPinned) } }, icon('pin', 14));
      pin.addEventListener('click', (ev) => {
        ev.stopPropagation();
        togglePin(s.id);
      });
      const status = statusOf(s);
      // 回答状态圆点：出错红 / 回答中黄 / 回答完成绿（与 statusOf 三态同步）
      const dotCls = status === '出错' ? 'r' : status === '回答中' ? 'y' : 'g';
      // 底部行右下角：收藏标记（有收藏才显示）+ 待确认删除提醒（armed 时出现、可点击直接确认）
      const favCount = favCounts.get(s.id) ?? 0;
      const delWarn = armed ? h('span', { class: 'si-delwarn', title: '确认删除此会话' }, '确认') : null;
      if (delWarn) delWarn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        void executeDelete(s);
      });
      const el = h('a', { class: `si${s.id === cur ? ' on' : ''}${isPinned ? ' pinned' : ''}` },
        h('div', { class: 'a' }, h('span', { class: 'tm', title: '最后一个回答耗时' }, s.lastTurnMs != null ? fmtDuration(s.lastTurnMs) : '—'), pin, del),
        h('div', { class: 'b' }, h('span', { class: `dot ${dotCls}`, title: status }), h('span', { class: 'ttl' }, s.title)),
        h('div', { class: 'c' },
          h('span', {}, `${s.messageCount} 条消息`),
          h('span', { class: 'si-br' },
            h('span', { class: `si-status ${dotCls}`, title: `状态：${status}` }, status),
            favCount > 0 ? h('span', { class: 'si-fav', title: `本会话已收藏 ${favCount} 条回答` }, icon('star'), h('span', {}, String(favCount))) : null,
            delWarn)));
      el.addEventListener('click', () => {
        // 点其它条目时清除已有条目的待确认删除态
        if (pendingDelId !== null && pendingDelId !== s.id) clearPendingDel();
        void hooks.selectSession(s.id).catch((e: unknown) => chat.notify(errorText(e)));
      });
      del.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (pendingDelId === s.id) {
          void executeDelete(s);
          return;
        }
        armPendingDel(s.id);
        renderList();
      });
      list.append(el);
    }
    renderTodoDock();
  };
  search.addEventListener('input', () => {
    query = search.value;
    renderList();
  });

  // ── 右列 ──
  const kv = (k: string, v: string | Node, mono = false) => [h('div', { class: 'k' }, k), h('div', { class: `v${mono ? ' mono' : ''}` }, v)];
  const generatedFiles: Array<{ sessionId: string; content: string; ext: string; at: string }> = [];
  const downloadedFiles = new Set<string>();
  const conversationFiles = (s: NonNullable<typeof store.state.current>): RelatedFile[] => {
    const found = new Map<string, RelatedFile>();
    for (const m of s.messages) {
      if (m.role !== 'assistant' && m.role !== 'user') continue;
      for (const hit of m.content.matchAll(/\b(?:src|contracts|tests|docs|scripts)\/[A-Za-z0-9._/-]+/g)) {
        const value = hit[0]?.replace(/[),.;:]+$/, '');
        if (value && !found.has(value)) found.set(value, { path: value, author: m.role, at: m.createdAt });
      }
    }
    return [...found.values()].slice(0, 30);
  };

  const taskContext = (c: BoardCard): HTMLElement[] => {
    const snap = store.state.board;
    const globs = snap?.lanes.find((l) => l.name === c.lane)?.globs ?? [];
    const allow = globs.filter((x) => !x.startsWith('!'));
    const deny = [...(c.lane === '@shared' ? [] : (snap?.shared ?? [])), ...globs.filter((x) => x.startsWith('!')).map((x) => x.slice(1))];
    const byId = new Map((snap?.cards ?? []).map((x) => [x.id, x]));
    const down = (snap?.cards ?? []).filter((x) => x.deps.includes(c.id));
    return [
      h('div', { class: 'h' }, h('span', {}, '任务上下文'), h('span', { class: 'mute lk', title: '在看板中定位此卡', on: { click: () => hooks.focusCard(c.id) } }, `${c.id} ↗`)),
      h('div', { class: 'chips' }, h('span', { class: `chip ${STATUS_META[c.status].cls}` }, STATUS_META[c.status].label), ...c.frs.slice(0, 2).map((f) => h('span', { class: 'chip fr' }, f)), c.frs.length > 2 ? h('span', { class: 'chip fr' }, `+${c.frs.length - 2}`) : null),
      ...kv('执行 / 协调 / 审查', `${c.assignee} / coordinator / 暂无指派审查者`),
      ...kv('Feature', snap?.feature ? `${snap.feature.id} · ${snap.feature.title}` : '—'),
      h('hr'),
      ...kv(`允许路径 · ${c.lane === '@shared' ? 'coordinator' : '独占'}`, allow.join('\n') || '—', true),
      ...kv('禁止修改', deny.join(' · ') || '—'),
      ...kv('Worktree', c.worktree ?? '暂无（未检出）', true),
      ...kv('分支 → 目标', `${c.branch ?? '—'}\n→ ${c.prTarget ?? snap?.integrationBranch ?? ''}`, true),
      ...kv('Pull request', `${PR_LINE}${c.ahead !== null ? ` · ${c.ahead} 提交领先 / ${c.behind ?? 0} 落后` : ''} · ${c.changedFiles} 个文件`),
      h('hr'),
      h('div', { class: 'k' }, `依赖${c.unmetDeps.length ? '未满足' : '已满足'}`),
      h('ul', { class: 'v' }, ...(c.deps.length ? c.deps.map((d) => {
        const x = byId.get(d);
        return h('li', {}, `${x?.status === 'merged' ? '✓' : '○'} ${d} · ${x?.title ?? ''}${x ? `（${STATUS_META[x.status].label}）` : ''}`);
      }) : [h('li', {}, '无前置任务')])),
      h('div', { class: 'k' }, `验收标准 · ${c.acceptance.filter((a) => a.done).length} / ${c.acceptance.length}`),
      h('ul', { class: 'v' }, ...c.acceptance.map((a) => h('li', {}, `${a.done ? '✓' : '○'} ${a.text}`))),
      h('div', { class: 'rel' }, h('div', { class: 'acc' }, `下游任务${down.length ? ` · ${down.map((x) => x.id).join('、')}` : ''}`),
        h('div', { class: 'mute desc' }, down.length ? down.map((x) => `${x.id} ${x.title}（${STATUS_META[x.status].label}）`).join('；') : '暂无依赖本任务的卡'),
        h('button', { class: 'btn', on: { click: hooks.openBoard } }, '在看板中查看')),
      h('hr'),
    ];
  };

  const renderCtx = () => {
    clear(ctxp);
    const s = store.state.current;
    const st = store.state.settings;
    const card = linkedCard();
    if (card) ctxp.append(...taskContext(card));
    const agent = s?.agent ?? st?.defaultAgent ?? 'builtin';
    const running = s ? store.state.running.has(s.id) : false;
    const cliId = agent !== 'builtin' ? agent.slice(4) : null;
    // 孤儿会话：绑定的 Agent CLI 已被删除（agent 仍为 cli:<id> 但设置里查无此条目），发送必报 E_CLI。
    // 给出重新绑定入口：选一个现存 agent 后经 sessions:setAgent 改绑，即可继续发送。
    const boundCliId = s?.agent?.startsWith('cli:') ? s.agent.slice(4) : null;
    const orphanId = boundCliId !== null && s && st && !(st.agentClis ?? []).some((c) => c.id === boundCliId) ? boundCliId : null;
    let orphanBlock: HTMLElement | null = null;
    if (orphanId !== null && s && st) {
      const sid = s.id;
      const clis = st.agentClis ?? [];
      const sel = h('select');
      sel.append(h('option', { attrs: { value: 'builtin' } }, '内置 agent'));
      for (const c of clis) sel.append(h('option', { attrs: { value: `cli:${c.id}` } }, c.name));
      // 默认选中：defaultAgent 是仍存在的 CLI 时选它，否则第一条 CLI，再否则内置。
      const da = st.defaultAgent;
      sel.value = da && clis.some((c) => `cli:${c.id}` === da) ? da : clis[0] ? `cli:${clis[0].id}` : 'builtin';
      const switchBtn = h('button', { class: 'btn', attrs: { type: 'button' } }, '切换');
      switchBtn.addEventListener('click', async () => {
        const chosen = sel.value as AgentRef;
        switchBtn.disabled = true;
        try {
          const updated = await api.invoke('sessions:setAgent', sid, chosen);
          store.state.current = updated;
          const sum = store.state.sessions.find((x) => x.id === sid);
          if (sum) sum.agent = updated.agent ?? chosen;
          store.emit('current');
          const name = chosen === 'builtin' ? '内置 agent' : clis.find((c) => `cli:${c.id}` === chosen)?.name ?? chosen;
          chat.notify(`已切换为 ${name}，可继续发送。`);
        } catch (e) {
          chat.notify(errorText(e));
          switchBtn.disabled = false;
        }
      });
      orphanBlock = h('div', { class: 'orphan-warn' },
        h('div', {}, `此会话使用的 Agent CLI（${orphanId}）已不存在，发送会失败。重新选择：`),
        h('div', { class: 'fx8 mt6' }, sel, switchBtn));
    }
    ctxp.append(
      h('div', { class: card ? 'h mt20' : 'h' }, h('span', {}, '会话上下文'), h('span', { class: 'mute' }, s?.id ?? '')),
      h('div', { class: 'chips' }, h('span', { class: `chip ${running ? 'acc' : 'grn'}` }, running ? '运行中' : '空闲'), h('span', { class: 'chip', attrs: { title: agentName(agent, st) } }, agentName(agent, st)), h('span', { class: 'chip perm' }, MODE_LABELS[st?.permissionMode ?? 'ask'])),
      ...(orphanBlock ? [orphanBlock] : []),
      ...kv('工作目录', store.state.project?.root ?? '未打开项目', true),
      ...(cliId ? kv('CLI 会话（续接）', s?.cliSessions?.[cliId] ?? '首轮后建立', true) : []),
      h('hr'));

    const filesInConversation = s ? conversationFiles(s) : [];
    const codeDownloads = s ? generatedFiles.filter((file) => file.sessionId === s.id) : [];
    const relatedByPath = new Map<string, RelatedFile>();
    const addRelated = (file: RelatedFile) => {
      const key = file.path.replace(/\\/g, '/').toLowerCase();
      if (file.path && !relatedByPath.has(key)) relatedByPath.set(key, file);
    };
    filesInConversation.forEach(addRelated);
    const latestAt = s?.messages.at(-1)?.createdAt ?? new Date(0).toISOString();
    for (const diff of store.state.diffs) if (diff.path) addRelated({ path: diff.path, author: 'assistant', at: latestAt });
    for (const path of files) addRelated({ path, author: 'user', at: latestAt });
    const relatedFiles = [...relatedByPath.values()];
    const renderCodeDownloads = codeDownloads.length
      ? h('div', { class: 'v ctx-files ctx-generated-files' }, ...codeDownloads.map((file) => {
        const stamp = file.at.replace(/[-:TZ.]/g, '').slice(0, 14);
        const name = `assistant-${stamp}.${file.ext}`;
        const button = h('button', { class: 'ctx-link', attrs: { type: 'button' }, title: '重新下载代码块文件', on: { click: () => {
          const url = URL.createObjectURL(new Blob([file.content], { type: 'text/plain;charset=utf-8' }));
          const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
        } } }, icon('download', 13), h('span', {}, name));
        return button;
      }))
      : h('div', { class: 'v ctx-empty' }, '暂无代码块下载文件');
    if (codeDownloads.length) ctxp.append(h('div', { class: 'k' }, `代码块下载 · ${codeDownloads.length}`), renderCodeDownloads);
    const renderFiles = (files: RelatedFile[], emptyText: string) => files.length
      ? h('div', { class: 'v ctx-files' }, ...files.map((file) => {
        const ext = file.path.split('.').pop()?.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'txt';
        const stamp = file.at.replace(/[-:TZ.]/g, '').slice(0, 14) || String(Date.now());
        const download = h('button', { class: 'ctx-download', attrs: { type: 'button' }, title: downloadedFiles.has(file.path) ? '文件已下载，点击跳转' : '下载对话文件' }, downloadedFiles.has(file.path) ? '↗' : '↓');
        download.addEventListener('click', async (ev) => {
          ev.stopPropagation();
          if (downloadedFiles.has(file.path)) { openFile(file.path); return; }
          try {
            const content = await api.invoke('fs:read', file.path);
            if (content.kind !== 'text') return;
            const url = URL.createObjectURL(new Blob([content.content], { type: 'text/plain;charset=utf-8' }));
            const a = document.createElement('a'); a.href = url; a.download = `${file.author}-${stamp}.${ext}`; a.click(); URL.revokeObjectURL(url);
            downloadedFiles.add(file.path);
            openFile(file.path);
          } catch (e) { chat.notify(`下载失败：${errorText(e)}`); }
        });
        const row = h('div', { class: 'ctx-file-row' }, h('button', { class: 'ctx-link', attrs: { type: 'button' }, title: `打开 ${file.path}`, on: { click: () => openFile(file.path) } }, icon('file', 13), h('span', {}, file.path)), download);
        return row;
      }))
      : h('div', { class: 'v ctx-empty' }, emptyText);
    ctxp.append(h('div', { class: 'k' }, `相关文件 · ${relatedFiles.length}`), renderFiles(relatedFiles, '暂无消息提及、修改记录或已打开文件'));
    const currentFavorites = s ? listFavorites().filter((f) => f.sessionId === s.id) : [];
    const favoriteLinks = h('div', { class: 'v ctx-favorites' }, ...currentFavorites.map((f) => {
      const link = h('button', { class: 'ctx-link', attrs: { type: 'button' }, title: '跳转到收藏消息' },
        icon(f.text.includes('```') ? 'code' : 'text', 13), h('span', {}, f.text.replace(/\s+/g, ' ').slice(0, 100)));
      link.addEventListener('click', () => {
        const mid = favoriteMessageId(f);
        if (mid) chat.focusMessage(mid, f.quote ? f.text : undefined);
        else chat.focusText(f.text);
        link.classList.remove('ctx-favorite-jump');
        void link.offsetWidth;
        link.classList.add('ctx-favorite-jump');
        window.setTimeout(() => link.classList.remove('ctx-favorite-jump'), 1400);
      });
      const edit = h('button', { class: 'ctx-favorite-edit', attrs: { type: 'button', 'aria-label': '编辑收藏' }, title: '编辑收藏快照' }, '✎');
      edit.addEventListener('click', (event) => {
        event.stopPropagation();
        const value = window.prompt('编辑收藏快照（不会修改原始消息；首尾空格会自动去除）', f.text);
        if (value === null) return;
        if (!updateFavorite(f.id, value)) chat.notify('收藏内容不能为空', 'info');
      });
      const remove = h('button', { class: 'ctx-favorite-remove', attrs: { type: 'button', 'aria-label': '删除收藏' }, title: '删除收藏' }, '×');
      remove.addEventListener('click', (event) => { event.stopPropagation(); removeFavorite(f.id); });
      return h('div', { class: 'ctx-favorite-row' }, link, edit, remove);
    }));
    ctxp.append(h('div', { class: 'h ctx-section-title' }, h('span', {}, '收藏'), h('span', { class: 'mute' }, String(currentFavorites.length))), favoriteLinks);

    // 文件修改（原 Diff 面板）：同一文件多次修改只留最新一条，按首次出现排列（Map 覆盖值不改键序）
    const byPath = new Map<string, (typeof store.state.diffs)[number]>();
    for (const d of store.state.diffs) byPath.set(d.path, d);
    const diffs = [...byPath.values()];
    const dl = h('div', { class: 'dlist' });
    for (const d of diffs.slice(0, 12)) {
      const approval = [...store.state.approvals.values()].find((a) => a.toolCallId === d.toolCallId);
      const { added, removed } = countChanges(d.diff);
      const det = h('details', {}, h('summary', { class: 'row', on: { click: () => { if (d.path) openFile(d.path); } } }, h('span', { class: 'p', title: d.path }, d.path || '(未知文件)'), h('span', { class: 'mute' }, `+${added} −${removed}`), h('span', { class: 'chip' }, STATUS_LABELS[d.status])), renderDiff(d.diff));
      if (approval && d.status === 'awaiting-approval') {
        det.open = true;
        det.append(h('div', { class: 'fx8 mt6' }, h('button', { class: 'btn danger', on: { click: () => void decideApproval(approval.id, false) } }, '拒绝'), h('button', { class: 'btn pri', on: { click: () => void decideApproval(approval.id, true) } }, '批准')));
      }
      dl.append(det);
    }
    if (diffs.length) ctxp.append(dl);
    ctxp.append(todoDock);

  };

  let ctxFrame = 0;
  const scheduleCtx = () => {
    if (ctxFrame) return;
    ctxFrame = requestAnimationFrame(() => {
      ctxFrame = 0;
      renderCtx();
    });
  };
  window.addEventListener('acm-code-download', (event) => {
    const detail = (event as CustomEvent<{ sessionId?: string; content?: string; ext?: string; at?: string }>).detail;
    if (!detail?.sessionId || typeof detail.content !== 'string' || !detail.ext || !detail.at) return;
    generatedFiles.unshift({ sessionId: detail.sessionId, content: detail.content, ext: detail.ext, at: detail.at });
    if (generatedFiles.length > 50) generatedFiles.pop();
    scheduleCtx();
  });

  for (const t of ['sessions', 'current', 'running', 'approvals', 'settings', 'workspace', 'project', 'errors'] as const) store.on(t, renderList);
  // 收藏增减后底部行的收藏条数实时刷新（renderList 只读 favorites 现值重渲，不回写收藏，无循环）
  onFavoritesChanged(() => { renderList(); scheduleCtx(); });
  for (const t of ['current', 'todos', 'diffs', 'tasks', 'running', 'approvals', 'settings', 'workspace', 'project'] as const) store.on(t, scheduleCtx);
  store.on('diffs', () => {
    if (!active) return;
    const diff = [...store.state.diffs].reverse().find((item) => item.path === active);
    if (diff) code.showDiff(active, diff.diff);
  });
  store.on('project', () => void refreshTasks().catch(() => undefined));
  renderList();
  renderCtx();
  applyMode();
  void refreshTasks().catch(() => undefined);
  // 界面恒为对话模式：showChat / showTerminal 都只确保对话列可见（终端列恒隐藏）。
  return { chat, openFile, showChat: () => { exitFileFocus(); applyMode(); }, showTerminal: () => applyMode() };
}
