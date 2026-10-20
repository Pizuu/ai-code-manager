/**
 * 把统一 diff 文本分类为行（供 Diff 面板着色）。纯函数。
 */

export type DiffLineKind = 'meta' | 'hunk' | 'add' | 'del' | 'ctx';

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

export function classifyDiff(diff: string): DiffLine[] {
  const lines = diff.endsWith('\n') ? diff.slice(0, -1).split('\n') : diff.split('\n');
  return lines.filter((l, i) => !(l === '' && i === lines.length - 1)).map((text): DiffLine => {
    if (text.startsWith('+++') || text.startsWith('---')) return { kind: 'meta', text };
    if (text.startsWith('@@')) return { kind: 'hunk', text };
    if (text.startsWith('+')) return { kind: 'add', text };
    if (text.startsWith('-')) return { kind: 'del', text };
    return { kind: 'ctx', text };
  });
}

export function countChanges(diff: string): { added: number; removed: number } {
  const lines = classifyDiff(diff);
  return { added: lines.filter((l) => l.kind === 'add').length, removed: lines.filter((l) => l.kind === 'del').length };
}
