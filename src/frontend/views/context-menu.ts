/**
 * 全局右键菜单（FR-304，ADR 0008，contracts/ui.ts）：应用任意位置右键 →「发送到任务会话」/「复制」。
 * 来源优先级：代码查看器选区 → 任意选中文本 → 最近的 data-send-* 元素（代码行 / 文件 / 任务卡 / 提交 / 分支）。
 * 无可发送内容时不拦截（保留默认行为）。只组装文本并交给 hooks.send，不自动发送。
 */
import type { SendSource } from '../../../contracts/ui.ts';
import { SEND_ATTR, SEND_TO_SESSION_LABEL } from '../../../contracts/ui.ts';
import { describeSource, formatSendText, sourceFromAttrs } from '../lib/context-send.ts';
import { h } from '../lib/dom.ts';

export interface ContextMenuHooks {
  /** 把格式化后的文本插入任务会话输入框并切到任务会话。 */
  send(text: string): void;
  /** 元素所在区域的中文名（用于选中文本的来源标注）。 */
  originOf(el: Element): string;
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
    if (!r) {
      close();
      return;
    }
    ev.preventDefault();
    const text = formatSendText(r.source);
    const item = (label: string, sub: string, fn: () => void) => h('button', { class: 'mi', attrs: { type: 'button', role: 'menuitem' }, on: { click: () => { close(); fn(); } } }, h('span', {}, label), sub ? h('span', { class: 'mute' }, sub) : null);
    const items: HTMLElement[] = [item(SEND_TO_SESSION_LABEL, describeSource(r.source), () => hooks.send(text))];
    if (r.selected) items.push(item('复制', '', () => void navigator.clipboard.writeText(r.selected).catch(() => undefined)));
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
