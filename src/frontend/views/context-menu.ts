/**
 * 全局右键菜单（FR-304，ADR 0008，contracts/ui.ts）：应用任意位置右键 →「新建会话窗口」/「复制」。
 * 来源优先级：代码查看器选区 → 任意选中文本 → 最近的 data-send-* 元素（代码行 / 文件 / 任务卡 / 提交 / 分支）。
 * 无可发送内容时不拦截（保留默认行为）。只组装文本并交给 hooks.sendNew（新建会话后插入其输入框），不自动发送。
 */
import type { SendSource } from '../../../contracts/ui.ts';
import { NEW_SESSION_LABEL, SEND_ATTR } from '../../../contracts/ui.ts';
import { describeSource, formatSendText, sourceFromAttrs } from '../lib/context-send.ts';
import { h } from '../lib/dom.ts';

export interface ContextMenuHooks {
  /** 新建会话并切换过去，再把格式化后的文本插入新会话输入框（不自动发送）；无法新建时由接线层回退插入当前会话。 */
  sendNew(text: string): Promise<void>;
  /** 元素所在区域的中文名（用于选中文本的来源标注）。 */
  originOf(el: Element): string;
  /** 任务会话里任意文字加入待办：text 为选中文字或整条消息，messageId 为所在消息（可缺省）。 */
  addTodo?(text: string, messageId?: string): Promise<void>;
  /** 加入收藏：quote 为选中文字（缺省 = 收藏整条消息）。 */
  addFavorite?(messageId: string | undefined, quote?: string): Promise<void>;
  /** 在系统资源管理器中显示项目内文件 / 目录（契约 v1.15 fs:reveal）。 */
  reveal?(relPath: string): Promise<void>;
}

const lineOf = (n: Node | null): number => {
  const el = n instanceof Element ? n : n?.parentElement;
  const line = el?.closest(`[${SEND_ATTR.line}]`)?.getAttribute(SEND_ATTR.line);
  return line ? Number(line) : 0;
};

/** 根据右键目标与当前选区组装发送来源。 */
export function resolveSource(target: Element, hooks: Pick<ContextMenuHooks, 'originOf'>): { source: SendSource; selected: string } | null {
  const sel = window.getSelection();
  const text = sel && !sel.isCollapsed ? sel.toString() : '';
  const codeRoot = (n: Node | null) => (n instanceof Element ? n : n?.parentElement)?.closest(`[${SEND_ATTR.kind}="code"]`) ?? null;
  if (text.trim() && sel) {
    const root = codeRoot(sel.anchorNode);
    const path = root?.getAttribute(SEND_ATTR.path);
    if (root && path && root === codeRoot(sel.focusNode)) {
      const a = lineOf(sel.anchorNode);
      const b = lineOf(sel.focusNode);
      if (a && b) return { source: { kind: 'code', path, startLine: Math.min(a, b), endLine: Math.max(a, b), text }, selected: text };
    }
    const host = (sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode?.parentElement) ?? target;
    return { source: { kind: 'selection', text, origin: hooks.originOf(host) }, selected: text };
  }
  const el = target.closest(`[${SEND_ATTR.kind}]`);
  if (!el) return null;
  const src = sourceFromAttrs((a) => el.getAttribute(a));
  if (!src) return null;
  if (src.kind === 'code') {
    const n = lineOf(target);
    return { source: { ...src, startLine: n, endLine: n }, selected: '' };
  }
  return { source: src, selected: '' };
}

export function installContextMenu(hooks: ContextMenuHooks): void {
  const menu = h('div', { class: 'ctxmenu', attrs: { role: 'menu' } });
  menu.hidden = true;
  document.body.append(menu);
  const close = () => {
    menu.hidden = true;
  };

  document.addEventListener('contextmenu', (ev) => {
    const target = ev.target instanceof Element ? ev.target : null;
    if (!target || menu.contains(target)) return;
    // 输入框内保留默认菜单（粘贴等）
    if (target.closest('textarea, input, select, [contenteditable="true"]')) return;
    const r = resolveSource(target, hooks);
    const inSession = Boolean(target.closest('#wb-session'));
    const turn = target.closest<HTMLElement>('article.turn');
    const messageIdOf = (t: HTMLElement | null): string | undefined => t
      ? (t.classList.contains('user') ? t.dataset.id : t.querySelector<HTMLElement>('.msg[data-id]')?.dataset.id)
      : undefined;
    // 选区所在消息优先（右键点在别处也能认出选区属于哪条消息）
    const selNode = window.getSelection()?.anchorNode ?? null;
    const selTurn = (selNode instanceof Element ? selNode : selNode?.parentElement)?.closest<HTMLElement>('article.turn') ?? null;
    const messageId = r?.selected ? messageIdOf(selTurn) ?? messageIdOf(turn) : messageIdOf(turn);
    const wholeText = turn && !r?.selected ? (turn.querySelector('.ubub, .msg .md') ?? turn).textContent?.trim() ?? '' : '';
    const pickText = r?.selected?.trim() || wholeText;
    if (!r && !(inSession && pickText)) {
      close();
      return;
    }
    ev.preventDefault();
    const text = r ? formatSendText(r.source) : '';
    const item = (label: string, sub: string, fn: () => void) => h('button', { class: 'mi', attrs: { type: 'button', role: 'menuitem' }, on: { click: () => { close(); fn(); } } }, h('span', {}, label), sub ? h('span', { class: 'mute' }, sub) : null);
    const items: HTMLElement[] = r ? [item(NEW_SESSION_LABEL, describeSource(r.source), () => void hooks.sendNew(text))] : [];
    if (inSession && pickText) {
      const what = r?.selected ? '选中的文字' : '这条消息';
      if (hooks.addTodo) items.push(item('加入待办', `添加${what}`, () => void hooks.addTodo?.(pickText, messageId)));
      if (hooks.addFavorite) items.push(item('加入收藏', `收藏${what}`, () => void hooks.addFavorite?.(messageId, r?.selected ? pickText : undefined)));
    }
    if (r && !r.selected && r.source.kind === 'file' && hooks.reveal) {
      const relPath = r.source.path;
      items.push(item('在资源管理器中显示', '', () => void hooks.reveal?.(relPath)));
    }
    if (r?.selected) items.push(item('复制', '', () => void navigator.clipboard.writeText(r.selected).catch(() => undefined)));
    menu.replaceChildren(...items);
    menu.hidden = false;
    const { innerWidth: W, innerHeight: H } = window;
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(ev.clientX, W - rect.width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(ev.clientY, H - rect.height - 4))}px`;
    (menu.querySelector('.mi') as HTMLElement | null)?.focus();
  });
  document.addEventListener('mousedown', (ev) => {
    if (!menu.hidden && !(ev.target instanceof Node && menu.contains(ev.target))) close();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') close();
  });
  window.addEventListener('blur', close);
  window.addEventListener('resize', close);
  document.addEventListener('wheel', close, { capture: true, passive: true });
}
