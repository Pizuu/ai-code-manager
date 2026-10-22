/**
 * 软件快捷使用高亮步进器（第二十五批 #2）：三套快速教程对应 GitHub spec-kit 的规格驱动三流程
 * （Specify 定规格 → Plan & Tasks 做计划拆任务 → Implement 抓实施），每套在本应用真实界面上
 * 逐步高亮讲解：遮罩拦截点击、高亮目标元素、步进卡给标题/说明/上一步/下一步。
 * 纯前端演示层，不读写任何业务状态；切视图经 opts.navigate 由 shell 接线（setView）。
 */
import { h } from './dom.ts';
import { icon } from './icons.ts';

export interface TourStep {
  /** 目标元素的 CSS 选择器；找不到或不可见时该步只居中显示步进卡、不高亮（兜底不报错）。 */
  selector: string;
  /** 该步需要的视图；与当前步不同时先调 opts.navigate 切换并等一帧再定位。缺省沿用当前视图。 */
  view?: 'session' | 'board' | 'git' | 'agents';
  title: string;
  text: string;
}

export interface TourDef {
  id: string;
  name: string;
  desc: string;
  steps: TourStep[];
}

type TourView = NonNullable<TourStep['view']>;
export interface TourOpts {
  navigate?: (view: TourView) => void;
}

export const TOURS: TourDef[] = [
  {
    id: 'specify',
    name: '流程一 · 定规格 Specify',
    desc: '先把要做的事说清：宪法、规格、阶段进度',
    steps: [
      {
        selector: '.crumb',
        view: 'session',
        title: '规格就是工作单元',
        text: '顶栏面包屑显示当前项目与功能规格（001 / 002 / 003…），点规格名即可切换。spec-kit 的出发点：先把要做的事定成一份规格，后面的计划、任务、实现都以它为准。',
      },
      {
        selector: '.comp',
        view: 'session',
        title: '用 /init 与 /specify 定规格',
        text: '在任务会话输入框输入 /init，先生成项目宪法（原则与约定）；再输入 /specify 加需求描述，把想法写成 spec.md——只写做什么与为什么：用户故事、功能需求、成功标准都在这里定清。',
      },
      {
        selector: '.status .prog',
        title: '阶段进度一眼可见',
        text: '状态栏右端常驻当前功能的阶段进度：规格、计划、任务等产物逐项就绪，阶段随之向前推进——不用打开看板，也能随时掌握推进到哪一步。',
      },
    ],
  },
  {
    id: 'plan-tasks',
    name: '流程二 · 做计划 Plan & Tasks',
    desc: '把规格变成计划，再拆成可派工的任务卡',
    steps: [
      {
        selector: '.comp',
        view: 'session',
        title: '/plan 做计划 · /tasks 拆任务',
        text: '规格定稿后，在输入框输入 /plan：基于 spec.md 生成实施计划 plan.md（技术选型、结构、契约与宪法检查）。接着输入 /tasks：把计划拆成 tasks.md，一项任务一张卡，按用户故事分组、可并行的标 [P]，每张卡写明泳道与文件路径。',
      },
      {
        selector: '.cap',
        view: 'board',
        title: '看板总览与筛选',
        text: '看板顶栏汇总全板状态：工人容量、正在执行的任务、各状态计数；右侧可按关键字、泳道、执行者筛选。计划拆出来的任务卡，都在这里统一调度。',
      },
      {
        selector: '.matrix .card',
        view: 'board',
        title: '点卡片即派工',
        text: '矩阵按泳道成行、按状态成列呈现任务卡。点击任意卡片即跳到任务会话派工：已有对应会话直接打开，没有则新建并预填任务号与标题，上下文不丢失。',
      },
    ],
  },
  {
    id: 'implement',
    name: '流程三 · 抓实施 Implement',
    desc: '按任务动手实施，成果合入与复用',
    steps: [
      {
        selector: '.comp',
        view: 'session',
        title: '用 /implement 按任务实施',
        text: '在任务会话输入 /implement（可带任务号），agent 按 tasks.md 顺序逐项实现、完成一项勾选一项；写代码与跑验证都在当前会话里完成，进度与看板实时对齐。',
      },
      {
        selector: '.turn .acts',
        view: 'session',
        title: '回答四图标，成果随手收藏',
        text: '每个回答右上角有四个图标：复制全文、折叠/展开这一回合、重新回答、收藏标记。好答案随手收藏，会话列表上会显示该会话的收藏条数。',
      },
      {
        selector: '.gq',
        view: 'git',
        title: '合入队列按序合入',
        text: '实施完成的任务分支进入 Git 视图的合入队列：前置依赖未合入的会标明在等谁，按序合入集成分支后，其余分支会收到 rebase 通知——spec-kit 的闭环在这里收尾。',
      },
    ],
  },
];

/** 进行中的教程结束函数；一次只跑一个，新教程开始前先结束旧的。 */
let stopCurrent: (() => void) | null = null;

const nextFrame = (): Promise<void> => new Promise((resolve) => {
  requestAnimationFrame(() => window.setTimeout(resolve, 40));
});

function queryTarget(selector: string): HTMLElement | null {
  try {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? el : null;
  } catch {
    return null; // 选择器异常（如旧内核不支持的语法）按找不到处理，走居中兜底
  }
}

export function startTour(tour: TourDef, opts: TourOpts = {}): void {
  stopCurrent?.();
  if (!tour.steps.length) return;

  let idx = 0;
  let lastView: TourView | null = null;
  let hlEl: HTMLElement | null = null;
  let ended = false;

  const titleEl = h('div', { class: 'tour-title' });
  const textEl = h('div', { class: 'tour-text' });
  const progEl = h('span', { class: 'tour-prog' });
  const nameEl = h('span', { class: 'tour-name' }, tour.name);
  const prevBtn = h('button', { class: 'tour-btn', attrs: { type: 'button' }, on: { click: () => { if (idx > 0) { idx -= 1; void show(); } } } }, '上一步');
  const nextBtn = h('button', {
    class: 'tour-btn pri', attrs: { type: 'button' },
    on: {
      click: () => {
        if (idx >= tour.steps.length - 1) end();
        else { idx += 1; void show(); }
      },
    },
  }, '下一步');
  const card = h('div', { class: 'tour-card' },
    h('div', { class: 'tour-head' }, nameEl,
      h('button', { class: 'tour-x', title: '结束教程', attrs: { type: 'button' }, on: { click: () => end() } }, '×')),
    titleEl, textEl,
    h('div', { class: 'tour-foot' }, progEl, h('span', { class: 'tour-btns' }, prevBtn, nextBtn)));
  const mask = h('div', { class: 'tour-mask' });
  document.body.append(mask, card);

  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') end();
  };
  document.addEventListener('keydown', onKey);

  function end(): void {
    if (ended) return;
    ended = true;
    hlEl?.classList.remove('tour-hl');
    hlEl = null;
    mask.remove();
    card.remove();
    document.removeEventListener('keydown', onKey);
    if (stopCurrent === end) stopCurrent = null;
  }
  stopCurrent = end;

  const placeCard = (rect: DOMRect | null): void => {
    const w = card.offsetWidth || 320;
    const ch = card.offsetHeight || 160;
    if (!rect) { // 兜底：目标找不到/不可见时居中，无高亮
      card.style.left = `${Math.max(8, (window.innerWidth - w) / 2)}px`;
      card.style.top = `${Math.max(8, (window.innerHeight - ch) / 2)}px`;
      return;
    }
    const gap = 12;
    let top = rect.bottom + gap;
    if (top + ch > window.innerHeight - 8) top = rect.top - ch - gap;
    if (top < 8) top = Math.max(8, window.innerHeight - ch - 8);
    const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - w - 8));
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  };

  async function show(): Promise<void> {
    const step = tour.steps[idx];
    if (!step) return;
    titleEl.textContent = step.title;
    textEl.textContent = step.text;
    progEl.textContent = `第 ${idx + 1} / ${tour.steps.length} 步`;
    prevBtn.toggleAttribute('disabled', idx === 0);
    nextBtn.textContent = idx === tour.steps.length - 1 ? '完成' : '下一步';
    hlEl?.classList.remove('tour-hl');
    hlEl = null;
    if (step.view && step.view !== lastView) {
      lastView = step.view;
      opts.navigate?.(step.view);
      await nextFrame();
      if (ended) return;
    }
    const target = queryTarget(step.selector);
    if (!target) { placeCard(null); return; }
    target.scrollIntoView({ block: 'nearest' });
    await nextFrame(); // 等滚动/重排落定后再量位置
    if (ended) return;
    target.classList.add('tour-hl');
    hlEl = target;
    placeCard(target.getBoundingClientRect());
  }

  void show();
}

/**
 * 生成 rail 用的教程按钮（a.ri + route 图标）：点击弹出三套教程的选择菜单，点项即开教程。
 * 协调者接线：把返回的按钮挂到 shell 的 rail（nav.rail）里、设置齿轮按钮之上；
 * opts.navigate 传 shell 的 setView。菜单/教程均为 body 级浮层，挂载点不影响定位。
 */
export function mountTourButton(parent: HTMLElement, opts: TourOpts = {}): HTMLElement {
  let menu: HTMLElement | null = null;
  const closeMenu = (): void => {
    menu?.remove();
    menu = null;
    document.removeEventListener('pointerdown', onDocDown, true);
    document.removeEventListener('keydown', onDocKey, true);
  };
  const onDocDown = (ev: PointerEvent): void => {
    if (menu && !menu.contains(ev.target as Node) && ev.target !== btn && !btn.contains(ev.target as Node)) closeMenu();
  };
  const onDocKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') closeMenu();
  };
  const openMenu = (): void => {
    if (menu) { closeMenu(); return; }
    menu = h('div', { class: 'tour-menu' },
      ...TOURS.map((t) => h('button', {
        class: 'tour-mi', attrs: { type: 'button' },
        on: {
          click: () => {
            closeMenu();
            startTour(t, opts);
          },
        },
      },
      h('span', { class: 'tour-mi-name' }, t.name),
      h('span', { class: 'tour-mi-desc' }, `${t.desc} · 共 ${t.steps.length} 步`))));
    document.body.append(menu);
    const r = btn.getBoundingClientRect();
    const mw = menu.offsetWidth || 300;
    const mh = menu.offsetHeight || 180;
    menu.style.left = `${Math.min(r.right + 8, window.innerWidth - mw - 8)}px`;
    menu.style.top = `${Math.min(Math.max(8, r.top), Math.max(8, window.innerHeight - mh - 8))}px`;
    document.addEventListener('pointerdown', onDocDown, true);
    document.addEventListener('keydown', onDocKey, true);
  };
  const btn = h('a', {
    class: 'ri', title: '快速教程',
    on: {
      click: (ev: MouseEvent) => {
        ev.preventDefault();
        openMenu();
      },
    },
  }, icon('route'));
  parent.append(btn);
  return btn;
}
