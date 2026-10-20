/**
 * 终端输出的 ANSI 解析（v1.6，ADR 0010）。
 *
 * 终端不是真 PTY（无 node-pty），子进程输出是原始文本流：里面可能夹带 ANSI 转义序列
 * （SGR 颜色 / 光标控制 / OSC 标题）。本模块把原始流切成「带样式片段」，
 * 由渲染进程渲染成 DOM 片段：
 * - SGR（`ESC [ … m`）→ 前景色 / 背景色 / 粗体 / 暗色 / 下划线；
 * - 其余 CSI / OSC 序列 → 丢弃（没有屏幕缓冲，无法回放光标移动）。
 *
 * 纯函数，无 DOM 依赖，可单元测试。
 */

/** 一个带样式的文本片段。 */
export interface AnsiSegment {
  text: string;
  /** 前景色（CSS 颜色值，如 '#e06c75'）；缺省 = 用默认前景色。 */
  fg?: string;
  /** 背景色（CSS 颜色值）。 */
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  underline?: boolean;
  italic?: boolean;
}

/** ANSI 基础 8 色（与多数终端主题一致，浅色可读）。 */
const BASE_COLORS: readonly string[] = ['#3b4048', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#abb2bf'];
/** ANSI 高亮 8 色。 */
const BRIGHT_COLORS: readonly string[] = ['#5c6370', '#ff7b86', '#b5e08c', '#ffd68a', '#7cc4ff', '#e39cf5', '#7fdbdf', '#ffffff'];

/** 256 色调色板：0-15 为基本色，16-231 为 6×6×6 立方，232-255 为灰阶。 */
export function xterm256(index: number): string {
  if (index < 0 || index > 255) return BASE_COLORS[7] as string;
  if (index < 8) return BASE_COLORS[index] as string;
  if (index < 16) return BRIGHT_COLORS[index - 8] as string;
  if (index < 232) {
    const i = index - 16;
    const r = Math.floor(i / 36);
    const g = Math.floor((i % 36) / 6);
    const b = i % 6;
    const conv = (v: number): number => (v === 0 ? 0 : 55 + v * 40);
    return `#${[conv(r), conv(g), conv(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  }
  const v = 8 + (index - 232) * 10;
  return `#${v.toString(16).padStart(2, '0').repeat(3)}`;
}

interface Style {
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  underline?: boolean;
  italic?: boolean;
}

const EMPTY_STYLE: Style = {};

/** 解析一段 SGR 参数（`ESC [ … m` 的参数部分，如 '1;31'）。 */
export function applySgr(style: Style, params: string): Style {  const nums = params.split(';').map((p) => (p === '' ? 0 : Number.parseInt(p, 10)));
  let out = { ...style };
  for (let i = 0; i < nums.length; i += 1) {
    const n = nums[i] ?? 0;
    if (n === 0) {
      out = { ...EMPTY_STYLE };
    } else if (n === 1) out.bold = true;
    else if (n === 2) out.dim = true;
    else if (n === 3) out.italic = true;
    else if (n === 4) out.underline = true;
    else if (n === 22) {
      out.bold = false;
      out.dim = false;
    } else if (n === 23) out.italic = false;
    else if (n === 24) out.underline = false;
    else if (n >= 30 && n <= 37) out.fg = BASE_COLORS[n - 30];
    else if (n === 39) delete out.fg;
    else if (n >= 40 && n <= 47) out.bg = BASE_COLORS[n - 40];
    else if (n === 49) delete out.bg;
    else if (n >= 90 && n <= 97) out.fg = BRIGHT_COLORS[n - 90];
    else if (n >= 100 && n <= 107) out.bg = BRIGHT_COLORS[n - 100];
    else if (n === 38 || n === 48) {
      // 38;5;n（256 色）/ 38;2;r;g;b（真彩）；未知形式忽略
      const mode = nums[i + 1];
      if (mode === 5) {
        const idx = nums[i + 2];
        if (typeof idx === 'number') {
          if (n === 38) out.fg = xterm256(idx);
          else out.bg = xterm256(idx);
        }
        i += 2;
      } else if (mode === 2) {
        const r = nums[i + 2] ?? 0;
        const g = nums[i + 3] ?? 0;
        const b = nums[i + 4] ?? 0;
        const color = `#${[r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`;
        if (n === 38) out.fg = color;
        else out.bg = color;
        i += 4;
      }
    }
  }
  return out;
}

/** 匹配一个 CSI 序列（`ESC [ 参数 结尾字母`）。 */
// eslint-disable-next-line no-control-regex -- 终端输出里的 ESC（0x1B）是待解析的数据本身
const CSI_RE = /\x1b\[([0-9;?]*)([@-~])/g;
/** 匹配一个 OSC 序列（`ESC ] … BEL` 或 `ESC ] … ESC \`）。 */
// eslint-disable-next-line no-control-regex -- 同上：解析终端输出中的控制序列
const OSC_RE = /\x1b\][\s\S]*?(?:\x07|\x1b\\)/g;

/**
 * 把原始终端输出解析为带样式的片段序列。
 * - `\r\n` 归一为 `\n`；单独的 `\r` 也按换行处理（行式终端没有光标回退语义）。
 * - SGR 之外的 CSI 与 OSC 序列被丢弃。
 */
export function parseAnsi(input: string): AnsiSegment[] {
  const segments: AnsiSegment[] = [];
  let style: Style = { ...EMPTY_STYLE };
  let text = '';

  const flush = (): void => {
    if (!text) return;
    const seg: AnsiSegment = { text };
    if (style.fg) seg.fg = style.fg;
    if (style.bg) seg.bg = style.bg;
    if (style.bold) seg.bold = true;
    if (style.dim) seg.dim = true;
    if (style.underline) seg.underline = true;
    if (style.italic) seg.italic = true;
    segments.push(seg);
    text = '';
  };

  // 先剥掉 OSC（标题等），再逐段处理 CSI
  const cleaned = input.replace(OSC_RE, '');
  let last = 0;
  CSI_RE.lastIndex = 0;
  let m = CSI_RE.exec(cleaned);
  while (m) {
    text += cleaned.slice(last, m.index);
    last = m.index + m[0].length;
    if (m[2] === 'm') {
      flush();
      style = applySgr(style, m[1] ?? '');
    }
    // 其它 CSI（光标移动、清屏等）直接丢弃：没有屏幕缓冲，无法回放
    m = CSI_RE.exec(cleaned);
  }
  text += cleaned.slice(last);
  flush();

  // 归一换行
  const out: AnsiSegment[] = [];
  for (const seg of segments) {
    const normalized = seg.text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (!normalized) continue;
    const lastSeg = out[out.length - 1];
    if (lastSeg && lastSeg.fg === seg.fg && lastSeg.bg === seg.bg && lastSeg.bold === seg.bold && lastSeg.dim === seg.dim && lastSeg.underline === seg.underline && lastSeg.italic === seg.italic) {
      lastSeg.text += normalized;
    } else {
      out.push({ ...seg, text: normalized });
    }
  }
  return out;
}

/** 片段 → CSS 行内样式（供 DOM 渲染）。 */
export function segmentStyle(seg: AnsiSegment): string {
  const parts: string[] = [];
  if (seg.fg) parts.push(`color:${seg.fg}`);
  if (seg.bg) parts.push(`background-color:${seg.bg}`);
  if (seg.bold) parts.push('font-weight:600');
  if (seg.dim) parts.push('opacity:.7');
  if (seg.underline) parts.push('text-decoration:underline');
  if (seg.italic) parts.push('font-style:italic');
  return parts.join(';');
}
