/**
 * 分支图布局（FR-108）：移植自 HTML 原型 graph()——每条分支一行，提交按 topo 顺序从左到右，
 * 分出 / 合入用三次贝塞尔曲线。已删除的任务分支由集成分支的合并提交（第二父提交）还原为一行。纯函数。
 */
import type { GitCommitNode, GitSnapshot } from '../../../contracts/ipc.ts';

export const LANE_COLORS: Readonly<Record<string, string>> = {
  main: '#73726C', dev: '#C6613F', backend: '#6D8170', frontend: '#B47C59', '@shared': '#9B8EAA', contracts: '#6A9BCC', infra: '#4682D5', docs: '#C46686',
};
const FALLBACK = '#9B8EAA';

export interface GraphRow {
  name: string;
  label: string;
  color: string;
  kind: 'main' | 'integration' | 'branch';
  /** 本行自有提交 sha（旧 → 新）。 */
  own: string[];
  state: 'merged' | 'open';
}

export interface GraphNode { sha: string; x: number; y: number; r: number; color: string; isMerge: boolean; showSha: boolean; commit: GitCommitNode }
export interface GraphEdge { d: string; color: string; dashed: boolean }
export interface GraphText { x: number; y: number; text: string; size: number; weight: number; color: string; anchor: 'start' | 'end' | 'middle'; mono?: boolean }

export interface GraphLayout {
  width: number;
  height: number;
  rows: GraphRow[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  texts: GraphText[];
}

export const GEOM = { L: 150, R: 40, T: 30, RH: 52 } as const;

function laneOf(name: string): string | null {
  const m = /^[^/]+\/([^/]+)\//.exec(name);
  if (m?.[1]) return m[1];
  return name.startsWith('int/') ? '@shared' : null;
}

function taskLabel(name: string): string {
  return /(T-\d+)/.exec(name)?.[1] ?? name.replace(/^[^/]+\/(?:[^/]+\/)?/, '');
}

export function layoutGraph(g: GitSnapshot, width: number, maxMergedRows = 10): GraphLayout {
  const W = Math.max(600, width);
  const commits = g.commits.slice().reverse(); // 旧 → 新
  const idx = new Map<string, number>();
  commits.forEach((c, i) => idx.set(c.sha, i));
  const integ = g.integrationBranch;
  const main = g.mainBranch;
  const rowOf = new Map<string, number>();
  const rows: GraphRow[] = [];
  const colorFor = (name: string) => (name === main ? (LANE_COLORS.main as string) : name === integ ? (LANE_COLORS.dev as string) : (LANE_COLORS[laneOf(name) ?? ''] ?? FALLBACK));

  const chain = (start: string | undefined): string[] => {
    const out: string[] = [];
    let sha = start;
    while (sha && idx.has(sha) && !rowOf.has(sha)) {
      out.push(sha);
      sha = commits[idx.get(sha) as number]?.parents[0];
    }
    return out.reverse();
  };
  const addRow = (name: string, label: string, kind: GraphRow['kind'], head: string | undefined, state: GraphRow['state']) => {
    const r = rows.length;
    const own = chain(head);
    for (const s of own) rowOf.set(s, r);
    rows.push({ name, label, color: colorFor(name), kind, own, state });
  };

  const branchSha = (n: string) => g.branches.find((b) => b.name === n)?.sha;
  if (branchSha(main)) addRow(main, 'main', 'main', branchSha(main), 'open');
  if (branchSha(integ)) addRow(integ, integ, 'integration', branchSha(integ), 'open');

  // 任务分支：仍存在的分支 + 已合入（可能已删除）的分支，按最早提交排序
  const candidates: Array<{ name: string; head: string; state: GraphRow['state'] }> = [];
  for (const b of g.branches) if (b.kind !== 'main' && b.kind !== 'integration' && idx.has(b.sha) && !b.mergedIntoIntegration) candidates.push({ name: b.name, head: b.sha, state: 'open' });
  const merged = g.merges.slice(-maxMergedRows);
  for (const m of merged) {
    const mc = commits[idx.get(m.sha) ?? -1];
    const p2 = mc?.parents[1];
    if (p2 && idx.has(p2) && m.branch && !candidates.some((c) => c.name === m.branch)) candidates.push({ name: m.branch, head: p2, state: 'merged' });
  }
  candidates.sort((a, b) => (idx.get(a.head) ?? 0) - (idx.get(b.head) ?? 0));
  for (const c of candidates) {
    const label = `${taskLabel(c.name)} · ${c.state === 'merged' ? '已合入' : '进行中'}`;
    addRow(c.name, label, 'branch', c.head, c.state);
  }
  for (const c of commits) if (!rowOf.has(c.sha)) rowOf.set(c.sha, Math.min(1, rows.length - 1));

  const { L, R, T, RH } = GEOM;
  const n = commits.length;
  const stepX = (W - L - R) / Math.max(1, n);
  const X = (i: number) => L + stepX * (i + 0.5);
  const Y = (r: number) => T + r * RH;
  const height = T + rows.length * RH + 4;
  const texts: GraphText[] = [];
  const edges: GraphEdge[] = [];

  rows.forEach((row, r) => {
    const y = Y(r);
    texts.push({ x: 16, y: y + 4, text: row.label, size: r < 2 && row.kind !== 'branch' ? 13 : 11, weight: r < 2 && row.kind !== 'branch' ? 600 : 400, color: row.kind === 'integration' ? (LANE_COLORS.dev as string) : row.kind === 'main' ? '#141413' : '#73726C', anchor: 'start' });
    const xs = row.own.map((s) => X(idx.get(s) as number));
    if (row.kind !== 'branch') {
      const x0 = xs.length ? Math.min(...xs) : X(0);
      edges.push({ d: `M${x0} ${y} L${W - R} ${y}`, color: row.color, dashed: false });
    } else if (xs.length) {
      texts.push({ x: Math.min(...xs) + 6, y: y - 8, text: row.name, size: 11, weight: 400, color: row.color, anchor: 'start' });
    }
  });

  for (const c of commits) {
    const ci = idx.get(c.sha) as number;
    const cr = rowOf.get(c.sha) as number;
    c.parents.forEach((p) => {
      if (!idx.has(p)) return;
      const x1 = X(idx.get(p) as number);
      const y1 = Y(rowOf.get(p) as number);
      const x2 = X(ci);
      const y2 = Y(cr);
      const rowB = rows[cr <= 1 && rows[cr]?.kind !== 'branch' ? (rowOf.get(p) as number) : cr];
      const color = rowB?.color ?? FALLBACK;
      if (y1 === y2) edges.push({ d: `M${x1} ${y1} L${x2} ${y2}`, color, dashed: false });
      else if (y2 > y1) {
        const k = Math.min(stepX * 0.9, 60);
        edges.push({ d: `M${x1} ${y1} C${x1 + k * 0.6} ${y1} ${x1 + k * 0.2} ${y2} ${x1 + k} ${y2} L${x2} ${y2}`, color, dashed: false });
      } else {
        const k = Math.min(stepX * 0.9, 60);
        edges.push({ d: `M${x1} ${y1} L${x2 - k} ${y1} C${x2 - k * 0.2} ${y1} ${x2 - k * 0.6} ${y2} ${x2} ${y2}`, color, dashed: false });
      }
    });
  }

  /** sha 标签之间至少留出的水平距离，避免挤成一团。 */
  const MIN_LABEL_GAP = 56;
  let lastLabelX = -Infinity;
  const nodes: GraphNode[] = commits.map((c) => {
    const r = rowOf.get(c.sha) as number;
    const row = rows[r];
    const isMerge = c.parents.length > 1;
    const x = X(idx.get(c.sha) as number);
    let showSha = row?.kind !== 'branch' && isMerge && x - lastLabelX >= MIN_LABEL_GAP;
    if (showSha) lastLabelX = x;
    else showSha = false;
    return { sha: c.sha, x, y: Y(r), r: isMerge ? 5 : 4.5, color: row?.color ?? FALLBACK, isMerge, showSha, commit: c };
  });

  const integRow = rows.findIndex((x) => x.kind === 'integration');
  const mainRow = rows.findIndex((x) => x.kind === 'main');
  if (integRow >= 0) texts.push({ x: W - R, y: Y(integRow) - 10, text: `HEAD · ${integ} ${g.integrationHead ?? ''}`, size: 11, weight: 400, color: LANE_COLORS.dev as string, anchor: 'end' });
  if (mainRow >= 0) {
    const rel = g.mainMerges.length ? '已有发布合入' : `${integ} → main 尚未发起`;
    texts.push({ x: W - R, y: Y(mainRow) - 10, text: `main ${g.mainHead ?? ''} · ${integ} 领先 ${g.integrationAheadOfMain} 提交 · ${rel}${g.tags.length ? ` · tags ${g.tags.join(',')}` : ' · 无 tag'}`, size: 11, weight: 400, color: '#73726C', anchor: 'end' });
  }
  return { width: W, height, rows, nodes, edges, texts };
}
