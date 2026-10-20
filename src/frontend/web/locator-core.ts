/**
 * Web 预览「UI 定位」的纯函数（FR-306，ADR 0008）：从调用栈取源位置、生成 CSS 选择器、拼复制文本。
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
