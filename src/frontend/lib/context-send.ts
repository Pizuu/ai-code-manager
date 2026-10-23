/**
 * 全局右键「新建会话窗口」的内容组装（FR-304，contracts/ui.ts）。纯函数，便于单测。
 * DOM 只通过 getter 读取 data-send-* 属性，不直接依赖 document。
 */
import type { SendSource } from '../../../contracts/ui.ts';
import { SEND_ATTR, SEND_TEXT_MAX_CHARS } from '../../../contracts/ui.ts';
import { languageFor } from './highlight.ts';

/** 超出上限时截断并注明。 */
export function clip(text: string, max: number = SEND_TEXT_MAX_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…（已截断，共 ${text.length} 字符）`;
}

/** 选择比内容中最长反引号串更长的围栏。 */
export function fenceFor(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((m) => m.length));
  return '`'.repeat(Math.max(3, longest + 1));
}

const FENCE_LANG: Readonly<Record<string, string>> = { ts: 'ts', json: 'json', css: 'css', sh: 'sh', py: 'python', md: 'md', yaml: 'yaml', html: 'html', plain: '' };

const lineRef = (path: string, a: number, b: number) => `\`${path}:L${a}${b > a ? `-L${b}` : ''}\``;

/** 把来源格式化为插入输入框的文本（带来源标注）。 */
export function formatSendText(src: SendSource): string {
  switch (src.kind) {
    case 'selection': {
      const body = clip(src.text.replace(/\s+$/, ''));
      return `来源：${src.origin}（选中文本）\n${body.split('\n').map((l) => `> ${l}`).join('\n')}`;
    }
    case 'code': {
      if (src.startLine <= 0) return `@${src.path}`;
      const a = Math.min(src.startLine, src.endLine);
      const b = Math.max(src.startLine, src.endLine);
      if (!src.text) return lineRef(src.path, a, b);
      const body = clip(src.text.replace(/\n$/, ''));
      const fence = fenceFor(body);
      return `${lineRef(src.path, a, b)}\n${fence}${FENCE_LANG[languageFor(src.path)] ?? ''}\n${body}\n${fence}`;
    }
    case 'file':
      return src.dir ? `@${src.path.replace(/\/$/, '')}/（目录）` : `@${src.path}`;
    case 'card':
      return `任务 ${src.id}「${src.title}」${src.lane || src.status ? `（${[src.lane && `泳道 ${src.lane}`, src.status].filter(Boolean).join(' · ')}）` : ''}`;
    case 'commit':
      return `提交 ${src.sha}${src.subject ? `「${src.subject}」` : ''}`;
    case 'branch':
      return `分支 ${src.name}${src.sha ? ` @ ${src.sha}` : ''}${src.subject ? `「${src.subject}」` : ''}`;
  }
}

/** 菜单里显示的简短来源说明。 */
export function describeSource(src: SendSource): string {
  switch (src.kind) {
    case 'selection': return `选中文本 · ${src.text.length} 字符`;
    case 'code': return src.startLine <= 0 ? src.path : `${src.path}:L${Math.min(src.startLine, src.endLine)}${src.endLine !== src.startLine ? `-L${Math.max(src.startLine, src.endLine)}` : ''}`;
    case 'file': return src.path;
    case 'card': return src.id;
    case 'commit': return src.sha.slice(0, 7);
    case 'branch': return src.name;
  }
}

/** 从元素的 data-send-* 属性组装来源（code 由视图结合行号另行组装）；缺必填属性返回 null。 */
export function sourceFromAttrs(get: (attr: string) => string | null): SendSource | null {
  const kind = get(SEND_ATTR.kind);
  const v = (a: string) => get(a) ?? '';
  switch (kind) {
    case 'file': return v(SEND_ATTR.path) ? { kind: 'file', path: v(SEND_ATTR.path), dir: get(SEND_ATTR.dir) === '1' } : null;
    case 'card': return v(SEND_ATTR.id) ? { kind: 'card', id: v(SEND_ATTR.id), title: v(SEND_ATTR.title), lane: v(SEND_ATTR.lane), status: v(SEND_ATTR.status) } : null;
    case 'commit': return v(SEND_ATTR.id) ? { kind: 'commit', sha: v(SEND_ATTR.id), subject: v(SEND_ATTR.title) } : null;
    case 'branch': return v(SEND_ATTR.id) ? { kind: 'branch', name: v(SEND_ATTR.id), sha: v(SEND_ATTR.sha), subject: v(SEND_ATTR.title) } : null;
    case 'code': return v(SEND_ATTR.path) ? { kind: 'code', path: v(SEND_ATTR.path), startLine: 0, endLine: 0, text: '' } : null;
    default: return null;
  }
}

/** 构造 data-send-* 属性表（视图用）；空值省略。 */
export function sendAttrs(src: Exclude<SendSource, { kind: 'selection' }>): Record<string, string> {
  const out: Record<string, string> = { [SEND_ATTR.kind]: src.kind };
  const set = (k: string, val: string) => {
    if (val) out[k] = val;
  };
  switch (src.kind) {
    case 'file': set(SEND_ATTR.path, src.path); if (src.dir) out[SEND_ATTR.dir] = '1'; break;
    case 'code': set(SEND_ATTR.path, src.path); break;
    case 'card': set(SEND_ATTR.id, src.id); set(SEND_ATTR.title, src.title); set(SEND_ATTR.lane, src.lane); set(SEND_ATTR.status, src.status); break;
    case 'commit': set(SEND_ATTR.id, src.sha); set(SEND_ATTR.title, src.subject); break;
    case 'branch': set(SEND_ATTR.id, src.name); set(SEND_ATTR.sha, src.sha); set(SEND_ATTR.title, src.subject); break;
  }
  return out;
}

/** 插入到输入框光标处：与前后已有文字之间补换行，返回 { text, caret }（caret = 插入后光标偏移）。 */
export function insertBlock(value: string, start: number, end: number, block: string): { text: string; caret: number } {
  const before = value.slice(0, start);
  const after = value.slice(end);
  const pre = before && !before.endsWith('\n') ? (before.endsWith('\n\n') ? '' : '\n') : '';
  const post = after.startsWith('\n') ? '' : '\n';
  const inserted = `${pre}${block}${post}`;
  return { text: before + inserted + after, caret: before.length + inserted.length };
}
