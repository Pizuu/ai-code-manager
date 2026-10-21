/**
 * 任务会话板块（FR-109、FR-111，ADR 0005）：原型 renderSession() 的三列 .sx——
 * 左列 .slist = 本机会话列表；中列 section.chat = 对话（chat.ts）；右列 .ctxp = 会话 / 任务上下文。
 * 会话标题含任务号（如 T-015）且看板中有该卡时，右列显示原型的「任务上下文」，否则显示「会话上下文」。
 * 003：中列 = 对话 + 文件窗格并列（T-037）；文件窗格含已打开文件的标签条（code-view.ts，T-039 起可编辑，未保存显示圆点），未打开文件时隐藏。
 * 会话置顶只是本机界面偏好，存 localStorage（不经 IPC）。
 * v1.6（ADR 0010）曾有中列顶部「对话 / 终端」分段切换；现已删除切换条，界面恒为对话模式
 * （终端列与 mountTerminal 本体保留、恒隐藏）。
 */
import type { BoardCard, SessionSummary, TodoItem } from '../../../contracts/ipc.ts';
import { api, errorText } from '../api.ts';
import { agentName, agentWho, isCli } from '../lib/agent-label.ts';
import { hm, PR_LINE, STATUS_META } from '../lib/board-format.ts';
import { sendAttrs } from '../lib/context-send.ts';
import { countChanges } from '../lib/diff-lines.ts';
import { clear, h } from '../lib/dom.ts';
import { icon } from '../lib/icons.ts';
import { store } from '../store.ts';
import { decideApproval, MODE_LABELS, mountChat, type ChatView } from './chat.ts';
import { mountCodeView } from './code-view.ts';
import { renderDiff } from './diff-view.ts';
import { mountTerminal } from './terminal-view.ts';
import { refreshTasks } from './tasks-view.ts';
import { STATUS_LABELS } from './tool-card.ts';

export interface SessionHooks {
  selectSession(id: string): Promise<void>;
  newSession(): Promise<void>;
  openBoard(): void;
  /** 代码查看器「发送到任务会话」（整个文件引用）。 */
  sendFile(relPath: string): void;
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
  const count = h('span', { class: 'mute' });
  const search = h('input', { class: 'inp', attrs: { placeholder: '搜索会话' } });
  const pinned = loadPinned();
  const togglePin = (id: string) => {
    if (pinned.has(id)) pinned.delete(id);
    else pinned.add(id);
    localStorage.setItem(PINNED_KEY, JSON.stringify([...pinned]));
    renderList();
  };
  const list = h('div');
  const slist = h('div', { class: 'slist' },
    h('div', { class: 'hd' }, h('span', {}, '任务会话'), count), search, list);

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
  const renderTabs = () => {
    filePane.hidden = files.length === 0;
    sx.classList.toggle('has-file', files.length > 0);
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
  };
  const setActive = (f: string | null) => {
    const changed = active !== f;
    active = f;
    renderTabs();
    if (f && changed) void code.show(f);
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
  renderTabs();

  const chat = mountChat(chatCol, {
    renderDiff,
    onNewSession: () => void hooks.newSession(),
    onToggleList: () => slist.toggleAttribute('hidden'),
    linkedCard,
  });

  // ── 恒对话模式：终端列本体保留、恒隐藏（切换条已删除，不再有模式状态） ──
  const terminal = mountTerminal(termCol, { notify: (t, k) => chat.notify(t, k) });

  const applyMode = (): void => {
    chatCol.hidden = false;
    termCol.hidden = true;
    terminal.focus();
  };

  // 切换会话时同样恒为对话模式（忽略任何存量模式记录）。
  store.on('current', () => applyMode());

  const statusOf = (s: SessionSummary): string => {
    if (store.state.running.has(s.id)) return [...store.state.approvals.values()].some((a) => a.sessionId === s.id) ? '待批准' : '运行中';
    // P1-6：有错误条目的会话标为「出错」，一眼可见（右侧分区可查详情）
    if (store.errorsOf(s.id).length) return '出错';
    return s.messageCount ? '空闲' : '新会话';
  };

  const renderList = () => {
    const st = store.state.settings;
    const cur = store.state.current?.id;
    const q = query.trim().toLowerCase();
    const items = store.state.sessions.filter((s) => !q || s.title.toLowerCase().includes(q));
    // 置顶的排在前面，其余保持原顺序（sort 稳定）
    items.sort((a, b) => Number(pinned.has(b.id)) - Number(pinned.has(a.id)));
    count.textContent = String(store.state.sessions.length);
    clear(list);
    if (!items.length) list.append(h('div', { class: 'mute pad8' }, q ? '无匹配会话' : '暂无会话'));
    for (const s of items) {
      const del = h('button', { class: 'del', title: '删除会话' }, '✕');
      const isPinned = pinned.has(s.id);
      const pin = h('button', { class: `pin${isPinned ? ' on' : ''}`, title: isPinned ? '取消置顶' : '置顶', attrs: { type: 'button', 'aria-pressed': String(isPinned) } }, icon('pin', 14));
      pin.addEventListener('click', (ev) => {
        ev.stopPropagation();
        togglePin(s.id);
      });
      const el = h('a', { class: `si${s.id === cur ? ' on' : ''}${isPinned ? ' pinned' : ''}` },
        h('div', { class: 'a' }, h('span', { class: 'who' }, agentWho(s.agent, st)), h('span', { class: 'st' }, statusOf(s)), h('span', { class: 'tm' }, hm(s.updatedAt) || '—'), pin, del),
        h('div', { class: 'b' }, s.title),
        h('div', { class: 'c' }, `${s.messageCount} 条消息 · ${isCli(s.agent, st) ? '外部 CLI' : '内置 agent'}`));
      el.addEventListener('click', () => void hooks.selectSession(s.id).catch((e: unknown) => chat.notify(errorText(e))));
      del.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        if (!confirm(`删除会话「${s.title}」？此操作不可撤销。`)) return;
        try {
          await api.invoke('sessions:delete', s.id);
          store.state.sessions = store.state.sessions.filter((x) => x.id !== s.id);
          store.emit('sessions');
          if (s.id === cur) {
            const next = store.state.sessions[0];
            if (next) await hooks.selectSession(next.id);
            else await hooks.newSession();
          }
        } catch (e) {
          chat.notify(errorText(e));
        }
      });
      list.append(el);
    }
  };
  search.addEventListener('input', () => {
    query = search.value;
    renderList();
  });

  // ── 右列 ──
  const kv = (k: string, v: string | Node, mono = false) => [h('div', { class: 'k' }, k), h('div', { class: `v${mono ? ' mono' : ''}` }, v)];
  const todoList = (todos: TodoItem[]) => h('ul', { class: 'v' }, ...(todos.length ? todos.map((t) => h('li', {}, `${t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '◐' : '○'} ${t.content}`)) : [h('li', { class: 'mute' }, '暂无待办')]));

  const taskContext = (c: BoardCard): HTMLElement[] => {
    const snap = store.state.board;
    const globs = snap?.lanes.find((l) => l.name === c.lane)?.globs ?? [];
    const allow = globs.filter((x) => !x.startsWith('!'));
    const deny = [...(c.lane === '@shared' ? [] : (snap?.shared ?? [])), ...globs.filter((x) => x.startsWith('!')).map((x) => x.slice(1))];
    const byId = new Map((snap?.cards ?? []).map((x) => [x.id, x]));
    const down = (snap?.cards ?? []).filter((x) => x.deps.includes(c.id));
    return [
      h('div', { class: 'h' }, h('span', {}, '任务上下文'), h('span', { class: 'mute' }, `${c.id} ↗`)),
      h('div', { class: 'chips' }, h('span', { class: `chip ${STATUS_META[c.status].cls}` }, STATUS_META[c.status].label), ...c.frs.slice(0, 2).map((f) => h('span', { class: 'chip' }, f)), c.frs.length > 2 ? h('span', { class: 'chip' }, `+${c.frs.length - 2}`) : null),
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
    ctxp.append(
      h('div', { class: card ? 'h mt20' : 'h' }, h('span', {}, '会话上下文'), h('span', { class: 'mute' }, s?.id ?? '')),
      h('div', { class: 'chips' }, h('span', { class: `chip ${running ? 'acc' : 'grn'}` }, running ? '运行中' : '空闲'), h('span', { class: 'chip' }, isCli(agent, st) ? '外部 CLI' : '内置 agent'), h('span', { class: 'chip' }, MODE_LABELS[st?.permissionMode ?? 'ask'])),
      ...kv('Agent', agentName(agent, st)),
      ...kv('工作目录', store.state.project?.root ?? '未打开项目', true),
      ...(cliId ? kv('CLI 会话（续接）', s?.cliSessions?.[cliId] ?? '首轮后建立', true) : []),
      h('hr'),
      h('div', { class: 'k acc' }, `待办 · ${(s?.todos ?? []).filter((t) => t.status === 'completed').length} / ${(s?.todos ?? []).length}`),
      todoList(s?.todos ?? []));

    // 文件修改（原 Diff 面板）：同一文件多次修改只留最新一条，按首次出现排列（Map 覆盖值不改键序）
    const byPath = new Map<string, (typeof store.state.diffs)[number]>();
    for (const d of store.state.diffs) byPath.set(d.path, d);
    const diffs = [...byPath.values()];
    const dl = h('div', { class: 'dlist' });
    for (const d of diffs.slice(0, 12)) {
      const approval = [...store.state.approvals.values()].find((a) => a.toolCallId === d.toolCallId);
      const { added, removed } = countChanges(d.diff);
      const det = h('details', {}, h('summary', { class: 'row' }, h('span', { class: 'p', title: d.path }, d.path || '(未知文件)'), h('span', { class: 'mute' }, `+${added} −${removed}`), h('span', { class: 'chip' }, STATUS_LABELS[d.status])), renderDiff(d.diff));
      if (approval && d.status === 'awaiting-approval') {
        det.open = true;
        det.append(h('div', { class: 'fx8 mt6' }, h('button', { class: 'btn danger', on: { click: () => void decideApproval(approval.id, false) } }, '拒绝'), h('button', { class: 'btn pri', on: { click: () => void decideApproval(approval.id, true) } }, '批准')));
      }
      dl.append(det);
    }
    ctxp.append(h('div', { class: 'k' }, `文件修改 · ${diffs.length}`), ...(diffs.length ? [dl] : []));

    // 终端输出（原终端面板）
    const term = h('div', { class: 'term' });
    const chunks = store.state.terminal.slice(-400);
    if (chunks.length) for (const c of chunks) term.append(h('span', { class: c.stream }, c.data));
    ctxp.append(h('div', { class: 'k' }, '终端输出'), term);
    requestAnimationFrame(() => {
      term.scrollTop = term.scrollHeight;
    });
  };

  let ctxFrame = 0;
  const scheduleCtx = () => {
    if (ctxFrame) return;
    ctxFrame = requestAnimationFrame(() => {
      ctxFrame = 0;
      renderCtx();
    });
  };

  for (const t of ['sessions', 'current', 'running', 'approvals', 'settings', 'workspace', 'project', 'errors'] as const) store.on(t, renderList);
  for (const t of ['current', 'todos', 'diffs', 'terminal', 'tasks', 'running', 'approvals', 'settings', 'workspace', 'project'] as const) store.on(t, scheduleCtx);
  store.on('project', () => void refreshTasks().catch(() => undefined));
  renderList();
  renderCtx();
  applyMode();
  void refreshTasks().catch(() => undefined);
  // 界面恒为对话模式：showChat / showTerminal 都只确保对话列可见（终端列恒隐藏）。
  return { chat, openFile, showChat: () => applyMode(), showTerminal: () => applyMode() };
}
