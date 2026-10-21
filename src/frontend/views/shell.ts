/**
 * 工作台外框（FR-101–FR-103，ADR 0005）：图标栏 .rail、项目栏 .explorer、页头 .wh、状态栏 .status，
 * DOM 结构与类名逐一对应 HTML 原型的 rail() / explorer() / header() / statusbar()。三个导航项 = 三个板块。
 */
import type { FileNode } from '../../../contracts/ipc.ts';
import { api, errorText } from '../api.ts';
import { sendAttrs } from '../lib/context-send.ts';
import { clear, h } from '../lib/dom.ts';
import { icon, type IconName } from '../lib/icons.ts';
import { activityLabels, activityTarget, activityTotal, sessionActivity, type ActivityKind } from '../lib/session-activity.ts';
import { store, type ViewId } from '../store.ts';

export const VIEW_TITLES: Readonly<Record<ViewId, string>> = { board: '泳道看板', session: '任务会话', git: 'Git 分支与集成', agents: 'Agents' };
/** 导航项：[板块, 名称, 图标, 父板块]。有父板块的项在项目栏缩进显示为其子入口（T-040）。 */
const NAV: ReadonlyArray<readonly [ViewId, string, IconName, ViewId?]> = [['board', '泳道看板', 'list'], ['session', '任务会话', 'sess'], ['git', 'Git', 'git'], ['agents', 'Agents', 'wt']];
/** 文件树默认全部折叠（用户要求）：只显示第一层，目录由用户点击逐个展开 / 折叠。 */
/** 整棵目录树折叠状态（仅本机界面偏好）。 */
const TREE_COLLAPSED_KEY = 'acm.explorer.treeCollapsed';

export interface ShellHooks {
  onNewSession(): void;
  onOpenSettings(): void;
  /** 单击文件：在任务会话中列打开只读代码标签（003）。 */
  onFileClick(relPath: string): void;
  onError(text: string): void;
  /** P0-3：点击活动徽标 / 状态栏计数时跳转到指定会话。 */
  onJumpToSession(sessionId: string): void;
}

export interface ShellView {
  /** 三个板块的内容容器。 */
  views: Record<ViewId, HTMLElement>;
  setView(v: ViewId): void;
  refreshWorkspace(): Promise<void>;
}

function monogram(name: string): string {
  return ((name.match(/[A-Za-z]/g) ?? ['P']).slice(0, 2).join('') || 'P').toUpperCase();
}

export function mountShell(app: HTMLElement, hooks: ShellHooks): ShellView {
  clear(app);
  app.className = 'app';

  // ── rail（原型 rail()）──
  // 板块图标与项目栏导航同序（泳道看板 → 任务会话 → Git 与集成，T-039）；切换项目入口在项目选择器与 ⋯ 菜单
  const railView = {} as Record<ViewId, HTMLAnchorElement>;
  const railBtn = (name: IconName, title: string, onClick: () => void) => h('a', { class: 'ri', title, on: { click: onClick } }, icon(name));
  const RAIL_ICON: Readonly<Record<ViewId, IconName>> = { board: 'grid', session: 'chat', git: 'code', agents: 'wt' };
  for (const [id, label] of NAV) railView[id] = railBtn(RAIL_ICON[id], label, () => setView(id));
  // P0-3：任务会话图标上的活动徽标（运行中 / 待批准 / 出错）
  const railBadge = h('span', { class: 'ri-badge', attrs: { hidden: '' } });
  railBadge.hidden = true;
  railView.session.append(railBadge);
  const rail = h('nav', { class: 'rail' },
    railBtn('side', '侧栏', () => explorer.toggleAttribute('hidden')),
    h('div', { class: 'gap26' }),
    ...NAV.map(([id]) => railView[id]),
    h('div', { class: 'sp' }),
    h('a', { class: 'ri', title: '设置', on: { click: () => hooks.onOpenSettings() } }, icon('gear')),
  );

  // ── explorer（原型 explorer()）──
  const badge = h('div', { class: 'mono-badge' });
  const pname = h('b');
  const pdesc = h('span');
  // 点击打开文件夹作为工程根目录（pickProject 在后段定义，闭包引用）
  const psel = h('div', { class: 'psel', title: '点击打开文件夹作为工程根目录', attrs: { role: 'button', tabindex: '0' }, on: { click: () => void pickProject(), keydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); void pickProject(); } } } },
    badge, h('div', { class: 'pid' }, pname, pdesc), h('span', { class: 'mute' }, icon('caret')));
  const navloc = h('div', { class: 'navloc' });
  const navItems = {} as Record<ViewId, HTMLAnchorElement>;
  const nav = h('div', { class: 'nav' });
  for (const [id, label, ic, parent] of NAV) {
    navItems[id] = h('a', { class: parent ? 'sub' : '', title: parent ? `${VIEW_TITLES[parent]} › ${label}` : label, on: { click: () => setView(id) } }, icon(ic), h('span', {}, label));
    nav.append(navItems[id]);
  }
  const readRef = h('span', { class: 'mono' });
  /** 当前分支名旁的切换指示（caret）；无 Git 快照 / 无分支时隐藏，菜单逻辑在下方分支下拉一节。 */
  const brCaret = h('span', { class: 'br-caret', title: '切换分支' }, icon('caret', 12));
  brCaret.hidden = true;
  const tree = h('div', { class: 'tree' });
  tree.hidden = localStorage.getItem(TREE_COLLAPSED_KEY) === '1';
  const exToggle = h('button', { class: `exh-t${tree.hidden ? '' : ' open'}`, title: '折叠 / 展开项目结构', attrs: { type: 'button', 'aria-expanded': String(!tree.hidden) } }, icon('caret', 12), h('span', {}, '项目结构'));
  exToggle.addEventListener('click', () => {
    tree.hidden = !tree.hidden;
    exToggle.classList.toggle('open', !tree.hidden);
    exToggle.setAttribute('aria-expanded', String(!tree.hidden));
    localStorage.setItem(TREE_COLLAPSED_KEY, tree.hidden ? '1' : '0');
  });
  const moreBtn = h('button', { class: 'exh-more', title: '更多操作', attrs: { type: 'button', 'aria-haspopup': 'menu' } }, icon('more', 14));
  const explorer = h('aside', { class: 'explorer' }, psel, navloc, nav, h('div', { class: 'exh' }, exToggle, readRef, brCaret, moreBtn), tree);

  // 「⋯」菜单：当前只支持单项目根（无多文件夹工作区），「打开文件夹」= 切换项目（project:pick）
  const exMenu = h('div', { class: 'ctxmenu exmenu', attrs: { role: 'menu' } });
  exMenu.hidden = true;
  document.body.append(exMenu);
  const menuItem = (label: string, run: () => void) => h('button', { class: 'mi', attrs: { type: 'button', role: 'menuitem' }, on: { click: () => { exMenu.hidden = true; run(); } } }, h('span', {}, label));
  moreBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (!exMenu.hidden) { exMenu.hidden = true; return; }
    exMenu.replaceChildren(
      menuItem('打开文件夹…（切换项目）', () => void pickProject()),
      menuItem('刷新目录', () => { kidsCache.clear(); void renderTree(); }),
      menuItem('全部折叠', () => { expanded.clear(); void renderTree(); }));
    const r = moreBtn.getBoundingClientRect();
    exMenu.hidden = false;
    exMenu.style.left = `${Math.max(8, r.right - exMenu.offsetWidth)}px`;
    exMenu.style.top = `${r.bottom + 4}px`;
  });
  document.addEventListener('click', (ev) => { if (!exMenu.hidden && !exMenu.contains(ev.target as Node)) exMenu.hidden = true; });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') exMenu.hidden = true; });

  // ── 分支下拉：点击当前分支名（readRef / caret）展开本地分支列表，选中走 git:checkout 切换并全量同步 ──
  const brMenu = h('div', { class: 'ctxmenu brmenu', attrs: { role: 'menu' } });
  brMenu.hidden = true;
  document.body.append(brMenu);
  const closeBrMenu = () => { brMenu.hidden = true; };
  const checkoutBranch = async (branch: string) => {
    try {
      store.state.git = await api.invoke('git:checkout', branch);
      // 全局同步：目录树缓存失效重读 + refreshWorkspace 重拉 board/git 并 emit('workspace')（页头、状态栏、各视图随之更新）
      kidsCache.clear();
      void renderTree();
      await refreshWorkspace();
      hooks.onError(`已切换到分支「${branch}」。`);
    } catch (e) {
      hooks.onError(errorText(e));
    }
  };
  const toggleBrMenu = (ev: Event) => {
    ev.stopPropagation();
    const g = store.state.git;
    if (!g?.available || g.branches.length === 0) return;
    if (!brMenu.hidden) { closeBrMenu(); return; }
    exMenu.hidden = true;
    closeFeatMenu();
    brMenu.replaceChildren(...g.branches.map((b) => h('button', {
      class: `mi${b.current ? ' on' : ''}`,
      attrs: { type: 'button', role: 'menuitem', ...(b.current ? { disabled: '' } : {}) },
      on: { click: () => { closeBrMenu(); void checkoutBranch(b.name); } },
    }, h('span', {}, b.current ? `✓ ${b.name}` : b.name))));
    const r = readRef.getBoundingClientRect();
    brMenu.hidden = false;
    brMenu.style.left = `${Math.max(8, r.right - brMenu.offsetWidth)}px`;
    brMenu.style.top = `${r.bottom + 4}px`;
  };
  readRef.title = '切换分支';
  readRef.addEventListener('click', toggleBrMenu);
  brCaret.addEventListener('click', toggleBrMenu);
  document.addEventListener('click', (ev) => { if (!brMenu.hidden && !brMenu.contains(ev.target as Node)) closeBrMenu(); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeBrMenu(); });

  // ── workspace header（原型 header()）──
  const crumbProject = h('span');
  const crumbFeature = h('b');
  /** 规格名旁的切换指示（caret）；可选规格不足 2 个时隐藏，菜单逻辑在下方功能下拉一节。 */
  const featCaret = h('span', { class: 'feat-caret', title: '切换功能规格' }, icon('caret', 12));
  featCaret.hidden = true;
  const crumbChip = h('span', { class: 'chip' });
  const header = h('header', { class: 'wh' },
    h('div', {}, h('div', { class: 'crumb' }, icon('box', 16), crumbProject, h('span', { class: 'crumb-sep', attrs: { 'aria-hidden': 'true' } }, '/'), crumbFeature, featCaret, crumbChip)),
    h('div', { class: 'wact' }));

  // ── 功能下拉：点击面包屑规格名（crumbFeature / caret）展开规格列表，选中走 board:setFeature 切换并全量同步 ──
  const featMenu = h('div', { class: 'ctxmenu featmenu', attrs: { role: 'menu' } });
  featMenu.hidden = true;
  document.body.append(featMenu);
  const closeFeatMenu = () => { featMenu.hidden = true; };
  const selectFeature = async (featureId: string | null) => {
    try {
      store.state.board = await api.invoke('board:setFeature', { featureId });
      // 全局同步：emit('workspace') 后页头（面包屑 / 快照时间）、状态栏与看板（.fo 标题、阶段、tasks 计数读 snap.feature）随返回快照重渲；
      // setFeature 已返回完整新快照，不再叠加 refreshWorkspace 重拉（与 git:checkout 不同，那里看板数据还需按新分支重新推导）
      store.emit('workspace');
      hooks.onError(featureId ? `已切换到功能「${featureId}」。` : '已切换为自动选择最新功能。');
    } catch (e) {
      hooks.onError(errorText(e));
    }
  };
  const toggleFeatMenu = (ev: Event) => {
    ev.stopPropagation();
    const b = store.state.board;
    const features = b?.features ?? [];
    if (!b || features.length <= 1) return;
    if (!featMenu.hidden) { closeFeatMenu(); return; }
    exMenu.hidden = true;
    closeBrMenu();
    const curId = b.feature?.id ?? null;
    const latest = features.at(-1);
    // 快照不区分「显式选了最新规格」与「自动（最新）」：当前规格即最新一项时 ✓ 落在底部「自动（最新）」行，
    // 最新规格行本身仍可点击（显式钉住该规格，语义与自动不同但当前快照表现一致）
    const autoOn = curId !== null && curId === latest?.id;
    const featItem = (label: string, sub: string, on: boolean, run: () => void) => h('button', {
      class: `mi${on ? ' on' : ''}`,
      attrs: { type: 'button', role: 'menuitem', ...(on ? { disabled: '' } : {}) },
      on: { click: () => { closeFeatMenu(); run(); } },
    }, h('span', {}, on ? `✓ ${label}` : label), h('span', { class: 'mute' }, sub));
    featMenu.replaceChildren(
      ...features.map((ft) => featItem(ft.id, ft.title, !autoOn && ft.id === curId, () => void selectFeature(ft.id))),
      featItem('自动（最新）', latest ? `${latest.id}${latest.title ? ` · ${latest.title}` : ''}` : '', autoOn, () => void selectFeature(null)));
    const r = crumbFeature.getBoundingClientRect();
    featMenu.hidden = false;
    featMenu.style.left = `${Math.max(8, r.right - featMenu.offsetWidth)}px`;
    featMenu.style.top = `${r.bottom + 4}px`;
  };
  crumbFeature.addEventListener('click', toggleFeatMenu);
  featCaret.addEventListener('click', toggleFeatMenu);
  document.addEventListener('click', (ev) => { if (!featMenu.hidden && !featMenu.contains(ev.target as Node)) closeFeatMenu(); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeFeatMenu(); });

  const views: Record<ViewId, HTMLElement> = {
    board: h('div', { class: 'ws-view wb', attrs: { id: 'wb-board' } }),
    session: h('div', { class: 'ws-view sess', attrs: { id: 'wb-session' } }),
    git: h('div', { class: 'ws-view wb', attrs: { id: 'wb-git' } }),
    agents: h('div', { class: 'ws-view wb', attrs: { id: 'wb-agents' } }),
  };
  const statusL = h('span');
  /** Git 视图时显示的集成摘要（原 Git 顶部说明行，T-039）。 */
  const statusR = h('span', { class: 'st-r' });
  /** P0-3：活动计数（运行中 / 待批准 / 错误），可点击跳转到对应会话。 */
  const statusAct = h('span', { class: 'st-act' });
  /** 规格进度行（原看板 .prog 移入）：状态栏最右端常驻，类名沿用 .prog，布局覆盖在 styles.css 的 .status .prog。 */
  const statusProg = h('span', { class: 'prog' });
  const status = h('footer', { class: 'status' }, statusL, statusAct, statusR, statusProg);
  const ws = h('main', { class: 'ws' }, header, views.board, views.session, views.git, views.agents, status);
  app.append(rail, explorer, ws);

  // ── 渲染 ──
  const renderProject = () => {
    const p = store.state.project;
    const pkgDesc = store.state.board?.feature?.title ?? '';
    badge.textContent = monogram(p?.name ?? '');
    pname.textContent = p?.name ?? '未打开项目';
    pdesc.textContent = p ? p.root : '点击选择项目文件夹';
    pdesc.title = p ? p.root : '';
    crumbProject.textContent = p?.name ?? '未打开项目';
    void pkgDesc;
  };

  const renderChrome = () => {
    const b = store.state.board;
    const g = store.state.git;
    const f = b?.feature;
    crumbFeature.textContent = f ? f.id : '—';
    crumbFeature.title = f ? `${f.id}${f.title ? ` · ${f.title}` : ''}` : '';
    const canSwitchFeature = (b?.features.length ?? 0) > 1;
    featCaret.hidden = !canSwitchFeature;
    crumbFeature.classList.toggle('feat-on', canSwitchFeature);
    const crumbBranch = g?.currentBranch ?? b?.integrationBranch ?? g?.integrationBranch ?? '';
    crumbChip.textContent = crumbBranch;
    crumbChip.hidden = crumbBranch === '';
    readRef.textContent = g?.currentBranch ?? '';
    const canSwitchBranch = Boolean(g?.available && g.branches.length > 0);
    brCaret.hidden = !canSwitchBranch;
    readRef.classList.toggle('br-on', canSwitchBranch);
    if (g?.available) {
      statusL.replaceChildren(h('span', { class: 'dot grn' }), `本地工作区 ${g.currentBranch ?? ''}（${g.worktrees.length} 个 worktree · ${g.dirtyCount} 个未提交文件）`);
    } else {
      statusL.replaceChildren(h('span', { class: 'dot' }), store.state.project ? (store.state.workspaceError ?? g?.reason ?? '读取中…') : '未打开项目');
    }
    renderGitStatus();
    renderProg();
    renderActivity();
    renderProject();
  };

  /**
   * P0-3：活动计数（运行中 / 待批准 / 错误）——图标栏徽标 + 状态栏，点击直接跳到相关会话。
   * 目标会话由 activityTarget 决定；无目标时不跳转（保持原地）。
   */
  const renderActivity = () => {
    const cur = store.state.current;
    const toolCalls = (cur?.messages ?? []).flatMap((m) => m.toolCalls ?? []);
    const approvals = [...store.state.approvals.values()];
    const input = {
      running: store.state.running,
      pending: approvals.length,
      toolCalls,
      currentSessionId: cur?.id ?? null,
      approvalSessionIds: approvals.map((a) => a.sessionId),
    };
    const act = sessionActivity(input);
    // 图标栏徽标：总数
    const total = activityTotal(act);
    railBadge.hidden = total === 0;
    railBadge.textContent = total > 99 ? '99+' : String(total);
    railBadge.className = `ri-badge${act.errors ? ' err' : act.pending ? ' pend' : ''}`;
    railView.session.title = total
      ? `${VIEW_TITLES.session}：${activityLabels(act).join(' · ')}（点击查看）`
      : VIEW_TITLES.session;
    // 状态栏：分段可点击
    clear(statusAct);
    const seg = (kind: ActivityKind, label: string, n: number) => {
      if (!n) return;
      const target = activityTarget(kind, input);
      const el = h('span', { class: `act act-${kind}`, title: target ? `点击跳转到「${target}」` : '当前会话' }, label);
      if (target) {
        el.classList.add('clickable');
        el.addEventListener('click', () => hooks.onJumpToSession(target));
      }
      statusAct.append(el);
    };
    seg('running', `${act.running} 运行中`, act.running);
    seg('pending', `${act.pending} 待批准`, act.pending);
    seg('errors', `${act.errors} 错误`, act.errors);
  };

  /**
   * 规格进度行（原看板 .prog，本批移入状态栏右端常驻）：内容与推导口径与看板原实现逐字一致，
   * 数据取 store.state.board，随 renderChrome（workspace / project 事件）刷新；无看板数据时隐藏
   * （与原 .prog 的出现条件对齐：没打开项目时看板里也没有这一行）。
   */
  const renderProg = () => {
    const b = store.state.board;
    statusProg.hidden = !b;
    if (!b) return;
    const F = b.feature;
    const cards = b.cards;
    const integ = b.integrationBranch;
    const contractCard = cards.find((c) => c.lane === 'contracts' && c.status === 'merged') ?? cards.find((c) => c.lane === 'contracts');
    const frozen = contractCard?.status === 'merged';
    const stg = h('div', { class: 'stg' });
    for (const s of F?.stages ?? []) stg.append(h('span', { class: s.done ? 'ok' : '', title: s.detail }, `${s.label}${s.key === 'checklists' ? ` ${s.detail}` : ''} ${s.done ? '✓' : '○'}`));
    // 当前阶段由真实 stages 推导：第一个未完成的阶段；七步全完成 = 规格准备结束、已进入实施（Implement）；无 stages 回退 '—'
    const currentStage = (F?.stages ?? []).find((s) => !s.done)?.label ?? ((F?.stages ?? []).length ? 'Implement' : '—');
    statusProg.replaceChildren(
      icon('check'),
      h('span', {}, `契约 IPC ${b.contractVersion ?? '?'}${frozen ? ' 已冻结' : ' 未冻结'}`),
      h('span', { class: 'mute' }, contractCard ? `${contractCard.id} · ${contractCard.merge ? `merge ${contractCard.merge.short} 已合入 ${integ}` : '未合入'}` : ''),
      stg,
      h('span', { class: 'chip acc', title: 'specs tasks.md 勾选数' }, `当前：${currentStage} · tasks.md ${F?.tasksDone ?? 0}/${F?.tasksTotal ?? 0}`),
      h('span', { class: 'mute' }, '按序合入 → Converge'));
  };

  const renderGitStatus = () => {
    const g = store.state.git;
    statusR.hidden = store.state.view !== 'git' || !g?.available;
    if (!g?.available) return;
    const open = g.branches.filter((x) => x.kind !== 'main' && x.kind !== 'integration' && !x.mergedIntoIntegration).length;
    const f = store.state.board?.feature;
    statusR.textContent = `${f ? `${f.id} · ` : ''}${g.integrationBranch} 基线 ${g.integrationHead ?? '—'} · ${open} 未合入 · ${g.merges.length} 次合入`;
    statusR.title = `${f ? `${f.id} · ${f.title}\n` : ''}任务分支合入后已删除，以合并提交追溯`;
  };

  const nodeAttrs = (n: FileNode) => sendAttrs({ kind: 'file', path: n.relPath, dir: n.kind === 'dir' });
  /** 展开的目录（relPath），初始为空 = 全部折叠；目录单击折叠 / 展开，子项按需读取并缓存。 */
  const expanded = new Set<string>();
  const kidsCache = new Map<string, FileNode[]>();
  const fileNodeEl = (n: FileNode, depth: number) => {
    const dir = n.kind === 'dir';
    const auth = depth === 0 && n.name === 'contracts';
    const tag = auth && store.state.board?.contractVersion ? h('span', { class: 'tag' }, ` ↗ 契约 ${store.state.board.contractVersion}`) : null;
    const open = dir && expanded.has(n.relPath);
    const el = h('div', { class: `te click${auth ? ' auth' : ''}${dir ? ' dir' : ''}${open ? ' open' : ''}`, title: n.relPath, attrs: { ...nodeAttrs(n), ...(dir ? { 'aria-expanded': String(open) } : {}) } },
      dir ? h('span', { class: 'tw' }, icon('caret', 12)) : h('span', { class: 'tw' }),
      icon(dir ? 'dir' : 'file', 14), h('span', { class: 'nm' }, `${n.name}${dir ? '/' : ''}`), tag);
    el.style.paddingLeft = `${4 + depth * 14}px`;
    el.addEventListener('click', () => {
      if (!dir) return hooks.onFileClick(n.relPath);
      if (open) expanded.delete(n.relPath);
      else expanded.add(n.relPath);
      void renderTree();
    });
    return el;
  };

  // 按名称顺序（目录与文件混排，同 git ls-tree）
  const byName = (a: FileNode, b: FileNode) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const kidsOf = async (rel: string): Promise<FileNode[]> => {
    let k = kidsCache.get(rel);
    if (!k) {
      k = (await api.invoke('fs:tree', rel)).sort(byName);
      kidsCache.set(rel, k);
    }
    return k;
  };
  let treeToken = 0;
  const renderTree = async () => {
    const token = ++treeToken;
    if (!store.state.project) {
      tree.replaceChildren(h('div', { class: 'mute pad8' }, '打开项目后显示目录结构。'));
      return;
    }
    try {
      const rows: HTMLElement[] = [];
      const walk = async (rel: string, depth: number): Promise<void> => {
        for (const n of await kidsOf(rel)) {
          rows.push(fileNodeEl(n, depth));
          if (n.kind === 'dir' && expanded.has(n.relPath)) await walk(n.relPath, depth + 1);
        }
      };
      await walk('', 0);
      if (token === treeToken) tree.replaceChildren(...rows);
    } catch (e) {
      if (token === treeToken) tree.replaceChildren(h('div', { class: 'mute pad8' }, errorText(e)));
    }
  };

  const setView = (v: ViewId) => {
    store.state.view = v;
    for (const id of Object.keys(views) as ViewId[]) {
      views[id].hidden = id !== v;
      navItems[id].classList.toggle('on', id === v);
      // 子视图打开时父项保持「展开中」弱高亮
      navItems[id].classList.toggle('parent-on', NAV.some(([cid, , , p]) => cid === v && p === id));
      railView[id].classList.toggle('on', id === v);
    }
    navloc.textContent = `当前 · ${VIEW_TITLES[v]}`;
    renderGitStatus();
    store.emit('view');
    if (v !== 'session' && !store.state.board) void refreshWorkspace();
  };

  let loading: Promise<void> | null = null;
  const refreshWorkspace = async (): Promise<void> => {
    if (loading) return loading;
    loading = (async () => {
      try {
        const [board, git] = await Promise.all([api.invoke('board:get'), api.invoke('git:get')]);
        store.state.board = board;
        store.state.git = git;
        store.state.workspaceError = null;
      } catch (e) {
        store.state.workspaceError = errorText(e);
        hooks.onError(errorText(e));
      } finally {
        loading = null;
      }
      store.emit('workspace');
    })();
    return loading;
  };

  const pickProject = async () => {
    try {
      const info = await api.invoke('project:pick');
      if (info) {
        store.state.project = info;
        store.emit('project');
      }
    } catch (e) {
      hooks.onError(errorText(e));
    }
  };

  store.on('workspace', renderChrome);
  // P1-3：活动徽标 / 状态栏计数随运行态、审批与消息实时更新
  for (const t of ['running', 'approvals', 'current', 'messages'] as const) store.on(t, renderActivity);
  // P1-8：窗口获得焦点时刷新工作区快照（看板 / Git 可能已被外部改动）
  window.addEventListener('focus', () => void refreshWorkspace());
  store.on('project', () => {
    kidsCache.clear();
    // 打开 / 切换项目回到默认：全部折叠（展开状态不跨项目保留）
    expanded.clear();
    renderChrome();
    void renderTree();
    void refreshWorkspace();
  });
  renderChrome();
  void renderTree();
  return { views, setView, refreshWorkspace };
}
