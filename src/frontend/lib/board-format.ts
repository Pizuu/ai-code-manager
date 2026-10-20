/**
 * 泳道看板文案（FR-104–FR-106）：与 HTML 原型 cardHtml / boardBody 相同的规则，数据来自 BoardSnapshot。纯函数。
 */
import type { BoardCard, BoardCardStatus, BoardSnapshot } from '../../../contracts/ipc.ts';

export const STATUS_META: Readonly<Record<BoardCardStatus, { label: string; cls: string }>> = {
  merged: { label: '已合入', cls: 'grn' },
  review: { label: '待审查', cls: 'blu' },
  active: { label: '进行中', cls: 'acc' },
  blocked: { label: '已阻塞', cls: 'amb' },
  ready: { label: '可派工', cls: '' },
};

export const COLUMNS: readonly BoardCardStatus[] = ['ready', 'active', 'review', 'blocked', 'merged'];

/** 本地仓库读不到 PR：原型统一写法。 */
export const PR_LINE = '无 PR（本地分支）';

export function frShort(c: BoardCard): string {
  if (!c.frs.length) return c.frsLabel && c.frsLabel !== '—' ? c.frsLabel.replace(/（.*$/, '') : '无 FR';
  const s = c.frs.slice(0, 2).join(' / ');
  return c.frs.length > 2 ? `${s} +${c.frs.length - 2}` : s;
}

export interface CardLines {
  hot: boolean;
  r3: string;
  r4: string;
  r4Class: 'grn' | 'acc' | 'amb';
}

export function cardLines(c: BoardCard, snap: Pick<BoardSnapshot, 'integrationBranch' | 'lanes'>): CardLines {
  const integ = snap.integrationBranch;
  const lane = snap.lanes.find((l) => l.name === c.lane);
  switch (c.status) {
    case 'merged':
      return { hot: false, r3: `${PR_LINE} · 已合入 ${integ}`, r4: `merge ${c.merge?.short ?? ''} · ${c.changedFiles} 个文件 · lane ${c.laneOk === false ? '✗' : '✓'}`, r4Class: 'grn' };
    case 'active':
    case 'review':
      return {
        hot: true,
        r3: `${PR_LINE} · 领先 ${integ} ${c.ahead ?? 0} 提交`,
        r4: `${c.changedFiles ? `${c.changedFiles} 个文件改动` : '暂无改动'} · lane ${c.laneOk === false ? '✗ 越界' : '✓'}`,
        r4Class: 'acc',
      };
    case 'ready':
      return {
        hot: false,
        r3: c.deps.length ? `${c.deps.join('、')} 已合入 ✓` : '无前置任务',
        r4: `范围 ${(lane?.globs.find((g) => !g.startsWith('!')) ?? c.lane) || '—'} · 可立即派工`,
        r4Class: 'acc',
      };
    default:
      return { hot: false, r3: `等待 ${c.unmetDeps.join('、')} 合入 ${integ}`, r4: '依赖未满足 · 不可派工', r4Class: 'amb' };
  }
}

export interface BoardFilter {
  q: string;
  lane: string;
  agent: string;
  done: boolean;
}

export function filterCards(cards: readonly BoardCard[], f: BoardFilter): BoardCard[] {
  const q = f.q.trim().toLowerCase();
  return cards.filter((c) => {
    if (q && !`${c.id} ${c.title} ${c.frs.join(' ')} ${c.branch ?? ''}`.toLowerCase().includes(q)) return false;
    if (f.agent && c.assignee !== f.agent) return false;
    if (!f.done && c.status === 'merged') return false;
    return true;
  });
}

export function countBy(cards: readonly BoardCard[], status: BoardCardStatus): number {
  return cards.filter((c) => c.status === status).length;
}

/** 泳道行顺序：lanes.conf 顺序 + @shared。 */
export function laneRows(snap: BoardSnapshot): string[] {
  return [...snap.lanes.map((l) => l.name), '@shared'];
}

export function uniqueAssignees(cards: readonly BoardCard[]): string[] {
  return [...new Set(cards.map((c) => c.assignee).filter(Boolean))];
}

/** ISO 时间 → 「HH:MM」（本地时区）。 */
export function hm(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** ISO 时间 → 「YYYY-MM-DD HH:MM」（本地时区）。 */
export function ymdhm(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
