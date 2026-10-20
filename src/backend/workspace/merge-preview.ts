/**
 * 合并冲突预演（P1-7）：用 `git merge-tree` 在不落盘、不改工作区的前提下，
 * 预演「任务分支合入集成分支」是否会产生冲突。
 *
 * 只读：不写 index、不建工作树、不产生提交；仅在内存中计算合并树。
 * git ≥ 2.38 才有 `--write-tree` 形态；更早的版本返回「无法预演」而不是谎报「无冲突」。
 *
 * 输出格式（已对 git 2.55 实测）：
 * - 无冲突：退出码 0，stdout 为合并树 oid。
 * - 有冲突：退出码 1，stdout 含 `CONFLICT (<类型>): Merge conflict in <路径>` 行
 *   （以及 `<mode> <oid> <stage>\t<路径>` 的阶段行）。
 * - 引用不存在 / 参数不支持：退出码非 0 且 stdout 无 CONFLICT 行 → 无法预演。
 */
import { type GitRunner } from './git.ts';

export type MergePreview = 'clean' | 'conflict' | 'unknown';

export interface MergePreviewResult {
  /** 预演结论。 */
  result: MergePreview;
  /** 冲突文件（相对项目根，路径分隔符统一为 /）；仅 conflict 时有值。 */
  files: string[];
  /** 无法预演时的原因（unknown 时有值）。 */
  reason?: string;
}

/**
 * 预演把 `branch` 合入 `integ` 是否冲突。
 */
export async function previewMerge(git: GitRunner, integ: string, branch: string): Promise<MergePreviewResult> {
  const r = await git(['merge-tree', '--write-tree', integ, branch]);
  if (r.ok) return { result: 'clean', files: [] };
  const files = parseConflictFiles(r.stdout);
  if (files.length) return { result: 'conflict', files };
  // 退出码非 0 且没有冲突信息：引用不存在 / git 版本过旧 / 其它错误——如实说「无法预演」
  const stderr = (r.stderr || r.stdout).trim();
  const reason = /unknown option|usage: git merge-tree/i.test(stderr)
    ? '当前 git 版本不支持 merge-tree 预演'
    : stderr.slice(0, 200) || `merge-tree 退出码 ${r.code ?? '?'}`;
  return { result: 'unknown', files: [], reason };
}

/**
 * 从 `git merge-tree --write-tree` 的输出里取冲突文件。
 * 两种来源都识别：
 * - `CONFLICT (content): Merge conflict in <路径>`
 * - `<mode> <oid> <stage>\t<路径>`（阶段 1/2/3 的行）
 */
export function parseConflictFiles(stdout: string): string[] {
  const out = new Set<string>();
  for (const line of stdout.split(/\r?\n/)) {
    const conflict = /^CONFLICT \([^)]*\): .* in (.+)$/.exec(line);
    if (conflict?.[1]) {
      out.add(normalizePath(conflict[1]));
      continue;
    }
    const stage = /^\d+\s+[0-9a-f]+\s+[123]\t(.+)$/.exec(line);
    if (stage?.[1]) out.add(normalizePath(stage[1]));
  }
  return [...out].sort();
}

/** 路径分隔符统一为 /（Windows 上 git 可能输出 \）。 */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}
