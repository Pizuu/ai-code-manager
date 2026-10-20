/**
 * 行级统一 diff（FR-007）。基于 LCS 动态规划；超大输入退化为整体替换，保证有界耗时。
 */

/** LCS 表规模上限（行数乘积），超过则按整体替换输出。 */
const MAX_LCS_CELLS = 4_000_000;
const DEFAULT_CONTEXT = 3;

type Op = { kind: ' ' | '-' | '+'; text: string };

/** 按行切分；末尾换行不产生空行。 */
export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function lcsOps(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  if (n * m > MAX_LCS_CELLS) {
    return [
      ...a.map((text) => ({ kind: '-' as const, text })),
      ...b.map((text) => ({ kind: '+' as const, text })),
    ];
  }
  // dp[i][j] = a[i..] 与 b[j..] 的 LCS 长度，扁平数组存储
  const width = m + 1;
  const dp = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * width + j] = a[i] === b[j]
        ? (dp[(i + 1) * width + j + 1] ?? 0) + 1
        : Math.max(dp[(i + 1) * width + j] ?? 0, dp[i * width + j + 1] ?? 0);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: ' ', text: a[i] ?? '' });
      i++; j++;
    } else if ((dp[(i + 1) * width + j] ?? 0) >= (dp[i * width + j + 1] ?? 0)) {
      ops.push({ kind: '-', text: a[i] ?? '' });
      i++;
    } else {
      ops.push({ kind: '+', text: b[j] ?? '' });
      j++;
    }
  }
  for (; i < n; i++) ops.push({ kind: '-', text: a[i] ?? '' });
  for (; j < m; j++) ops.push({ kind: '+', text: b[j] ?? '' });
  return ops;
}

/** 按统一 diff 约定生成 hunk 头：长度为 0 的一侧起始行号取其前一行。 */
function hunkHeader(slice: Op[], oldBefore: number, newBefore: number): string {
  const oldLen = slice.filter((o) => o.kind !== '+').length;
  const newLen = slice.filter((o) => o.kind !== '-').length;
  const oldStart = oldLen > 0 ? oldBefore + 1 : oldBefore;
  const newStart = newLen > 0 ? newBefore + 1 : newBefore;
  return `@@ -${oldStart},${oldLen} +${newStart},${newLen} @@`;
}

/**
 * 生成统一 diff。内容相同返回空字符串。
 * @param oldText 原内容；新建文件传 null。
 */
export function createUnifiedDiff(oldText: string | null, newText: string, filePath: string, context = DEFAULT_CONTEXT): string {
  const a = splitLines(oldText ?? '');
  const b = splitLines(newText);
  const ops = lcsOps(a, b);
  if (ops.every((o) => o.kind === ' ')) return '';

  const changeIdx = ops.map((o, idx) => (o.kind === ' ' ? -1 : idx)).filter((idx) => idx >= 0);
  const hunks: Array<[number, number]> = [];
  for (const idx of changeIdx) {
    const start = Math.max(0, idx - context);
    const end = Math.min(ops.length - 1, idx + context);
    const last = hunks[hunks.length - 1];
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
    else hunks.push([start, end]);
  }

  const header = [`--- ${oldText === null ? '/dev/null' : `a/${filePath}`}`, `+++ b/${filePath}`];
  const body = hunks.flatMap(([s, e]) => {
    const before = ops.slice(0, s);
    const oldBefore = before.filter((o) => o.kind !== '+').length;
    const newBefore = before.filter((o) => o.kind !== '-').length;
    const slice = ops.slice(s, e + 1);
    return [hunkHeader(slice, oldBefore, newBefore), ...slice.map((o) => `${o.kind}${o.text}`)];
  });
  return [...header, ...body].join('\n') + '\n';
}

/** 统计 diff 的增删行数（不计文件头）。 */
export function diffStats(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) added++;
    else if (line.startsWith('-')) removed++;
  }
  return { added, removed };
}
