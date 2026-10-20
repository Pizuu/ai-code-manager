/**
 * 工作台外框（FR-101–FR-103，ADR 0005）：图标栏 .rail、项目栏 .explorer、页头 .wh、状态栏 .status，
 * DOM 结构与类名逐一对应 HTML 原型的 rail() / explorer() / header() / statusbar()。三个导航项 = 三个板块。
 */
import type { FileNode } from '../../../contracts/ipc.ts';
import { api, errorText } from '../api.ts';
import { ymdhm } from '../lib/board-format.ts';
import { clear, h } from '../lib/dom.ts';
import { icon, type IconName } from '../lib/icons.ts';
import { store, type ViewId } from '../store.ts';

export const VIEW_TITLES: Readonly<Record<ViewId, string>> = { board: '泳道看板', session: '任务会话', git: 'Git 分支与集成' };
const NAV: ReadonlyArray<[ViewId, string, IconName]> = [['board', '泳道看板', 'list'], ['session', '任务会话', 'sess'], ['git', 'Git 与集成', 'git']];
/** 原型 treeHtml 中展开显示子项的目录。 */
const EXPAND: ReadonlySet<string> = new Set(['.agents', '.specify', 'src', 'specs', 'contracts']);

export interface ShellHooks {
  onNewSession(): void;
  onOpenSettings(): void;
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
  const policyFiles = h('div', { class: 'mono files' });
  const policy = h('div', { class: 'policy' },
    h('div', { class: 'h' }, icon('lock'), h('span', {}, '共享热点仅 Coordinator 修改')),
    policyFiles,
    h('div', { class: 'mt4' }, '只能由 coordinator 在 int/* 分支上修改（lanes.conf @shared）'));
  const explorer = h('aside', { class: 'explorer' }, psel, navloc, nav, h('div', { class: 'exh' }, h('span', {}, '项目结构'), readRef), tree, policy);

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
  const statusR = h('span');
  const status = h('footer', { class: 'status' }, statusL, statusR);
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
    crumbFeature.textContent = f ? `${f.id}${f.title ? ` · ${f.title}` : ''}` : '—';
    crumbChip.textContent = g?.available ? (g.remotes.length ? `远端 ${g.remotes.join(',')}` : '本地仓库') : '非 Git 仓库';
    snapTime.textContent = b ? `快照 · ${ymdhm(b.generatedAt)}（本地时间）` : '快照 · —';
    snapTime.title = b?.generatedAt ?? '';
    readRef.textContent = b?.integrationBranch ?? g?.integrationBranch ?? '';
    clear(policyFiles);
    policyFiles.textContent = b?.shared.length ? b.shared.join('、') : '未配置 .agents/lanes.conf';
    if (g?.available) {
      statusL.replaceChildren(h('span', { class: 'dot grn' }), `本地工作区 ${g.currentBranch ?? ''}（${g.worktrees.length} 个 worktree · ${g.dirtyCount} 个未提交文件）`);
      statusR.textContent = `${g.remotes.length ? `远端 ${g.remotes.join(',')}` : '无 Git 远端'}\u3000·\u3000所有状态由 git 历史推导`;
    } else {
      statusL.replaceChildren(h('span', { class: 'dot' }), store.state.project ? (g?.reason ?? '读取中…') : '未打开项目');
      statusR.textContent = store.state.workspaceError ?? '';
    }
    renderProject();
  };

  const fileNodeEl = (n: FileNode, kid: boolean, label?: string) => {
    const auth = !kid && n.name === 'contracts';
    const tag = auth && store.state.board?.contractVersion ? h('span', { class: 'tag' }, ` ↗ 契约 ${store.state.board.contractVersion}`) : null;
    const el = h('div', { class: `te${kid ? ' kid' : ''}${auth ? ' auth' : ''}${n.kind === 'file' ? ' click' : ''}`, title: n.relPath },
      icon(n.kind === 'dir' ? 'dir' : 'file', 14), h('span', { class: 'nm' }, label ?? `${n.name}${n.kind === 'dir' ? '/' : ''}`), tag);
    if (n.kind === 'file') el.addEventListener('click', () => hooks.onFileClick(n.relPath));
    return el;
  };

  let treeToken = 0;
  const renderTree = async () => {
    const token = ++treeToken;
    if (!store.state.project) {
      tree.replaceChildren(h('div', { class: 'mute pad8' }, '打开项目后显示目录结构。'));
      return;
    }
    try {
      // 原型按 git ls-tree 的名称顺序（目录与文件混排）
      const byName = (a: FileNode, b: FileNode) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
      const top = (await api.invoke('fs:tree', '')).sort(byName);
      const rows: HTMLElement[] = [];
      for (const n of top) {
        rows.push(fileNodeEl(n, false));
        if (n.kind === 'dir' && EXPAND.has(n.name)) {
          const kids = (await api.invoke('fs:tree', n.relPath)).sort(byName);
          // 原型：子项两两一行，以「 · 」连接
          for (let i = 0; i < kids.length; i += 2) {
            const pair = kids.slice(i, i + 2);
            const first = pair[0] as FileNode;
            rows.push(fileNodeEl(first, true, pair.map((k) => `${k.name}${k.kind === 'dir' ? '/' : ''}`).join(' · ')));
          }
        }
      }
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
    renderChrome();
    void renderTree();
    void refreshWorkspace();
  });
  renderChrome();
  void renderTree();
  return { views, setView, refreshWorkspace };
}
