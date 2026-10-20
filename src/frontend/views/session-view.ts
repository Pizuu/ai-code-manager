/**
 * 任务会话板块（FR-109、FR-111，ADR 0005）：原型 renderSession() 的三列 .sx——
 * 左列 .slist = 本机会话列表；中列 section.chat = 对话（chat.ts）；右列 .ctxp = 会话 / 任务上下文。
 * 会话标题含任务号（如 T-015）且看板中有该卡时，右列显示原型的「任务上下文」，否则显示「会话上下文」。
 */
import type { BoardCard, SessionSummary, TodoItem } from '../../../contracts/ipc.ts';
import { api, errorText } from '../api.ts';
import { agentName, agentWho, isCli } from '../lib/agent-label.ts';
import { hm, PR_LINE, STATUS_META } from '../lib/board-format.ts';
import { countChanges } from '../lib/diff-lines.ts';
import { clear, h } from '../lib/dom.ts';
import { icon } from '../lib/icons.ts';
import { store } from '../store.ts';
import { decideApproval, MODE_LABELS, mountChat, type ChatView } from './chat.ts';
import { renderDiff } from './diff-view.ts';
import { refreshTasks } from './tasks-view.ts';
import { STATUS_LABELS } from './tool-card.ts';

export interface SessionHooks {
  selectSession(id: string): Promise<void>;
  newSession(): Promise<void>;
  openBoard(): void;
}

/** 会话标题中的任务号 → 看板任务卡。 */
export function linkedCardFor(title: string | undefined, cards: readonly BoardCard[]): BoardCard | null {
  const id = title ? /\bT-\d{3}\b/.exec(title)?.[0] : undefined;
  return id ? (cards.find((c) => c.id === id) ?? null) : null;
}

export function mountSessionView(container: HTMLElement, hooks: SessionHooks): ChatView {
  clear(container);
  let query = '';
  const linkedCard = () => linkedCardFor(store.state.current?.title, store.state.board?.available ? store.state.board.cards : []);

  // ── 左列 ──
  const count = h('span', { class: 'mute' });
  const search = h('input', { class: 'inp', attrs: { placeholder: '搜索会话' } });
  const feat = h('div', { class: 'mute feat' });
  const list = h('div');
  const slist = h('div', { class: 'slist' },
    h('div', { class: 'hd' }, h('span', {}, '项目会话'), count), search, feat, list,
    h('div', { class: 'mute foot' }, icon('pr'), h('div', { class: 'mt6' }, '一个会话 · 一个 agent', h('br'), '工具调用随会话本机持久化')));

  const chatCol = h('section', { class: 'chat' });
  const ctxp = h('aside', { class: 'ctxp' });
  container.append(h('div', { class: 'sx' }, slist, chatCol, ctxp));

  const chat = mountChat(chatCol, {
    renderDiff,
    onNewSession: () => void hooks.newSession(),
    onToggleList: () => slist.toggleAttribute('hidden'),
    linkedCard,
  });

  const statusOf = (s: SessionSummary): string => {
    if (store.state.running.has(s.id)) return [...store.state.approvals.values()].some((a) => a.sessionId === s.id) ? '待批准' : '运行中';
    return s.messageCount ? '空闲' : '新会话';
  };

  const renderList = () => {
    const st = store.state.settings;
    const cur = store.state.current?.id;
    const q = query.trim().toLowerCase();
    const items = store.state.sessions.filter((s) => !q || s.title.toLowerCase().includes(q));
    count.textContent = String(store.state.sessions.length);
    feat.textContent = store.state.board?.feature ? `当前 Feature · ${store.state.board.feature.id}` : store.state.project ? `项目 · ${store.state.project.name}` : '未打开项目';
    clear(list);
    if (!items.length) list.append(h('div', { class: 'mute pad8' }, q ? '无匹配会话' : '暂无会话'));
    for (const s of items) {
      const del = h('button', { class: 'del', title: '删除会话' }, '✕');
      const el = h('a', { class: `si${s.id === cur ? ' on' : ''}` },
        h('div', { class: 'a' }, h('span', { class: 'who' }, agentWho(s.agent, st)), h('span', { class: 'st' }, statusOf(s)), h('span', { class: 'tm' }, hm(s.updatedAt) || '—'), del),
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
      h('div', { class: 'chips' }, h('span', { class: `chip ${running ? 'acc' : ''}` }, running ? '运行中' : '空闲'), h('span', { class: 'chip' }, isCli(agent, st) ? '外部 CLI' : '内置 agent'), h('span', { class: 'chip' }, MODE_LABELS[st?.permissionMode ?? 'ask'])),
      ...kv('Agent', agentName(agent, st)),
      ...kv('工作目录', store.state.project?.root ?? '未打开项目', true),
      ...(cliId ? kv('CLI 会话（续接）', s?.cliSessions?.[cliId] ?? '首轮后建立', true) : []),
      h('hr'),
      h('div', { class: 'k' }, `待办 · ${(s?.todos ?? []).filter((t) => t.status === 'completed').length} / ${(s?.todos ?? []).length}`),
      todoList(s?.todos ?? []));

    // 文件修改（原 Diff 面板）
    const diffs = store.state.diffs;
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
    ctxp.append(h('div', { class: 'k' }, `文件修改 · ${diffs.length}`), diffs.length ? dl : h('div', { class: 'v mute' }, '本次运行的文件修改会显示在这里。'));

    // 终端输出（原终端面板）
    const term = h('div', { class: 'term' });
    const chunks = store.state.terminal.slice(-400);
    if (chunks.length) for (const c of chunks) term.append(h('span', { class: c.stream }, c.data));
    else term.textContent = `（暂无输出。命令以 ${window.api.platform === 'win32' ? 'PowerShell' : 'bash'} 在项目根执行；外部 CLI 的 stderr 与非 JSON 输出也显示在这里。）`;
    ctxp.append(h('div', { class: 'k' }, '终端输出'), term);
    requestAnimationFrame(() => {
      term.scrollTop = term.scrollHeight;
    });

    // Spec 任务（原 Tasks 面板）
    const files = store.state.tasks;
    const all = files.flatMap((f) => f.tasks);
    const latest = files.at(-1);
    ctxp.append(h('div', { class: 'k' }, latest ? `tasks.md · ${latest.feature} · ${latest.tasks.filter((t) => t.done).length} / ${latest.tasks.length} 已勾选` : 'tasks.md'));
    const tl = h('div', { class: 'v' });
    if (!latest) tl.append(h('span', { class: 'mute' }, all.length ? '' : '项目没有 specs/*/tasks.md。'));
    for (const t of latest?.tasks.slice(0, 40) ?? []) tl.append(h('div', { class: `tk${t.done ? ' done' : ''}`, title: t.description }, h('span', { class: 'id' }, `${t.done ? '✓' : '○'} ${t.id}`), h('span', { class: 'd' }, `${t.lane ? `[${t.lane}] ` : ''}${t.description.slice(0, 40)}${t.description.length > 40 ? '…' : ''}`)));
    ctxp.append(tl);
  };

  let ctxFrame = 0;
  const scheduleCtx = () => {
    if (ctxFrame) return;
    ctxFrame = requestAnimationFrame(() => {
      ctxFrame = 0;
      renderCtx();
    });
  };

  for (const t of ['sessions', 'current', 'running', 'approvals', 'settings', 'workspace', 'project'] as const) store.on(t, renderList);
  for (const t of ['current', 'todos', 'diffs', 'terminal', 'tasks', 'running', 'approvals', 'settings', 'workspace', 'project'] as const) store.on(t, scheduleCtx);
  store.on('project', () => void refreshTasks().catch(() => undefined));
  renderList();
  renderCtx();
  void refreshTasks().catch(() => undefined);
  return chat;
}
