/**
 * 极简 DOM 工厂。文本一律走 textContent；只有 setTrustedHtml 接受已转义的 HTML（来自 markdown.ts）。
 */

export type Child = Node | string | null | undefined | false;

export interface Props {
  class?: string;
  title?: string;
  attrs?: Record<string, string>;
  on?: Partial<{ [E in keyof HTMLElementEventMap]: (ev: HTMLElementEventMap[E]) => void }>;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.title) el.title = props.title;
  for (const [k, v] of Object.entries(props.attrs ?? {})) el.setAttribute(k, v);
  for (const [type, handler] of Object.entries(props.on ?? {})) {
    el.addEventListener(type, handler as EventListener);
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

export function clear(el: Element): void {
  el.replaceChildren();
}

/** 只用于 renderMarkdown 的输出：该函数先整体转义再生成白名单标签。 */
export function setTrustedHtml(el: Element, html: string): void {
  el.innerHTML = html;
}
