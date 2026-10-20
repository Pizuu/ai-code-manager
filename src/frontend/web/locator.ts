/**
 * Web 预览「UI 定位」（FR-306，ADR 0008）：仅在 `npm run web` 中加载，不进 Electron 打包。
 * installSourceHook()：包装 createElement / createElementNS，按调用栈给元素写 data-src="文件:行"。
 * mountLocator()：右下角工具条开关；开启后悬停高亮，点击（捕获阶段拦截）显示源文件:行、CSS 选择器与祖先链，一键复制。
 */
import { LOCATOR_SRC_ATTR } from '../../../contracts/ui.ts';
import { copyText, cssPath, srcFromStack, type ElLike } from './locator-core.ts';

const UI_ATTR = 'data-locator-ui';

export function installSourceHook(): void {
  Error.stackTraceLimit = 50;
  const proto = Document.prototype;
  const origCreate = proto.createElement;
  const origCreateNS = proto.createElementNS;
  const tag = <T extends Element>(el: T): T => {
    const src = srcFromStack(new Error().stack ?? '');
    if (src) el.setAttribute(LOCATOR_SRC_ATTR, src);
    return el;
  };
  proto.createElement = function (this: Document, ...args: Parameters<Document['createElement']>) {
    return tag(origCreate.apply(this, args));
  } as Document['createElement'];
  proto.createElementNS = function (this: Document, ns: string | null, name: string, opts?: ElementCreationOptions) {
    return tag(origCreateNS.call(this, ns, name, opts));
  } as Document['createElementNS'];
}

function toElLike(el: Element): ElLike {
  const parent = el.parentElement;
  const same = parent ? [...parent.children].filter((c) => c.tagName === el.tagName) : [el];
  return {
    tag: el.tagName,
    id: el.id,
    classes: [...el.classList],
    nthOfType: same.indexOf(el) + 1,
    sameTypeCount: same.length,
    get parent() {
      return parent ? toElLike(parent) : null;
    },
  };
}

function srcChain(el: Element, max = 4): string[] {
  const out: string[] = [];
  for (let cur: Element | null = el; cur && out.length < max; cur = cur.parentElement) {
    const s = cur.getAttribute(LOCATOR_SRC_ATTR);
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

function mk<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ''): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = cls;
  el.setAttribute(UI_ATTR, '');
  if (text) el.textContent = text;
  return el;
}

export function mountLocator(): void {
  const box = mk('div', 'loc-box');
  const tip = mk('div', 'loc-tip');
  box.append(tip);
  box.hidden = true;
  const toggle = mk('button', 'loc-toggle', 'UI 定位');
  toggle.title = '开启后悬停高亮元素，点击查看源文件与选择器（Esc 退出）';
  const bar = mk('div', 'loc-bar');
  bar.append(mk('span', 'loc-chip', 'Web 预览 · 只读模拟'), toggle);
  const panel = mk('div', 'loc-panel');
  panel.hidden = true;
  document.body.append(box, panel, bar);

  let on = false;
  const isUi = (t: EventTarget | null) => t instanceof Element && t.closest(`[${UI_ATTR}]`) !== null;
  const setOn = (v: boolean) => {
    on = v;
    toggle.classList.toggle('on', v);
    toggle.textContent = v ? 'UI 定位：开（Esc 退出）' : 'UI 定位';
    document.documentElement.classList.toggle('loc-active', v);
    if (!v) box.hidden = true;
  };
  toggle.addEventListener('click', () => setOn(!on));

  const highlight = (el: Element) => {
    const r = el.getBoundingClientRect();
    box.hidden = false;
    box.style.left = `${r.left}px`;
    box.style.top = `${r.top}px`;
    box.style.width = `${r.width}px`;
    box.style.height = `${r.height}px`;
    const src = srcChain(el, 1)[0] ?? '未标记';
    tip.textContent = `${src}  ·  ${el.tagName.toLowerCase()}${el.classList.length ? `.${[...el.classList].slice(0, 2).join('.')}` : ''}  ${Math.round(r.width)}×${Math.round(r.height)}`;
    tip.classList.toggle('below', r.top < 26);
  };

  const show = (el: Element) => {
    const chain = srcChain(el);
    const selector = cssPath(toElLike(el));
    const text = copyText(chain[0] ?? null, selector);
    panel.replaceChildren();
    const row = (k: string, v: string) => {
      const r = mk('div', 'loc-row');
      r.append(mk('span', 'k', k), mk('code', 'v', v));
      return r;
    };
    const head = mk('div', 'loc-head');
    const close = mk('button', 'loc-x', '✕');
    close.addEventListener('click', () => {
      panel.hidden = true;
    });
    head.append(mk('b', '', '元素定位'), close);
    const copy = mk('button', 'loc-copy', '复制「文件:行 + 选择器」');
    const status = mk('span', 'loc-status');
    copy.addEventListener('click', () => {
      void navigator.clipboard.writeText(text).then(() => (status.textContent = '已复制'), () => (status.textContent = '复制失败，请手动选择'));
    });
    const actions = mk('div', 'loc-actions');
    actions.append(copy, status);
    panel.append(head,
      row('源文件', chain[0] ?? '未标记（不是由 src/frontend 创建的元素）'),
      row('选择器', selector),
      row('祖先链', chain.slice(1).join('\n') || '—'),
      row('复制内容', text),
      actions);
    panel.hidden = false;
  };

  const block = (ev: Event) => {
    if (!on || isUi(ev.target)) return;
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();
  };
  document.addEventListener('mousemove', (ev) => {
    if (!on || isUi(ev.target) || !(ev.target instanceof Element)) return;
    highlight(ev.target);
  }, true);
  for (const type of ['mousedown', 'mouseup', 'dblclick', 'contextmenu', 'auxclick'] as const) document.addEventListener(type, block, true);
  document.addEventListener('click', (ev) => {
    if (!on || isUi(ev.target)) return;
    block(ev);
    if (ev.target instanceof Element) show(ev.target);
  }, true);
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && on) setOn(false);
  });
  document.addEventListener('scroll', () => {
    if (on) box.hidden = true;
  }, true);
}
