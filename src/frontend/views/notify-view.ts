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
  unresolvedReminderCount,
} from '../lib/notify.ts';
import { store } from '../store.ts';

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
  const popover = h('section', { class: 'notify-pop', attrs: { role: 'dialog', 'aria-label': '待办收件箱' } });
  popover.hidden = true;
  const root = h('div', { class: 'notify-root' }, stack, popover);

  /** 首次观察到某审批的时间，保证重渲时事项 createdAt 与排队顺序稳定。 */
  const firstSeenAt = new Map<string, string>();
  /** 被 × 收起的弹窗（只收弹窗，事项仍在收件箱待处理中，角标不变）。 */
  const dismissed = new Set<string>();
  /** 决定提交中的审批：禁用其按钮防双击，决定事件回来前不重复发。 */
  const deciding = new Set<string>();
  let inboxOpen = false;
  let activeTab: 'pending' | 'history' = 'pending';

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

  const pendingRow = (item: ReminderItem): HTMLElement => h('article', { class: 'notify-row', attrs: { 'data-item-id': item.id } },
    h('div', { class: 'notify-hd' },
      h('span', { class: 'chip' }, item.level),
      h('span', { class: 'notify-kind' }, item.title),
      h('span', { class: 'notify-time' }, hm(item.createdAt))),
    ...(item.body ? [h('div', { class: 'notify-row-body' }, item.body)] : []),
    ...(hooks.viewItem
      ? [h('div', { class: 'notify-actions' }, h('button', {
        class: 'btn sm',
        attrs: { type: 'button' },
        on: { click: () => { inboxOpen = false; hooks.viewItem?.(item); } },
      }, '查看'))]
      : []));

  const renderInbox = (approvals: ApprovalRequest[], extras: readonly ReminderItem[]): void => {
    popover.hidden = !inboxOpen;
    if (!inboxOpen) {
      popover.replaceChildren();
      return;
    }
    const history = listApprovalHistory();
    const tabBtn = (id: 'pending' | 'history', label: string) => h('button', {
      class: `notify-tab${activeTab === id ? ' on' : ''}`,
      attrs: { type: 'button', role: 'tab', 'aria-selected': String(activeTab === id) },
      on: { click: () => { activeTab = id; render(); } },
    }, label);
    const body = h('div', { class: 'notify-list' });
    if (activeTab === 'pending') {
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
          on: { click: () => { inboxOpen = false; render(); } },
        }, '×')),
      h('div', { class: 'notify-tabs', attrs: { role: 'tablist' } },
        tabBtn('pending', `待处理 ${approvals.length + extras.length}`),
        tabBtn('history', `历史 ${history.length}`)),
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
    const extras = hooks.extraPendingItems?.() ?? [];
    const count = unresolvedReminderCount(items) + unresolvedReminderCount(extras);
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
    stack.replaceChildren(...cards);
    renderInbox(approvals, extras);
  };

  function toggleInbox(): void {
    inboxOpen = !inboxOpen;
    if (inboxOpen) activeTab = 'pending';
    render();
  }

  document.addEventListener('click', (ev) => {
    if (!inboxOpen) return;
    const t = ev.target as Node;
    if (!popover.contains(t) && !button.contains(t)) {
      inboxOpen = false;
      render();
    }
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && inboxOpen) {
      inboxOpen = false;
      render();
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
  render();

  return { button, root };
}
