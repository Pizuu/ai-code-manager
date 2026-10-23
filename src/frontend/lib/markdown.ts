/**
 * 安全 Markdown 渲染（FR-004，宪法 十二）：模型输出不可信，先整体 HTML 转义，再生成白名单标签。
 * 只支持对话常用子集：代码块、行内代码、标题、列表、引用、分隔线、表格、粗体、斜体、http(s) 链接。
 * 纯函数、不依赖 DOM，可在 Node 中测试。
 */

import { detectLang, highlightCode, langLabel, normalizeLang } from './code-highlight.ts';

const ESCAPES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);
}

const PLACEHOLDER = '\u0000';

/** 行内格式：代码 span 先抽出保护，再处理链接、粗体、斜体。 */
export function renderInline(text: string): string {
  const codes: string[] = [];
  const protectedText = text.replace(/`([^`\n]+)`/g, (_m, code: string) => {
    codes.push(`<code>${escapeHtml(code)}</code>`);
    return `${PLACEHOLDER}${codes.length - 1}${PLACEHOLDER}`;
  });
  let out = escapeHtml(protectedText);
  out = out.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label: string, url: string) =>
    `<a href="${url}" target="_blank" rel="noreferrer noopener">${label}</a>`);
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>');
  out = out.replace(new RegExp(`${PLACEHOLDER}(\\d+)${PLACEHOLDER}`, 'g'), (_m, i: string) => codes[Number(i)] ?? '');
  return out;
}

const FENCE_RE = /^\s*```([\w+-]*)\s*$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const HR_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const UL_RE = /^\s*[-*+]\s+(.*)$/;
const OL_RE = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE_RE = /^\s*>\s?(.*)$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

export function renderMarkdown(src: string): string {
  const lines = src.split(/\r?\n/);
  const out: string[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(renderInline).join('<br>')}</p>`);
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const fence = FENCE_RE.exec(line);
    if (fence) {
      flushPara();
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE_RE.test(lines[i] as string)) body.push(lines[i++] as string);
      // 语言：优先 ``` 标注（规范化别名），其次按内容猜；着色输出只含固定 span 且源码全部转义。
      const code = body.join('\n');
      const lang = (fence[1] ? normalizeLang(fence[1]) : null) ?? detectLang(code);
      const rawTag = fence[1] && !lang ? fence[1] : '';
      const cls = lang ? ` class="lang-${lang}" data-lang="${escapeHtml(langLabel(lang))}"` : rawTag ? ` class="lang-${escapeHtml(rawTag)}" data-lang="${escapeHtml(rawTag)}"` : '';
      out.push(`<pre><code${cls}>${highlightCode(code, lang)}</code></pre>`);
      continue; // 未闭合的代码块（流式中）渲染到末尾
    }
    if (line.trim() === '') { flushPara(); continue; }
    const heading = HEADING_RE.exec(line);
    if (heading) {
      flushPara();
      const level = Math.min((heading[1] as string).length + 2, 6);
      out.push(`<h${level}>${renderInline(heading[2] ?? '')}</h${level}>`);
      continue;
    }
    if (HR_RE.test(line)) { flushPara(); out.push('<hr>'); continue; }
    if (line.trim().startsWith('|') && TABLE_SEP_RE.test(lines[i + 1] ?? '')) {
      flushPara();
      const header = splitRow(line).map((c) => `<th>${renderInline(c)}</th>`).join('');
      const rows: string[] = [];
      i += 2;
      while (i < lines.length && (lines[i] as string).trim().startsWith('|')) {
        rows.push(`<tr>${splitRow(lines[i] as string).map((c) => `<td>${renderInline(c)}</td>`).join('')}</tr>`);
        i++;
      }
      i--;
      out.push(`<table><thead><tr>${header}</tr></thead><tbody>${rows.join('')}</tbody></table>`);
      continue;
    }
    const listRe = UL_RE.test(line) ? UL_RE : OL_RE.test(line) ? OL_RE : null;
    if (listRe) {
      flushPara();
      const tag = listRe === UL_RE ? 'ul' : 'ol';
      const items: string[] = [];
      while (i < lines.length && listRe.test(lines[i] as string)) {
        items.push(`<li>${renderInline(listRe.exec(lines[i] as string)?.[1] ?? '')}</li>`);
        i++;
      }
      i--;
      out.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }
    if (QUOTE_RE.test(line)) {
      flushPara();
      const quoted: string[] = [];
      while (i < lines.length && QUOTE_RE.test(lines[i] as string)) quoted.push(QUOTE_RE.exec(lines[i++] as string)?.[1] ?? '');
      i--;
      out.push(`<blockquote>${quoted.map(renderInline).join('<br>')}</blockquote>`);
      continue;
    }
    para.push(line);
  }
  flushPara();
  return out.join('\n');
}
