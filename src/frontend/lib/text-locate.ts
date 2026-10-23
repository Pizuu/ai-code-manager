/**
 * 在渲染后的纯文本里定位一段来源文字（待办 / 收藏 跳转高亮用）。
 *
 * 渲染文本与来源文字常有差异：Markdown 标记被渲染掉、块级元素之间没有换行、
 * 空白被折叠或拆行。这里统一按「去掉所有空白」比对，并依次尝试：
 * 1. 原文；2. 去掉常见 Markdown 标记后的文字；3. 去标记后的首个非空行（长文本只要能定位到开头即可）。
 * 返回原始文本中的 [start, end) 偏移（包含首尾非空白字符），找不到返回 null。
 */

export interface TextRange { start: number; end: number }

const MD_MARKS = /```[^\n]*\n?|`|\*\*|__|~~|^\s{0,3}#{1,6}\s+|^\s{0,3}>\s?|^\s*[-*+]\s+|^\s*\d+[.)]\s+|!?\[([^\]]*)\]\([^)]*\)/gm;

/** 去掉常见 Markdown 语法，保留可见文字（链接保留文字部分）。 */
export function stripMarkdown(text: string): string {
  return text.replace(MD_MARKS, (_m, linkText: string | undefined) => linkText ?? '');
}

/** 候选来源文字：原文 → 去标记 → 去标记后首行；去重、去空。 */
export function locateCandidates(source: string): string[] {
  const plain = stripMarkdown(source);
  const firstLine = plain.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? '';
  const out: string[] = [];
  for (const c of [source, plain, firstLine]) {
    const squeezed = c.replace(/\s+/g, '');
    if (squeezed && !out.some((x) => x.replace(/\s+/g, '') === squeezed)) out.push(c);
  }
  return out;
}

/** 忽略空白定位 needle；命中返回原始偏移。 */
export function findIgnoringSpace(haystack: string, needle: string): TextRange | null {
  const target = needle.replace(/\s+/g, '');
  if (!target) return null;
  let squeezed = '';
  const map: number[] = [];
  for (let i = 0; i < haystack.length; i++) {
    const ch = haystack[i] ?? '';
    if (/\s/.test(ch)) continue;
    squeezed += ch;
    map.push(i);
  }
  const at = squeezed.indexOf(target);
  if (at < 0) return null;
  const start = map[at];
  const last = map[at + target.length - 1];
  return start === undefined || last === undefined ? null : { start, end: last + 1 };
}

/** 依次尝试各候选，返回第一个命中的区间。 */
export function locateText(haystack: string, source: string): TextRange | null {
  for (const c of locateCandidates(source)) {
    const r = findIgnoringSpace(haystack, c);
    if (r) return r;
  }
  return null;
}
