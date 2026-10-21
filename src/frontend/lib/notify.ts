/**
 * 审批提醒的纯逻辑与已决审批历史（功能 005，T-048）。
 *
 * 待处理事项不落盘：每次都由当前待批审批集合（store.state.approvals）推导重建，
 * 同一 approvalId 只生成一条 P0 事项，解决事件把审批从集合删除后事项自然撤下（FR-504/505/514）。
 * 历史只保存已决审批的轻量流水，本机 localStorage 落盘；它不是审批状态的权威来源，
 * 损坏或不可用时退化为内存态，不影响待处理事项（FR-515）。
 */
import type { ApprovalKind, ApprovalRequest, ReminderItem } from '../../../contracts/ipc.ts';
import { approvalPrompt } from './approval-prompt.ts';
import { countChanges } from './diff-lines.ts';

export const NOTIFY_HISTORY_KEY = 'acm.notify-history.v1';
export const MAX_NOTIFY_HISTORY = 100;
export const MAX_POPUP_APPROVALS = 3;

/** 已决审批流水（收件箱「历史」页签的数据形状）。 */
export interface ApprovalHistoryEntry {
  /** 审批 id，与 ApprovalRequest.id 一致；同一审批只记一条。 */
  id: string;
  sessionId: string;
  /** 解决时从会话摘要 / 当前会话取到的标题；取不到时为空串，界面回退为会话 id。 */
  sessionTitle: string;
  approved: boolean;
  /** 决定时间（epoch ms）。 */
  at: number;
  kind: ApprovalKind;
  /** 待批内容摘要（标题 + 关键对象；完整内容仍以当时的 ApprovalRequest 为准）。 */
  summary: string;
}

const APPROVAL_KINDS: ReadonlySet<string> = new Set(['edit', 'command', 'webfetch', 'loop', 'subagent', 'external-dir', 'other']);

/** 审批的完整正文口径：与会话审批卡共用 approvalPrompt，弹窗不得另行截断命令。 */
export function approvalBody(req: ApprovalRequest): string {
  const prompt = approvalPrompt(req);
  switch (req.kind) {
    case 'command':
      return req.command ?? '';
    case 'edit': {
      if (!req.diff) return req.path ?? '';
      const { added, removed } = countChanges(req.diff);
      return `${req.path ?? ''}（+${added} −${removed} 行）`;
    }
    default:
      return [...prompt.lines, ...(prompt.note ? [prompt.note] : [])].join('\n') || prompt.title;
  }
}

/** 历史摘要：审批问题 + 关键对象，折叠空白并限制长度（历史只是流水，不是完整内容存档）。 */
export function summarizeApproval(req: ApprovalRequest, maxLength = 180): string {
  const prompt = approvalPrompt(req);
  const text = `${prompt.title} ${approvalBody(req)}`.replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1))}…` : text;
}

export interface BuildApprovalReminderOptions {
  /** approvalId → 首次被本界面观察到的时间；保证多次重渲时 createdAt 不漂移。 */
  firstSeenAt?: ReadonlyMap<string, string>;
  /** 未提供 firstSeenAt 时的统一产生时间（测试可注入固定值）。 */
  now?: string;
}

/**
 * 由待批审批集合构建 P0 提醒事项：按 approvalId 去重（重复投递只保留第一条），
 * 再按 createdAt 与原始到达顺序稳定排队（弹窗栈的先进先出顺序）。
 */
export function buildApprovalReminderItems(
  approvals: Iterable<ApprovalRequest>,
  options: BuildApprovalReminderOptions = {},
): ReminderItem[] {
  const fallbackCreatedAt = options.now ?? new Date().toISOString();
  const seen = new Set<string>();
  const rows: Array<{ index: number; item: ReminderItem }> = [];
  let index = 0;
  for (const req of approvals) {
    const arrival = index;
    index += 1;
    if (seen.has(req.id)) continue;
    seen.add(req.id);
    const prompt = approvalPrompt(req);
    rows.push({
      index: arrival,
      item: {
        id: req.id,
        level: 'P0',
        source: 'approval',
        title: prompt.title,
        body: approvalBody(req),
        createdAt: options.firstSeenAt?.get(req.id) ?? fallbackCreatedAt,
        state: 'active',
        sessionId: req.sessionId,
        approvalId: req.id,
      },
    });
  }
  rows.sort((a, b) => a.item.createdAt.localeCompare(b.item.createdAt) || a.index - b.index);
  return rows.map((r) => r.item);
}

/** 未消解计数：active / snoozed 计入，resolved / read 不计。 */
export function unresolvedReminderCount(items: readonly ReminderItem[]): number {
  return items.filter((i) => i.state === 'active' || i.state === 'snoozed').length;
}

export interface PopupSelectionOptions {
  /** 被用户用 × 收起的 approvalId：仍在收件箱待处理中，只是不再弹窗。 */
  dismissedIds?: ReadonlySet<string>;
  /** 被 FR-507 抑制的 approvalId（用户正看着对应审批卡）。 */
  suppressedIds?: ReadonlySet<string>;
  /** 同时显示的弹窗上限，默认 3。 */
  limit?: number;
}

export interface PopupSelection {
  visible: ReminderItem[];
  overflow: ReminderItem[];
  suppressed: ReminderItem[];
  dismissed: ReminderItem[];
}

/**
 * 推导弹窗可见集合：只考虑未消解事项；已收起与被抑制的都不弹，
 * 其余按排队顺序取前 limit 条，超出的折叠为 overflow（「还有 N 条」）。
 */
export function selectPopupReminderItems(
  items: readonly ReminderItem[],
  options: PopupSelectionOptions = {},
): PopupSelection {
  const limit = Math.max(0, Math.floor(options.limit ?? MAX_POPUP_APPROVALS));
  const active = items.filter((i) => i.state === 'active' || i.state === 'snoozed');
  const dismissed = active.filter((i) => options.dismissedIds?.has(i.id));
  const available = active.filter((i) => !options.dismissedIds?.has(i.id));
  const suppressed = available.filter((i) => options.suppressedIds?.has(i.id));
  const queue = available.filter((i) => !options.suppressedIds?.has(i.id));
  return {
    visible: queue.slice(0, limit),
    overflow: queue.slice(limit),
    suppressed,
    dismissed,
  };
}

/** 由解决前的审批请求生成一条历史流水（解决后请求即从待批集合删除，必须在此之前取摘要）。 */
export function approvalHistoryEntry(
  req: ApprovalRequest,
  approved: boolean,
  at: number,
  sessionTitle = '',
): ApprovalHistoryEntry {
  return {
    id: req.id,
    sessionId: req.sessionId,
    sessionTitle,
    approved,
    at,
    kind: req.kind,
    summary: summarizeApproval(req),
  };
}

/** 合并历史：按 id 去重（同 id 取时间较新的一条），时间倒序，封顶 cap 条。 */
export function mergeApprovalHistory(
  existing: readonly ApprovalHistoryEntry[],
  additions: readonly ApprovalHistoryEntry[],
  cap = MAX_NOTIFY_HISTORY,
): ApprovalHistoryEntry[] {
  const byId = new Map<string, ApprovalHistoryEntry>();
  for (const e of [...existing, ...additions]) {
    const prev = byId.get(e.id);
    if (!prev || e.at >= prev.at) byId.set(e.id, e);
  }
  return [...byId.values()].sort((a, b) => b.at - a.at).slice(0, Math.max(0, Math.floor(cap)));
}

/* ── 历史落盘（localStorage；范式同 lib/favorites.ts） ── */

let historyCache: ApprovalHistoryEntry[] | null = null;
const historyListeners = new Set<() => void>();

function isValidStoredHistory(e: unknown): e is ApprovalHistoryEntry {
  if (!e || typeof e !== 'object') return false;
  const s = e as Record<string, unknown>;
  return typeof s.id === 'string' && s.id !== ''
    && typeof s.sessionId === 'string' && s.sessionId !== ''
    && typeof s.approved === 'boolean'
    && typeof s.at === 'number' && Number.isFinite(s.at)
    && typeof s.kind === 'string' && APPROVAL_KINDS.has(s.kind)
    && typeof s.summary === 'string';
}

function loadHistory(): ApprovalHistoryEntry[] {
  if (historyCache) return historyCache;
  let raw: string | null;
  try {
    raw = globalThis.localStorage?.getItem(NOTIFY_HISTORY_KEY) ?? null;
  } catch {
    raw = null;
  }
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  const valid = Array.isArray(parsed)
    ? parsed.filter(isValidStoredHistory).map((e) => ({
      ...e,
      sessionTitle: typeof (e as { sessionTitle?: unknown }).sessionTitle === 'string'
        ? (e as { sessionTitle: string }).sessionTitle
        : '',
    }))
    : [];
  historyCache = mergeApprovalHistory([], valid);
  return historyCache;
}

function persistHistory(): void {
  try {
    globalThis.localStorage?.setItem(NOTIFY_HISTORY_KEY, JSON.stringify(historyCache ?? []));
  } catch {
    /* 存储不可用：仅内存态 */
  }
}

function historyChanged(): void {
  persistHistory();
  for (const cb of [...historyListeners]) cb();
}

/** 历史流水（时间倒序，最新在前）。 */
export function listApprovalHistory(): ApprovalHistoryEntry[] {
  return [...loadHistory()];
}

/** 记录一条已决审批并落盘，返回记录后的完整历史。重复解决事件同 id 只保留一条。 */
export function recordApprovalHistory(entry: ApprovalHistoryEntry): ApprovalHistoryEntry[] {
  historyCache = mergeApprovalHistory(loadHistory(), [entry]);
  historyChanged();
  return listApprovalHistory();
}

/** 解决事件的便捷入口：在审批从待批集合删除前调用，摘要取自请求本体。 */
export function recordApprovalResolution(
  req: ApprovalRequest,
  approved: boolean,
  sessionTitle = '',
  at = Date.now(),
): ApprovalHistoryEntry[] {
  return recordApprovalHistory(approvalHistoryEntry(req, approved, at, sessionTitle));
}

/** 订阅历史变更，返回退订函数。 */
export function onNotifyHistoryChanged(cb: () => void): () => void {
  historyListeners.add(cb);
  return () => historyListeners.delete(cb);
}
