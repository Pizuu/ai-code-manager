/**
 * 审批提醒呈现（功能 005，T-048）：P0 弹窗栈 + rail 收件箱。
 *
 * 数据全部来自 store.state.approvals（待批集合）与 lib/notify.ts 的历史流水：
 * 审批被任何路径解决后会从待批集合删除，重渲时弹窗与待处理条目自然撤下（FR-505）。
 * 本模块不直接碰 chat 的 DOM：审批卡可见性与定位都经 hooks 注入（chat.ts 的查询/定位函数）。
 */
import type { ApprovalRequest, ReminderItem } from '../../../contracts/ipc.ts';
import { approvalPrompt } from '../lib/approval-prompt.ts';
import { hm, ymdhm } from '../lib/board-format.ts';
import { countChanges } from '../lib/diff-lines.ts';
import { h } from '../lib/dom.ts';
import { icon } from '../lib/icons.ts';
import {
  buildApprovalReminderItems,
  listApprovalHistory,
  onNotifyHistoryChanged,
  selectPopupReminderItems,
} from '../lib/notify.ts';
import { pendingBadgeCount, PROGRESS_STAGES, type CardProgressRow } from '../lib/notify-diff.ts';
import { store } from '../store.ts';
import { createNotifyFeed } from './notify-feed.ts';

export interface NotifyViewHooks {
  /** 弹窗 / 收件箱内直批：必须复用既有审批决定通路（chat.ts 的 decideApproval）。 */
  decide(approvalId: string, approved: boolean): Promise<void>;
  /** 查看：切到审批所属会话并定位审批卡（main.ts 组合 selectSession + setView + chat.focusApproval）。 */
  view(approvalId: string): void;
  /** FR-507 抑制判定：对应审批卡是否正显示在当前会话可视区。 */
  isApprovalCardVisible(approvalId: string): boolean;
  /** T-049 预留：P1–P3 事项的提供方；本卡未提供时待处理页签只渲染审批类事项。 */
  extraPendingItems?: () => readonly ReminderItem[];
  /** T-049 预留：非审批事项的跳转处理。 */
  viewItem?: (item: ReminderItem) => void;
}

export interface NotifyView {
  /** rail 底部组入口（主题按钮上方，由 shell 插入 rail）。 */
  button: HTMLAnchorElement;
  /** 弹窗栈 + 收件箱弹层的根节点（shell 挂到应用根上，自身 fixed 定位不占布局）。 */
  root: HTMLElement;
}

const KIND_LABELS: Readonly<Record<string, string>> = {
  edit: '文件修改',
  command: '执行命令',
  webfetch: '网页抓取',
  loop: '重复调用',
  subagent: '子 Agent',
  'external-dir': '项目外目录',
  other: '权限请求',
};

export function mountNotifyView(hooks: NotifyViewHooks): NotifyView {
  const badge = h('span', { class: 'ri-badge err', attrs: { hidden: '' } });
  badge.hidden = true;
  const button = h('a', { class: 'ri', title: '收件箱', on: { click: (ev) => { ev.stopPropagation(); toggleInbox(); } } }, icon('inbox'), badge);
  const stack = h('div', { class: 'notify-stack', attrs: { 'aria-live': 'polite' } });
  const toasts = h('div', { class: 'notify-toasts', attrs: { 'aria-live': 'polite' } });
  const popover = h('section', { class: 'notify-pop', attrs: { role: 'dialog', 'aria-label': '待办收件箱' } });
  popover.hidden = true;
  const root = h('div', { class: 'notify-root' }, toasts, stack, popover);

  /* T-049：P1–P3 事项喂数器（看板差分 + 会话出错）；本视图是其唯一消费者。 */
  const feed = createNotifyFeed();
  /** 最新一次渲染时 feed 事项的 id 集合（区分外部 extras：只有 feed 事项可标已读 / 稍后）。 */
  let feedIds = new Set<string>();

  /** 首次观察到某审批的时间，保证重渲时事项 createdAt 与排队顺序稳定。 */
  const firstSeenAt = new Map<string, string>();
  /** 被 × 收起的弹窗（只收弹窗，事项仍在收件箱待处理中，角标不变）。 */
  const dismissed = new Set<string>();
  /** 决定提交中的审批：禁用其按钮防双击，决定事件回来前不重复发。 */
  const deciding = new Set<string>();
  let inboxOpen = false;
  let activeTab: 'pending' | 'history' | 'progress' = 'pending';

  const sessionTitle = (sessionId: string): string =>
    store.state.sessions.find((s) => s.id === sessionId)?.title
    ?? (store.state.current?.id === sessionId ? store.state.current.title : '')
    ?? `会话 ${sessionId.slice(0, 8)}`;

  const decide = async (approvalId: string, approved: boolean): Promise<void> => {
    if (deciding.has(approvalId)) return;
    deciding.add(approvalId);
    render();
    try {
      await hooks.decide(approvalId, approved);
    } finally {
      deciding.delete(approvalId);
      render();
    }
  };

  const approvalContent = (req: ApprovalRequest): HTMLElement => {
    const prompt = approvalPrompt(req);
    if (req.kind === 'command') {
      return h('div', { class: 'notify-content' },
        h('div', { class: 'notify-shell' }, `Shell：${req.shell ?? 'shell'}`),
        h('pre', { class: 'notify-command' }, req.command ?? ''));
    }
    if (req.kind === 'edit') {
      const counts = req.diff ? countChanges(req.diff) : null;
      return h('div', { class: 'notify-content' },
        h('div', { class: 'notify-path mono' }, req.path ?? '(未知文件)'),
        h('div', { class: 'notify-diffsum' }, counts ? `改动摘要：+${counts.added} −${counts.removed} 行` : '未提供 diff 摘要'));
    }
    return h('div', { class: 'notify-content' },
      ...(prompt.lines.length
        ? prompt.lines.map((line) => h('pre', { class: 'notify-lines' }, line))
        : [h('div', { class: 'notify-lines' }, prompt.title)]),
      ...(prompt.note ? [h('div', { class: 'notify-note' }, prompt.note)] : []));
  };

  const actionRow = (req: ApprovalRequest): HTMLElement => {
    const busy = deciding.has(req.id);
    const approve = h('button', { class: 'btn sm pri', attrs: { type: 'button' }, on: { click: () => void decide(req.id, true) } }, '批准');
    const reject = h('button', { class: 'btn sm danger', attrs: { type: 'button' }, on: { click: () => void decide(req.id, false) } }, '拒绝');
    const view = h('button', {
      class: 'btn sm',
      attrs: { type: 'button' },
      on: { click: () => { inboxOpen = false; hooks.view(req.id); } },
    }, '查看');
    if (busy) {
      approve.disabled = true;
      reject.disabled = true;
      view.disabled = true;
    }
    return h('div', { class: 'notify-actions' }, approve, reject, view);
  };

  const approvalCard = (req: ApprovalRequest, variant: 'popup' | 'inbox'): HTMLElement => {
    const prompt = approvalPrompt(req);
    const close = variant === 'popup'
      ? h('button', {
        class: 'notify-x',
        title: '收起（事项仍留在收件箱待处理中）',
        attrs: { type: 'button', 'aria-label': '收起此提醒' },
        on: { click: () => { dismissed.add(req.id); render(); } },
      }, '×')
      : null;
    return h('article', { class: `notify-card ${variant}`, attrs: { 'data-approval-id': req.id } },
      h('div', { class: 'notify-hd' },
        h('span', { class: 'chip amb' }, 'P0 待批准'),
        h('span', { class: 'notify-kind' }, KIND_LABELS[req.kind as string] ?? req.permission ?? String(req.kind)),
        h('span', { class: 'notify-sess', title: sessionTitle(req.sessionId) }, sessionTitle(req.sessionId)),
        close),
      h('div', { class: 'notify-title' }, prompt.title),
      approvalContent(req),
      actionRow(req));
  };

  const LEVEL_CHIP: Readonly<Record<string, string>> = { P1: 'amb', P2: 'blu', P3: '' };

  const pendingRow = (item: ReminderItem): HTMLElement => {
    const fromFeed = feedIds.has(item.id);
    const canRead = fromFeed && (item.level === 'P2' || item.level === 'P3') && item.state !== 'read';
    const actions: HTMLElement[] = [];
    if (hooks.viewItem) {
      actions.push(h('button', {
        class: 'btn sm',
        attrs: { type: 'button' },
        on: {
          click: () => {
            if (canRead) feed.markRead(item.id);
            inboxOpen = false;
            hooks.viewItem?.(item);
          },
        },
      }, '查看'));
    }
    if (canRead) {
      actions.push(h('button', {
        class: 'btn sm',
        attrs: { type: 'button' },
        on: { click: () => feed.markRead(item.id) },
      }, '标已读'));
    }
    return h('article', { class: 'notify-row', attrs: { 'data-item-id': item.id } },
      h('div', { class: 'notify-hd' },
        h('span', { class: `chip ${LEVEL_CHIP[item.level] ?? ''}`.trim() }, item.level),
        h('span', { class: 'notify-kind' }, item.title),
        ...(item.state === 'read' ? [h('span', { class: 'chip' }, '已读')] : []),
        ...(item.state === 'snoozed' ? [h('span', { class: 'chip' }, '已稍后')] : []),
        h('span', { class: 'notify-time' }, hm(item.createdAt))),
      ...(item.body ? [h('div', { class: 'notify-row-body' }, item.body)] : []),
      ...(actions.length ? [h('div', { class: 'notify-actions' }, ...actions)] : []));
  };

  /* ── T-049：P1 弹窗卡（复用弹窗栈形态；无审批类按钮，「稍后」只收起弹窗） ── */
  const extraPopupCard = (item: ReminderItem): HTMLElement => h('article', { class: 'notify-card popup', attrs: { 'data-item-id': item.id } },
    h('div', { class: 'notify-hd' },
      h('span', { class: 'chip amb' }, item.source === 'card' ? 'P1 受阻' : 'P1 出错'),
      h('span', { class: 'notify-time' }, hm(item.createdAt)),
      h('button', {
        class: 'notify-x',
        title: '稍后（事项仍留在收件箱待处理中）',
        attrs: { type: 'button', 'aria-label': '稍后处理此提醒' },
        on: { click: () => feed.snooze(item.id) },
      }, '×')),
    h('div', { class: 'notify-title' }, item.title),
    ...(item.body ? [h('div', { class: 'notify-content' }, h('div', { class: 'notify-lines' }, item.body))] : []),
    h('div', { class: 'notify-actions' },
      ...(hooks.viewItem
        ? [h('button', {
          class: 'btn sm pri',
          attrs: { type: 'button' },
          on: { click: () => hooks.viewItem?.(item) },
        }, '查看')]
        : []),
      h('button', {
        class: 'btn sm',
        attrs: { type: 'button' },
        on: { click: () => feed.snooze(item.id) },
      }, '稍后')));

  /* ── T-049：P2 轻提示（非模态小条，数秒自动消失；点击打开收件箱） ── */
  const showToast = (item: ReminderItem): void => {
    const el = h('div', { class: 'notify-toast', attrs: { role: 'status', 'data-item-id': item.id } },
      h('span', { class: 'chip blu' }, 'P2'),
      h('span', { class: 'notify-toast-text' }, item.title));
    el.addEventListener('click', () => {
      el.remove();
      activeTab = 'pending';
      inboxOpen = true;
      render();
    });
    toasts.append(el);
    while (toasts.children.length > 3) toasts.firstElementChild?.remove();
    setTimeout(() => el.remove(), 6000);
  };

  /* ── FR-516「进度」页签行：在途卡 + 五段进度指示 + 状态时间戳；点击走 viewItem 的 card 路由 ── */
  const progressRow = (row: CardProgressRow): HTMLElement => {
    const segs = PROGRESS_STAGES.map((s, i) => h('span', {
      class: `notify-prog-seg${row.blocked ? ' blocked' : i <= row.stageIndex ? ' on' : ''}`,
      attrs: { title: s.label },
    }));
    const timeText = row.statusSinceKind === 'preexisting'
      ? '本应用打开前已处于此状态'
      : `${row.statusSinceKind === 'merge' ? '合入于 ' : '进入此状态 '}${ymdhm(row.statusSince)}`;
    const el = h('article', { class: 'notify-row notify-prog-row', attrs: { 'data-card-id': row.cardId, role: 'button', tabindex: '0' } },
      h('div', { class: 'notify-hd' },
        h('span', { class: 'notify-kind' }, row.cardId),
        h('span', { class: 'notify-sess', title: row.title }, row.title),
        ...(row.blocked ? [h('span', { class: 'chip amb' }, '受阻')] : [])),
      h('div', { class: 'notify-prog-track' }, ...segs),
      h('div', { class: 'notify-prog-meta' },
        `${row.assignee} · ${row.lane}${row.ahead ? ` · 领先 ${row.ahead} 提交` : ''} · ${timeText}`));
    const go = (): void => {
      if (!hooks.viewItem) return;
      inboxOpen = false;
      hooks.viewItem({
        id: `card:${row.cardId}:${row.status}`,
        level: row.blocked ? 'P1' : row.status === 'review' ? 'P2' : 'P3',
        source: 'card',
        title: row.title,
        createdAt: new Date().toISOString(),
        state: 'active',
        cardId: row.cardId,
      });
    };
    el.addEventListener('click', go);
    el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); go(); } });
    return el;
  };

  const renderInbox = (approvals: ApprovalRequest[], extras: readonly ReminderItem[]): void => {
    popover.hidden = !inboxOpen;
    if (!inboxOpen) {
      popover.replaceChildren();
      return;
    }
    const history = listApprovalHistory();
    const progress = feed.progressRows();
    // 页签计数与下方列表渲染同源（同一批数组的长度）：角标数字与实际条目数恒一致。
    const tabCounts: Readonly<Record<'pending' | 'history' | 'progress', number>> = {
      pending: approvals.length + extras.length,
      history: history.length,
      progress: progress.length,
    };
    const tabBtn = (id: 'pending' | 'history' | 'progress', label: string) => h('button', {
      class: `notify-tab${activeTab === id ? ' on' : ''}`,
      attrs: { type: 'button', role: 'tab', 'aria-selected': String(activeTab === id) },
      on: {
        click: () => {
          // 目标页签没有数据时不切空页签：直接关闭弹层（负责人定版口径），activeTab 不变。
          if (tabCounts[id] === 0) { closeInbox(); return; }
          activeTab = id;
          render();
        },
      },
    }, label);
    const body = h('div', { class: 'notify-list' });
    if (activeTab === 'progress') {
      if (!progress.length) body.append(h('div', { class: 'notify-empty' }, '暂无在途任务卡。'));
      for (const row of progress) body.append(progressRow(row));
    } else if (activeTab === 'pending') {
      if (!approvals.length && !extras.length) body.append(h('div', { class: 'notify-empty' }, '暂无待处理事项。'));
      for (const req of approvals) body.append(approvalCard(req, 'inbox'));
      for (const item of extras) body.append(pendingRow(item));
    } else if (!history.length) {
      body.append(h('div', { class: 'notify-empty' }, '暂无审批历史。已批准 / 已拒绝的审批会记录在这里。'));
    } else {
      for (const e of history) {
        body.append(h('article', { class: 'notify-row history', attrs: { 'data-approval-id': e.id } },
          h('div', { class: 'notify-hd' },
            h('span', { class: `chip ${e.approved ? 'grn' : 'amb'}` }, e.approved ? '已批准' : '已拒绝'),
            h('span', { class: 'notify-kind' }, KIND_LABELS[e.kind as string] ?? String(e.kind)),
            h('span', { class: 'notify-sess', title: e.sessionTitle || e.sessionId }, e.sessionTitle || `会话 ${e.sessionId.slice(0, 8)}`),
            h('span', { class: 'notify-time' }, ymdhm(new Date(e.at).toISOString()))),
          h('div', { class: 'notify-row-body' }, e.summary)));
      }
    }
    popover.replaceChildren(
      h('div', { class: 'notify-pop-hd' },
        h('b', {}, '收件箱'),
        h('button', {
          class: 'notify-x',
          title: '关闭',
          attrs: { type: 'button', 'aria-label': '关闭收件箱' },
          on: { click: () => closeInbox() },
        }, '×')),
      h('div', { class: 'notify-tabs', attrs: { role: 'tablist' } },
        tabBtn('pending', `待处理 ${tabCounts.pending}`),
        tabBtn('history', `历史 ${tabCounts.history}`),
        tabBtn('progress', `进度 ${tabCounts.progress}`)),
      body);
    positionInbox();
  };

  const positionInbox = (): void => {
    const r = button.getBoundingClientRect();
    if (!r.width) return;
    popover.style.left = `${r.right + 8}px`;
    popover.style.bottom = `${Math.max(8, window.innerHeight - r.bottom)}px`;
  };

  const render = (): void => {
    const approvals = [...store.state.approvals.values()];
    const liveIds = new Set(approvals.map((a) => a.id));
    for (const id of [...firstSeenAt.keys()]) if (!liveIds.has(id)) firstSeenAt.delete(id);
    for (const id of [...dismissed]) if (!liveIds.has(id)) dismissed.delete(id);
    for (const id of [...deciding]) if (!liveIds.has(id)) deciding.delete(id);
    for (const a of approvals) if (!firstSeenAt.has(a.id)) firstSeenAt.set(a.id, new Date().toISOString());

    const items = buildApprovalReminderItems(approvals, { firstSeenAt });
    const feedItems = feed.items();
    feedIds = new Set(feedItems.map((i) => i.id));
    const extras: readonly ReminderItem[] = [...feedItems, ...(hooks.extraPendingItems?.() ?? [])];
    // 角标口径（FR-511）：P0 待批 + P1 活动（含稍后）+ P2/P3 未读——统一走 lib 的 pendingBadgeCount。
    const count = pendingBadgeCount(items, extras);
    badge.hidden = count === 0;
    badge.textContent = count > 99 ? '99+' : String(count);
    button.title = count ? `收件箱（${count} 条待处理）` : '收件箱';

    const suppressedIds = new Set(approvals.filter((a) => hooks.isApprovalCardVisible(a.id)).map((a) => a.id));
    const picked = selectPopupReminderItems(items, { dismissedIds: dismissed, suppressedIds });
    const byId = new Map(approvals.map((a) => [a.id, a]));
    const cards: HTMLElement[] = [];
    for (const item of picked.visible) {
      const req = item.approvalId ? byId.get(item.approvalId) : undefined;
      if (req) cards.push(approvalCard(req, 'popup'));
    }
    if (picked.overflow.length) {
      cards.push(h('button', {
        class: 'notify-more',
        attrs: { type: 'button' },
        on: { click: () => { activeTab = 'pending'; inboxOpen = true; render(); } },
      }, `还有 ${picked.overflow.length} 条待批准 · 打开收件箱`));
    }
    // T-049：P1 弹窗跟在 P0 之后（优先级低一档）；P2 只轻提示、P3 不出声（FR-501）。
    for (const item of feed.popupItems()) cards.push(extraPopupCard(item));
    stack.replaceChildren(...cards);
    for (const item of feed.takeToasts()) showToast(item);
    renderInbox(approvals, extras);
  };

  function toggleInbox(): void {
    inboxOpen = !inboxOpen;
    if (inboxOpen) activeTab = 'pending';
    render();
  }

  /** 弹层唯一的关闭入口：标题栏 ×、点外关闭、Esc 与「空页签点击关闭」都走这里。 */
  function closeInbox(): void {
    inboxOpen = false;
    render();
  }

  document.addEventListener('click', (ev) => {
    if (!inboxOpen) return;
    const t = ev.target as Node;
    if (!popover.contains(t) && !button.contains(t)) {
      closeInbox();
    }
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && inboxOpen) {
      closeInbox();
    }
  });
  // 审批卡可见性会随滚动变化（FR-507 是动态判定）：滚动 / 缩放后按帧重推导弹窗集合。
  let renderQueued = false;
  const scheduleRender = (): void => {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      render();
    });
  };
  document.addEventListener('scroll', scheduleRender, true);
  window.addEventListener('resize', scheduleRender);

  for (const t of ['approvals', 'sessions', 'current', 'view'] as const) store.on(t, render);
  onNotifyHistoryChanged(render);
  feed.onChanged(render);
  render();

  return { button, root };
}
