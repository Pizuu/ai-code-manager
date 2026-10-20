/**
 * 只读代码查看器（FR-301、FR-302，ADR 0008）：任务会话中列的文件标签页内容。
 * 数据来自 fs:read（主进程沙箱 + 大小 / 二进制保护）；行号 + 轻量高亮，全部用 textContent 构建。
 * T-039：编辑模式（textarea，缓冲区按文件保留，标签显示未保存圆点）。契约暂无写文件通道，保存按钮禁用；
 * 待契约新增 `fs:write` 后在 save() 中接入即可。
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

/** 契约没有渲染进程可用的写文件通道时的提示（T-039）。 */
export const SAVE_UNAVAILABLE = '需后端写文件通道（契约任务）';

export interface CodeViewHooks {
  /** 「发送到任务会话」按钮（整个文件引用）。 */
  sendFile(relPath: string): void;
  /** 某文件编辑缓冲区的未保存状态变化（标签圆点）。 */
  onDirty?(relPath: string, dirty: boolean): void;
}

export interface CodeView {
  /** 显示某文件（有编辑缓冲区时显示缓冲区，否则重新读取）。 */
  show(relPath: string): Promise<void>;
  isDirty(relPath: string): boolean;
  /** 丢弃该文件的编辑缓冲区（关闭标签时）。 */
  discard(relPath: string): void;
}

interface EditBuf { original: string; text: string }

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
  const mode = h('span', { class: 'chip' }, '只读');
  let current = '';
  /** 已进入编辑模式的文件缓冲区（只在内存，关闭标签即丢弃）。 */
  const bufs = new Map<string, EditBuf>();
  let loaded: FileContent | null = null;
  let loadedPath = '';
  const reload = h('button', { class: 'btn sm', attrs: { type: 'button' }, title: '重新读取文件', on: { click: () => {
    if (isDirty(current) && !confirm(`「${current}」有未保存的修改，重新读取将丢失。继续？`)) return;
    discard(current);
    void show(current);
  } } }, '刷新');
  const editBtn = h('button', { class: 'btn sm', attrs: { type: 'button' }, title: '编辑此文件', on: { click: () => toggleEdit() } }, '编辑');
  const saveBtn = h('button', { class: 'btn sm pri', attrs: { type: 'button', disabled: '' }, title: SAVE_UNAVAILABLE }, '保存');
  const send = h('button', { class: 'btn sm', attrs: { type: 'button' }, title: '把文件引用插入任务会话输入框', on: { click: () => hooks.sendFile(current) } }, '发送到任务会话');
  const banner = h('div', { class: 'cv-banner' });
  const body = h('div', { class: 'cvb' });
  pane.append(h('div', { class: 'cvh' }, mode, path, meta, h('span', { class: 'sp' }), reload, editBtn, saveBtn, send), banner, body);

  const isDirty = (p: string) => {
    const b = bufs.get(p);
    return !!b && b.text !== b.original;
  };
  const discard = (p: string) => {
    const was = isDirty(p);
    bufs.delete(p);
    if (was) hooks.onDirty?.(p, false);
  };
  const setMode = (editing: boolean) => {
    mode.textContent = editing ? (isDirty(current) ? '已修改' : '编辑中') : '只读';
    mode.classList.toggle('edit', editing);
    editBtn.textContent = editing ? '完成编辑' : '编辑';
    saveBtn.hidden = !editing;
    // 编辑时让出标题栏宽度：隐藏「发送到任务会话」
    send.hidden = editing;
  };
  const save = () => {
    // 契约暂无写文件通道：不发起任何 IPC，只提示
    banner.hidden = false;
    banner.textContent = `无法保存：${SAVE_UNAVAILABLE}。修改仅保留在本标签内存中。`;
  };
  const renderEditor = (buf: EditBuf) => {
    const ta = h('textarea', { class: 'cv-ed', attrs: { spellcheck: 'false', wrap: 'off', 'aria-label': `编辑 ${current}` } });
    ta.value = buf.text;
    const p = current;
    ta.addEventListener('input', () => {
      const was = buf.text !== buf.original;
      buf.text = ta.value;
      const now = buf.text !== buf.original;
      if (was !== now) {
        hooks.onDirty?.(p, now);
        setMode(true);
      }
    });
    ta.addEventListener('keydown', (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') {
        ev.preventDefault();
        save();
      } else if (ev.key === 'Tab' && !ev.shiftKey) {
        ev.preventDefault();
        ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end');
        ta.dispatchEvent(new Event('input'));
      }
    });
    body.classList.add('edit');
    body.replaceChildren(ta);
    setMode(true);
    requestAnimationFrame(() => ta.focus());
  };
  const toggleEdit = () => {
    const buf = bufs.get(current);
    if (buf) {
      // 退出编辑：未修改则丢弃缓冲区回到只读高亮；有修改则保留缓冲区并继续编辑提示
      if (isDirty(current)) {
        banner.hidden = false;
        banner.textContent = `有未保存的修改（${SAVE_UNAVAILABLE}）。关闭标签或「刷新」可放弃修改。`;
        return;
      }
      bufs.delete(current);
      body.classList.remove('edit');
      setMode(false);
      if (loaded && loadedPath === current) renderLines(body, loaded);
      else void show(current);
      return;
    }
    if (!loaded || loadedPath !== current || !canEdit(loaded)) return;
    const b: EditBuf = { original: loaded.content, text: loaded.content };
    bufs.set(current, b);
    renderEditor(b);
  };
  const canEdit = (f: FileContent | null) => !!f && f.kind === 'text' && !f.truncated;

  let token = 0;
  const show = async (relPath: string): Promise<void> => {
    const my = ++token;
    current = relPath;
    for (const [k, v] of Object.entries(sendAttrs({ kind: 'code', path: relPath, startLine: 0, endLine: 0, text: '' }))) pane.setAttribute(k, v);
    path.textContent = relPath;
    banner.hidden = true;
    body.classList.remove('edit');
    const buf = bufs.get(relPath);
    if (buf) {
      meta.textContent = '编辑缓冲区';
      editBtn.disabled = false;
      renderEditor(buf);
      return;
    }
    setMode(false);
    loaded = null;
    editBtn.disabled = true;
    meta.textContent = '读取中…';
    body.replaceChildren();
    try {
      const f = await api.invoke('fs:read', relPath);
      if (my !== token) return;
      loaded = f;
      loadedPath = relPath;
      editBtn.disabled = !canEdit(f);
      editBtn.title = canEdit(f) ? '编辑此文件' : f.kind === 'text' ? '文件已截断，不能编辑' : '二进制或过大的文件不能编辑';
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
  setMode(false);
  return { show, isDirty, discard };
}
