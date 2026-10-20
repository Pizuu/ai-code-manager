/**
 * Diff 面板（FR-007）：最新的修改在最上；待批准的修改带批准/拒绝按钮。
 */
import { clear, h } from '../lib/dom.ts';
import { classifyDiff, countChanges } from '../lib/diff-lines.ts';
import { store } from '../store.ts';
import { decideApproval } from './chat.ts';
import { STATUS_LABELS } from './tool-card.ts';

export function renderDiff(diff: string): HTMLElement {
  return h('div', { class: 'diff' }, ...classifyDiff(diff).map((l) => h('div', { class: l.kind }, l.text || ' ')));
}

export function mountDiffPanel(container: HTMLElement): void {
  const render = () => {
    clear(container);
    const { diffs, approvals } = store.state;
    const clearBtn = h('button', { class: 'ghost', on: { click: () => { store.state.diffs = store.state.diffs.filter((d) => d.status === 'awaiting-approval'); store.emit('diffs'); } } }, '清除已处理');
    container.append(h('div', { class: 'panel-toolbar' }, h('span', { class: 'grow-text' }, `本次运行的文件修改（${diffs.length}）`), clearBtn));
    if (diffs.length === 0) {
      container.append(h('div', { class: 'empty-hint' }, 'Agent 提出的文件修改会以 diff 形式显示在这里。'));
      return;
    }
    for (const d of diffs) {
      const approval = [...approvals.values()].find((a) => a.toolCallId === d.toolCallId);
      const { added, removed } = countChanges(d.diff);
      const head = h('div', { class: 'head' },
        h('span', { class: 'path', title: d.path }, d.path),
        h('span', { class: 'tag' }, `+${added} −${removed}`),
        h('span', { class: `badge ${d.status}` }, STATUS_LABELS[d.status]));
      if (approval && d.status === 'awaiting-approval') {
        head.append(
          h('button', { class: 'danger', on: { click: () => void decideApproval(approval.id, false) } }, '拒绝'),
          h('button', { class: 'primary', on: { click: () => void decideApproval(approval.id, true) } }, '批准'));
      }
      container.append(h('div', { class: 'diff-entry' }, head, renderDiff(d.diff)));
    }
  };
  store.on('diffs', render);
  store.on('approvals', render);
  render();
}
