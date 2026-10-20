/**
 * Web 预览「UI 定位」与 UI 修改记录器（FR-306，ADR 0008）：仅在 `npm run web` 中加载，不进 Electron 打包。
 * installSourceHook()：包装 createElement / createElementNS，按调用栈给元素写 data-src="文件:行"。
 * mountLocator()：Alt+Q（或右下角「UI 定位」按钮）为唯一开关。开启后悬停高亮；点击（捕获阶段拦截）显示元素定位卡片，
 *   并在点击点右侧显示固定操作条（复制 / 修改 / 删除 + 备注）；右上角修改记录卡片可一键复制、单条删除；
 *   被记录元素在独立覆盖层上显示蓝 / 红临时边框与注释。原生 showModal 弹窗打开时，定位器节点挂入该弹窗以进入 Top Layer。
 */
import { LOCATOR_SRC_ATTR } from '../../../contracts/ui.ts';
import { icon } from '../lib/icons.ts';
import {
  clampBarPosition, copyText, cssPath, formatRecord, formatRecords, isToggleKey, markerLabel, srcFromStack,
  type ElLike, type RecordAction,
} from './locator-core.ts';

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
  if (el instanceof HTMLButtonElement) el.type = 'button';
  return el;
}

interface LocatorRecord {
  action: RecordAction;
  /** 未填写时为空字符串。 */
  note: string;
  /** 元素定位信息（「文件:行  选择器」）。 */
  selector: string;
  target: Element;
  marker: HTMLElement | null;
}

/** 当前选中元素（点击后）。 */
interface Picked {
  el: Element;
  text: string;
  x: number;
  y: number;
}

export function mountLocator(): void {
  // ── 悬停高亮 ──
  const box = mk('div', 'loc-box');
  const tip = mk('div', 'loc-tip');
  box.append(tip);
  // ── 右下角开关 ──
  const toggle = mk('button', 'loc-toggle', 'UI 定位');
  toggle.title = 'Alt+Q 开关：悬停高亮元素，点击查看源文件与选择器并记录修改';
  const bar = mk('div', 'loc-bar');
  bar.append(mk('span', 'loc-chip', 'Web 预览 · 只读模拟'), toggle);
  // ── 元素定位卡片（只展示信息） ──
  const panel = mk('div', 'loc-panel');
  // ── 固定操作条 ──
  const actionBar = mk('div', 'loc-action-bar');
  const actionRow = mk('div', 'loc-action-row');
  const btnCopy = mk('button', 'loc-act', '复制');
  const btnModify = mk('button', 'loc-act', '修改');
  const btnRemove = mk('button', 'loc-act', '删除');
  const actStatus = mk('span', 'loc-status');
  actionRow.append(btnCopy, btnModify, btnRemove, actStatus);
  const editor = mk('div', 'loc-editor');
  const noteInput = mk('input', 'loc-note');
  noteInput.type = 'text';
  noteInput.placeholder = '备注（可留空）';
  const btnSave = mk('button', 'loc-save', '保存');
  editor.append(noteInput, btnSave);
  actionBar.append(actionRow, editor);
  // ── 修改记录卡片 ──
  const recordPanel = mk('div', 'loc-panel loc-record-panel');
  const recHead = mk('div', 'loc-head');
  const recTitle = mk('b', '', '修改记录');
  const recStatus = mk('span', 'loc-status');
  const btnCopyAll = mk('button', 'loc-copy-all', '一键复制');
  const recRight = mk('div', 'loc-head-r');
  recRight.append(recStatus, btnCopyAll);
  recHead.append(recTitle, recRight);
  const recList = mk('div', 'loc-record-list');
  recordPanel.append(recHead, recList);
  // ── 临时标记覆盖层 ──
  const recordLayer = mk('div', 'loc-record-layer');

  const locatorElements: HTMLElement[] = [box, panel, recordPanel, bar, actionBar, recordLayer];
  for (const el of locatorElements) document.body.append(el);

  let on = false;
  let panelOpen = false;
  let barOpen = false;
  let editing: RecordAction | null = null;
  let picked: Picked | null = null;
  const records: LocatorRecord[] = [];

  const isUi = (t: EventTarget | null) => t instanceof Element && t.closest(`[${UI_ATTR}]`) !== null;
  const flash = (el: HTMLElement, text: string) => {
    el.textContent = text;
  };

  const sync = () => {
    box.hidden = !on || box.hidden;
    panel.hidden = !(on && panelOpen);
    actionBar.hidden = !(on && barOpen);
    recordPanel.hidden = !on;
    recordLayer.hidden = !on;
    editor.hidden = editing === null;
    btnModify.classList.toggle('on', editing === '修改');
    btnRemove.classList.toggle('on', editing === '删除');
  };

  const setOn = (v: boolean) => {
    on = v;
    toggle.classList.toggle('on', v);
    toggle.textContent = v ? 'UI 定位：开（Alt+Q）' : 'UI 定位';
    document.documentElement.classList.toggle('loc-active', v);
    if (!v) box.hidden = true;
    sync();
    if (v) {
      positionMarkers();
      if (picked && barOpen) requestAnimationFrame(() => positionActionBar());
    }
  };

  // ── 操作条定位 ──
  const positionActionBar = () => {
    if (!picked || actionBar.hidden) return;
    const r = actionBar.getBoundingClientRect();
    const { left, top } = clampBarPosition(picked.x, picked.y, r.width, r.height, window.innerWidth, window.innerHeight);
    actionBar.style.left = `${left}px`;
    actionBar.style.top = `${top}px`;
  };

  // ── 临时标记 ──
  const placeMarker = (rec: LocatorRecord) => {
    const m = rec.marker;
    if (!m) return;
    const r = rec.target.getBoundingClientRect();
    const gone = !rec.target.isConnected || (r.width === 0 && r.height === 0);
    m.hidden = gone;
    if (gone) return;
    m.style.left = `${r.left}px`;
    m.style.top = `${r.top}px`;
    m.style.width = `${r.width}px`;
    m.style.height = `${r.height}px`;
    m.classList.toggle('below', r.top < 24);
  };
  let rafPending = false;
  function positionMarkers(): void {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      for (const rec of records) placeMarker(rec);
    });
  }

  // ── 修改记录卡片 ──
  const renderRecords = () => {
    recTitle.textContent = records.length ? `修改记录（${records.length}）` : '修改记录';
    recList.replaceChildren();
    if (!records.length) {
      recList.append(mk('div', 'loc-empty', '暂无记录：点击元素后在操作条中选择「修改」或「删除」'));
      return;
    }
    records.forEach((rec, i) => {
      const row = mk('div', 'loc-record');
      const del = mk('button', 'loc-trash');
      del.title = '删除这条记录';
      del.setAttribute('aria-label', `删除第 ${i + 1} 条记录`);
      del.append(icon('box', 14));
      del.addEventListener('click', () => {
        records.splice(i, 1);
        rec.marker?.remove();
        renderRecords();
        recStatus.textContent = '';
      });
      const text = mk('code', `loc-record-text ${rec.action === '修改' ? 'modify' : 'remove'}`, formatRecord(i + 1, rec.action, rec.note, rec.selector));
      row.append(del, text);
      recList.append(row);
    });
  };

  const addRecord = (action: RecordAction, note: string) => {
    if (!picked) return;
    const marker = mk('div', `loc-record-marker ${action === '修改' ? 'modify' : 'remove'}`);
    marker.append(mk('span', 'loc-record-note', markerLabel(action, note)));
    recordLayer.append(marker);
    const rec: LocatorRecord = { action, note, selector: picked.text, target: picked.el, marker };
    records.push(rec);
    placeMarker(rec);
    renderRecords();
  };

  btnCopyAll.addEventListener('click', () => {
    if (!records.length) {
      flash(recStatus, '暂无记录');
      return;
    }
    void navigator.clipboard.writeText(formatRecords(records)).then(() => flash(recStatus, '已复制'), () => flash(recStatus, '复制失败'));
  });

  // ── 元素定位卡片 + 操作条 ──
  const show = (el: Element, x: number, y: number) => {
    const chain = srcChain(el);
    const selector = cssPath(toElLike(el));
    const text = copyText(chain[0] ?? null, selector);
    picked = { el, text, x, y };
    panel.replaceChildren();
    const row = (k: string, v: string) => {
      const r = mk('div', 'loc-row');
      r.append(mk('span', 'k', k), mk('code', 'v', v));
      return r;
    };
    const head = mk('div', 'loc-head');
    const close = mk('button', 'loc-x', '✕');
    close.title = '关闭定位卡片与操作条';
    close.addEventListener('click', () => {
      panelOpen = false;
      barOpen = false;
      editing = null;
      sync();
    });
    head.append(mk('b', '', '元素定位'), close);
    panel.append(head,
      row('源文件', chain[0] ?? '未标记（不是由 src/frontend 创建的元素）'),
      row('选择器', selector),
      row('祖先链', chain.slice(1).join('\n') || '—'),
      row('定位文本', text));
    panelOpen = true;
    barOpen = true;
    highlight(el);
    editing = null;
    noteInput.value = '';
    actStatus.textContent = '';
    sync();
    positionActionBar();
  };

  btnCopy.addEventListener('click', () => {
    if (!picked) return;
    void navigator.clipboard.writeText(picked.text).then(() => flash(actStatus, '已复制'), () => flash(actStatus, '复制失败'));
  });
  const openEditor = (action: RecordAction) => {
    editing = editing === action ? null : action;
    actStatus.textContent = '';
    sync();
    if (editing) {
      btnSave.textContent = `保存${action}`;
      noteInput.focus();
    }
    requestAnimationFrame(() => positionActionBar());
  };
  btnModify.addEventListener('click', () => openEditor('修改'));
  btnRemove.addEventListener('click', () => openEditor('删除'));
  const save = () => {
    if (!editing) return;
    addRecord(editing, noteInput.value.trim());
    editing = null;
    noteInput.value = '';
    flash(actStatus, '已记录');
    sync();
    requestAnimationFrame(() => positionActionBar());
  };
  btnSave.addEventListener('click', save);
  noteInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.isComposing) {
      ev.preventDefault();
      save();
    }
    ev.stopPropagation();
  });

  // ── 悬停 ──
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

  // ── 事件 ──
  toggle.addEventListener('click', () => setOn(!on));
  const block = (ev: Event) => {
    if (!on || isUi(ev.target)) return;
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();
  };
  document.addEventListener('mousemove', (ev) => {
    // 选中元素后暂停悬停高亮，高亮框停在已选元素上；关闭卡片后恢复。
    if (!on || barOpen || isUi(ev.target) || !(ev.target instanceof Element)) return;
    highlight(ev.target);
  }, true);
  for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'dblclick', 'contextmenu', 'auxclick'] as const) document.addEventListener(type, block, true);
  document.addEventListener('click', (ev) => {
    if (!on || isUi(ev.target)) return;
    block(ev);
    if (ev.target instanceof Element) show(ev.target, ev.clientX, ev.clientY);
  }, true);
  window.addEventListener('keydown', (ev) => {
    if (!isToggleKey(ev)) return;
    ev.preventDefault();
    ev.stopPropagation();
    setOn(!on);
  }, true);
  document.addEventListener('scroll', () => {
    if (!on) return;
    if (barOpen && picked?.el.isConnected) highlight(picked.el);
    else box.hidden = true;
    positionMarkers();
  }, true);
  window.addEventListener('resize', () => {
    if (!on) return;
    positionMarkers();
    positionActionBar();
  });

  // ── Top Layer：原生 modal dialog 打开时把定位器节点挂进去，关闭后回到 body ──
  const host = (): Element => {
    const modals = [...document.querySelectorAll('dialog')].filter((d) => d.open && d.matches(':modal'));
    return modals.at(-1) ?? document.body;
  };
  const mountAll = () => {
    const h = host();
    for (const el of locatorElements) if (el.parentElement !== h) h.append(el);
  };
  // 观察 open 属性与子节点：弹窗内容重绘（replaceChildren）会带走定位器节点，需要补回。
  new MutationObserver(mountAll).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['open'], childList: true });

  renderRecords();
  sync();
}
