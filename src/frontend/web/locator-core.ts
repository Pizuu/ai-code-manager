/**
 * Web 预览「UI 定位」的纯函数（FR-306，ADR 0008）：从调用栈取源位置、生成 CSS 选择器、拼复制文本、
 * 修改记录格式、Alt+Q 判定与操作条定位。
 * Web 预览服务器对 .ts 做原地类型擦除，浏览器栈中的行号即源文件行号。
 */

/** 不作为「创建者」的帧：DOM 工厂、图标工厂与 Web 预览自身。 */
const SKIP = /\/src\/frontend\/(?:lib\/dom\.ts|lib\/icons\.ts|web\/)/;
const FRAME = /(\/src\/frontend\/[\w./-]+\.ts):(\d+):\d+/;

/** 从 Error.stack 中找第一个渲染层源码帧，返回 `src/frontend/views/x.ts:57`；找不到返回 null。 */
export function srcFromStack(stack: string): string | null {
  for (const line of stack.split('\n')) {
    const m = FRAME.exec(line);
    if (!m || SKIP.test(m[1] ?? '')) continue;
    return `${(m[1] ?? '').replace(/^\//, '')}:${m[2]}`;
  }
  return null;
}

/** 选择器生成所需的最小元素描述（便于脱离 DOM 测试）。 */
export interface ElLike {
  tag: string;
  id: string;
  classes: string[];
  /** 在同级同标签元素中的序号（1-based）与同级同标签元素个数。 */
  nthOfType: number;
  sameTypeCount: number;
  parent: ElLike | null;
}

/** 状态类不进选择器（会随交互变化）。 */
const STATE_CLASSES: ReadonlySet<string> = new Set(['on', 'hot', 'open', 'active', 'click']);
const cssIdent = (s: string) => s.replace(/([^\w-])/g, '\\$1');

function segment(el: ElLike): string {
  if (el.id) return `#${cssIdent(el.id)}`;
  const cls = el.classes.filter((c) => c && !STATE_CLASSES.has(c)).slice(0, 2).map((c) => `.${cssIdent(c)}`).join('');
  const nth = el.sameTypeCount > 1 ? `:nth-of-type(${el.nthOfType})` : '';
  return `${el.tag.toLowerCase()}${cls}${nth}`;
}

/** 由近到远拼接，遇到 id 或 body 停止，最多 depth 段。 */
export function cssPath(el: ElLike, depth = 6): string {
  const parts: string[] = [];
  let cur: ElLike | null = el;
  while (cur && parts.length < depth) {
    const tag = cur.tag.toLowerCase();
    if (tag === 'body' || tag === 'html') break;
    parts.unshift(segment(cur));
    if (cur.id) break;
    cur = cur.parent;
  }
  return parts.join(' > ');
}

/** 一键复制的文本：「文件:行 + 选择器」。 */
export function copyText(src: string | null, selector: string): string {
  return `${src ?? '（未知源文件）'}  ${selector}`;
}

/** 修改记录的操作类型。 */
export type RecordAction = '修改' | '删除';

/** 一条修改记录的可序列化部分（DOM 引用留在 locator.ts）。 */
export interface RecordLike {
  action: RecordAction;
  /** 备注；未填写时为空字符串。 */
  note: string;
  /** 元素定位信息。 */
  selector: string;
}

/** 单条记录文本：`序号. 操作 + [备注 + ]元素定位信息`。 */
export function formatRecord(index: number, action: RecordAction, note: string, selector: string): string {
  return `${index}. ${action} + ${note ? `${note} + ` : ''}${selector}`;
}

/** 全部记录按当前顺序从 1 重新编号，每条一行（一键复制的文本）。 */
export function formatRecords(records: readonly RecordLike[]): string {
  return records.map((r, i) => formatRecord(i + 1, r.action, r.note, r.selector)).join('\n');
}

/** 临时标记旁的注释：无备注显示「修改」，有备注显示「修改：备注」。 */
export function markerLabel(action: RecordAction, note: string): string {
  return note ? `${action}：${note}` : action;
}

/** 键盘事件的最小描述。 */
export interface KeyLike {
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

/** 唯一开关 Alt+Q（按物理键位 KeyQ 判断，macOS 的 Option+Q 也能命中）；Esc 不再关闭。 */
export function isToggleKey(e: KeyLike): boolean {
  return e.code === 'KeyQ' && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
}

/** 操作条位置：默认在点击点右侧 gap 处、顶边与点击点对齐；右侧放不下翻到左侧，再夹到视口内（含底部避让）。 */
export function clampBarPosition(
  x: number, y: number, width: number, height: number,
  viewportW: number, viewportH: number, gap = 12, margin = 8,
): { left: number; top: number } {
  let left = x + gap;
  if (left + width > viewportW - margin) left = x - gap - width;
  left = Math.max(margin, Math.min(left, viewportW - margin - width));
  let top = y - 4;
  if (top + height > viewportH - margin) top = viewportH - margin - height;
  top = Math.max(margin, top);
  return { left, top };
}
