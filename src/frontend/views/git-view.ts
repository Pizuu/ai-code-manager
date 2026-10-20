/**
 * Git 分支与集成板块（FR-107、FR-108，US3）：DOM 与类名对应 HTML 原型 gitBody()/graph()，
 * 数据来自 git:get（分支、提交图、合并记录、worktree）与 board:get（任务卡标题、泳道检查、集成队列）。
 * PR / CI / 审查者在本地仓库不可得，统一显示「暂无」。
 */
import type { BoardCard, GitSnapshot } from '../../../contracts/ipc.ts';
import { PR_LINE, STATUS_META, ymdhm } from '../lib/board-format.ts';
import { sendAttrs } from '../lib/context-send.ts';
import { clear, h } from '../lib/dom.ts';
import { fallbackColor, layoutGraphVertical } from '../lib/git-graph.ts';
import { icon, svgEl } from '../lib/icons.ts';
import { store } from '../store.ts';

export interface GitHooks {
  openBoard(): void;
  /** 打开「Worktree 与 Agent」视图（T-040 从本页拆出）。 */
  openAgents(): void;
  openProject(): void;
  notify(text: string): void;
}

function emptyState(title: string, text: string, action?: HTMLElement): HTMLElement {
  return h('div', { class: 'empty-state' }, h('b', {}, title), text, action ? h('div', {}, action) : null);
}

/** 选中的提交 / 分支（仅本机界面偏好，localStorage）。 */
const SEL_KEY = 'acm.git.selected';

interface GraphLink {
  /** 提交 sha → 下方列表中的分支键（PR 行 data-branch）。 */
  keyOf: Map<string, string>;
}

/** 竖向提交图 + 右侧信息行（1:1 对齐、同一滚动容器）。返回提交行与节点元素，供联动高亮。 */
function drawGraph(wrap: HTMLElement, g: GitSnapshot, link: GraphLink, onHover: (sha: string | null, scroll: boolean) => void, onPick: (sha: string) => void): void {
  const lay = layoutGraphVertical(g);
  const svg = svgEl('svg', { width: lay.width, height: lay.height, viewBox: `0 0 ${lay.width} ${lay.height}` });
  for (const e of lay.edges) svg.append(svgEl('path', { d: e.d, fill: 'none', stroke: e.color, 'stroke-width': 1.5, ...(e.dashed ? { 'stroke-dasharray': '4 3' } : {}) }));
  const list = h('div', { class: 'gl' });
  list.style.paddingLeft = `${lay.width + 6}px`;
  const laneName = (i: number) => lay.lanes[i];
  for (const [i, r] of lay.rows.entries()) {
    const n = lay.nodes[i];
    if (!n) continue;
    // merge 与 HEAD 节点加一层同色外环区分（不拦截指针事件、不带 data-sha，不影响联动 mark 的查询）
    if (n.isMerge || n.isHead) svg.append(svgEl('circle', { class: 'ring', cx: n.x, cy: n.y, r: n.r + 3, fill: 'none', stroke: n.color, 'stroke-width': 1, 'stroke-opacity': 0.55, 'pointer-events': 'none' }));
    const c = svgEl('circle', { class: 'cn', cx: n.x, cy: n.y, r: n.r, fill: n.color, 'fill-opacity': n.isMerge || n.isHead ? 1 : 0.82, stroke: n.color, 'stroke-width': 1.6, 'data-sha': n.sha, ...sendAttrs({ kind: 'commit', sha: n.commit.sha, subject: n.commit.subject }) });
    c.addEventListener('mouseenter', () => onHover(n.sha, false));
    c.addEventListener('mouseleave', () => onHover(null, false));
    c.addEventListener('click', () => onPick(n.sha));
    svg.append(c);
    const lane = laneName(r.lane);
    const key = link.keyOf.get(r.sha);
    const refs = r.commit.refs;
    // data-branch = 所属泳道名（分支键），供右侧队列 / 左侧行的分支背景联动（.brhl）按分支匹配
    const row = h('div', { class: `gr${key ? ' linked' : ''}`, title: `${r.commit.short} · ${r.commit.subject}\n${r.commit.author} · ${ymdhm(r.commit.time)}${r.isMerge ? ' · merge' : ''}`, attrs: { 'data-sha': r.sha, ...(lane ? { 'data-branch': lane.name } : {}), ...sendAttrs({ kind: 'commit', sha: r.commit.sha, subject: r.commit.subject }) } },
      h('span', { class: 'mono sha' }, r.commit.short),
      lane && lane.kind === 'branch' ? h('span', { class: 'ln' }, lane.label.split(' · ')[0] ?? '') : null,
      ...refs.slice(0, 2).map((x) => h('span', { class: 'ref' }, x)),
      h('span', { class: 'sj' }, r.commit.subject),
      h('span', { class: 'tm' }, ymdhm(r.commit.time).slice(5)));
    row.style.height = `${lay.rowHeight}px`;
    if (lane) row.style.setProperty('--lane', lane.color);
    row.addEventListener('mouseenter', () => onHover(r.sha, false));
    row.addEventListener('mouseleave', () => onHover(null, false));
    row.addEventListener('click', () => onPick(r.sha));
    list.append(row);
  }
  wrap.replaceChildren(h('div', { class: 'gg' }, svg, list));
}

export function mountGit(container: HTMLElement, hooks: GitHooks): void {
  let graphWrap: HTMLElement | null = null;
  let prListEl: HTMLElement | null = null;
  /** 右栏「按序集成」（T-040：与提交图 / 列表联动）。 */
  let queueEl: HTMLElement | null = null;
  let keyOf = new Map<string, string>();
  /** 持久选中：'c:<sha>' 或 'b:<分支>'。 */
  let selected = localStorage.getItem(SEL_KEY) ?? '';
  /** 分支背景联动（.brhl）：当前被浅染的分支与分支 → 颜色表（与提交图 lanes 同源取色）。 */
  let branchTint: string | null = null;
  let branchColors = new Map<string, string>();

  /** 把 el 滚到 box 可视区内（只滚动 box 自身，不牵动整页）。 */
  const scrollWithin = (box: HTMLElement, el: Element) => {
    const b = box.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.top >= b.top && r.bottom <= b.bottom) return;
    box.scrollTo({ top: box.scrollTop + (r.top - b.top) - (box.clientHeight - r.height) / 2, behavior: 'smooth' });
  };
  /** 高亮一组提交与一个分支行；scrollGraph / scrollList 控制把对应元素滚入视野。 */
  const mark = (shas: ReadonlySet<string>, branch: string | null, scrollGraph: boolean, scrollList: boolean, scrollQueue = scrollList) => {
    if (!graphWrap || !prListEl) return;
    let firstRow: Element | null = null;
    for (const el of graphWrap.querySelectorAll('[data-sha]')) {
      const on = shas.has(el.getAttribute('data-sha') ?? '');
      el.classList.toggle('hl', on);
      if (on && !firstRow && el.classList.contains('gr')) firstRow = el;
    }
    let prRowEl: Element | null = null;
    for (const el of prListEl.querySelectorAll('.pr[data-branch]')) {
      const on = branch !== null && el.getAttribute('data-branch') === branch;
      el.classList.toggle('hl', on);
      if (on) prRowEl = el;
    }
    let qEl: Element | null = null;
    if (queueEl) {
      for (const el of queueEl.querySelectorAll('.q[data-branch]')) {
        const on = branch !== null && el.getAttribute('data-branch') === branch;
        el.classList.toggle('hl', on);
        if (on) qEl = el;
      }
      queueEl.classList.toggle('has-hl', qEl !== null);
      const hint = queueEl.querySelector<HTMLElement>('.qhint');
      if (hint) {
        hint.hidden = branch === null || qEl !== null;
        hint.textContent = branch ? `${branch} 无对应任务卡，不在集成队列中` : '';
      }
    }
    if (scrollGraph && firstRow) scrollWithin(graphWrap, firstRow);
    if (scrollList && prRowEl) scrollWithin(prListEl, prRowEl);
    if (scrollQueue && qEl && queueEl) scrollWithin(queueEl, qEl);
  };
  const shasOf = (branch: string) => new Set([...keyOf].filter(([, k]) => k === branch).map(([s]) => s));
  const apply = (sel: string, scroll: boolean) => {
    if (sel.startsWith('c:')) mark(new Set([sel.slice(2)]), keyOf.get(sel.slice(2)) ?? null, scroll, scroll);
    else if (sel.startsWith('b:')) mark(shasOf(sel.slice(2)), sel.slice(2), scroll, scroll);
    else mark(new Set(), null, false, false);
  };
  const select = (sel: string) => {
    selected = selected === sel ? '' : sel;
    localStorage.setItem(SEL_KEY, selected);
    apply(selected, true);
  };
  const hoverCommit = (sha: string | null, scrollGraph: boolean) => {
    if (sha) mark(new Set([sha]), keyOf.get(sha) ?? null, scrollGraph, true);
    else apply(selected, false);
  };
  /** 悬停分支行（列表或右栏）：高亮提交图并滚入视野；fromQueue 时同时把列表行滚入视野，反之滚右栏。 */
  const hoverBranch = (branch: string | null, fromQueue = false) => {
    if (branch) mark(shasOf(branch), branch, true, fromQueue, !fromQueue);
    else apply(selected, false);
  };
  /** 分支背景联动：悬停任一侧的分支行时，两侧同分支行一起以该分支色浅染背景；与 .hl 图形联动相互独立。 */
  const TINT_SEL = '.q[data-branch], .pr[data-branch], .gr[data-branch]';
  const applyTint = (branch: string | null) => {
    if (branch === branchTint) return;
    branchTint = branch;
    for (const el of container.querySelectorAll('.brhl')) {
      el.classList.remove('brhl');
      (el as HTMLElement).style.removeProperty('--hl');
    }
    if (!branch) return;
    const color = branchColors.get(branch) ?? fallbackColor(branch);
    for (const el of container.querySelectorAll(TINT_SEL)) {
      if (el.getAttribute('data-branch') !== branch) continue;
      (el as HTMLElement).style.setProperty('--hl', color);
      el.classList.add('brhl');
    }
  };
  container.addEventListener('mouseover', (ev) => {
    const t = (ev.target as Element).closest?.(TINT_SEL);
    if (t && !t.contains(ev.relatedTarget as Node)) applyTint(t.getAttribute('data-branch'));
  });
  container.addEventListener('mouseout', (ev) => {
    const t = (ev.target as Element).closest?.(TINT_SEL);
    if (t && !t.contains(ev.relatedTarget as Node)) applyTint(null);
  });
  const redraw = () => {
    const g = store.state.git;
    if (!graphWrap || !g?.available) return;
    drawGraph(graphWrap, g, { keyOf }, hoverCommit, (sha) => select(`c:${sha}`));
    apply(selected, true);
  };
  const LINKED = '.pr[data-branch], .q[data-branch]';
  container.addEventListener('mouseover', (ev) => {
    const pr = (ev.target as Element).closest?.(LINKED);
    if (pr && !pr.contains(ev.relatedTarget as Node)) hoverBranch(pr.getAttribute('data-branch'), pr.classList.contains('q'));
  });
  container.addEventListener('mouseout', (ev) => {
    const pr = (ev.target as Element).closest?.(LINKED);
    if (pr && !pr.contains(ev.relatedTarget as Node)) hoverBranch(null);
  });
  container.addEventListener('click', (ev) => {
    const pr = (ev.target as Element).closest?.(LINKED);
    if (pr) {
      ev.preventDefault(); // .q 是 label：不切换其中禁用的勾选框
      select(`b:${pr.getAttribute('data-branch') ?? ''}`);
    }
  });

  const render = () => {
    clear(container);
    graphWrap = null;
    prListEl = null;
    queueEl = null;
    branchTint = null;
    const g = store.state.git;
    const b = store.state.board;
    if (!store.state.project) {
      container.append(emptyState('请先打开项目', 'Git 板块用本机 git 只读读取分支、提交与 worktree。', h('button', { class: 'btn', on: { click: hooks.openProject } }, '打开项目文件夹')));
      return;
    }
    if (!g) {
      container.append(emptyState('读取中…', store.state.workspaceError ?? '正在读取 git 状态。'));
      return;
    }
    if (!g.available) {
      container.append(emptyState('不可用', g.reason ?? ''));
      return;
    }
    const cards: BoardCard[] = b?.available ? b.cards : [];
    const integ = g.integrationBranch;
    const cardFor = (branch: string | null) => (branch ? cards.find((c) => c.branch === branch) : undefined);
    const openBranches = g.branches.filter((x) => x.kind !== 'main' && x.kind !== 'integration' && !x.mergedIntoIntegration);
    const mergedList = g.merges.slice().reverse();

    // 与提交图同一次布局：lanes 的 color 即图中实际用色，图例与分支背景联动都从这里取色
    const lay = layoutGraphVertical(g);
    branchColors = new Map(lay.lanes.map((l) => [l.name, l.color]));
    // 分支颜色图示：集成分支 + 各泳道分支（去重，最多 8 项），无分支时不渲染
    const legendLanes: typeof lay.lanes = [];
    const seenLane = new Set<string>();
    for (const l of lay.lanes) {
      if (l.kind === 'main' || seenLane.has(l.name)) continue;
      seenLane.add(l.name);
      legendLanes.push(l);
      if (legendLanes.length >= 8) break;
    }
    const legend = legendLanes.length
      ? h('div', { class: 'glegend' }, ...legendLanes.map((l) => {
          const dot = h('span', { class: 'dot' });
          dot.style.background = l.color;
          return h('span', { class: 'gi', title: l.name }, dot, h('span', { class: 'gn' }, l.name));
        }))
      : null;

    // T-040：整页固定高度，左栏提交图与列表、右栏按序集成各自滚动
    const left = h('div', { class: 'gcol' });
    // 分支图：竖向（新 → 旧），固定高度可滚动，与下方分支列表联动；图下方附分支颜色图示
    graphWrap = h('div', { attrs: { id: 'graph' } });
    left.append(h('div', { class: 'panel w gpanel' }, graphWrap, legend));

    // 提交与 PR
    left.append(h('div', { class: 'sec' }, h('span', {}, '提交与 Pull requests'), h('span', { class: 'mute' }, `${openBranches.length} 个未合入 · ${g.merges.length} 个已合入 · PR：暂无（本地仓库无远端）`)));
    // P0-1：本地无集成分支时已回退远端，明示实际比对用的引用
    if (g.integrationRefRemote) {
      left.append(h('div', { class: 'rootcause info' },
        icon('route'),
        h('div', {},
          h('b', { class: 'b600' }, '已回退到远端集成分支'),
          h('div', {}, `本地没有 ${integ} 分支，ahead / behind 与合入记录基于 ${g.integrationRef}。`))));
    }
    const prRow = (o: { branch: string; task: string | null; subject: string; state: 'merged' | 'review' | 'active'; ahead: number; behind: number; short: string; time: string; mergeShort: string | null; worktree: string | null; commitCount: number | null }) => {
      const c = cardFor(o.branch);
      const tag = o.state === 'merged' ? h('span', { class: 'chip grn' }, '已合入') : o.state === 'review' ? h('span', { class: 'chip blu' }, '待审查') : h('span', { class: 'chip acc' }, '进行中');
      const lg = o.branch.startsWith('int/') ? h('span', { class: 'mute' }, 'check-lane：int/* 跳过')
        : c?.laneOk === true ? h('span', { class: 'grn' }, 'lane-guard ✓') : c?.laneOk === false ? h('span', { class: 'acc' }, 'lane-guard ✗') : h('span', { class: 'mute' }, 'lane-guard：暂无改动');
      return h('div', { class: 'pr', attrs: { 'data-branch': o.branch, ...sendAttrs({ kind: 'branch', name: o.branch, sha: o.short, subject: c ? `${o.task ?? ''} ${c.title}`.trim() : o.subject }) } }, h('span', { class: 'mute' }, icon('pr')),
        h('div', { class: 'm' },
          h('div', { class: 't' }, h('span', {}, `${PR_LINE} · ${o.task ?? '—'}\u3000${c ? c.title : o.subject}`), tag),
          h('div', { class: 'b' }, `${o.branch} → ${integ}${o.worktree ? `\u3000· worktree ${o.worktree}` : ''}`),
          h('div', { class: 'fx12' }, lg, h('span', { class: 'mute' }, c ? `${c.changedFiles} 个文件` : o.commitCount !== null ? `${o.commitCount} 个提交` : ''), h('span', { class: 'mute' }, 'CI：暂无记录'),
            o.mergeShort ? h('span', { class: 'grn' }, `merge ${o.mergeShort}`) : h('span', { class: 'mute' }, `领先 ${o.ahead} / 落后 ${o.behind}`))),
        h('div', { class: 'r' }, c ? `${c.assignee} → coordinator` : '审查者：暂无', h('div', { class: 'mono' }, `${o.short} · ${ymdhm(o.time).slice(5)}`)));
    };
    const prList = h('div', { class: 'prl' });
    for (const x of openBranches) prList.append(prRow({ branch: x.name, task: x.task, subject: x.subject, state: x.ahead > 0 ? 'review' : 'active', ahead: x.ahead, behind: x.behind, short: x.short, time: x.time, mergeShort: null, worktree: x.worktree, commitCount: null }));
    for (const m of mergedList) prList.append(prRow({ branch: m.branch ?? m.subject, task: /(T-\d+)/.exec(m.branch ?? '')?.[1] ?? null, subject: m.subject, state: 'merged', ahead: 0, behind: 0, short: m.tip, time: m.time, mergeShort: m.short, worktree: null, commitCount: m.commitCount }));
    left.append(prList);

    // ── 右栏：按序集成（「发布到 main」随 Worktree 小节移到「Worktree 与 Agent」视图，T-040）──
    const right = h('div', { class: 'gcol' });
    const queue = h('div', { class: 'panel gq' },
      h('div', { class: 'h' }, h('span', {}, '按序集成')),
      h('div', { class: 'qhint mono', attrs: { hidden: '' } }));
    for (const c of cards) {
      const sub = c.status === 'merged' ? `merge ${c.merge?.short ?? ''} 已合入 ${integ}${c.merge ? ` · ${ymdhm(c.merge.time).slice(11)}` : ''}`
        : c.status === 'active' || c.status === 'review' ? `分支已创建 · 领先 ${c.ahead ?? 0} 提交 · ${PR_LINE}`
          : c.status === 'ready' ? '前置已合入 · 尚未开分支' : `等待 ${c.unmetDeps.join('、')} 合入`;
      const box = h('input', { attrs: { type: 'checkbox', disabled: '' } });
      box.checked = c.status === 'merged';
      // 有分支的任务卡带 data-branch（与列表 / 提交图同一分支键），可悬停 / 点击联动
      const linked: Record<string, string> = c.branch ? { 'data-branch': c.branch } : {};
      queue.append(h('label', { class: `q${c.branch ? ' linked' : ''}`, title: c.branch ? `${c.branch}\n悬停 / 点击：在提交图与列表中定位` : '尚无分支', attrs: { ...linked, ...sendAttrs({ kind: 'card', id: c.id, title: c.title, lane: c.lane, status: STATUS_META[c.status].label }) } }, box,
        h('div', { class: 'grow0' }, h('div', {}, `${c.title} / ${c.id}`), h('div', { class: 's' }, sub), c.branch ? h('div', { class: 's mono br' }, c.branch) : null)));
    }
    const viol = cards.filter((c) => c.laneOk === false);
    queue.append(h('div', { class: `note${viol.length ? '' : ' grn'}` }, ...(viol.length
      ? [h('span', { class: 'acc' }, `泳道越界 → ${viol.map((c) => c.id).join('、')}`), h('div', { class: 'mt4' }, '分支改动不全在本泳道内（check-lane.sh 同语义本地复算）')]
      : [h('span', { class: 'grn' }, '泳道越界：暂无'), h('div', { class: 'ink2 mt4' }, cards.length ? '所有任务分支改动按 check-lane.sh 规则本地复算通过' : '无任务卡可复算')])));
    queue.append(h('div', { class: 'mute mt14' }, '每次合入后通知其余分支 rebase。', h('br'), 'Converge 发现新缺口时，显式拆卡再派工。'));
    right.append(queue);

    void STATUS_META;

    container.append(h('div', { class: 'gx' }, left, right));
    // 提交 → 分支键：任务分支泳道上的提交归该分支；合并提交归被合入的分支
    keyOf = new Map<string, string>();
    for (const lane of lay.lanes) if (lane.kind === 'branch') for (const sha of lane.own) keyOf.set(sha, lane.name);
    for (const m of g.merges) keyOf.set(m.sha, m.branch ?? m.subject);
    prListEl = prList;
    queueEl = queue;
    requestAnimationFrame(redraw);
  };

  store.on('workspace', render);
  store.on('project', render);
  store.on('view', () => {
    if (store.state.view === 'git') requestAnimationFrame(redraw);
  });
  render();
}
