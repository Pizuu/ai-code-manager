/**
 * 轻量语法高亮（FR-301）：逐行正则分词，只区分注释 / 字符串 / 关键字 / 数字 / 普通文本。
 * 纯函数；视图用 textContent 构建 span，不生成 HTML（宪法 十二）。
 */

export type Lang = 'ts' | 'json' | 'css' | 'sh' | 'py' | 'md' | 'yaml' | 'html' | 'plain';
export type TokenType = 'com' | 'str' | 'kw' | 'num' | null;

export interface Token {
  t: TokenType;
  v: string;
}

/** 跨行状态：是否处于块注释中。 */
export interface LineState {
  inBlock: boolean;
}

interface LangSpec {
  line: string[];
  block: [string, string] | null;
  quotes: string[];
  keywords: ReadonlySet<string>;
}

const words = (s: string): ReadonlySet<string> => new Set(s.split(/\s+/).filter(Boolean));

const SPECS: Readonly<Record<Exclude<Lang, 'plain' | 'md'>, LangSpec>> = {
  ts: {
    line: ['//'], block: ['/*', '*/'], quotes: ['"', "'", '`'],
    keywords: words('import export from as default const let var function return if else for while do switch case break continue new class extends implements interface type enum public private protected readonly static async await yield try catch finally throw typeof instanceof in of void null undefined true false this super satisfies keyof declare namespace'),
  },
  json: { line: [], block: null, quotes: ['"'], keywords: words('true false null') },
  css: { line: [], block: ['/*', '*/'], quotes: ['"', "'"], keywords: words('@media @import @keyframes @supports !important') },
  sh: { line: ['#'], block: null, quotes: ['"', "'"], keywords: words('if then else elif fi for in do done while case esac function return local export set echo exit source') },
  py: { line: ['#'], block: null, quotes: ['"', "'"], keywords: words('def class return if elif else for while in import from as with try except finally raise pass break continue lambda yield None True False and or not is async await') },
  yaml: { line: ['#'], block: null, quotes: ['"', "'"], keywords: words('true false null yes no') },
  html: { line: [], block: ['<!--', '-->'], quotes: ['"', "'"], keywords: words('') },
};

const EXT: Readonly<Record<string, Lang>> = {
  ts: 'ts', tsx: 'ts', cts: 'ts', mts: 'ts', js: 'ts', jsx: 'ts', mjs: 'ts', cjs: 'ts',
  json: 'json', jsonl: 'json', css: 'css', scss: 'css',
  sh: 'sh', bash: 'sh', ps1: 'sh', conf: 'sh', py: 'py', md: 'md', markdown: 'md',
  yml: 'yaml', yaml: 'yaml', toml: 'yaml', html: 'html', htm: 'html', xml: 'html', svg: 'html',
};

/** 由文件名推断语言；未知为 plain。 */
export function languageFor(path: string): Lang {
  const name = path.split('/').pop() ?? '';
  if (/^\.?(env|gitignore|editorconfig|npmrc)$/i.test(name)) return 'sh';
  const ext = name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : '';
  return EXT[ext] ?? 'plain';
}

function push(out: Token[], t: TokenType, v: string): void {
  if (!v) return;
  const last = out[out.length - 1];
  if (last && last.t === t) last.v += v;
  else out.push({ t, v });
}

/** 对一行分词；返回 token 与下一行的起始状态。 */
export function tokenizeLine(line: string, lang: Lang, state: LineState = { inBlock: false }): { tokens: Token[]; state: LineState } {
  const out: Token[] = [];
  if (lang === 'plain') return { tokens: line ? [{ t: null, v: line }] : [], state: { inBlock: false } };
  if (lang === 'md') {
    if (/^\s*#{1,6}\s/.test(line)) push(out, 'kw', line);
    else if (/^\s*(```|~~~)/.test(line)) push(out, 'com', line);
    else for (const part of line.split(/(`[^`]*`)/)) push(out, part.startsWith('`') && part.endsWith('`') && part.length > 1 ? 'str' : null, part);
    return { tokens: out, state: { inBlock: false } };
  }
  const spec = SPECS[lang];
  let i = 0;
  let inBlock = state.inBlock;
  while (i < line.length) {
    if (inBlock && spec.block) {
      const end = line.indexOf(spec.block[1], i);
      if (end === -1) {
        push(out, 'com', line.slice(i));
        return { tokens: out, state: { inBlock: true } };
      }
      push(out, 'com', line.slice(i, end + spec.block[1].length));
      i = end + spec.block[1].length;
      inBlock = false;
      continue;
    }
    const rest = line.slice(i);
    if (spec.line.some((p) => rest.startsWith(p)) && (lang !== 'sh' || i === 0 || /\s/.test(line[i - 1] ?? ''))) {
      push(out, 'com', rest);
      break;
    }
    if (spec.block && rest.startsWith(spec.block[0])) {
      inBlock = true;
      push(out, 'com', spec.block[0]);
      i += spec.block[0].length;
      continue;
    }
    const ch = line[i] ?? '';
    if (spec.quotes.includes(ch)) {
      let j = i + 1;
      while (j < line.length && line[j] !== ch) j += line[j] === '\\' ? 2 : 1;
      push(out, 'str', line.slice(i, Math.min(j + 1, line.length)));
      i = j + 1;
      continue;
    }
    const prev = line[i - 1] ?? '';
    const num = /^\d[\w.]*/.exec(rest);
    if (num && !/[\w$]/.test(prev)) {
      push(out, 'num', num[0]);
      i += num[0].length;
      continue;
    }
    const word = /^[@!]?[A-Za-z_$][\w$-]*/.exec(rest);
    if (word && !/[\w$]/.test(prev)) {
      const w = lang === 'css' || lang === 'sh' || lang === 'yaml' ? word[0] : word[0].replace(/-.*$/, '');
      push(out, spec.keywords.has(w) ? 'kw' : null, w);
      i += w.length;
      continue;
    }
    push(out, null, ch);
    i += 1;
  }
  return { tokens: out, state: { inBlock } };
}
