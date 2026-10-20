/**
 * 只读代码查看器（FR-301、FR-302，ADR 0008）：任务会话中列的文件标签页内容。
 * 数据来自 fs:read（主进程沙箱 + 大小 / 二进制保护）；行号 + 轻量高亮，全部用 textContent 构建。
 */
import type { FileContent } from '../../../contracts/ipc.ts';
import { SEND_ATTR } from '../../../contracts/ui.ts';
import { api, errorText } from '../api.ts';
import { sendAttrs } from '../lib/context-send.ts';
import { clear, h } from '../lib/dom.ts';
import { languageFor, tokenizeLine, type LineState } from '../lib/highlight.ts';

/** 超过该行数不做高亮，只显示纯文本。 */
export const HIGHLIGHT_MAX_LINES = 5000;

const LANG_LABEL: Readonly<Record<string, string>> = { ts: 'TypeScript / JavaScript', json: 'JSON', css: 'CSS', sh: 'Shell', py: 'Python', md: 'Markdown', yaml: 'YAML', html: 'HTML / XML', plain: '纯文本' };

function sizeText(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export interface CodeViewHooks {
  /** 「发送到任务会话」按钮（整个文件引用）。 */
  sendFile(relPath: string): void;
}

export interface CodeView {
  /** 显示某文件（每次打开重新读取）。 */
  show(relPath: string): Promise<void>;
}

function renderLines(body: HTMLElement, f: FileContent): number {
  const lines = f.content.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const lang = languageFor(f.relPath);
  const plain = lines.length > HIGHLIGHT_MAX_LINES || lang === 'plain';
  let state: LineState = { inBlock: false };
  const frag = document.createDocumentFragment();
  const width = String(lines.length).length;
  lines.forEach((line, i) => {
    const lc = h('span', { class: 'lc' });
    if (plain) lc.textContent = line;
    else {
      const r = tokenizeLine(line, lang, state);
      state = r.state;
      for (const t of r.tokens) lc.append(t.t ? h('span', { class: `tk-${t.t}` }, t.v) : t.v);
    }
    if (!line) lc.textContent = '\u200b';
    frag.append(h('div', { class: 'cl', attrs: { [SEND_ATTR.line]: String(i + 1) } }, h('span', { class: 'ln' }, String(i + 1).padStart(width)), lc));
  });
  body.replaceChildren(frag);
  return lines.length;
}

export function mountCodeView(pane: HTMLElement, hooks: CodeViewHooks): CodeView {
  clear(pane);
  const path = h('span', { class: 'mono p' });
  const meta = h('span', { class: 'mute' });
  let current = '';
  const reload = h('button', { class: 'btn sm', attrs: { type: 'button' }, title: '重新读取文件', on: { click: () => void show(current) } }, '刷新');
  const send = h('button', { class: 'btn sm', attrs: { type: 'button' }, title: '把文件引用插入任务会话输入框', on: { click: () => hooks.sendFile(current) } }, '发送到任务会话');
  const banner = h('div', { class: 'cv-banner' });
  const body = h('div', { class: 'cvb' });
  pane.append(h('div', { class: 'cvh' }, h('span', { class: 'chip' }, '只读'), path, meta, h('span', { class: 'sp' }), reload, send), banner, body);

  let token = 0;
  const show = async (relPath: string): Promise<void> => {
    const my = ++token;
    current = relPath;
    for (const [k, v] of Object.entries(sendAttrs({ kind: 'code', path: relPath, startLine: 0, endLine: 0, text: '' }))) pane.setAttribute(k, v);
    path.textContent = relPath;
    meta.textContent = '读取中…';
    banner.hidden = true;
    body.replaceChildren();
    try {
      const f = await api.invoke('fs:read', relPath);
      if (my !== token) return;
      const lang = LANG_LABEL[languageFor(f.relPath)] ?? '纯文本';
      if (f.kind === 'binary') {
        meta.textContent = `${sizeText(f.size)} · 二进制`;
        body.replaceChildren(h('div', { class: 'cv-empty' }, `二进制文件（${sizeText(f.size)}），未显示内容。`));
        return;
      }
      if (f.kind === 'too-large') {
        meta.textContent = `${sizeText(f.size)} · 过大`;
        body.replaceChildren(h('div', { class: 'cv-empty' }, `文件过大（${sizeText(f.size)}，上限 2 MB），未显示内容。可在编辑器中打开，或让 agent 用 search 定位后分段读取。`));
        return;
      }
      const n = renderLines(body, f);
      meta.textContent = `${n} 行 · ${sizeText(f.size)} · ${lang}${n > HIGHLIGHT_MAX_LINES ? ' · 行数过多，已关闭高亮' : ''}`;
      if (f.truncated) {
        banner.hidden = false;
        banner.textContent = `文件较大（${sizeText(f.size)}），只显示前 512 KB（${n} 行）。`;
      }
      body.scrollTop = 0;
    } catch (e) {
      if (my !== token) return;
      meta.textContent = '';
      body.replaceChildren(h('div', { class: 'cv-empty error-text' }, errorText(e)));
    }
  };
  return { show };
}
