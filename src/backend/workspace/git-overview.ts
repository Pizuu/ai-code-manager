/**
 * Git 快照（FR-107、US3）：分支、提交图、相对集成分支的 ahead/behind、合并记录、worktree、标签、远端。
 * 全部为只读 git 命令；PR / CI / 审查者在本地仓库不可得，恒为 null（界面显示「暂无」）。
 */
import path from 'node:path';
import type { GitBranchInfo, GitBranchKind, GitCommitNode, GitMergeInfo, GitSnapshot, GitWorktreeInfo } from '../../../contracts/ipc.ts';
import { mergedBranchName } from './cards.ts';
import { gitOut, mapLimit, probeRepo, type GitRunner } from './git.ts';

const CONCURRENCY = 8;
import type { AgentsConfig } from './lanes.ts';

export const MAX_GRAPH_COMMITS = 200;
const SEP = '\x1f';
const REC = '\x1e';

export function emptyGitSnapshot(cfg: AgentsConfig, reason: string, now: string): GitSnapshot {
  return {
    available: false, reason, generatedAt: now, currentBranch: null,
    integrationBranch: cfg.integrationBranch, mainBranch: cfg.mainBranch, integrationHead: null, mainHead: null,
    integrationAheadOfMain: 0, mainAheadOfIntegration: 0, branches: [], commits: [], merges: [], mainMerges: [],
    worktrees: [], tags: [], remotes: [], dirtyCount: 0, pullRequests: null, ci: null,
  };
}

export function branchKind(name: string, cfg: AgentsConfig): GitBranchKind {
  if (name === cfg.mainBranch) return 'main';
  if (name === cfg.integrationBranch) return 'integration';
  if (name.startsWith(`${cfg.branchPrefix}/`)) return 'worker';
  if (name.startsWith('int/')) return 'int';
  return 'other';
}

/** 分支名 → 泳道与任务号：feat/<lane>/<T-xxx-…>；int/* 记为 @shared。 */
export function laneOfBranch(name: string, prefix: string): { lane: string | null; task: string | null } {
  const esc = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`^${esc}/([^/]+)/(.+)$`).exec(name);
  const rest = m ? m[2] : name.startsWith('int/') ? name.slice(4) : null;
  return {
    lane: m ? (m[1] ?? null) : name.startsWith('int/') ? '@shared' : null,
    task: rest ? (/(T-\d+)/.exec(rest)?.[1] ?? null) : null,
  };
}

export function parsePorcelainWorktrees(text: string): Array<{ path: string; head: string; branch: string | null }> {
  const out: Array<{ path: string; head: string; branch: string | null }> = [];
  let cur: { path: string; head: string; branch: string | null } | null = null;
  for (const line of [...text.split(/\r?\n/), '']) {
    if (!line) {
      if (cur) out.push(cur);
      cur = null;
      continue;
    }
    const sp = line.indexOf(' ');
    const k = sp === -1 ? line : line.slice(0, sp);
    const v = sp === -1 ? '' : line.slice(sp + 1);
    if (k === 'worktree') cur = { path: v, head: '', branch: null };
    else if (cur && k === 'HEAD') cur.head = v;
    else if (cur && k === 'branch') cur.branch = v.replace(/^refs\/heads\//, '');
  }
  return out;
}

async function countRange(git: GitRunner, range: string): Promise<number> {
  const n = Number.parseInt((await gitOut(git, ['rev-list', '--count', range])).trim(), 10);
  return Number.isFinite(n) ? n : 0;
}

async function firstParentMerges(git: GitRunner, ref: string): Promise<GitMergeInfo[]> {
  const out = await gitOut(git, ['log', '--first-parent', '--merges', `--format=%H${SEP}%P${SEP}%cI${SEP}%s`, ref, '--']);
  const lines = out.split('\n').filter((l) => l.trim());
  const list = await mapLimit(lines, CONCURRENCY, async (line): Promise<GitMergeInfo> => {
    const [sha = '', parents = '', time = '', subject = ''] = line.split(SEP);
    const [p1, p2] = parents.split(' ');
    return {
      sha, short: sha.slice(0, 7), time, subject, branch: mergedBranchName(subject), tip: (p2 ?? '').slice(0, 7),
      commitCount: p1 && p2 ? await countRange(git, `${p1}..${p2}`) : 0,
    };
  });
  return list.reverse();
}

async function dirtyCount(git: GitRunner): Promise<number> {
  return (await gitOut(git, ['status', '--porcelain', '--untracked-files=normal'])).split('\n').filter((l) => l.trim()).length;
}

export async function readGitSnapshot(git: GitRunner, root: string, cfg: AgentsConfig, now: string, worktreeGit: (dir: string) => GitRunner): Promise<GitSnapshot> {
  const probe = await probeRepo(git);
  if (!probe.ok) return emptyGitSnapshot(cfg, probe.reason ?? '不可用', now);
  const integ = cfg.integrationBranch;
  const main = cfg.mainBranch;
  const has = async (ref: string) => (await git(['rev-parse', '--verify', '--quiet', `refs/heads/${ref}`])).ok;
  const [hasInteg, hasMain] = await Promise.all([has(integ), has(main)]);
  const current = (await gitOut(git, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim() || null;

  const wtList = parsePorcelainWorktrees(await gitOut(git, ['worktree', 'list', '--porcelain']));
  const worktrees: GitWorktreeInfo[] = await mapLimit(wtList, CONCURRENCY, async (w, i) => ({
    path: w.path, branch: w.branch, head: w.head.slice(0, 7), dirtyCount: await dirtyCount(i === 0 ? git : worktreeGit(w.path)), isMain: i === 0,
  }));
  const rootParent = path.dirname(root);

  const refLines = (await gitOut(git, ['for-each-ref', `--format=%(refname:short)${SEP}%(objectname)${SEP}%(committerdate:iso-strict)${SEP}%(subject)`, 'refs/heads'])).split('\n').filter(Boolean);
  const branches: GitBranchInfo[] = await mapLimit(refLines, CONCURRENCY, async (l): Promise<GitBranchInfo> => {
    const [name = '', sha = '', time = '', subject = ''] = l.split(SEP);
    const kind = branchKind(name, cfg);
    const { lane, task } = laneOfBranch(name, cfg.branchPrefix);
    const vsInteg = hasInteg && name !== integ;
    const wt = worktrees.find((w) => w.branch === name);
    return {
      name, sha, short: sha.slice(0, 7), time, subject, kind, lane, task,
      ahead: vsInteg ? await countRange(git, `${integ}..${name}`) : 0,
      behind: vsInteg ? await countRange(git, `${name}..${integ}`) : 0,
      mergedIntoIntegration: vsInteg ? (await git(['merge-base', '--is-ancestor', name, integ])).ok : name === integ,
      worktree: wt ? (wt.isMain ? path.basename(wt.path) : path.relative(rootParent, wt.path) || wt.path) : null,
      current: name === current,
    };
  });
  const order: Record<GitBranchKind, number> = { main: 0, integration: 1, worker: 2, int: 3, other: 4 };
  branches.sort((a, b) => order[a.kind] - order[b.kind] || b.time.localeCompare(a.time));

  const log = await gitOut(git, ['log', '--branches', '--topo-order', `--max-count=${MAX_GRAPH_COMMITS}`, `--format=%H${SEP}%P${SEP}%an${SEP}%cI${SEP}%s${SEP}%D${REC}`]);
  const commits: GitCommitNode[] = log.split(REC).map((b) => b.replace(/^\n/, '')).filter((b) => b.trim()).map((b) => {
    const [sha = '', parents = '', author = '', time = '', subject = '', refs = ''] = b.split(SEP);
    return { sha, short: sha.slice(0, 7), parents: parents.split(' ').filter(Boolean), author, time, subject, refs: refs.split(',').map((r) => r.trim()).filter(Boolean) };
  });

  const head = (ref: string) => branches.find((b) => b.name === ref)?.short ?? null;
  const [merges, mainMerges, tags, remotes, aheadMain, behindMain] = await Promise.all([
    hasInteg ? firstParentMerges(git, integ) : Promise.resolve([]),
    hasMain ? firstParentMerges(git, main) : Promise.resolve([]),
    gitOut(git, ['tag', '--list']),
    gitOut(git, ['remote']),
    hasInteg && hasMain ? countRange(git, `${main}..${integ}`) : Promise.resolve(0),
    hasInteg && hasMain ? countRange(git, `${integ}..${main}`) : Promise.resolve(0),
  ]);
  return {
    available: true, generatedAt: now, currentBranch: current, integrationBranch: integ, mainBranch: main,
    integrationHead: head(integ), mainHead: head(main),
    integrationAheadOfMain: aheadMain,
    mainAheadOfIntegration: behindMain,
    branches, commits, merges, mainMerges, worktrees,
    tags: tags.split('\n').filter(Boolean),
    remotes: remotes.split('\n').filter(Boolean),
    dirtyCount: worktrees[0]?.dirtyCount ?? (await dirtyCount(git)),
    pullRequests: null, ci: null,
  };
}
