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
import { previewMerge } from './merge-preview.ts';

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

/** spec.md 的第一个一级标题（去掉 `Feature Specification:` 前缀）；parseSpec 的严格标题格式未命中时的真实标题来源。 */
function specHeading(md: string | null): string {
  if (!md) return '';
  const m = /^#\s+(.+)$/m.exec(md);
  return (m?.[1] ?? '').replace(/^Feature Specification:\s*/i, '').trim();
}

/** specs/ 下的候选功能目录 id（NNN-* 前缀，升序；listDir 已排序）。 */
export async function listFeatureDirs(root: string): Promise<string[]> {
  return (await listDir(root, 'specs')).filter((d) => /^\d{3}-/.test(d));
}

/** 功能标题（只读 spec.md）：与 readFeature 相同的标题链——parseSpec 标题 || spec.md 一级标题 || id。 */
async function readFeatureTitle(root: string, id: string): Promise<string> {
  const specMd = await readText(root, `specs/${id}/spec.md`);
  const spec = specMd ? parseSpec(specMd) : null;
  return spec?.title || specHeading(specMd) || id;
}

/** 全部可选规格（id 升序）与各自标题；只读各目录的 spec.md，不解析 tasks / checklists。 */
export async function listFeatures(root: string): Promise<{ id: string; title: string }[]> {
  const out: { id: string; title: string }[] = [];
  for (const id of await listFeatureDirs(root)) out.push({ id, title: await readFeatureTitle(root, id) });
  return out;
}

/**
 * 读取一个功能的完整看板数据：selectedId 命中 specs 列表时用它，
 * 否则（未选 / 无效 / 已删除）回退最新（编号最大）。
 */
export async function readFeature(root: string, selectedId?: string | null): Promise<BoardFeature | null> {
  const dirs = await listFeatureDirs(root);
  const id = selectedId && dirs.includes(selectedId) ? selectedId : dirs.at(-1);
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
    id, dir, title: spec?.title || specHeading(specMd) || id, status: spec?.status ?? '',
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
    integrationRef: cfg.integrationBranch, integrationRefRemote: false, integrationMissing: null,
    maxParallel: cfg.maxParallel, lanes: [], shared: [], feature: null, features: [], cards: [], contractVersion: null, boardFile: null, conflicts: [],
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

export async function buildBoard(root: string, git: GitRunner, gitSnap: GitSnapshot, now: string, selectedFeatureId?: string | null): Promise<BoardSnapshot> {
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
  // 集成分支的实际引用（本地缺失时回退 origin/<分支>）；本地与远端都没有则为 null（P0-1）
  const integRef = gitSnap.integrationRefRemote ? gitSnap.integrationRef : cfg.integrationBranch;
  const integMissing = gitSnap.available && !gitSnap.integrationRefRemote && !gitSnap.branches.some((b) => b.name === cfg.integrationBranch)
    ? `集成分支 ${cfg.integrationBranch} 在本地与 origin 均不存在：无法据此判定任务卡是否已合入（请先 git fetch 并创建该分支）。`
    : null;
  const changed = gitSnap.available ? await mapLimit(parsed, 8, (c) => changedFiles(git, c, facts, integRef)) : parsed.map(() => []);
  const cards: BoardCard[] = [];
  /** 声明 done 但 git 未确认合入的卡（P0-1：集成分支缺失时全部同因，合并为一条）。 */
  const unmerged: Array<{ id: string; status: string }> = [];
  for (const [ci, c] of parsed.entries()) {
    const row = rows.get(c.id);
    const lane = c.lane ?? row?.lane ?? '';
    const st = statuses.get(c.id) ?? { status: 'ready' as const, unmet: [] };
    const declared = c.declaredStatus || row?.declaredStatus || '';
    const merge = c.branch ? (facts.merged.get(c.branch) ?? null) : null;
    const br = c.branch ? facts.branches.get(c.branch) : undefined;
    const files = changed[ci] ?? [];
    const workerLane = lanesCfg.lanes.some((l) => l.name === lane);
    // 文书豁免（仅看板判定口径，不改 lanes.ts 的通用 laneCheck 语义）：任务分支更新自己任务卡的
    // 验收勾选与 BOARD.md 中自己那行属文书、非越界改代码，故从待检文件中剔除；豁免仅限这两项——
    // 他卡的任务卡文件与任何代码文件仍照旧全检。剔除后为空集则 laneOk 保持 null（无可检文件，不报）。
    const ownDocs = new Set([`docs/tasks/${c.id}.md`, 'docs/tasks/BOARD.md']);
    const laneFiles = files.filter((f) => !ownDocs.has(f));
    const laneOk = laneFiles.length && workerLane ? laneFiles.every((f) => laneCheck(lanesCfg, f, lane).ok) : null;
    const declaredMismatch = declared === 'done' && st.status !== 'merged';
    if (declaredMismatch) unmerged.push({ id: c.id, status: st.status });
    if (row && c.declaredStatus && row.declaredStatus && row.declaredStatus !== c.declaredStatus) conflicts.push(`${c.id}：任务卡状态「${c.declaredStatus}」与 BOARD.md「${row.declaredStatus}」不一致`);
    if (laneOk === false) conflicts.push(`${c.id}：分支改动越出泳道 ${lane}`);
    // P1-7：预演合入集成分支是否冲突（只读 merge-tree，不落盘）
    let mergePreview: BoardCard['mergePreview'] = 'unknown';
    let mergeConflictFiles: string[] = [];
    if (c.branch && !merge && gitSnap.available && integRef) {
      const pv = await previewMerge(git, integRef, c.branch);
      mergePreview = pv.result;
      mergeConflictFiles = pv.files;
      if (pv.result === 'conflict') conflicts.push(`${c.id}：合入 ${cfg.integrationBranch} 会冲突（${pv.files.join('、')}）`);
    }
    cards.push({
      id: c.id, title: c.title || row?.title || c.id, lane, frs: c.frs, frsLabel: c.frsLabel, specTaskIds: c.specTaskIds,
      branch: c.branch, prTarget: c.prTarget, deps: c.deps, unmetDeps: st.unmet, assignee: c.assignee ?? row?.assignee ?? '',
      declaredStatus: declared, status: st.status, declaredMismatch, goal: c.goal, acceptance: c.acceptance,
      file: `docs/tasks/${c.id}.md`, merge, ahead: br?.ahead ?? null, behind: br?.behind ?? null, worktree: br?.worktree ?? null,
      laneOk, mergePreview, mergeConflictFiles, changedFiles: files.length, lastActivity: merge?.time ?? br?.time ?? null,
    });
  }
  // 声明 done 但 git 未确认合入：P0-1 合并为一条（同因不逐卡刷屏）
  if (unmerged.length) {
    if (integMissing) {
      // 根因就是集成分支缺失：一条说明 + 受影响的卡号，不再逐卡重复
      conflicts.unshift(`${integMissing} 受影响的任务卡（${unmerged.length} 张）：${unmerged.map((u) => u.id).join('、')}`);
    } else if (unmerged.length === 1) {
      const u = unmerged[0] as { id: string; status: string };
      conflicts.unshift(`${u.id}：任务卡 / BOARD.md 声明 done，但 git 中未合入 ${cfg.integrationBranch}（按 git 显示为「${u.status}」）`);
    } else {
      const ids = unmerged.map((u) => u.id).join('、');
      conflicts.unshift(`${unmerged.length} 张任务卡 / BOARD.md 声明 done，但 git 中未合入 ${cfg.integrationBranch}：${ids}`);
    }
  }
  const ipc = await readText(root, 'contracts/ipc.ts');
  return {
    available: true, generatedAt: now, integrationBranch: cfg.integrationBranch, mainBranch: cfg.mainBranch,
    integrationRef: integRef, integrationRefRemote: gitSnap.integrationRefRemote, integrationMissing: integMissing,
    maxParallel: cfg.maxParallel,
    lanes: lanesCfg.lanes.map((l) => ({ name: l.name, globs: l.globs, ownerRole: owners[l.name] ?? null })),
    shared: lanesCfg.shared, feature: await readFeature(root, selectedFeatureId), features: await listFeatures(root), cards,
    contractVersion: ipc ? (/IPC_CONTRACT_REVISION\s*=\s*'([^']+)'/.exec(ipc)?.[1] ?? /IPC_CONTRACT_VERSION\s*=\s*'([^']+)'/.exec(ipc)?.[1] ?? null) : null,
    boardFile: boardMd !== null ? 'docs/tasks/BOARD.md' : null,
    conflicts,
  };
}
