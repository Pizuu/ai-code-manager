/**
 * edit_file 的纯替换逻辑（FR-007）：old_string 必须唯一出现，除非 replace_all。
 * 兼容 Windows CRLF 文件：模型给出的 \n 文本在 CRLF 文件中自动按 \r\n 匹配。
 */

export type EditOutcome =
  | { ok: true; content: string; replacements: number }
  | { ok: false; error: string };

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

export function applyEdit(content: string, oldString: string, newString: string, replaceAll = false): EditOutcome {
  if (oldString === '') return { ok: false, error: 'old_string 不能为空；创建或覆盖文件请使用 write_file。' };
  if (oldString === newString) return { ok: false, error: 'old_string 与 new_string 相同，没有可修改的内容。' };

  let oldS = oldString;
  let newS = newString;
  let count = countOccurrences(content, oldS);
  if (count === 0 && content.includes('\r\n') && oldS.includes('\n') && !oldS.includes('\r\n')) {
    oldS = oldS.replace(/\n/g, '\r\n');
    newS = newS.replace(/\r?\n/g, '\r\n');
    count = countOccurrences(content, oldS);
  }
  if (count === 0) return { ok: false, error: '在文件中找不到 old_string，请先用 read_file 确认原文（包括缩进与空白）。' };
  if (count > 1 && !replaceAll) {
    return { ok: false, error: `old_string 在文件中出现了 ${count} 次，不唯一。请补充上下文，或设置 replace_all=true。` };
  }
  const next = replaceAll ? content.split(oldS).join(newS) : content.replace(oldS, () => newS);
  return { ok: true, content: next, replacements: replaceAll ? count : 1 };
}
