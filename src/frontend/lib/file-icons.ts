/**
 * 文件类型图标：按文件名 / 扩展名适配图标形状，单色线性（stroke=currentColor，不带任何填充色），
 * 颜色完全由所在位置的 CSS color 决定（资源管理器、上下文面板「文件」「DIFF」共用）。
 * 纯映射逻辑 fileIconKind 可单测；fileIcon 负责生成 SVG 节点。
 */
import { svgEl } from './icons.ts';

export type FileIconKind =
  | 'dir' | 'dir-open'
  | 'code' | 'test' | 'markup' | 'style' | 'data' | 'doc' | 'image' | 'shell'
  | 'config' | 'lock' | 'git' | 'package' | 'db' | 'archive' | 'pdf' | 'file';

const EXT: Record<string, FileIconKind> = {};
const reg = (kind: FileIconKind, exts: string) => { for (const e of exts.split(' ')) EXT[e] = kind; };
reg('code', 'ts tsx mts cts js jsx mjs cjs py rb go rs java kt kts swift c h cc cpp hpp cs php lua dart scala r m');
reg('markup', 'html htm xml xhtml vue svelte astro');
reg('style', 'css scss sass less styl');
reg('data', 'json jsonc json5 yaml yml toml csv tsv ndjson');
reg('doc', 'md mdx markdown txt rst adoc log');
reg('image', 'png jpg jpeg gif webp bmp ico svg avif heic');
reg('shell', 'sh bash zsh fish ps1 bat cmd');
reg('config', 'ini cfg conf env properties editorconfig');
reg('lock', 'lock');
reg('db', 'sql db sqlite sqlite3');
reg('archive', 'zip tar gz tgz bz2 xz 7z rar asar');
reg('pdf', 'pdf');

const NAMES: Record<string, FileIconKind> = {
  'package.json': 'package',
  'package-lock.json': 'lock', 'pnpm-lock.yaml': 'lock', 'yarn.lock': 'lock', 'bun.lockb': 'lock', 'cargo.lock': 'lock',
  '.gitignore': 'git', '.gitattributes': 'git', '.gitmodules': 'git', '.gitkeep': 'git',
  '.env': 'config', '.npmrc': 'config', '.nvmrc': 'config', '.editorconfig': 'config', '.prettierrc': 'config', '.eslintrc': 'config',
  'dockerfile': 'config', 'makefile': 'shell',
  'license': 'doc', 'readme': 'doc',
};

/** 由路径推导图标类别；目录按展开状态区分。 */
export function fileIconKind(path: string, isDir = false, open = false): FileIconKind {
  if (isDir) return open ? 'dir-open' : 'dir';
  const name = (path.split(/[\\/]/).pop() ?? path).toLowerCase();
  if (NAMES[name]) return NAMES[name];
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(name)) return 'test';
  if (name.startsWith('.env.')) return 'config';
  if (/^(tsconfig|jsconfig)(\..+)?\.json$/.test(name) || /\.config\.[cm]?[jt]s$/.test(name) || /^\.[\w-]+rc(\.\w+)?$/.test(name)) return 'config';
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return 'file';
  return EXT[name.slice(dot + 1)] ?? 'file';
}

/** 文档外框（带折角）；内部再叠加类型符号。 */
const PAGE = ['M6 3h8l4 4v14H6z', 'M14 3v4h4'];
type Shape = { d: string[]; circles?: [number, number, number][]; rects?: [number, number, number, number, number][] };
const SHAPES: Record<FileIconKind, Shape> = {
  dir: { d: ['M3 6h7l2 2h9v11H3z'] },
  'dir-open': { d: ['M3 19V6h7l2 2h7v3', 'M3 19l3-8h16l-3 8z'] },
  file: { d: PAGE },
  code: { d: [...PAGE, 'M10 12l-2 2.5 2 2.5M14 12l2 2.5-2 2.5'] },
  test: { d: [...PAGE, 'M8.5 14.5l2.2 2.2 4-4.4'] },
  markup: { d: [...PAGE], circles: [[12, 14.5, 3.2]], rects: [] },
  style: { d: [...PAGE, 'M10.5 11.5l-1 6M14.5 11.5l-1 6M8.8 13.3h6.6M8.4 15.8h6.6'] },
  data: { d: [...PAGE, 'M10.5 11.5c-1.2 0-1.2.8-1.2 1.6s-.6 1.4-1 1.4c.4 0 1 .5 1 1.4s0 1.6 1.2 1.6M13.5 11.5c1.2 0 1.2.8 1.2 1.6s.6 1.4 1 1.4c-.4 0-1 .5-1 1.4s0 1.6-1.2 1.6'] },
  doc: { d: [...PAGE, 'M9 11.5h6M9 14.5h6M9 17.5h4'] },
  pdf: { d: [...PAGE, 'M8.5 17.5c2-1 4.5-4.5 3.5-6s-1.5 2.5 1 4.5 3 .5 2.5-.2-3-.3-7 1.7z'] },
  lock: { d: [...PAGE, 'M10.2 14v-1.2a1.8 1.8 0 013.6 0V14'], rects: [[9, 14, 6, 4, 0.8]] },
  config: { d: [...PAGE, 'M12 11.2v1.1M12 16.7v1.1M9.2 14.5h1.1M13.7 14.5h1.1M10 12.5l.8.8M13.2 15.7l.8.8M14 12.5l-.8.8M10.8 15.7l-.8.8'], circles: [[12, 14.5, 1.4]] },
  image: { d: ['M4 18l5-5 4 4 2.5-2.5L20 19'], rects: [[3, 5, 18, 14, 2]], circles: [[15.5, 9.5, 1.5]] },
  shell: { d: ['M7 10l3 2.5L7 15M12 15h5'], rects: [[3, 5, 18, 14, 2]] },
  git: { d: ['M7 8.2v7.6M7 12h4a3 3 0 003-3V8.2'], circles: [[7, 6.2, 2], [7, 17.8, 2], [14, 6.2, 2]] },
  package: { d: ['M12 3l8 4.5v9L12 21l-8-4.5v-9z', 'M4 7.5l8 4.5 8-4.5M12 12v9M8 5.3l8 4.5'] },
  db: { d: ['M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6', 'M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3'], circles: [] },
  archive: { d: [...PAGE, 'M11 3v2h2v2h-2v2h2v2h-2'], rects: [[10.2, 13, 3.6, 4, 0.8]] },
};

/** 生成单色文件类型图标；width/height 属性只是兜底，实际尺寸由 CSS `.ficon`（1.2em）随文件名字号缩放。 */
export function fileIcon(path: string, opts: { dir?: boolean; open?: boolean; size?: number } = {}): SVGElement {
  const kind = fileIconKind(path, opts.dir, opts.open);
  const size = opts.size ?? 14;
  const svg = svgEl('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: `ficon ficon-${kind}`, 'aria-hidden': 'true' });
  const sh = SHAPES[kind];
  for (const [x, y, w, hh, rx] of sh.rects ?? []) svg.append(svgEl('rect', { x, y, width: w, height: hh, rx }));
  for (const d of sh.d) svg.append(svgEl('path', { d }));
  for (const [cx, cy, r] of sh.circles ?? []) svg.append(svgEl('circle', { cx, cy, r }));
  if (kind === 'markup') svg.append(svgEl('path', { d: 'M8.8 14.5h6.4M12 11.3c-1.3 1.8-1.3 4.6 0 6.4M12 11.3c1.3 1.8 1.3 4.6 0 6.4' }));
  if (kind === 'db') svg.append(svgEl('ellipse', { cx: 12, cy: 6, rx: 7, ry: 3 }));
  return svg;
}
