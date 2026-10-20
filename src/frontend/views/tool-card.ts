/**
 * 工具调用卡片（FR-005）：名称、摘要、状态、可折叠的参数/结果/diff，以及待批准时的批准/拒绝按钮。
 */
import type { ApprovalRequest, ToolCallRecord, ToolCallStatus } from '../../../contracts/ipc.ts';
import { h } from '../lib/dom.ts';

export const STATUS_LABELS: Readonly<Record<ToolCallStatus, string>> = {
  pending: '等待中',
  'awaiting-approval': '待批准',
  running: '运行中',
  done: '完成',
  error: '失败',
  rejected: '已拒绝',
};

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

export function toolSummary(call: ToolCallRecord): string {
  const i = call.input;
  switch (call.name) {
    case 'list_dir': return `列出目录 ${str(i.path) || '.'}`;
    case 'read_file': return `读取 ${str(i.path)}`;
    case 'search': return `搜索「${str(i.pattern)}」${str(i.path) ? ` 于 ${str(i.path)}` : ''}`;
    case 'write_file': return `写入 ${str(i.path)}`;
    case 'edit_file': return `编辑 ${str(i.path)}`;
    case 'run_command': return `执行 ${str(i.command)}`;
    case 'todo_write': return '更新待办';
    default: return call.name;
  }
}

export type DecideFn = (approvalId: string, approved: boolean) => void;
/** 渲染 diff 的函数，由 diff 视图提供（彩色）；缺省为纯文本。 */
export type DiffRenderer = (diff: string) => HTMLElement;

const plainDiff: DiffRenderer = (diff) => h('pre', {}, diff);

export function renderToolCard(call: ToolCallRecord, approval: ApprovalRequest | undefined, onDecide: DecideFn, renderDiff: DiffRenderer = plainDiff): HTMLElement {
  const card = h('div', { class: 'tool-card', attrs: { 'data-call': call.id } },
    h('div', { class: 'head' },
      h('span', { class: 'name' }, call.name),
      h('span', { class: 'summary', title: toolSummary(call) }, toolSummary(call)),
      h('span', { class: `badge ${call.status}` }, STATUS_LABELS[call.status])),
  );
  if (call.diff) {
    const d = h('details', {}, h('summary', {}, 'Diff'), renderDiff(call.diff));
    d.open = call.status === 'awaiting-approval';
    card.append(d);
  }
  // write_file 的完整内容已体现在 diff 中，参数区只显示路径与长度
  const showInput = call.name === 'write_file'
    ? { path: call.input.path, content: `（${str(call.input.content).length} 字符，见 Diff）` }
    : call.input;
  card.append(h('details', {}, h('summary', {}, '参数'), h('pre', {}, JSON.stringify(showInput, null, 2))));
  if (call.output) card.append(h('details', {}, h('summary', {}, '结果'), h('pre', {}, call.output)));
  if (call.status === 'awaiting-approval' && approval) {
    const q = approval.kind === 'command' ? `在 ${approval.shell ?? 'shell'} 中执行此命令？` : `应用对 ${approval.path ?? ''} 的修改？`;
    card.append(h('div', { class: 'approval-bar' },
      h('span', { class: 'q' }, q),
      h('button', { class: 'danger', on: { click: () => onDecide(approval.id, false) } }, '拒绝'),
      h('button', { class: 'primary', on: { click: () => onDecide(approval.id, true) } }, '批准')));
  }
  return card;
}
