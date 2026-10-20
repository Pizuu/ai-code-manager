/**
 * 泳道看板板块（FR-104–FR-106，US2）：DOM 与类名对应 HTML 原型 boardBody()/cardHtml()，数据来自 board:get。
 */
import type { BoardCard, BoardSnapshot } from '../../../contracts/ipc.ts';
import { cardLines, COLUMNS, countBy, filterCards, frShort, hm, laneRows, STATUS_META, uniqueAssignees, type BoardFilter } from '../lib/board-format.ts';
import { sendAttrs } from '../lib/context-send.ts';
import { clear, h } from '../lib/dom.ts';
import { icon } from '../lib/icons.ts';
import { store } from '../store.ts';

export interface BoardHooks {
  openGit(): void;
  openProject(): void;
  /** 点击卡片：在任务会话中打开 / 新建与该任务相关的会话。 */
  openCard(card: BoardCard): void;
}

function emptyState(title: string, text: string, action?: HTMLElement): HTMLElement {
  return h('div', { class: 'empty-state' }, h('b', {}, title), text, action ? h('div', {}, action) : null);
}

export function mountBoard(container: HTMLElement, hooks: BoardHooks): void {
  const f: BoardFilter = { q: '', lane: '', agent: '', done: true };
  let matrixHost: HTMLElement | null = null;

  const cardEl = (c: BoardCard, snap: BoardSnapshot) => {
    const l = cardLines(c, snap);
    return h('a', { class: `card${l.hot ? ' hot' : ''}`, title: c.goal, attrs: sendAttrs({ kind: 'card', id: c.id, title: c.title, lane: c.lane, status: STATUS_META[c.status].label }), on: { click: () => hooks.openCard(c) } },
      h('div', { class: 'r1' }, h('span', { class: 'id' }, `${c.id}\u3000·\u3000${frShort(c)}`), h('span', {}, c.assignee)),
      h('div', { class: 'tt' }, c.title),
      h('div', { class: 'r3' }, l.r3),
      h('div', { class: 'r4' }, h('span', { class: l.r4Class }, h('span', { class: 'dot' }), l.r4)),
      c.declaredMismatch ? h('div', { class: 'warn' }, h('span', { class: 'chip amb', title: 'docs/tasks/BOARD.md 与任务卡写的是 done，但 git 中未合入' }, '看板声明 done · git 未合入')) : null);
  };

  const renderMatrix = (snap: BoardSnapshot) => {
    if (!matrixHost) return;
    const vis = filterCards(snap.cards, f);
    const matrix = h('div', { class: 'matrix' });
    const head = h('div', { class: 'mrow' }, h('div', { class: 'mh mute' }, '泳道 / 所有权'));
    for (const s of COLUMNS) head.append(h('div', { class: 'mh' }, STATUS_META[s].label, h('span', { class: 'n' }, String(vis.filter((c) => c.status === s && (!f.lane || c.lane === f.lane)).length))));
    matrix.append(head);
    for (const lane of laneRows(snap).filter((l) => !f.lane || l === f.lane)) {
      const all = snap.cards.filter((c) => c.lane === lane);
      const lc = vis.filter((c) => c.lane === lane);
      const meta = snap.lanes.find((x) => x.name === lane);
      const globs = (lane === '@shared' ? snap.shared : (meta?.globs ?? [])).filter((g) => !g.startsWith('!'));
      const owners = [...new Set(all.map((c) => c.assignee).filter(Boolean))];
      const act = all.filter((c) => c.status === 'active' || c.status === 'review').length;
      const row = h('div', { class: 'mrow' }, h('div', { class: 'lanec' },
        h('div', {}, lane),
        h('div', { class: 'g' }, globs.slice(0, 2).join(' · ') + (globs.length > 2 ? ' …' : '')),
        h('div', { class: 'o' }, lane === '@shared' ? 'coordinator · int/*' : `${meta?.ownerRole ?? ''}${owners.length ? ` · ${owners.join('/')}` : ''}`),
        h('div', { class: 's' }, lane === '@shared' ? '共享热点 · 受保护' : `${all.length} 张卡 · 执行中 ${act}`)));
      for (const s of COLUMNS) {
        const cs = lc.filter((c) => c.status === s);
        row.append(h('div', { class: 'cell' }, ...(cs.length ? cs.map((c) => cardEl(c, snap)) : [h('span', { class: 'empty' }, '—')])));
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
    const contractCard = cards.find((c) => c.lane === 'contracts' && c.status === 'merged') ?? cards.find((c) => c.lane === 'contracts');
    const frozen = contractCard?.status === 'merged';
    const allMerged = cards.length > 0 && cards.every((c) => c.status === 'merged');

    const pad = h('div', { class: 'pad' });
    // 功能概览
    pad.append(h('div', { class: 'fo' },
      h('div', {},
        h('div', { class: 't' }, h('span', {}, F ? `${F.id} · ${F.title}` : '未找到 specs/NNN-*'), h('span', { class: `chip ${allMerged ? 'grn' : 'acc'}` }, allMerged ? '已全部合入' : '实施中'))),
      h('button', { class: 'btn', on: { click: hooks.openGit } }, '查看集成队列')));
    // 进度条
    const stg = h('div', { class: 'stg' });
    for (const s of F?.stages ?? []) stg.append(h('span', { class: s.done ? 'ok' : '', title: s.detail }, `${s.label}${s.key === 'checklists' ? ` ${s.detail}` : ''} ${s.done ? '✓' : '○'}`));
    pad.append(h('div', { class: 'prog' },
      icon('check'),
      h('span', {}, `契约 IPC ${snap.contractVersion ?? '?'}${frozen ? ' 已冻结' : ' 未冻结'}`),
      h('span', { class: 'mute' }, contractCard ? `${contractCard.id} · ${contractCard.merge ? `merge ${contractCard.merge.short} 已合入 ${integ}` : '未合入'}` : ''),
      stg,
      h('span', { class: 'chip acc', title: 'specs tasks.md 勾选数' }, `当前：Implement · tasks.md ${F?.tasksDone ?? 0}/${F?.tasksTotal ?? 0}`),
      h('span', { class: 'mute' }, '按序合入 → Converge')));
    // 容量
    pad.append(h('div', { class: 'cap' },
      h('span', {}, 'Worker 容量'), h('b', { class: 'b600' }, `${workers.length} / ${snap.maxParallel ?? '?'}`),
      h('span', { class: 'mute' }, activeC.length ? activeC.map((c) => `${c.assignee} ${c.id} ${STATUS_META[c.status].label}`).join(' · ') : '暂无执行中'),
      h('span', { class: 'sep' }),
      h('span', { class: 'mute' }, `${countBy(cards, 'ready')} 张可派工\u3000·\u3000${countBy(cards, 'blocked')} 张等待依赖\u3000·\u3000${countBy(cards, 'review')} 张待审查\u3000·\u3000${countBy(cards, 'merged')} 张已合入`),
      h('span', { class: 'flex1' }),
      h('span', { class: 'mute' }, '一个任务 = 一个泳道 = 一个 PR'),
      h('button', { class: 'btn pri dim', attrs: { disabled: '' }, title: '派工由 coordinator 执行（docs/commands/dispatch.md）' }, '派工')));
    // 控件
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
    const tog = h('span', { class: `tog ml24${f.done ? ' on' : ''}` }, '显示已完成 ', h('i'));
    tog.addEventListener('click', () => {
      f.done = !f.done;
      tog.classList.toggle('on', f.done);
      renderMatrix(snap);
    });
    pad.append(h('div', { class: 'ctl' }, q, h('span', { class: 'ibtn' }, icon('filt')), selWrap(laneSel), selWrap(agentSel), h('span', { class: 'flex1' }), h('span', { class: 'mute' }, '按泳道分组'), tog));
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

  store.on('workspace', render);
  store.on('project', render);
  render();
}
