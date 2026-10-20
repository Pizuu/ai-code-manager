/**
 * 泳道看板快照（FR-104–FR-106、US2）。状态以 git 为准（research R2）：
 * 合并记录 → merged；分支存在 → review（领先 > 0）/ active；否则看前置 → ready / blocked。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { BoardCard, BoardCardStatus, BoardFeature, BoardSnapshot, GitSnapshot } from '../../../contracts/ipc.ts';
import { parseTasksMarkdown } from '../specs/tasks-parser.ts';
import { countChecklist, featureStages, parseBoardRows, parseSpec, parseTaskCard, type ParsedCard } from './cards.ts';
import { gitOut, mapLimit, type GitRunner } from './git.ts';
import { laneCheck, parseAgentsConfig, parseLaneOwners, parseLanesConf, type AgentsConfig, type LanesConfig } from './lanes.ts';

async function readText(root: string, rel: string): Promise<string | null> {
  try {
    return await fs.readFile(path.join(root, rel), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT' || (err as NodeJS.ErrnoException).code === 'ENOTDIR') return null;
    throw err;
  }
}

async function listDir(root: string, rel: string): Promise<string[]> {
  try {
    return (await fs.readdir(path.join(root, rel))).sort();
  } catch {
    return [];
  }
}

export async function readAgentsConfig(root: string): Promise<AgentsConfig> {
  return parseAgentsConfig(await readText(root, '.agents/config.sh'));
}

async function readFeature(root: string): Promise<BoardFeature | null> {
  const dirs = (await listDir(root, 'specs')).filter((d) => /^\d{3}-/.test(d));
  const id = dirs.at(-1);
  if (!id) return null;
  const dir = `specs/${id}`;
  const specMd = await readText(root, `${dir}/spec.md`);
  const spec = specMd ? parseSpec(specMd) : null;
  const tasksMd = await readText(root, `${dir}/tasks.md`);
  const tasks = tasksMd ? parseTasksMarkdown(tasksMd) : [];
  const checklists = [];
  for (const f of (await listDir(root, `${dir}/checklists`)).filter((x) => x.endsWith('.md'))) {
    checklists.push(countChecklist((await readText(root, `${dir}/checklists/${f}`)) ?? ''));
  }
  return {
    id, dir, title: spec?.title ?? id, status: spec?.status ?? '',
    stages: featureStages({
      constitution: await readText(root, '.specify/memory/constitution.md'),
      spec, hasPlan: (await readText(root, `${dir}/plan.md`)) !== null, checklists, hasTasks: tasksMd !== null,
      analysis: await readText(root, `${dir}/analysis.md`),
    }),
    tasksDone: tasks.filter((t) => t.done).length,
    tasksTotal: tasks.length,
  };
}

export function emptyBoard(cfg: AgentsConfig, reason: string, now: string): BoardSnapshot {
  return {
    available: false, reason, generatedAt: now, integrationBranch: cfg.integrationBranch, mainBranch: cfg.mainBranch,
    maxParallel: cfg.maxParallel, lanes: [], shared: [], feature: null, cards: [], contractVersion: null, boardFile: null, conflicts: [],
  };
}

interface GitFacts {
  /** 分支名 → 合并记录 */
  merged: Map<string, { sha: string; short: string; time: string }>;
  branches: Map<string, { ahead: number; behind: number; worktree: string | null; time: string; mergedIntoIntegration: boolean }>;
}

function gitFacts(g: GitSnapshot): GitFacts {
  const merged = new Map<string, { sha: string; short: string; time: string }>();
  for (const m of g.merges) if (m.branch) merged.set(m.branch, { sha: m.sha, short: m.short, time: m.time });
  const branches = new Map<string, { ahead: number; behind: number; worktree: string | null; time: string; mergedIntoIntegration: boolean }>();
  for (const b of g.branches) branches.set(b.name, { ahead: b.ahead, behind: b.behind, worktree: b.worktree, time: b.time, mergedIntoIntegration: b.mergedIntoIntegration });
  return { merged, branches };
}

/** 纯函数：由解析结果与 git 事实推导状态（单测友好）。 */
export function deriveStatuses(cards: ParsedCard[], facts: GitFacts): Map<string, { status: BoardCardStatus; unmet: string[] }> {
  const out = new Map<string, { status: BoardCardStatus; unmet: string[] }>();
  for (const c of cards) {
    const br = c.branch ? facts.branches.get(c.branch) : undefined;
    if (c.branch && facts.merged.has(c.branch)) out.set(c.id, { status: 'merged', unmet: [] });
    else if (br) out.set(c.id, { status: br.ahead > 0 ? 'review' : 'active', unmet: [] });
  }
  // 前置可能链式依赖：迭代到稳定
  for (let pass = 0; pass < cards.length + 1; pass++) {
    let changed = false;
    for (const c of cards) {
      const cur = out.get(c.id);
      if (cur && cur.status !== 'ready' && cur.status !== 'blocked') continue;
      const unmet = c.deps.filter((d) => out.get(d)?.status !== 'merged');
      const status: BoardCardStatus = unmet.length ? 'blocked' : 'ready';
      if (!cur || cur.status !== status || cur.unmet.join() !== unmet.join()) {
        out.set(c.id, { status, unmet });
        changed = true;
      }
    }
    if (!changed) break;
  }
  return out;
}

async function changedFiles(git: GitRunner, card: ParsedCard, facts: GitFacts, integ: string): Promise<string[]> {
  if (!card.branch) return [];
  const m = facts.merged.get(card.branch);
  let range: string | null = null;
  if (m) range = `${m.sha}^1...${m.sha}^2`;
  else if (facts.branches.has(card.branch)) range = `${integ}...${card.branch}`;
  if (!range) return [];
  return (await gitOut(git, ['diff', '--name-only', range, '--'])).split('\n').filter(Boolean);
}

export async function buildBoard(root: string, git: GitRunner, gitSnap: GitSnapshot, now: string): Promise<BoardSnapshot> {
  const cfg = await readAgentsConfig(root);
  const lanesText = await readText(root, '.agents/lanes.conf');
  if (lanesText === null) return emptyBoard(cfg, '此项目未配置泳道（缺少 .agents/lanes.conf）。', now);
  const lanesCfg: LanesConfig = parseLanesConf(lanesText);
  const owners = parseLaneOwners(await readText(root, 'docs/development/multi-agent.md'));
  const boardMd = await readText(root, 'docs/tasks/BOARD.md');
  const rows = boardMd ? parseBoardRows(boardMd) : new Map();

  const parsed: ParsedCard[] = [];
  for (const f of (await listDir(root, 'docs/tasks')).filter((x) => /^T-\d+\.md$/.test(x))) {
    const c = parseTaskCard(f, (await readText(root, `docs/tasks/${f}`)) ?? '');
    if (c) parsed.push(c);
  }
  parsed.sort((a, b) => Number(a.id.slice(2)) - Number(b.id.slice(2)));
  const facts = gitFacts(gitSnap);
  const statuses = deriveStatuses(parsed, facts);
  const conflicts: string[] = [];
  const changed = gitSnap.available ? await mapLimit(parsed, 8, (c) => changedFiles(git, c, facts, cfg.integrationBranch)) : parsed.map(() => []);
  const cards: BoardCard[] = [];
  for (const [ci, c] of parsed.entries()) {
    const row = rows.get(c.id);
    const lane = c.lane ?? row?.lane ?? '';
    const st = statuses.get(c.id) ?? { status: 'ready' as const, unmet: [] };
    const declared = c.declaredStatus || row?.declaredStatus || '';
    const merge = c.branch ? (facts.merged.get(c.branch) ?? null) : null;
    const br = c.branch ? facts.branches.get(c.branch) : undefined;
    const files = changed[ci] ?? [];
    const workerLane = lanesCfg.lanes.some((l) => l.name === lane);
    const laneOk = files.length && workerLane ? files.every((f) => laneCheck(lanesCfg, f, lane).ok) : null;
    const declaredMismatch = declared === 'done' && st.status !== 'merged';
    if (declaredMismatch) conflicts.push(`${c.id}：任务卡 / BOARD.md 声明 done，但 git 中未合入 ${cfg.integrationBranch}（按 git 显示为「${st.status}」）`);
    if (row && c.declaredStatus && row.declaredStatus && row.declaredStatus !== c.declaredStatus) conflicts.push(`${c.id}：任务卡状态「${c.declaredStatus}」与 BOARD.md「${row.declaredStatus}」不一致`);
    if (laneOk === false) conflicts.push(`${c.id}：分支改动越出泳道 ${lane}`);
    cards.push({
      id: c.id, title: c.title || row?.title || c.id, lane, frs: c.frs, frsLabel: c.frsLabel, specTaskIds: c.specTaskIds,
      branch: c.branch, prTarget: c.prTarget, deps: c.deps, unmetDeps: st.unmet, assignee: c.assignee ?? row?.assignee ?? '',
      declaredStatus: declared, status: st.status, declaredMismatch, goal: c.goal, acceptance: c.acceptance,
      file: `docs/tasks/${c.id}.md`, merge, ahead: br?.ahead ?? null, behind: br?.behind ?? null, worktree: br?.worktree ?? null,
      laneOk, changedFiles: files.length, lastActivity: merge?.time ?? br?.time ?? null,
    });
  }
  const ipc = await readText(root, 'contracts/ipc.ts');
  return {
    available: true, generatedAt: now, integrationBranch: cfg.integrationBranch, mainBranch: cfg.mainBranch, maxParallel: cfg.maxParallel,
    lanes: lanesCfg.lanes.map((l) => ({ name: l.name, globs: l.globs, ownerRole: owners[l.name] ?? null })),
    shared: lanesCfg.shared, feature: await readFeature(root), cards,
    contractVersion: ipc ? (/IPC_CONTRACT_REVISION\s*=\s*'([^']+)'/.exec(ipc)?.[1] ?? /IPC_CONTRACT_VERSION\s*=\s*'([^']+)'/.exec(ipc)?.[1] ?? null) : null,
    boardFile: boardMd !== null ? 'docs/tasks/BOARD.md' : null,
    conflicts,
  };
}
