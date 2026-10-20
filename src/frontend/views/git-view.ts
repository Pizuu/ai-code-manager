/**
 * Git 分支与集成板块（FR-107、FR-108，US3）：DOM 与类名对应 HTML 原型 gitBody()/graph()，
 * 数据来自 git:get（分支、提交图、合并记录、worktree）与 board:get（任务卡标题、泳道检查、集成队列）。
 * PR / CI / 审查者在本地仓库不可得，统一显示「暂无」。
 */
import type { BoardCard, GitSnapshot } from '../../../contracts/ipc.ts';
import { PR_LINE, STATUS_META, ymdhm } from '../lib/board-format.ts';
import { clear, h } from '../lib/dom.ts';
import { layoutGraph } from '../lib/git-graph.ts';
import { icon, svgEl } from '../lib/icons.ts';
import { store } from '../store.ts';

export interface GitHooks {
  openBoard(): void;
  openProject(): void;
  notify(text: string): void;
}

function emptyState(title: string, text: string, action?: HTMLElement): HTMLElement {
  return h('div', { class: 'empty-state' }, h('b', {}, title), text, action ? h('div', {}, action) : null);
}

function drawGraph(wrap: HTMLElement, g: GitSnapshot): void {
  const lay = layoutGraph(g, wrap.clientWidth || 900);
  const svg = svgEl('svg', { width: lay.width, height: lay.height, viewBox: `0 0 ${lay.width} ${lay.height}` });
  for (const t of lay.texts) svg.append(svgEl('text', { x: t.x, y: t.y, 'font-size': t.size, 'font-weight': t.weight, fill: t.color, 'text-anchor': t.anchor }, t.text));
  for (const e of lay.edges) svg.append(svgEl('path', { d: e.d, fill: 'none', stroke: e.color, 'stroke-width': 1.5, ...(e.dashed ? { 'stroke-dasharray': '4 3' } : {}) }));
  const tip = h('div', { class: 'tip' });
  for (const n of lay.nodes) {
    const c = svgEl('circle', { class: 'cn', cx: n.x, cy: n.y, r: n.r, fill: 'var(--bg)', stroke: n.color, 'stroke-width': 1.6 });
    c.addEventListener('mouseenter', () => {
      tip.replaceChildren(
        h('div', { class: 'mono' }, `${n.commit.short}\u3000${ymdhm(n.commit.time)}`),
        h('div', {}, n.commit.subject),
        h('div', { class: 'mute' }, `${n.commit.author}${n.commit.refs.length ? ` · ${n.commit.refs.join(', ')}` : ''}${n.isMerge ? ' · merge' : ''}`));
      tip.style.display = 'block';
      tip.style.left = `${Math.min(n.x + 10, lay.width - 350)}px`;
      tip.style.top = `${n.y + 12}px`;
      c.setAttribute('r', '6.5');
    });
    c.addEventListener('mouseleave', () => {
      tip.style.display = 'none';
      c.setAttribute('r', String(n.r));
    });
    svg.append(c);
    if (n.showSha) svg.append(svgEl('text', { x: n.x, y: n.y + 20, 'font-size': 10, fill: '#73726C', 'text-anchor': 'middle', class: 'mono' }, n.commit.short));
  }
  wrap.replaceChildren(svg, tip);
}

export function mountGit(container: HTMLElement, hooks: GitHooks): void {
  let graphWrap: HTMLElement | null = null;

  const render = () => {
    clear(container);
    graphWrap = null;
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
    const F = b?.feature;
    const cardFor = (branch: string | null) => (branch ? cards.find((c) => c.branch === branch) : undefined);
    const openBranches = g.branches.filter((x) => x.kind !== 'main' && x.kind !== 'integration' && !x.mergedIntoIntegration);
    const mergedList = g.merges.slice().reverse();

    // ── 顶部 ──
    container.append(h('div', { class: 'gtop' },
      h('div', {}, h('div', { class: 'fs12' }, '分支拓扑与集成队列'),
        h('div', { class: 'mute mt6' }, `${F ? `${F.id} · ${F.title}` : '—'}\u3000/\u3000${integ} 基线 ${g.integrationHead ?? '—'}\u3000/\u3000${openBranches.length} 条未合入分支 · ${g.merges.length} 次合入（任务分支合入后已删除，以合并提交追溯）`)),
      h('div', { class: 'fx8' },
        h('button', { class: 'btn', on: { click: () => void navigator.clipboard.writeText(JSON.stringify({ git: g, board: b }, null, 1)).then(() => hooks.notify('已复制快照 JSON 到剪贴板。'), () => hooks.notify('复制失败。')) } }, '复制快照 JSON'),
        h('button', { class: 'btn', on: { click: hooks.openBoard } }, '看板'))));

    const left = h('div');
    // 分支图
    graphWrap = h('div', { attrs: { id: 'graph' } });
    left.append(h('div', { class: 'panel w' },
      h('div', { class: 'h' }, h('span', {}, '分支图'), h('span', { class: 'mute' }, `提交从左至右（topo 顺序，最近 ${g.commits.length} 个）· 当前 ${integ} 为共同基线`)),
      graphWrap,
      h('div', { class: 'mute mt6' }, '○ 空心节点为提交，悬停查看 sha / 说明\u3000·\u3000已合入分支按合并提交的第二父提交还原（分支本身已删除）')));

    // 提交与 PR
    left.append(h('div', { class: 'sec' }, h('span', {}, '提交与 Pull requests'), h('span', { class: 'mute' }, `${openBranches.length} 个未合入 · ${g.merges.length} 个已合入 · PR：暂无（本地仓库无远端）`)));
    const prRow = (o: { branch: string; task: string | null; subject: string; state: 'merged' | 'review' | 'active'; ahead: number; behind: number; short: string; time: string; mergeShort: string | null; worktree: string | null; commitCount: number | null }) => {
      const c = cardFor(o.branch);
      const tag = o.state === 'merged' ? h('span', { class: 'chip grn' }, '已合入') : o.state === 'review' ? h('span', { class: 'chip blu' }, '待审查') : h('span', { class: 'chip acc' }, '进行中');
      const lg = o.branch.startsWith('int/') ? h('span', { class: 'mute' }, 'check-lane：int/* 跳过')
        : c?.laneOk === true ? h('span', { class: 'grn' }, 'lane-guard ✓') : c?.laneOk === false ? h('span', { class: 'acc' }, 'lane-guard ✗') : h('span', { class: 'mute' }, 'lane-guard：暂无改动');
      return h('div', { class: 'pr' }, h('span', { class: 'mute' }, icon('pr')),
        h('div', { class: 'm' },
          h('div', { class: 't' }, h('span', {}, `${PR_LINE} · ${o.task ?? '—'}\u3000${c ? c.title : o.subject}`), tag),
          h('div', { class: 'b' }, `${o.branch} → ${integ}${o.worktree ? `\u3000· worktree ${o.worktree}` : ''}`),
          h('div', { class: 'fx12' }, lg, h('span', { class: 'mute' }, c ? `${c.changedFiles} 个文件` : o.commitCount !== null ? `${o.commitCount} 个提交` : ''), h('span', { class: 'mute' }, 'CI：暂无记录'),
            o.mergeShort ? h('span', { class: 'grn' }, `merge ${o.mergeShort}`) : h('span', { class: 'mute' }, `领先 ${o.ahead} / 落后 ${o.behind}`))),
        h('div', { class: 'r' }, c ? `${c.assignee} → coordinator` : '审查者：暂无', h('div', { class: 'mono' }, `${o.short} · ${ymdhm(o.time).slice(5)}`)));
    };
    for (const x of openBranches) left.append(prRow({ branch: x.name, task: x.task, subject: x.subject, state: x.ahead > 0 ? 'review' : 'active', ahead: x.ahead, behind: x.behind, short: x.short, time: x.time, mergeShort: null, worktree: x.worktree, commitCount: null }));
    for (const m of mergedList.slice(0, 8)) left.append(prRow({ branch: m.branch ?? m.subject, task: /(T-\d+)/.exec(m.branch ?? '')?.[1] ?? null, subject: m.subject, state: 'merged', ahead: 0, behind: 0, short: m.tip, time: m.time, mergeShort: m.short, worktree: null, commitCount: m.commitCount }));
    if (mergedList.length > 8) left.append(h('div', { class: 'mute pad8' }, `另有 ${mergedList.length - 8} 次更早的合入，见下方合入记录。`));
    const strip = h('div', { class: 'strip' }, icon('check'), h('span', {}, `已合入 ${integ}：`));
    g.merges.forEach((m, i) => {
      if (i) strip.append(h('span', { class: 'mute' }, '→'));
      strip.append(h('span', {}, `${m.branch ?? '?'} · `, h('span', { class: 'mono' }, m.short)));
    });
    if (!g.merges.length) strip.append(h('span', { class: 'mute' }, '暂无'));
    left.append(strip);

    // worktree
    left.append(h('div', { class: 'sec' }, h('span', {}, 'Worktree 与 Agent'), h('span', { class: 'mute' }, '单泳道 · 单任务 · 单分支 · 单 PR')));
    const wts = h('div', { class: 'wts' });
    for (const w of g.worktrees) {
      const c = cardFor(w.branch);
      wts.append(h('div', { class: 'wt' }, h('span', { class: 'mute' }, icon('wt')), h('div', { class: 'grow0' },
        h('div', { class: 'between' }, h('span', {}, c ? `${c.assignee} · ${c.lane}` : w.isMain ? '主工作区' : 'worktree'), h('span', { class: 'acc' }, c?.id ?? '')),
        h('div', { class: 'mono' }, `${w.path}\u3000[${w.branch ?? 'detached'}]`),
        h('div', { class: 'ink2' }, `${w.head} · ${w.dirtyCount ? `${w.dirtyCount} 个未提交文件` : '工作区干净'}`))));
    }
    for (let i = g.worktrees.length; i < 3; i++) {
      wts.append(h('div', { class: 'wt dash' }, h('span', { class: 'mute' }, icon('wt')), h('div', { class: 'mute' }, '暂无其它 worktree', h('div', { class: 'mono fs10' }, 'scripts/agent-worktree.sh new <泳道> <任务>'))));
    }
    left.append(wts);

    // ── 右栏：按序集成 + 发布 ──
    const laneOrder = [...new Set(cards.map((c) => c.lane))];
    const right = h('div');
    const queue = h('div', { class: 'panel' },
      h('div', { class: 'h' }, h('span', {}, '按序集成'), h('span', { class: 'mute' }, 'coordinator 管理')),
      h('div', { class: 'mute mt12' }, laneOrder.length ? laneOrder.join(' → ') : '未读取到任务卡', h('br'), `按 BOARD.md 依赖顺序 --no-ff 合入 ${integ}`));
    for (const c of cards) {
      const sub = c.status === 'merged' ? `merge ${c.merge?.short ?? ''} 已合入 ${integ}${c.merge ? ` · ${ymdhm(c.merge.time).slice(11)}` : ''}`
        : c.status === 'active' || c.status === 'review' ? `分支已创建 · 领先 ${c.ahead ?? 0} 提交 · ${PR_LINE}`
          : c.status === 'ready' ? '前置已合入 · 尚未开分支' : `等待 ${c.unmetDeps.join('、')} 合入`;
      const box = h('input', { attrs: { type: 'checkbox', disabled: '' } });
      box.checked = c.status === 'merged';
      queue.append(h('label', { class: 'q' }, box, h('div', {}, h('div', {}, `${c.title} / ${c.id}`), h('div', { class: 's' }, sub))));
    }
    const viol = cards.filter((c) => c.laneOk === false);
    queue.append(h('div', { class: `note${viol.length ? '' : ' grn'}` }, ...(viol.length
      ? [h('span', { class: 'acc' }, `泳道越界 → ${viol.map((c) => c.id).join('、')}`), h('div', { class: 'mt4' }, '分支改动不全在本泳道内（check-lane.sh 同语义本地复算）')]
      : [h('span', { class: 'grn' }, '泳道越界：暂无'), h('div', { class: 'ink2 mt4' }, cards.length ? '所有任务分支改动按 check-lane.sh 规则本地复算通过' : '无任务卡可复算')])));
    queue.append(h('div', { class: 'mute mt14' }, '每次合入后通知其余分支 rebase。', h('br'), 'Converge 发现新缺口时，显式拆卡再派工。'));
    right.append(queue);

    const merged = cards.filter((c) => c.status === 'merged').length;
    const allM = cards.length > 0 && merged === cards.length;
    const tasksAll = F ? F.tasksDone === F.tasksTotal && F.tasksTotal > 0 : false;
    right.append(h('div', { class: 'panel w mt20' },
      h('div', { class: 'h start' }, icon('lock'), h('span', {}, '发布到 main'), h('span', { class: 'chip' }, 'Owner')),
      h('div', { class: 'mute mt12' }, `${integ} → main · 仅 Owner（人类）可批准`, h('br'), `${merged} / ${cards.length} 张任务卡已合入，${integ} 领先 main ${g.integrationAheadOfMain} 个提交`),
      h('div', { class: 'gate' },
        `${allM ? '✓' : '○'} 所有任务卡合入 ${integ}（${merged}/${cards.length}）`, h('br'),
        '○ CI / lane-guard 运行记录（暂无：本地无远端）', h('br'),
        `${tasksAll ? '✓' : '○'} tasks.md 全部勾选（${F?.tasksDone ?? 0}/${F?.tasksTotal ?? 0}）`, h('br'),
        '○ Converge 无新增缺口（暂无记录）'),
      h('div', { class: 'fx8 mt16' }, h('button', { class: 'btn', attrs: { disabled: '' } }, '合入 main'), h('span', { class: 'chip amb' }, '门禁未满足')),
      h('div', { class: 'mute mt14' }, '满足门禁后，由 Owner 人类批准合入并发布；Agent 无权推进 main。')));
    void STATUS_META;

    container.append(h('div', { class: 'gx' }, left, right));
    requestAnimationFrame(() => {
      if (graphWrap) drawGraph(graphWrap, g);
    });
  };

  let t = 0;
  window.addEventListener('resize', () => {
    clearTimeout(t);
    t = window.setTimeout(() => {
      const g = store.state.git;
      if (graphWrap && g?.available && !container.hidden) drawGraph(graphWrap, g);
    }, 120);
  });
  store.on('workspace', render);
  store.on('project', render);
  store.on('view', () => {
    const g = store.state.git;
    if (store.state.view === 'git' && graphWrap && g?.available) requestAnimationFrame(() => graphWrap && drawGraph(graphWrap, g));
  });
  render();
}
