/**
 * 任务卡 / BOARD.md / Spec Kit 制品解析（FR-104、FR-106）。纯函数，输入为文件文本。
 * 格式见 docs/tasks/TEMPLATE.md 与 specs/<NNN>/ 下各制品。
 */
import type { BoardAcceptance, FeatureStage } from '../../../contracts/ipc.ts';

export interface ParsedCard {
  id: string;
  title: string;
  lane: string | null;
  frs: string[];
  frsLabel: string;
  specTaskIds: string[];
  branch: string | null;
  prTarget: string | null;
  deps: string[];
  declaredStatus: string;
  assignee: string | null;
  goal: string;
  acceptance: BoardAcceptance[];
}

export interface BoardRow {
  id: string;
  title: string;
  lane: string;
  deps: string;
  declaredStatus: string;
  assignee: string;
}

function sections(md: string): Record<string, string> {
  const out: Record<string, string> = {};
  const parts = md.split(/^## /m).slice(1);
  for (const p of parts) {
    const nl = p.indexOf('\n');
    const head = (nl === -1 ? p : p.slice(0, nl)).trim();
    out[head] = (nl === -1 ? '' : p.slice(nl + 1)).trim();
  }
  return out;
}

function tableFields(md: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of md.matchAll(/^\|\s*([^|]+?)\s*\|\s*(.+?)\s*\|\s*$/gm)) {
    const k = (m[1] ?? '').trim();
    if (!k || k === '字段' || /^-+$/.test(k)) continue;
    if (!(k in out)) out[k] = (m[2] ?? '').trim();
  }
  return out;
}

const firstTick = (s: string | undefined): string | null => (s ? (/`([^`]+)`/.exec(s)?.[1] ?? null) : null);

export function parseTaskCard(fileName: string, md: string): ParsedCard | null {
  const id = /(T-\d+)/.exec(fileName)?.[1];
  if (!id) return null;
  const f = tableFields(md);
  const sec = sections(md);
  const req = f['对应需求'] ?? '';
  const frs = [...new Set(req.match(/FR-\d+/g) ?? [])].sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)));
  const frsLabel = req.includes('…') || req.includes('全部') || req.includes('–') ? req.replace(/（specs\/.*$/, '').trim() : frs.join(', ') || '—';
  return {
    id,
    title: (/^#\s+T-\d+\s+(.+)$/m.exec(md)?.[1] ?? '').trim(),
    lane: f['泳道'] ?? null,
    frs,
    frsLabel,
    specTaskIds: (f['包含任务号'] ?? '').match(/T\d{3}/g) ?? [],
    branch: firstTick(f['分支']),
    prTarget: firstTick(f['PR 目标']),
    deps: (f['前置任务'] ?? '').match(/T-\d+/g) ?? [],
    declaredStatus: (f['状态'] ?? '').trim(),
    assignee: f['执行者'] ?? null,
    goal: sec['目标'] ?? '',
    acceptance: [...(sec['验收标准'] ?? '').matchAll(/^- \[([ xX])\] (.+)$/gm)].map((m) => ({ done: m[1] !== ' ', text: (m[2] ?? '').trim() })),
  };
}

export function parseBoardRows(md: string): Map<string, BoardRow> {
  const out = new Map<string, BoardRow>();
  for (const m of md.matchAll(/^\|\s*(T-\d+)\s*\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|/gm)) {
    const id = m[1] as string;
    out.set(id, {
      id,
      title: (m[2] ?? '').trim(),
      lane: (m[3] ?? '').trim(),
      deps: (m[4] ?? '').trim(),
      declaredStatus: (m[5] ?? '').trim(),
      assignee: (m[6] ?? '').trim(),
    });
  }
  return out;
}

export interface SpecInfo {
  title: string;
  status: string;
  frCount: number;
  scCount: number;
  clarifications: number;
}

export function parseSpec(md: string): SpecInfo {
  const frs = new Set(md.match(/\*\*FR-\d+\*\*/g) ?? md.match(/FR-\d+/g) ?? []);
  return {
    title: (/^#\s+Feature Specification:\s*(.+)$/m.exec(md)?.[1] ?? '').trim(),
    status: (/\*\*Status\*\*:\s*(.+)$/m.exec(md)?.[1] ?? '').trim(),
    frCount: frs.size,
    scCount: new Set(md.match(/SC-\d+/g) ?? []).size,
    clarifications: (md.match(/^- Q: .+ → A: .+$/gm) ?? []).length,
  };
}

export function countChecklist(md: string): { done: number; open: number } {
  return { done: (md.match(/^\s*- \[[xX]\]/gm) ?? []).length, open: (md.match(/^\s*- \[ \]/gm) ?? []).length };
}

export function constitutionVersion(md: string | null): string | null {
  if (!md) return null;
  return /\*\*(?:Version|版本)\*\*[:：]\s*([\d.]+)/.exec(md)?.[1] ?? null;
}

export function analysisFindings(md: string | null): number {
  if (!md) return 0;
  return (md.match(/^\|\s*[A-Z]\d+\s*\|/gm) ?? []).length;
}

export interface StageInput {
  constitution: string | null;
  spec: SpecInfo | null;
  hasPlan: boolean;
  checklists: Array<{ done: number; open: number }>;
  hasTasks: boolean;
  analysis: string | null;
}

/** Spec Kit 阶段条（看板进度行）。 */
export function featureStages(i: StageInput): FeatureStage[] {
  const cv = constitutionVersion(i.constitution);
  const done = i.checklists.reduce((a, c) => a + c.done, 0);
  const total = i.checklists.reduce((a, c) => a + c.done + c.open, 0);
  return [
    { key: 'constitution', label: '宪法', done: Boolean(i.constitution), detail: cv ? `v${cv}` : '' },
    { key: 'spec', label: '规格', done: Boolean(i.spec), detail: i.spec ? `${i.spec.frCount} FR · ${i.spec.scCount} SC` : '' },
    { key: 'clarify', label: '澄清', done: Boolean(i.spec && i.spec.clarifications > 0), detail: i.spec ? `${i.spec.clarifications} 问` : '' },
    { key: 'plan', label: '计划', done: i.hasPlan, detail: '' },
    { key: 'checklists', label: 'Checklist', done: i.checklists.length > 0, detail: `${done}/${total}` },
    { key: 'tasks', label: '任务', done: i.hasTasks, detail: '' },
    { key: 'analyze', label: 'Analyze', done: Boolean(i.analysis), detail: `${analysisFindings(i.analysis)} 项发现` },
  ];
}

/** 合并提交说明 → 被合入分支名（`merge: x`、`Merge branch 'x'`）。 */
export function mergedBranchName(subject: string): string | null {
  const pr = /^Merge pull request #\d+ from (\S+)/i.exec(subject.trim());
  if (pr?.[1]) return pr[1];
  const m = /^merge:?\s*(?:branch\s+)?'?([\w./@-]+)'?/i.exec(subject.trim());
  return m?.[1] ?? null;
}
