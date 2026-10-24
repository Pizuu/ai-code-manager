/**
 * 审批中心的全流程活动记录（纯渲染进程，不改 IPC 契约）：把 agent:event 里与「审批 / 消息收发 / 运行状态 / 错误」
 * 相关的事件折算为一条条带时间的记录，供审批中心时间线展示与筛选。
 * 只做纯函数（便于单元测试）；落盘（localStorage）与订阅在 store.ts。
 */
import type { ApprovalRequest } from '../../../contracts/ipc.ts';

export type ActivityKind =
  | 'approval-request'   // 收到审批请求
  | 'approval-approved'  // 已批准
  | 'approval-rejected'  // 已拒绝
  | 'sent'               // 发送用户消息
  | 'received'           // 收到 Agent 回答
  | 'run-start'          // 开始回答
  | 'run-end'            // 回答结束
  | 'error';             // 出错

export type ActivityGroup = 'approval' | 'message' | 'status' | 'error';

export interface ActivityEntry {
  id: string;
  /** ISO 时间。 */
  at: string;
  sessionId: string;
  kind: ActivityKind;
  /** 一行摘要（已截断）。 */
  text: string;
  /** 审批相关记录：对应的审批 ID。 */
  approvalId?: string;
}

/** 本机最多保留的记录条数（超出丢最早的）。 */
export const ACTIVITY_MAX = 500;
/** 摘要最长字符数。 */
const TEXT_MAX = 140;

export const ACTIVITY_META: Readonly<Record<ActivityKind, { label: string; group: ActivityGroup; tone: 'acc' | 'grn' | 'red' | 'mute' | 'warn' }>> = {
  'approval-request': { label: '待审批', group: 'approval', tone: 'warn' },
  'approval-approved': { label: '已批准', group: 'approval', tone: 'grn' },
  'approval-rejected': { label: '已拒绝', group: 'approval', tone: 'red' },
  sent: { label: '发送', group: 'message', tone: 'acc' },
  received: { label: '接收', group: 'message', tone: 'grn' },
  'run-start': { label: '开始回答', group: 'status', tone: 'mute' },
  'run-end': { label: '回答结束', group: 'status', tone: 'mute' },
  error: { label: '出错', group: 'error', tone: 'red' },
};

export const GROUP_LABEL: Readonly<Record<ActivityGroup, string>> = { approval: '审批', message: '消息', status: '状态', error: '错误' };

export function clip(text: string, max = TEXT_MAX): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

const KIND_LABEL: Readonly<Record<string, string>> = { edit: '修改文件', command: '执行命令', webfetch: '抓取网页', loop: '循环调用', subagent: '子 Agent', 'external-dir': '访问项目外目录', other: '其他操作' };
export function approvalKindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}

/** 审批请求的一行摘要：种类 + 目标（文件 / 命令 / URL / 路径）。 */
export function approvalSummary(a: ApprovalRequest): string {
  const target = a.command ?? a.path ?? a.url ?? a.description ?? a.tool ?? a.permission ?? '';
  return clip(`${approvalKindLabel(a.kind)}${target ? ` · ${target}` : ''}`);
}

let seq = 0;
export function makeEntry(kind: ActivityKind, sessionId: string, text: string, at = new Date().toISOString(), approvalId?: string): ActivityEntry {
  seq = (seq + 1) % 1_000_000;
  return { id: `${Date.parse(at) || 0}-${seq}`, at, sessionId, kind, text: clip(text), ...(approvalId ? { approvalId } : {}) };
}

/** 追加一条（返回新数组，最新在末尾，超出上限丢最早的）。 */
export function appendEntry(list: readonly ActivityEntry[], e: ActivityEntry, max = ACTIVITY_MAX): ActivityEntry[] {
  const out = [...list, e];
  return out.length > max ? out.slice(out.length - max) : out;
}

export interface ActivityFilter {
  /** 只保留这些会话（当前项目）的记录。 */
  sessionIds: ReadonlySet<string>;
  group?: ActivityGroup | '';
  sessionId?: string;
  q?: string;
}

/** 筛选并按时间倒序（最新在前；同一时刻按追加顺序倒序）。 */
export function filterEntries(list: readonly ActivityEntry[], f: ActivityFilter): ActivityEntry[] {
  const q = (f.q ?? '').trim().toLowerCase();
  return list
    .map((e, i) => ({ e, i }))
    .sort((a, b) => b.e.at.localeCompare(a.e.at) || b.i - a.i)
    .map(({ e }) => e)
    .filter((e) => f.sessionIds.has(e.sessionId))
    .filter((e) => !f.group || ACTIVITY_META[e.kind].group === f.group)
    .filter((e) => !f.sessionId || e.sessionId === f.sessionId)
    .filter((e) => !q || e.text.toLowerCase().includes(q) || ACTIVITY_META[e.kind].label.includes(q));
}

export interface ActivityStats {
  sent: number;
  received: number;
  approved: number;
  rejected: number;
  requested: number;
  errors: number;
}

export function activityStats(list: readonly ActivityEntry[], sessionIds: ReadonlySet<string>): ActivityStats {
  const s: ActivityStats = { sent: 0, received: 0, approved: 0, rejected: 0, requested: 0, errors: 0 };
  for (const e of list) {
    if (!sessionIds.has(e.sessionId)) continue;
    if (e.kind === 'sent') s.sent++;
    else if (e.kind === 'received') s.received++;
    else if (e.kind === 'approval-approved') s.approved++;
    else if (e.kind === 'approval-rejected') s.rejected++;
    else if (e.kind === 'approval-request') s.requested++;
    else if (e.kind === 'error') s.errors++;
  }
  return s;
}

/** 从 localStorage 文本恢复（容错：非法数据返回空）。 */
export function parseEntries(raw: string | null): ActivityEntry[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is ActivityEntry => !!x && typeof x === 'object'
      && typeof (x as ActivityEntry).id === 'string' && typeof (x as ActivityEntry).at === 'string'
      && typeof (x as ActivityEntry).sessionId === 'string' && typeof (x as ActivityEntry).text === 'string'
      && (x as ActivityEntry).kind in ACTIVITY_META).slice(-ACTIVITY_MAX);
  } catch {
    return [];
  }
}
