/**
 * 待发送附件与消息文本的拼装/拆分（纯函数）。
 *
 * 发送侧的唯一拼装口径：正文末尾以「每行一个 @路径」的尾随块携带文件引用；
 * 渲染侧用同一口径把尾随引用块拆出来显示为附件标签，其余为正文。
 * 引用行定义：整行以 '@' 开头、其后非空；含空白时须同时像路径（含 '/'、'\' 或以扩展名结尾），
 * 以免把「@某人 一句话」这类正文行误拆为附件（带空格的文件名路径可正常拆出）。
 * 只有与内容末尾连续相接的引用行才算附件块（允许与正文之间有空行分隔，
 * 但引用行之间被空行打断即不再属于同一块）；正文中部的 @ 行不拆。
 */

/** 一条附件引用：path 为消息中携带的引用路径，name 为其 basename（展示用）。 */
export interface MessageAttachment {
  name: string;
  path: string;
}

/** path 的 basename：同时兼容 '/' 与 '\' 分隔（Windows 路径）。 */
function baseName(p: string): string {
  const parts = p.split(/[\\/]/).filter((s) => s !== '');
  return parts.length > 0 ? (parts[parts.length - 1] as string) : p;
}

/** 行是引用行时返回其路径，否则 null。兼容 CRLF 的行尾 '\r'。 */
function refPathOf(line: string): string | null {
  const l = line.endsWith('\r') ? line.slice(0, -1) : line;
  if (!l.startsWith('@')) return null;
  const p = l.slice(1);
  if (p === '') return null;
  if (/\s/.test(p) && !/[/\\]/.test(p) && !/\.[^\s.]+$/.test(p)) return null;
  return p;
}

const isBlank = (line: string): boolean => line.trim() === '';

/**
 * 拆分：从末尾向上收集连续的引用行作为附件块。
 * 命中拆分时 text 去掉尾随空行；无尾随引用块时原文原样返回（不 trim 正文）。
 */
export function splitMessageAttachments(content: string): { text: string; attachments: MessageAttachment[] } {
  const lines = content.split('\n');
  // 先跳过内容最末尾的空行，再向上收集连续引用行；遇空行/普通行即停（空行打断块）。
  let i = lines.length - 1;
  while (i >= 0 && isBlank(lines[i] as string)) i--;
  let j = i;
  while (j >= 0 && refPathOf(lines[j] as string) !== null) j--;
  if (j === i) return { text: content, attachments: [] };
  const attachments: MessageAttachment[] = [];
  for (let k = j + 1; k <= i; k++) {
    const p = refPathOf(lines[k] as string) as string;
    attachments.push({ name: baseName(p), path: p });
  }
  // 正文为引用块之上的部分，去掉与附件块相隔的尾随空行。
  let b = j;
  while (b >= 0 && isBlank(lines[b] as string)) b--;
  const text = b < 0 ? '' : lines.slice(0, b + 1).join('\n');
  return { text, attachments };
}

/**
 * 拼装（发送侧唯一口径）：text 去尾随空白后，附件非空则追加 '\n' + 每行 '@path'；
 * text 为空时只出引用块（无前导换行）；附件为空返回原 text。
 */
export function composeMessageWithAttachments(text: string, attachments: readonly MessageAttachment[]): string {
  if (attachments.length === 0) return text;
  const head = text.replace(/\s+$/, '');
  const block = attachments.map((a) => `@${a.path}`).join('\n');
  return head === '' ? block : `${head}\n${block}`;
}
