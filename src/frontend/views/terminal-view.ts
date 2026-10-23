/**
 * 任务会话 · 终端模式（v1.6，ADR 0010）。
 *
 * 与 Orca 的「终端 / 对话」双视图对应：本面板显示会话所属终端的原始终端输出，
 * 输入框把用户敲的命令送回主进程的终端进程。
 *
 * - 终端进程由主进程托管（src/backend/terminal/terminal-manager.ts），本模块不碰进程；
 *   切走终端模式时进程继续运行（与 Orca「对话覆盖层之下终端仍在跑」的行为一致）。
 * - 输出按 ANSI 解析（lib/ansi.ts）：SGR 颜色保留，其余控制序列丢弃（无 PTY，无法回放光标）。
 * - 输入为行式：回车提交一行（补 \r\n）。子进程不回显，故本模块自行回显用户输入。
 */
import type { TerminalKind } from '../../../contracts/ipc.ts';
import { api, errorText } from '../api.ts';
import { parseAnsi, segmentStyle } from '../lib/ansi.ts';
import { clear, h } from '../lib/dom.ts';
import { store } from '../store.ts';

export interface TerminalHooks {
  /** 提示信息（错误等）。 */
  notify(text: string, kind?: 'notice' | 'info'): void;
}

export interface TerminalView {
  /** 打开（或复用）当前会话的终端。 */
  open(kind?: TerminalKind): Promise<void>;
  /** 结束当前会话的终端。 */
  close(): Promise<void>;
  /** 聚焦输入框。 */
  focus(): void;
  /** 当前会话是否有终端在运行。 */
  active(): boolean;
}

/** 渲染时保留的输出尾部字符数（更早的内容不再渲染，避免大输出拖慢界面）。 */
const RENDER_TAIL_CHARS = 60_000;

export function mountTerminal(container: HTMLElement, hooks: TerminalHooks): TerminalView {
  clear(container);
  const sub = h('span', { class: 'mute tv-sub' });
  const title = h('span', { class: 'p' }, '终端');
  /** 终端种类：shell = 项目根 shell；cli = 以可读输出运行本会话的 Agent CLI（照 Orca 的「在终端里跑 agent」）。 */
  const kindSel = h('select', { class: 'tv-kind', title: '终端类型', attrs: { 'aria-label': '终端类型' } });
  for (const [v, l] of [['shell', 'Shell'], ['cli', 'Agent CLI']] as const) {
    kindSel.append(h('option', { attrs: { value: v } }, l));
  }
  const btnClear = h('button', { class: 'btn sm', title: '清屏（只清显示，不影响进程）', attrs: { type: 'button' } }, '清屏');
  const btnRestart = h('button', { class: 'btn sm', title: '重启终端', attrs: { type: 'button' } }, '重启');
  const btnStop = h('button', { class: 'btn sm', title: '结束终端进程', attrs: { type: 'button' } }, '结束');
  const head = h('div', { class: 'cvh' }, title, sub, kindSel, h('span', { class: 'sp' }), btnClear, btnRestart, btnStop);
  const out = h('div', { class: 'termout', attrs: { role: 'log', 'aria-live': 'polite' } });
  const prompt = h('span', { class: 'pr' }, '›');
  const input = h('input', {
    class: 'tin',
    attrs: { type: 'text', placeholder: '输入命令后按回车执行', autocomplete: 'off', spellcheck: 'false', 'aria-label': '终端输入' },
  });
  const form = h('form', { class: 'termin' }, prompt, input);
  const note = h('div', { class: 'tv-note mute' });
  container.append(head, out, form, note);

  /** 用户输入的本地回显（子进程不回显）：会话 ID → 已回显文本。 */
  const echoes = new Map<string, string>();
  let renderedKey = '';
  let frame = 0;

  const sessionId = (): string | null => store.state.current?.id ?? null;

  const terminalOf = (sid: string) => store.state.terminals.get(sid) ?? null;

  /** 渲染输出：本地回显 + 主进程缓冲（按 ANSI 解析）。 */
  const renderOut = (): void => {
    const sid = sessionId();
    const t = sid ? terminalOf(sid) : null;
    const echo = sid ? echoes.get(sid) ?? '' : '';
    const raw = `${echo}${t?.buffer ?? ''}`;
    const tail = raw.length > RENDER_TAIL_CHARS ? raw.slice(raw.length - RENDER_TAIL_CHARS) : raw;
    const key = `${sid ?? ''}|${tail.length}|${tail.slice(-64)}`;
    if (key === renderedKey) return;
    renderedKey = key;
    clear(out);
    if (!raw) {
      out.append(h('div', { class: 'tv-hint mute' }, '终端没有输出。'));
      return;
    }
    const segs = parseAnsi(tail);
    const frag = document.createDocumentFragment();
    for (const seg of segs) {
      if (!seg.text) continue;
      const style = segmentStyle(seg);
      if (!style) {
        frag.append(document.createTextNode(seg.text));
        continue;
      }
      const span = document.createElement('span');
      span.setAttribute('style', style);
      span.textContent = seg.text;
      frag.append(span);
    }
    out.append(frag);
    out.scrollTop = out.scrollHeight;
  };

  const scheduleRender = (): void => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      renderOut();
    });
  };

  const renderHead = (): void => {
    const sid = sessionId();
    const t = sid ? terminalOf(sid) : null;
    const project = store.state.project;
    if (!t) {
      title.textContent = '终端';
      sub.textContent = project ? '未启动' : '未打开项目';
    } else {
      title.textContent = t.kind === 'cli' ? '终端 · Agent CLI' : '终端';
      sub.textContent = `${t.program} · ${t.cwd}${t.alive ? '' : ` · 已退出${t.exitCode === null ? '' : `（${t.exitCode}）`}`}`;
    }
    kindSel.value = t?.kind ?? kindSel.value;
    kindSel.disabled = !project;
    btnStop.disabled = !t || !t.alive;
    btnRestart.disabled = !project;
    input.disabled = !t || !t.alive;
    if (!t) {
      note.textContent = project ? '' : '请先打开项目文件夹（终端的工作目录恒为项目根）。';
      note.hidden = !note.textContent;
    } else if (!t.alive) {
      note.textContent = '终端进程已退出，可点击「重启」重新打开。';
      note.hidden = false;
    } else {
      note.hidden = true;
    }
  };

  const openTerminal = async (kind: TerminalKind = 'shell', restart = false): Promise<void> => {
    const sid = sessionId();
    if (!sid) {
      hooks.notify('请先选择一个会话。');
      return;
    }
    if (!store.state.project) {
      hooks.notify('请先打开项目文件夹（终端的工作目录恒为项目根）。');
      return;
    }
    try {
      const info = await api.invoke('terminal:open', { sessionId: sid, kind, restart });
      store.setTerminal(info);
      renderHead();
      renderOut();
      input.focus();
    } catch (e) {
      hooks.notify(errorText(e));
    }
  };

  const closeTerminal = async (): Promise<void> => {
    const sid = sessionId();
    if (!sid) return;
    try {
      await api.invoke('terminal:close', { sessionId: sid });
    } catch (e) {
      hooks.notify(errorText(e));
    }
    store.dropTerminal(sid);
    renderHead();
    renderOut();
  };

  /** 发送一行输入（补 \r\n）并本地回显。 */
  const send = async (): Promise<void> => {
    const sid = sessionId();
    const text = input.value;
    if (!sid || !text.trim()) return;
    input.value = '';
    const t = terminalOf(sid);
    if (!t || !t.alive) {
      hooks.notify('终端未运行，无法输入。');
      return;
    }
    echoes.set(sid, `${echoes.get(sid) ?? ''}${'› '}${text}\n`);
    try {
      await api.invoke('terminal:input', { sessionId: sid, data: `${text}\r\n` });
    } catch (e) {
      hooks.notify(errorText(e));
    }
    renderOut();
  };

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    void send();
  });
  btnClear.addEventListener('click', () => {
    const sid = sessionId();
    if (!sid) return;
    echoes.set(sid, '');
    store.clearTerminalOutput(sid);
    renderedKey = '';
    renderOut();
  });
  btnRestart.addEventListener('click', () => {
    void openTerminal((kindSel.value as TerminalKind) || 'shell', true);
  });
  kindSel.addEventListener('change', () => {
    // 切换终端类型：结束旧终端并按新类型重开
    void openTerminal((kindSel.value as TerminalKind) || 'shell', true);
  });
  btnStop.addEventListener('click', () => void closeTerminal());

  store.on('terminals', () => {
    renderHead();
    scheduleRender();
  });
  store.on('current', () => {
    renderHead();
    scheduleRender();
  });
  store.on('project', renderHead);

  renderHead();
  renderOut();

  return {
    open: openTerminal,
    close: closeTerminal,
    focus: () => input.focus(),
    active: () => {
      const sid = sessionId();
      const t = sid ? terminalOf(sid) : null;
      return Boolean(t && t.alive);
    },
  };
}