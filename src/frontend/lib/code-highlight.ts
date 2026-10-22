/**
 * 轻量代码高亮（无第三方依赖）：识别代码语言 + 按语言着色。
 * 安全：输出只含固定的 <span class="tk-*">，所有源码文本一律经 escapeHtml 转义（宪法 十二）。
 * 纯函数、不依赖 DOM，可在 Node 中测试。
 */
import { escapeHtml } from './markdown.ts';

type Family = 'c' | 'py' | 'sh' | 'json' | 'css' | 'html' | 'sql' | 'yaml';

interface LangDef {
  family: Family;
  keywords: ReadonlySet<string>;
  /** 显示名 */
  label: string;
}

const words = (s: string): ReadonlySet<string> => new Set(s.split(/\s+/).filter(Boolean));

const JS_KW = words(`break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new return super switch this throw try typeof var void while with yield async await of static get set from as null undefined true false`);
const TS_KW = words(`${[...JS_KW].join(' ')} interface type enum implements namespace declare readonly private protected public abstract keyof infer satisfies is any unknown never string number boolean`);
const PY_KW = words(`False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield self print`);
const SH_KW = words(`if then else elif fi for while until do done case esac function in return export local readonly echo cd exit set unset source sudo`);
const GO_KW = words(`break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false string int error`);
const RS_KW = words(`as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while Some None Ok Err String Vec`);
const JAVA_KW = words(`abstract boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long new null package private protected public return short static super switch this throw throws try void while true false var String`);
const C_KW = words(`auto break case char const continue default do double else enum extern float for goto if inline int long register return short signed sizeof static struct switch typedef union unsigned void volatile while include define bool true false nullptr class namespace public private protected template typename using new delete virtual std`);
const SQL_KW = words(`select from where and or not insert into values update set delete create table drop alter add primary key foreign references join left right inner outer on group by order having limit offset as distinct union all null is in like between exists index view count sum avg min max case when then else end`);

const LANGS: Readonly<Record<string, LangDef>> = {
  javascript: { family: 'c', keywords: JS_KW, label: 'JavaScript' },
  typescript: { family: 'c', keywords: TS_KW, label: 'TypeScript' },
  python: { family: 'py', keywords: PY_KW, label: 'Python' },
  bash: { family: 'sh', keywords: SH_KW, label: 'Shell' },
  json: { family: 'json', keywords: words('true false null'), label: 'JSON' },
  css: { family: 'css', keywords: words(''), label: 'CSS' },
  html: { family: 'html', keywords: words(''), label: 'HTML' },
  go: { family: 'c', keywords: GO_KW, label: 'Go' },
  rust: { family: 'c', keywords: RS_KW, label: 'Rust' },
  java: { family: 'c', keywords: JAVA_KW, label: 'Java' },
  cpp: { family: 'c', keywords: C_KW, label: 'C/C++' },
  sql: { family: 'sql', keywords: SQL_KW, label: 'SQL' },
  yaml: { family: 'yaml', keywords: words('true false null yes no'), label: 'YAML' },
};

const ALIASES: Readonly<Record<string, string>> = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', node: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  py: 'python', python3: 'python',
  sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash', powershell: 'bash', ps1: 'bash', bat: 'bash', cmd: 'bash',
  jsonc: 'json', json5: 'json',
  scss: 'css', less: 'css',
  xml: 'html', svg: 'html', vue: 'html', htm: 'html',
  golang: 'go', rs: 'rust', kt: 'java', kotlin: 'java', c: 'cpp', h: 'cpp', 'c++': 'cpp', cc: 'cpp', cs: 'java', csharp: 'java',
  mysql: 'sql', postgres: 'sql', postgresql: 'sql', sqlite: 'sql',
  yml: 'yaml',
};

/** 规范化语言名；未知返回 null。 */
export function normalizeLang(hint: string): string | null {
  const k = hint.trim().toLowerCase();
  if (!k) return null;
  if (LANGS[k]) return k;
  return ALIASES[k] ?? null;
}

export function langLabel(lang: string): string {
  return LANGS[lang]?.label ?? lang;
}

/** 按内容猜语言（启发式，猜不出返回 null）。 */
export function detectLang(code: string): string | null {
  const s = code.trim();
  if (!s) return null;
  if (/^[[{]/.test(s)) {
    try { JSON.parse(s); return 'json'; } catch { /* 不是 JSON */ }
  }
  if (/^<(!doctype|html|\?xml|[a-z][\w-]*[\s>/])/i.test(s)) return 'html';
  if (/^#!.*\b(bash|sh|zsh)\b/.test(s) || /^\s*(\$ |sudo |npm |npx |pnpm |yarn |git |cd |ls |mkdir |curl |pip |brew |apt(-get)? )/m.test(s)) return 'bash';
  if (/^\s*(def |class \w+(\(.*\))?:|import \w+$|from [\w.]+ import |if __name__ ==|print\()/m.test(s) && !/[;{}]\s*$/m.test(s)) return 'python';
  if (/^\s*(package \w+|func \w*\(|import \(\s*$)/m.test(s)) return 'go';
  if (/^\s*(fn \w+|let mut |use \w+::|impl |pub fn )/m.test(s)) return 'rust';
  if (/^\s*#include\s*[<"]|\bstd::|\bprintf\s*\(/m.test(s)) return 'cpp';
  if (/^\s*(export )?(interface|type) \w+[^;]*[{=]|:\s*(string|number|boolean)\b|\bas const\b|<\w+>\(/m.test(s)) return 'typescript';
  if (/^\s*(public |private )?(static )?(class|interface) \w+|System\.out\./m.test(s)) return 'java';
  if (/^\s*(select|insert into|update \w+ set|create table|delete from|alter table)\b/im.test(s)) return 'sql';
  if (/\b(const|let|var|function|=>|console\.|require\(|export |import .* from )/.test(s)) return 'javascript';
  if (/^\s*[.#]?[\w-]+(\s*[,>+~]\s*[.#]?[\w-]+)*\s*\{[^}]*:[^}]*\}/m.test(s) || /^\s*@media\b/m.test(s)) return 'css';
  if (/^[\w-]+:\s*.*$/m.test(s) && /^(\s*-\s+|\s*[\w-]+:)/m.test(s) && !/[;{}]/.test(s)) return 'yaml';
  return null;
}

const span = (cls: string, text: string): string => `<span class="tk-${cls}">${escapeHtml(text)}</span>`;

/** 按 family 的 token 规则构造正则；每个分组对应一种 token 类别。 */
function tokenRe(family: Family): { re: RegExp; kinds: string[] } {
  const parts: Array<[string, string]> = [];
  switch (family) {
    case 'c':
      parts.push(['com', String.raw`\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)`], ['str', String.raw`"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?|\x60(?:\\.|[^\x60\\])*\x60?`]);
      break;
    case 'py':
      parts.push(['com', String.raw`#[^\n]*`], ['str', String.raw`[rbfu]{0,2}(?:"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?)`], ['fn', String.raw`@[\w.]+`]);
      break;
    case 'sh':
      parts.push(['com', String.raw`(?:^|(?<=\s))#[^\n]*`], ['str', String.raw`"(?:\\.|[^"\\])*"?|'[^']*'?`], ['var', String.raw`\$\{[^}\n]*\}|\$[\w@#?$!*-]+`]);
      break;
    case 'json':
      parts.push(['key', String.raw`"(?:\\.|[^"\\\n])*"(?=\s*:)`], ['str', String.raw`"(?:\\.|[^"\\\n])*"?`]);
      break;
    case 'css':
      parts.push(['com', String.raw`\/\*[\s\S]*?(?:\*\/|$)`], ['str', String.raw`"[^"\n]*"?|'[^'\n]*'?`], ['key', String.raw`[\w-]+(?=\s*:[^{};]*;?)`], ['fn', String.raw`@[\w-]+|[.#][\w-]+`]);
      break;
    case 'html':
      parts.push(['com', String.raw`<!--[\s\S]*?(?:-->|$)`], ['kw', String.raw`<\/?[\w:-]+|\/?>`], ['key', String.raw`[\w:-]+(?==)`], ['str', String.raw`"[^"]*"?|'[^']*'?`]);
      break;
    case 'sql':
      parts.push(['com', String.raw`--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)`], ['str', String.raw`'(?:''|[^'])*'?|"[^"\n]*"?`]);
      break;
    case 'yaml':
      parts.push(['com', String.raw`(?:^|(?<=\s))#[^\n]*`], ['key', String.raw`[\w.-]+(?=\s*:(?:\s|$))`], ['str', String.raw`"(?:\\.|[^"\\\n])*"?|'[^'\n]*'?`]);
      break;
  }
  if (family !== 'html') parts.push(['num', String.raw`\b(?:0x[\da-fA-F]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)(?:px|em|rem|%|vh|vw|ms|s)?\b`]);
  if (family !== 'html' && family !== 'json') parts.push(['word', String.raw`[A-Za-z_$][\w$]*`]);
  else if (family === 'json') parts.push(['word', String.raw`\b(?:true|false|null)\b`]);
  return { re: new RegExp(parts.map(([, p]) => `(${p})`).join('|'), 'gm'), kinds: parts.map(([k]) => k) };
}

/** 着色：返回安全 HTML（未知语言只做转义）。 */
export function highlightCode(code: string, lang: string | null): string {
  const def = lang ? LANGS[lang] : undefined;
  if (!def) return escapeHtml(code);
  const { re, kinds } = tokenRe(def.family);
  const caseInsensitive = def.family === 'sql';
  let out = '';
  let last = 0;
  for (const m of code.matchAll(re)) {
    const text = m[0];
    if (!text) continue;
    const idx = m.index ?? 0;
    out += escapeHtml(code.slice(last, idx));
    last = idx + text.length;
    const gi = m.slice(1).findIndex((g) => g !== undefined);
    const kind = kinds[gi] ?? '';
    if (kind === 'word') {
      const w = caseInsensitive ? text.toLowerCase() : text;
      if (def.keywords.has(w)) out += span('kw', text);
      else if (/^[A-Z][\w$]*$/.test(text) && def.family !== 'sql') out += span('type', text);
      else if (code[last] === '(') out += span('fn', text);
      else out += escapeHtml(text);
    } else {
      out += span(kind, text);
    }
  }
  return out + escapeHtml(code.slice(last));
}
