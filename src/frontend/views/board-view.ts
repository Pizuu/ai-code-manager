/**
 * 泳道看板板块（FR-104–FR-106，US2）：DOM 与类名对应 HTML 原型 boardBody()/cardHtml()，数据来自 board:get。
 */
import type { BoardCard, BoardCardStatus, BoardSnapshot } from '../../../contracts/ipc.ts';
import { cardLines, COLUMNS, countBy, filterCards, frShort, hm, laneRows, STATUS_META, uniqueAssignees, type BoardFilter } from '../lib/board-format.ts';
import { sendAttrs } from '../lib/context-send.ts';
import { clear, h } from '../lib/dom.ts';
import { LANE_COLORS } from '../lib/git-graph.ts';
import { icon } from '../lib/icons.ts';
import { store } from '../store.ts';

export interface BoardHooks {
  openGit(): void;
  openProject(): void;
  /** 点击卡片：在任务会话中打开 / 新建与该任务相关的会话。 */
  openCard(card: BoardCard): void;
}

/** 待定位的卡片（会话上下文面板点任务号 → 跳转看板并定位该卡）：focusBoardCard 先登记，看板挂载后消费。 */
let pendingFocusId: string | null = null;
let applyPendingFocus: (() => void) | null = null;

/** 登记「定位到指定卡片」：看板已挂载则立即定位；未挂载时由挂载后的首次渲染消费。 */
export function focusBoardCard(id: string): void {
  pendingFocusId = id;
  applyPendingFocus?.();
}

/** 矩阵状态列顺序：仅本机界面偏好，存 localStorage（不经 IPC）。 */
const COL_ORDER_KEY = 'acm.board.colOrder';

function loadColOrder(): BoardCardStatus[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(COL_ORDER_KEY) ?? '[]');
    const saved = Array.isArray(v) ? v.filter((x): x is BoardCardStatus => (COLUMNS as readonly unknown[]).includes(x)) : [];
    const uniq = [...new Set(saved)];
    return [...uniq, ...COLUMNS.filter((c) => !uniq.includes(c))];
  } catch {
    return [...COLUMNS];
  }
}

/** 泳道整体状态（看板矩阵行首的语义色圆点）。 */
function laneState(cards: readonly BoardCard[]): { label: string; cls: string } {
  if (cards.some((c) => c.status === 'active' || c.status === 'review')) return { label: '执行中', cls: 'blu' };
  if (cards.some((c) => c.status === 'blocked')) return { label: '等待依赖', cls: 'amb' };
  if (cards.length && cards.every((c) => c.status === 'merged')) return { label: '已完成', cls: 'grn' };
  return { label: cards.length ? '可派工' : '空', cls: '' };
}

function emptyState(title: string, text: string, action?: HTMLElement): HTMLElement {
  return h('div', { class: 'empty-state' }, h('b', {}, title), text, action ? h('div', {}, action) : null);
}

export function mountBoard(container: HTMLElement, hooks: BoardHooks): void {
  const f: BoardFilter = { q: '', lane: '', agent: '', done: true };
  let matrixHost: HTMLElement | null = null;
  let cols = loadColOrder();

  const cardEl = (c: BoardCard, snap: BoardSnapshot) => {
    const l = cardLines(c, snap);
    return h('a', { class: `card${l.hot ? ' hot' : ''}`, title: c.goal, attrs: sendAttrs({ kind: 'card', id: c.id, title: c.title, lane: c.lane, status: STATUS_META[c.status].label }), on: { click: () => hooks.openCard(c) } },
      h('div', { class: 'r1' }, h('span', { class: 'id' }, `${c.id}\u3000·\u3000${frShort(c)}`), h('span', {}, c.assignee)),
      h('div', { class: 'tt' }, c.title),
      h('div', { class: 'r3' }, l.r3),
      h('div', { class: 'r4' }, h('span', { class: l.r4Class }, h('span', { class: 'dot' }), l.r4)),
      c.declaredMismatch ? h('div', { class: 'warn' }, h('span', { class: 'chip amb', title: 'docs/tasks/BOARD.md 与任务卡写的是 done，但 git 中未合入' }, '看板声明 done · git 未合入')) : null,
      // P1-7：合入冲突预警（merge-tree 预演）
      c.mergePreview === 'conflict' ? h('div', { class: 'warn' },
        h('span', { class: 'chip acc', title: `合入时会在这些文件上冲突：\n${c.mergeConflictFiles.join('\n')}` }, `合入会冲突${c.mergeConflictFiles.length ? ` · ${c.mergeConflictFiles.length} 个文件` : ''}`)) : null);
  };

  const renderMatrix = (snap: BoardSnapshot) => {
    if (!matrixHost) return;
    const vis = filterCards(snap.cards, f);
    const matrix = h('div', { class: 'matrix' });
    const head = h('div', { class: 'mrow mhead' }, h('div', { class: 'mh mute' }, '泳道 / 所有权'));
    let dragFrom: BoardCardStatus | null = null;
    for (const s of cols) {
      const hc = h('div', { class: 'mh drag', title: '拖动调整列顺序', attrs: { draggable: 'true', 'data-col': s } },
        h('span', { class: `dot st-${STATUS_META[s].cls || 'none'}` }), STATUS_META[s].label,
        h('span', { class: 'n' }, String(vis.filter((c) => c.status === s && (!f.lane || c.lane === f.lane)).length)));
      hc.addEventListener('dragstart', (ev) => {
        dragFrom = s;
        hc.classList.add('dragging');
        ev.dataTransfer?.setData('text/plain', s);
        if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
      });
      hc.addEventListener('dragend', () => {
        dragFrom = null;
        head.querySelectorAll('.dragging,.over').forEach((x) => x.classList.remove('dragging', 'over'));
      });
      hc.addEventListener('dragover', (ev) => {
        if (!dragFrom || dragFrom === s) return;
        ev.preventDefault();
        hc.classList.add('over');
      });
      hc.addEventListener('dragleave', () => hc.classList.remove('over'));
      hc.addEventListener('drop', (ev) => {
        ev.preventDefault();
        const from = dragFrom;
        if (!from || from === s) return;
        const next = cols.filter((c) => c !== from);
        // 向右拖放到目标之后，向左拖放到目标之前
        const at = next.indexOf(s) + (cols.indexOf(from) < cols.indexOf(s) ? 1 : 0);
        next.splice(at, 0, from);
        cols = next;
        localStorage.setItem(COL_ORDER_KEY, JSON.stringify(cols));
        renderMatrix(snap);
      });
      head.append(hc);
    }
    matrix.append(head);
    for (const lane of laneRows(snap).filter((l) => !f.lane || l === f.lane)) {
      const all = snap.cards.filter((c) => c.lane === lane);
      const lc = vis.filter((c) => c.lane === lane);
      const meta = snap.lanes.find((x) => x.name === lane);
      const globs = (lane === '@shared' ? snap.shared : (meta?.globs ?? [])).filter((g) => !g.startsWith('!'));
      const owners = [...new Set(all.map((c) => c.assignee).filter(Boolean))];
      const act = all.filter((c) => c.status === 'active' || c.status === 'review').length;
      const blk = all.filter((c) => c.status === 'blocked').length;
      const mrg = all.filter((c) => c.status === 'merged').length;
      const st = lane === '@shared' ? { label: '共享热点 · 受保护', cls: 'amb' } : laneState(all);
      const badge = (text: string, cls = '', title = '') => h('span', { class: `lb${cls ? ` ${cls}` : ''}`, title }, text);
      const row = h('div', { class: `mrow${lc.length ? '' : ' empty'}` }, h('div', { class: 'lanec' },
        h('div', { class: 'lr1' },
          h('span', { class: 'ltag', title: st.label, attrs: { style: `background:${LANE_COLORS[lane] ?? '#9B8EAA'}` } }, lane),
          h('span', { class: 'o' }, lane === '@shared' ? 'coordinator · int/*' : `${meta?.ownerRole ?? ''}${owners.length ? ` · ${owners.join('/')}` : ''}`)),
        globs.length ? h('span', { class: 'g', title: globs.join('\n') }, globs.slice(0, 2).join(' · ') + (globs.length > 2 ? ' …' : '')) : null,
        h('span', { class: 's' },
          lane === '@shared' ? badge('受保护', 'amb', '共享热点，仅 coordinator 修改') : badge(`${all.length} 张`, '', '任务卡总数'),
          act ? badge(`执行中 ${act}`, 'blu') : null,
          blk ? badge(`阻塞 ${blk}`, 'amb') : null,
          mrg ? badge(`已合入 ${mrg}`, 'grn') : null)));
      for (const s of cols) {
        const cs = lc.filter((c) => c.status === s);
        row.append(h('div', { class: `cell${cs.length ? '' : ' none'}` }, ...(cs.length ? cs.map((c) => cardEl(c, snap)) : [h('span', { class: 'empty' }, '—')])));
      }
      matrix.append(row);
    }
    matrixHost.replaceChildren(matrix);
  };

  const render = () => {
    clear(container);
    const snap = store.state.board;
    if (!store.state.project) {
      container.append(emptyState('请先打开项目', '泳道看板读取项目的 .agents/lanes.conf、docs/tasks/ 与 git 历史。', h('button', { class: 'btn', on: { click: hooks.openProject } }, '打开项目文件夹')));
      return;
    }
    if (!snap) {
      container.append(emptyState('读取中…', store.state.workspaceError ?? '正在读取任务卡与 git 状态。'));
      return;
    }
    if (!snap.available) {
      container.append(emptyState('此项目未配置泳道', `${snap.reason ?? ''} 看板需要 .agents/lanes.conf 与 docs/tasks/T-*.md（多 Agent 泳道约定）。Git 板块仍可使用。`, h('button', { class: 'btn', on: { click: hooks.openGit } }, '查看 Git 分支与集成')));
      return;
    }
    const F = snap.feature;
    const cards = snap.cards;
    const integ = snap.integrationBranch;
    const activeC = cards.filter((c) => c.status === 'active' || c.status === 'review');
    const workers = activeC.filter((c) => c.lane !== '@shared');
    // 功能状态 chip：按当前所选功能自身的真实进度推导（F.tasksDone / F.tasksTotal，源自该功能 tasks.md 勾选），
    // 不再取全项目任务卡的合入情况——旧口径下切功能时 chip 不随功能变、与标题/stages/tasks 计数不同源。
    const featureDone = F !== null && F.tasksTotal > 0 && F.tasksDone >= F.tasksTotal;

    const pad = h('div', { class: 'pad' });
    // 功能概览
    pad.append(h('div', { class: 'fo' },
      h('div', {},
        h('div', { class: 't' }, h('span', {}, F ? F.title : '未找到 specs/NNN-*'), h('span', { class: `chip ${featureDone ? 'grn' : 'acc'}` }, featureDone ? '已完成' : '实施中'))),
      h('button', { class: 'btn', on: { click: hooks.openGit } }, '查看集成队列')));
    // 规格进度行（原 .prog）已移至 shell 底部状态栏右端常驻，见 shell.ts renderProg
    // 「显示已完成」开关：挂在容量条最右端（原在 .ctl 控制行，第十一批移入 .cap）
    const tog = h('span', { class: `tog${f.done ? ' on' : ''}` }, '显示已完成 ', h('i'));
    tog.addEventListener('click', () => {
      f.done = !f.done;
      tog.classList.toggle('on', f.done);
      renderMatrix(snap);
    });
    // 控件（搜索 / 泳道 / Agent 筛选）：原独立 .ctl 控制行，本批按用户定位反馈并入 .cap 右端、「显示已完成」开关左侧；事件绑定与筛选逻辑不变
    const q = h('input', { class: 'inp', attrs: { placeholder: '搜索任务 / FR / 分支', value: f.q } });
    q.addEventListener('input', () => {
      f.q = q.value;
      renderMatrix(snap);
    });
    /** 下拉框外包一层放 chevron（ADR 0009 控件样式）；选中非「全部」时高亮。 */
    const selWrap = (sel: HTMLSelectElement) => {
      const sync = () => sel.parentElement?.classList.toggle('on', sel.value !== '');
      sel.addEventListener('change', sync);
      return h('span', { class: `selw${sel.value ? ' on' : ''}` }, sel, icon('caret', 14));
    };
    const laneSel = h('select', { class: 'chip', attrs: { 'aria-label': '按泳道筛选' } }, h('option', { attrs: { value: '' } }, '全部泳道'), ...laneRows(snap).map((l) => h('option', { attrs: { value: l } }, l)));
    laneSel.value = f.lane;
    laneSel.addEventListener('change', () => {
      f.lane = laneSel.value;
      renderMatrix(snap);
    });
    const agentSel = h('select', { class: 'chip', attrs: { 'aria-label': '按 Agent 筛选' } }, h('option', { attrs: { value: '' } }, '全部 Agent'), ...uniqueAssignees(cards).map((a) => h('option', { attrs: { value: a } }, a)));
    agentSel.value = f.agent;
    agentSel.addEventListener('change', () => {
      f.agent = agentSel.value;
      renderMatrix(snap);
    });
    // 容量（两行：第一行容量与计数，第二行靠右依次：搜索 / 泳道筛选 / Agent 筛选 / 显示已完成开关）
    pad.append(h('div', { class: 'cap' },
      h('span', {}, 'Worker 容量'), h('b', { class: 'b600' }, `${workers.length} / ${snap.maxParallel ?? '?'}`),
      h('span', { class: 'mute' }, activeC.length ? activeC.map((c) => `${c.assignee} ${c.id} ${STATUS_META[c.status].label}`).join(' · ') : '暂无执行中'),
      h('span', { class: 'sep' }),
      h('span', { class: 'mute' }, `${countBy(cards, 'ready')} 张可派工\u3000·\u3000${countBy(cards, 'blocked')} 张等待依赖\u3000·\u3000${countBy(cards, 'review')} 张待审查\u3000·\u3000${countBy(cards, 'merged')} 张已合入`),
      h('div', { class: 'cap-ctl' }, q, selWrap(laneSel), selWrap(agentSel), tog));
    // 根因提示（P0-1）：集成分支本地缺失 / 已回退远端时，先说清「为什么」，再看逐条冲突
    if (snap.integrationMissing) {
      pad.append(h('div', { class: 'rootcause' },
        icon('route'),
        h('div', {},
          h('b', { class: 'b600' }, '集成分支不可用'),
          h('div', {}, snap.integrationMissing),
          h('div', { class: 'mute' }, '看板状态与「未合入」判定在此期间不可信；先修复集成分支引用再解读冲突。'))));
    } else if (snap.integrationRefRemote) {
      pad.append(h('div', { class: 'rootcause info' },
        icon('route'),
        h('div', {},
          h('b', { class: 'b600' }, '已回退到远端集成分支'),
          h('div', {}, `本地没有 ${integ} 分支，已改用 ${snap.integrationRef} 比对；ahead / behind 与合入记录基于远端。`))));
    }
    // 不一致项默认折叠为一行摘要（v0.4 重新设计，ADR 0009），展开查看明细
    if (snap.conflicts.length) pad.append(h('details', { class: 'conflicts' }, h('summary', {}, h('b', { class: 'b600' }, `声明与 git 不一致 ${snap.conflicts.length} 项`), h('span', { class: 'mute' }, snap.conflicts[0] ?? '')), h('div', { class: 'list' }, ...snap.conflicts.map((c) => h('div', {}, `· ${c}`)))));
    matrixHost = h('div');
    pad.append(matrixHost);
    pad.append(h('div', { class: 'legend' },
      h('span', {}, `状态由 git 推导：合入 ${integ} = 已合入 · 分支存在未合入 = 进行中 / 待审查 · 未开分支看前置是否合入 · 本地无远端，无 PR / CI 记录`),
      h('span', {}, `${snap.boardFile ?? 'docs/tasks/BOARD.md（缺失）'} · ${hm(snap.generatedAt)}`)));
    container.append(pad);
    renderMatrix(snap);
  };

  /** 消费待定位卡片：筛到该卡（搜索词设为卡片 id，并清掉泳道 / Agent 筛选、显示已完成），全量重渲染后滚动居中并短暂高亮；找不到卡片时静默。 */
  const focusPending = () => {
    const id = pendingFocusId;
    if (!id) return;
    pendingFocusId = null;
    f.q = id;
    f.lane = '';
    f.agent = '';
    f.done = true;
    render();
    // 卡片元素经 sendAttrs 带 data-send-id（值即卡片 id），据此定位
    const el = matrixHost?.querySelector(`.card[data-send-id="${id}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1600);
  };
  applyPendingFocus = focusPending;

  store.on('workspace', render);
  store.on('project', render);
  render();
  focusPending();
}
