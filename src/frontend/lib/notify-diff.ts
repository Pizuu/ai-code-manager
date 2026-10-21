/**
 * P1–P3 提醒事项的快照差分（功能 005，T-049 / T506 / T507 共用）。
 *
 * 输入是「观察快照」：看板卡片 id → 状态（含标题）与出错会话 id → 摘要。
 * 输出是事项变迁（新增 / 消解）。规则口径：
 * - 卡片新进入 blocked → P1（source 'card'）；新进入 review → P2；新进入 ready → P3（FR-509 / FR-510）。
 * - 卡片新进入 merged → P2 合入提醒（走 P2 通道：收件箱 + 轻提示一次）；标题带集成分支名。
 * - 会话新进入出错态 → P1（source 'session'）。
 * - 同一来源同一目标状态持续期间不重复产生；状态离开即消解；离开后再次进入可再产生
 *   （id 由「来源 + 对象 + 目标状态」推导，消解后同 id 复用不冲突，见契约 v1.13 去重键口径）。
 * - 基线规则：prev 为 null（首次喂入）只建基线，added / resolved 恒为空——
 *   启动时的历史状态不是变迁，不许糊成一墙待办。
 *
 * 本模块纯函数、无副作用；事项的呈现（弹窗 / 轻提示 / 已读 / 计数）在 views/notify-feed.ts 与
 * views/notify-view.ts，本模块只提供呈现所需的集合推导（popup / toast 资格与角标计数口径）。
 */
import type { BoardCardStatus, ReminderItem } from '../../../contracts/ipc.ts';
import { unresolvedReminderCount } from './notify.ts';

/** 观察快照中的一张卡片（只取差分与呈现需要的字段）。 */
export interface ObservedCardState {
  status: BoardCardStatus;
  title: string;
}

/** 观察快照中的一个出错会话（title 为会话标题，summary 为错误摘要首行）。 */
export interface ObservedErrorState {
  title: string;
  summary: string;
}

/** 一份观察快照：喂数器从 store 看板快照与会话错误集合构建。 */
export interface ObservedSnapshot {
  cards: ReadonlyMap<string, ObservedCardState>;
  errorSessions: ReadonlyMap<string, ObservedErrorState>;
}

/** 一次差分的结果：新增事项（按来源 id 升序，保证呈现顺序确定）与消解的事项 id。 */
export interface ReminderTransition {
  added: ReminderItem[];
  resolvedIds: string[];
}

/** 卡片目标状态 → 级别；非目标状态（active）不产生事项。merged 为合入提醒（P2）。 */
const CARD_LEVEL: Partial<Record<BoardCardStatus, ReminderItem['level']>> = {
  blocked: 'P1',
  review: 'P2',
  ready: 'P3',
  merged: 'P2',
};

const CARD_VERB: Partial<Record<BoardCardStatus, string>> = {
  blocked: '已受阻',
  review: '待审查',
  ready: '变为 ready 可派发',
};

/** 卡片事项 id：来源 + 卡片 id + 目标状态（契约 v1.13 去重键口径）。 */
export function cardReminderId(cardId: string, status: BoardCardStatus): string {
  return `card:${cardId}:${status}`;
}

/** 会话出错事项 id：来源 + 会话 id + 目标状态（出错态）。 */
export function sessionReminderId(sessionId: string): string {
  return `session:${sessionId}:error`;
}

function cardItem(cardId: string, card: ObservedCardState, now: string, branchLabel: string): ReminderItem | null {
  const level = CARD_LEVEL[card.status];
  if (!level) return null;
  if (card.status === 'merged') {
    // 合入提醒：标题自带卡号 + 卡名 + 目标集成分支（轻提示只显标题，须自足）；卡名不再另放 body 防重复。
    return {
      id: cardReminderId(cardId, card.status),
      level,
      source: 'card',
      title: card.title ? `${cardId} ${card.title} 已合入 ${branchLabel}` : `${cardId} 已合入 ${branchLabel}`,
      createdAt: now,
      state: 'active',
      cardId,
    };
  }
  return {
    id: cardReminderId(cardId, card.status),
    level,
    source: 'card',
    title: `${cardId} ${CARD_VERB[card.status] ?? card.status}`,
    ...(card.title ? { body: card.title } : {}),
    createdAt: now,
    state: 'active',
    cardId,
  };
}

function sessionItem(sessionId: string, err: ObservedErrorState, now: string): ReminderItem {
  return {
    id: sessionReminderId(sessionId),
    level: 'P1',
    source: 'session',
    title: `${err.title || `会话 ${sessionId.slice(0, 8)}`} 出错`,
    ...(err.summary ? { body: err.summary } : {}),
    createdAt: now,
    state: 'active',
    sessionId,
  };
}

/**
 * 差分前后两份观察快照。prev 为 null 表示首次喂入（基线）：恒返回空变迁。
 * 「进入」判定：对象在 next 处于目标状态，且 prev 中不存在或状态不同；
 * 对象从快照消失（卡片被删 / 会话错误清空）按离开其原目标状态处理。
 * integrationBranch 只用于合入提醒的标题文案（调用方从看板快照取集成分支名）；
 * 缺省 / 空白时兜底为「集成分支」，不写死具体分支名。
 */
export function diffReminderSnapshot(
  prev: ObservedSnapshot | null,
  next: ObservedSnapshot,
  now: string = new Date().toISOString(),
  integrationBranch?: string,
): ReminderTransition {
  if (!prev) return { added: [], resolvedIds: [] };
  const branchLabel = integrationBranch?.trim() ? integrationBranch : '集成分支';
  const added: ReminderItem[] = [];
  const resolvedIds: string[] = [];

  for (const [cardId, card] of next.cards) {
    if (!CARD_LEVEL[card.status]) continue;
    const before = prev.cards.get(cardId);
    if (!before || before.status !== card.status) {
      const item = cardItem(cardId, card, now, branchLabel);
      if (item) added.push(item);
    }
  }
  for (const [cardId, card] of prev.cards) {
    if (!CARD_LEVEL[card.status]) continue;
    const after = next.cards.get(cardId);
    if (!after || after.status !== card.status) resolvedIds.push(cardReminderId(cardId, card.status));
  }

  for (const [sessionId, err] of next.errorSessions) {
    if (!prev.errorSessions.has(sessionId)) added.push(sessionItem(sessionId, err, now));
  }
  for (const sessionId of prev.errorSessions.keys()) {
    if (!next.errorSessions.has(sessionId)) resolvedIds.push(sessionReminderId(sessionId));
  }

  added.sort((a, b) => a.id.localeCompare(b.id));
  resolvedIds.sort();
  return { added, resolvedIds };
}

/** 把一次变迁应用到活动事项集合（id → 事项），返回同一 Map（原地更新，喂数器与测试共用）。 */
export function applyReminderTransition(
  active: Map<string, ReminderItem>,
  transition: ReminderTransition,
): Map<string, ReminderItem> {
  for (const id of transition.resolvedIds) active.delete(id);
  for (const item of transition.added) active.set(item.id, item);
  return active;
}

/* ── 呈现集合推导（FR-501 分级通道的逻辑断言落点） ── */

/**
 * 可进弹窗栈的事项：只有 P1（新事项弹一次）。P0 由审批链路单独处理不在此列；
 * P2 只轻提示、P3 只进收件箱——两者永不进弹窗集合（SC-004 的前端断言在此函数）。
 * snoozed（已「稍后」）的 P1 不再弹窗。
 */
export function selectExtraPopups(items: readonly ReminderItem[]): ReminderItem[] {
  return items.filter((i) => i.level === 'P1' && i.state === 'active');
}

/** 可给轻提示的事项：只有 P2；P3 连轻提示都不给（仅收件箱）。 */
export function selectExtraToasts(items: readonly ReminderItem[]): ReminderItem[] {
  return items.filter((i) => i.level === 'P2' && i.state === 'active');
}

/**
 * 收件箱角标的未消解计数口径（FR-511）：P0 待批（active / snoozed）
 * + P1 活动（active / snoozed——「稍后」只是收起弹窗，事项未消解照常计数）
 * + P2 / P3 未读（state 为 read 的不计；条目本身保留到消解）。
 * extras 传入前应已应用已读标记（P2 / P3 已读项的 state 为 'read'）。
 */
export function pendingBadgeCount(
  p0Items: readonly ReminderItem[],
  extras: readonly ReminderItem[],
): number {
  return unresolvedReminderCount(p0Items) + unresolvedReminderCount(extras);
}

/* ── 收件箱「进度」页签（FR-516）：状态 → 进度段映射与状态时间戳 ── */

/** 进度段（顺序即推进方向）：待派发 → 进行中 → 待审查 → 已合入。 */
export const PROGRESS_STAGES = [
  { status: 'ready', label: '待派发' },
  { status: 'active', label: '进行中' },
  { status: 'review', label: '待审查' },
  { status: 'merged', label: '已合入' },
] as const satisfies readonly { status: BoardCardStatus; label: string }[];

/**
 * 状态 → 进度段序号：ready 0 / active 1 / review 2 / merged 3。
 * blocked 不占正常段（异常态）：返回 -1，呈现层以红色异常标记整条进度，
 * 状态离开 blocked 后自然回到其应处段。
 */
export function progressStageIndex(status: BoardCardStatus): number {
  switch (status) {
    case 'ready': return 0;
    case 'active': return 1;
    case 'review': return 2;
    case 'merged': return 3;
    case 'blocked': return -1;
  }
}

/** 一张卡进入当前状态的亲历记录（喂数器在变迁发生时以本地墙钟写下）。 */
export interface CardStatusTime {
  status: BoardCardStatus;
  /** 进入该状态的本地时间（ISO 8601）。 */
  at: string;
}

/**
 * 按一份卡片状态映射更新亲历记录：状态变化（或首次在基线后观察到）的卡记为 now；
 * 未变的保留原记录；已不在快照中的卡删除记录（防存储膨胀）。
 * 基线观察（baseline=true，应用启动后的首次加载）不写任何记录——
 * 没亲历的变迁不许冒充亲历（FR-516 时间戳口径）。
 */
export function recordCardStatusTimes(
  prev: ReadonlyMap<string, CardStatusTime>,
  cards: ReadonlyMap<string, { status: BoardCardStatus }>,
  now: string,
  baseline: boolean,
): { times: Map<string, CardStatusTime>; changed: boolean } {
  const times = new Map<string, CardStatusTime>();
  let changed = false;
  for (const [id, card] of cards) {
    const before = prev.get(id);
    if (before && before.status === card.status) {
      times.set(id, before);
    } else if (baseline) {
      // 基线：不记录（该卡进入当前状态的时间未亲历，呈现层走兜底口径）。
    } else {
      times.set(id, { status: card.status, at: now });
      changed = true;
    }
  }
  if (!changed) {
    for (const id of prev.keys()) {
      if (!cards.has(id)) {
        changed = true;
        break;
      }
    }
  }
  return { times, changed };
}

/** 构建进度行所需的看板卡片最小形状（BoardCard 的子集，字段原文直用）。 */
export interface CardProgressInput {
  id: string;
  title: string;
  lane: string;
  assignee: string;
  status: BoardCardStatus;
  ahead: number | null;
  merge: { time: string } | null;
}

/** 状态时间戳的来源口径：亲历 / git 合入时间兜底 / 应用打开前已是此状态（不编造）。 */
export type StatusSinceKind = 'witnessed' | 'merge' | 'preexisting';

export interface CardProgressRow {
  cardId: string;
  title: string;
  lane: string;
  /** 执行者原文（空 / 待派发等原文照用）。 */
  assignee: string;
  status: BoardCardStatus;
  /** 进度段序号（progressStageIndex）；blocked 为 -1（异常态）。 */
  stageIndex: number;
  blocked: boolean;
  /** 分支领先数；null 时不呈现。 */
  ahead: number | null;
  /** 进入当前状态的时间；preexisting 时为 null（呈现层显兜底文案）。 */
  statusSince: string | null;
  statusSinceKind: StatusSinceKind;
}

const PROGRESS_ORDER: Record<BoardCardStatus, number> = {
  blocked: 0, review: 1, active: 2, ready: 3, merged: 4,
};

/**
 * 构建进度行（输入什么卡就映射什么卡；在途过滤由调用方按 FR-516 口径做）：
 * 排序为 受阻 → 待审查 → 进行中 → 待派发 → 已合入（急迫度降序），同档按卡号升序。
 * 时间戳解析：亲历记录且状态匹配 → witnessed；merged 卡无亲历记录 → merge.time；
 * 其余 → preexisting（statusSince 为 null）。
 */
export function buildCardProgress(
  cards: readonly CardProgressInput[],
  statusTimes: ReadonlyMap<string, CardStatusTime>,
): CardProgressRow[] {
  const rows: CardProgressRow[] = [];
  for (const c of cards) {
    const witnessed = statusTimes.get(c.id);
    let statusSince: string | null = null;
    let statusSinceKind: StatusSinceKind = 'preexisting';
    if (witnessed && witnessed.status === c.status) {
      statusSince = witnessed.at;
      statusSinceKind = 'witnessed';
    } else if (c.status === 'merged' && c.merge) {
      statusSince = c.merge.time;
      statusSinceKind = 'merge';
    }
    rows.push({
      cardId: c.id,
      title: c.title,
      lane: c.lane,
      assignee: c.assignee,
      status: c.status,
      stageIndex: progressStageIndex(c.status),
      blocked: c.status === 'blocked',
      ahead: c.ahead,
      statusSince,
      statusSinceKind,
    });
  }
  rows.sort((a, b) => PROGRESS_ORDER[a.status] - PROGRESS_ORDER[b.status] || a.cardId.localeCompare(b.cardId));
  return rows;
}
