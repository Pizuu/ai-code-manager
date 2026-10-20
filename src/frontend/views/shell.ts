/**
 * 工作台外框（FR-101–FR-103，ADR 0005）：图标栏 .rail、项目栏 .explorer、页头 .wh、状态栏 .status，
 * DOM 结构与类名逐一对应 HTML 原型的 rail() / explorer() / header() / statusbar()。三个导航项 = 三个板块。
 */
import type { FileNode } from '../../../contracts/ipc.ts';
import { api, errorText } from '../api.ts';
import { ymdhm } from '../lib/board-format.ts';
import { sendAttrs } from '../lib/context-send.ts';
import { clear, h } from '../lib/dom.ts';
import { icon, type IconName } from '../lib/icons.ts';
import { store, type ViewId } from '../store.ts';

export const VIEW_TITLES: Readonly<Record<ViewId, string>> = { board: '泳道看板', session: '任务会话', git: 'Git 分支与集成' };
const NAV: ReadonlyArray<[ViewId, string, IconName]> = [['board', '泳道看板', 'list'], ['session', '任务会话', 'sess'], ['git', 'Git 与集成', 'git']];
/** 默认展开的顶层目录（原型 treeHtml）；之后由用户点击目录折叠 / 展开。 */
const EXPAND: readonly string[] = ['.agents', '.specify', 'src', 'specs', 'contracts'];
/** 整棵目录树折叠状态（仅本机界面偏好）。 */
const TREE_COLLAPSED_KEY = 'acm.explorer.treeCollapsed';

export interface ShellHooks {
  onNewSession(): void;
  onOpenSettings(): void;
  /** 单击文件：在任务会话中列打开只读代码标签（003）。 */
  onFileClick(relPath: string): void;
  onError(text: string): void;
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
  const railBtn = (name: IconName, title: string, onClick: () => void) => h('a', { class: 'ri', title, on: { click: onClick } }, icon(name));
  const rail = h('nav', { class: 'rail' },
    railBtn('side', '侧栏', () => explorer.toggleAttribute('hidden')),
    h('div', { class: 'gap26' }),
    railBtn('plus', '新建会话', () => hooks.onNewSession()),
    railBtn('chat', '任务会话', () => setView('session')),
    railBtn('box', '打开项目文件夹', () => void pickProject()),
    railBtn('grid', '泳道看板', () => setView('board')),
    railBtn('code', 'Git 与集成', () => setView('git')),
    h('div', { class: 'sp' }),
    h('a', { class: 'ri', title: '设置', on: { click: () => hooks.onOpenSettings() } }, icon('gear')),
    h('div', { class: 'av', title: 'Owner（人类，未署名）' }, icon('grid', 14)),
  );

  // ── explorer（原型 explorer()）──
  const badge = h('div', { class: 'mono-badge' });
  const pname = h('b');
  const pdesc = h('span');
  const psel = h('div', { class: 'psel', title: '切换项目文件夹', on: { click: () => void pickProject() } },
    badge, h('div', { class: 'pid' }, pname, pdesc), h('span', { class: 'mute' }, icon('caret')));
  const navloc = h('div', { class: 'navloc' });
  const navItems = {} as Record<ViewId, HTMLAnchorElement>;
  const nav = h('div', { class: 'nav' });
  for (const [id, label, ic] of NAV) {
    navItems[id] = h('a', { on: { click: () => setView(id) } }, icon(ic), h('span', {}, label));
    nav.append(navItems[id]);
  }
  const readRef = h('span', { class: 'mono' });
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
  const explorer = h('aside', { class: 'explorer' }, psel, navloc, nav, h('div', { class: 'exh' }, exToggle, readRef, moreBtn), tree);

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

  // ── workspace header（原型 header()）──
  const crumbProject = h('span');
  const crumbFeature = h('b');
  const crumbChip = h('span', { class: 'chip' });
  const sub = h('div', { class: 'sub' });
  const snapTime = h('span');
  const refreshBtn = h('button', { class: 'btn', on: { click: () => void refreshWorkspace() } }, '刷新快照');
  const header = h('header', { class: 'wh' },
    h('div', {}, h('div', { class: 'crumb' }, icon('box', 16), crumbProject, '/', crumbFeature, crumbChip), sub),
    h('div', { class: 'wact' }, snapTime, h('span', { class: 'chip', title: 'multi-agent.md：负责人 Owner = 人类；仓库未登记姓名' }, 'Owner · 人类（未署名）'), refreshBtn));

  const views: Record<ViewId, HTMLElement> = {
    board: h('div', { class: 'ws-view wb', attrs: { id: 'wb-board' } }),
    session: h('div', { class: 'ws-view sess', attrs: { id: 'wb-session' } }),
    git: h('div', { class: 'ws-view wb', attrs: { id: 'wb-git' } }),
  };
  const statusL = h('span');
  const status = h('footer', { class: 'status' }, statusL);
  const ws = h('main', { class: 'ws' }, header, views.board, views.session, views.git, status);
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
    crumbChip.textContent = g?.available ? (g.remotes.length ? `远端 ${g.remotes.join(',')}` : '本地仓库') : '非 Git 仓库';
    snapTime.textContent = b ? `快照 · ${ymdhm(b.generatedAt)}（本地时间）` : '快照 · —';
    snapTime.title = b?.generatedAt ?? '';
    readRef.textContent = b?.integrationBranch ?? g?.integrationBranch ?? '';
    if (g?.available) {
      statusL.replaceChildren(h('span', { class: 'dot grn' }), `本地工作区 ${g.currentBranch ?? ''}（${g.worktrees.length} 个 worktree · ${g.dirtyCount} 个未提交文件）`);
    } else {
      statusL.replaceChildren(h('span', { class: 'dot' }), store.state.project ? (store.state.workspaceError ?? g?.reason ?? '读取中…') : '未打开项目');
    }
    renderProject();
  };

  const nodeAttrs = (n: FileNode) => sendAttrs({ kind: 'file', path: n.relPath, dir: n.kind === 'dir' });
  /** 展开的目录（relPath）；目录单击折叠 / 展开，子项按需读取并缓存。 */
  const expanded = new Set<string>(EXPAND);
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
    }
    navloc.textContent = `当前 · ${VIEW_TITLES[v]}`;
    sub.textContent = VIEW_TITLES[v];
    store.emit('view');
    if (v !== 'session' && !store.state.board) void refreshWorkspace();
  };

  let loading: Promise<void> | null = null;
  const refreshWorkspace = async (): Promise<void> => {
    if (loading) return loading;
    loading = (async () => {
      refreshBtn.disabled = true;
      try {
        const [board, git] = await Promise.all([api.invoke('board:get'), api.invoke('git:get')]);
        store.state.board = board;
        store.state.git = git;
        store.state.workspaceError = null;
      } catch (e) {
        store.state.workspaceError = errorText(e);
        hooks.onError(errorText(e));
      } finally {
        refreshBtn.disabled = false;
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
  store.on('project', () => {
    kidsCache.clear();
    expanded.clear();
    for (const d of EXPAND) expanded.add(d);
    renderChrome();
    void renderTree();
    void refreshWorkspace();
  });
  renderChrome();
  void renderTree();
  return { views, setView, refreshWorkspace };
}
