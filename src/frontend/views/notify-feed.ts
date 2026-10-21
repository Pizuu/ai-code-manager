/**
 * P1–P3 事项喂数器（功能 005，T-049）：把 store 的看板快照与会话错误集合
 * 持续差分成未消解事项，供 views/notify-view.ts 的收件箱 / 弹窗 / 轻提示消费。
 *
 * 落位决定：差分纯逻辑在 lib/notify-diff.ts；本模块是 views 层的状态持有者——
 * 订阅 store（'workspace' / 'errors' / 'sessions' / 'project'）、维护基线与活动事项、
 * 已读标记落盘、P1 弹窗「弹一次」与 P2 轻提示「给一次」的已呈现记录。
 *
 * 基线口径（T-049 卡点名）：首次观察只建基线不产生事项。看板快照异步到达，
 * 故基线在「看板至少加载过一次」后才锁定；锁定前观察到的卡片状态与会话错误
 * 全部并入基线。切换项目（'project' 主题）后重新基线，避免把新项目的
 * 现状误报成变迁。
 *
 * 已读落盘（FR-511 / FR-514）：localStorage 存 事项 id → createdAt；
 * 事项同 id 再次进入（createdAt 不同）视为新事项、未读——重入不继承旧已读。
 */
import type { BoardCardStatus, ReminderItem } from '../../../contracts/ipc.ts';
import {
  applyReminderTransition,
  buildCardProgress,
  diffReminderSnapshot,
  recordCardStatusTimes,
  selectExtraPopups,
  selectExtraToasts,
  type CardProgressRow,
  type CardStatusTime,
  type ObservedSnapshot,
} from '../lib/notify-diff.ts';
import { store } from '../store.ts';

export const NOTIFY_READ_KEY = 'acm.notify-read.v1';
export const NOTIFY_CARD_TIMES_KEY = 'acm.notify-card-times.v1';

const CARD_STATUSES: ReadonlySet<string> = new Set(['ready', 'active', 'review', 'blocked', 'merged']);

function loadCardTimes(): Map<string, CardStatusTime> {
  try {
    const raw = globalThis.localStorage?.getItem(NOTIFY_CARD_TIMES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return new Map();
    const map = new Map<string, CardStatusTime>();
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue;
      const e = v as { status?: unknown; at?: unknown };
      if (typeof e.status === 'string' && CARD_STATUSES.has(e.status) && typeof e.at === 'string') {
        map.set(k, { status: e.status as BoardCardStatus, at: e.at });
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

function persistCardTimes(times: ReadonlyMap<string, CardStatusTime>): void {
  try {
    globalThis.localStorage?.setItem(NOTIFY_CARD_TIMES_KEY, JSON.stringify(Object.fromEntries(times)));
  } catch {
    /* 存储不可用：时间戳仅内存态 */
  }
}

export interface NotifyFeed {
  /** 当前未消解的 P1–P3 事项（已应用已读标记：P2 / P3 已读项 state 为 'read'），按产生时间升序。 */
  items(): readonly ReminderItem[];
  /** 当前应显示的 P1 弹窗事项（活动且未「稍后」、且该事项已实际呈现过弹窗或刚产生）。 */
  popupItems(): readonly ReminderItem[];
  /** 取走自上次以来新产生的 P2 轻提示事项（每条事项在其活动期内至多被取走一次）。 */
  takeToasts(): ReminderItem[];
  /** P1「稍后」：收起弹窗，事项留在收件箱、计数保留，直到来源消解。 */
  snooze(id: string): void;
  /** P2 / P3 标记已读（落盘）；P1 不接受已读（未消解前一直计数）。 */
  markRead(id: string): void;
  /** 「进度」页签行（FR-516）：全部任务卡的全量开发进度（含已合入）+ 状态时间戳；不产生事项、不计入角标。 */
  progressRows(): readonly CardProgressRow[];
  /** 订阅事项集合变化（新增 / 消解 / 稍后 / 已读），返回退订函数。 */
  onChanged(cb: () => void): () => void;
}

function loadReadMarks(): Map<string, string> {
  try {
    const raw = globalThis.localStorage?.getItem(NOTIFY_READ_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return new Map();
    const map = new Map<string, string>();
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string') map.set(k, v);
    }
    return map;
  } catch {
    return new Map();
  }
}

function persistReadMarks(marks: ReadonlyMap<string, string>): void {
  try {
    globalThis.localStorage?.setItem(NOTIFY_READ_KEY, JSON.stringify(Object.fromEntries(marks)));
  } catch {
    /* 存储不可用：已读仅内存态 */
  }
}

function buildObserved(): ObservedSnapshot {
  const cards = new Map<string, { status: BoardCardStatus; title: string }>();
  const board = store.state.board;
  if (board?.available) {
    for (const c of board.cards) cards.set(c.id, { status: c.status, title: c.title });
  }
  const errorSessions = new Map<string, { title: string; summary: string }>();
  for (const [sessionId, errs] of store.state.errors) {
    if (!errs.length) continue;
    const latest = errs[errs.length - 1];
    const title = store.state.sessions.find((s) => s.id === sessionId)?.title
      ?? (store.state.current?.id === sessionId ? store.state.current.title : '')
      ?? '';
    errorSessions.set(sessionId, {
      title,
      summary: (latest?.text ?? '').split('\n')[0]?.trim() ?? '',
    });
  }
  return { cards, errorSessions };
}

export function createNotifyFeed(): NotifyFeed {
  const active = new Map<string, ReminderItem>();
  const readMarks = loadReadMarks();
  /** 卡片进入当前状态的亲历时间（FR-516 时间戳口径；基线后才开始记录）。 */
  let statusTimes = loadCardTimes();
  /** 已被取走轻提示的 P2 事项 id（活动期内只给一次）。 */
  const toastedIds = new Set<string>();
  const toastQueue: ReminderItem[] = [];
  const listeners = new Set<() => void>();

  let prev: ObservedSnapshot | null = null;
  let baselined = false;

  const emit = (): void => {
    for (const cb of [...listeners]) cb();
  };

  /** 给活动事项应用已读标记（仅 P2 / P3；标记需 id 与 createdAt 双匹配）。 */
  const withReadState = (item: ReminderItem): ReminderItem => {
    if (item.level !== 'P2' && item.level !== 'P3') return item;
    return readMarks.get(item.id) === item.createdAt ? { ...item, state: 'read' } : item;
  };

  const refresh = (): void => {
    const next = buildObserved();
    if (!baselined) {
      // 基线未锁定：持续吸收观察值；看板加载过一次（board 非 null）即锁定当前快照为基线。
      prev = next;
      if (store.state.board !== null) baselined = true;
      return;
    }
    const nowIso = new Date().toISOString();
    // 合入提醒的标题分支名取看板快照的集成分支（不写死）；看板未加载时传 undefined，lib 兜底「集成分支」。
    const transition = diffReminderSnapshot(prev, next, nowIso, store.state.board?.integrationBranch);
    prev = next;
    // 状态时间戳：任何卡片状态变迁都亲历记录（不止产生事项的那些），供「进度」页签。
    const rec = recordCardStatusTimes(statusTimes, next.cards, nowIso, false);
    if (rec.changed) {
      statusTimes = rec.times;
      persistCardTimes(statusTimes);
    }
    const itemsChanged = transition.added.length > 0 || transition.resolvedIds.length > 0;
    if (itemsChanged) {
      applyReminderTransition(active, transition);
      for (const id of transition.resolvedIds) toastedIds.delete(id);
      for (const item of transition.added) {
        if (item.level === 'P2' && readMarks.get(item.id) !== item.createdAt) toastQueue.push(item);
      }
    }
    if (itemsChanged || rec.changed) emit();
  };

  const resetBaseline = (): void => {
    baselined = false;
    prev = null;
    active.clear();
    toastedIds.clear();
    toastQueue.length = 0;
    // 换项目后旧项目的亲历记录不再可信（同卡号会串），一并清掉。
    statusTimes = new Map();
    persistCardTimes(statusTimes);
    refresh();
    emit();
  };

  for (const t of ['workspace', 'errors', 'sessions'] as const) store.on(t, refresh);
  store.on('project', resetBaseline);
  refresh();

  return {
    items(): readonly ReminderItem[] {
      return [...active.values()].map(withReadState).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    },
    popupItems(): readonly ReminderItem[] {
      // 「弹一次」口径：弹窗集合只由活动态推导——未稍后的 P1 在场即呈现，
      // 稍后（snoozed）即退出集合且消解前不再回来；不存在第二条产生路径。
      return selectExtraPopups([...active.values()]);
    },
    takeToasts(): ReminderItem[] {
      const fresh = toastQueue.filter((i) => active.has(i.id) && !toastedIds.has(i.id));
      for (const i of fresh) toastedIds.add(i.id);
      toastQueue.length = 0;
      return selectExtraToasts(fresh);
    },
    snooze(id: string): void {
      const item = active.get(id);
      if (!item || item.level !== 'P1' || item.state === 'snoozed') return;
      active.set(id, { ...item, state: 'snoozed' });
      emit();
    },
    markRead(id: string): void {
      const item = active.get(id);
      if (!item || (item.level !== 'P2' && item.level !== 'P3')) return;
      if (readMarks.get(id) === item.createdAt) return;
      readMarks.set(id, item.createdAt);
      persistReadMarks(readMarks);
      emit();
    },
    progressRows(): readonly CardProgressRow[] {
      const board = store.state.board;
      if (!board?.available) return [];
      const inputs = board.cards.map((c) => ({
        id: c.id,
        title: c.title,
        lane: c.lane,
        assignee: c.assignee,
        status: c.status,
        ahead: c.ahead,
        merge: c.merge ? { time: c.merge.time } : null,
      }));
      // 全量开发进度（负责人定版）：已合入不再过滤，汇总与全部行共同呈现「开发进度」。
      // 呈现排序在此重排（新数组，不改 lib 的原序语义）：受阻 → 进行中 → 待审查 → 待派发
      // → 已合入；已合入组内按合入时间（statusSince）倒序、无时间排后，其余组按卡号升序。
      const GROUP: Readonly<Record<CardProgressRow['status'], number>> = { blocked: 0, active: 1, review: 2, ready: 3, merged: 4 };
      return [...buildCardProgress(inputs, statusTimes)].sort((a, b) => {
        const g = GROUP[a.status] - GROUP[b.status];
        if (g !== 0) return g;
        if (a.status === 'merged') {
          const t = (b.statusSince ?? '').localeCompare(a.statusSince ?? '');
          if (t !== 0) return t;
        }
        return a.cardId.localeCompare(b.cardId);
      });
    },
    onChanged(cb: () => void): () => void {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
