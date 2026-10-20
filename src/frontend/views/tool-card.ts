/**
 * 工具调用卡片（FR-005、FR-112）：沿用 HTML 原型「验证证据」卡片 .verify 的样式；
 * 名称、摘要、状态、可折叠的 diff / 参数 / 结果，以及待批准时的批准 / 拒绝按钮。
 * 内置工具与外部 CLI 的工具（opencode 的 write / edit / bash / read …，以及启动记录 agent_cli）共用。
 */
import type { ApprovalRequest, ToolCallRecord, ToolCallStatus } from '../../../contracts/ipc.ts';
import { approvalPrompt, approvalText } from '../lib/approval-prompt.ts';
import { h } from '../lib/dom.ts';
import { icon } from '../lib/icons.ts';

export const STATUS_LABELS: Readonly<Record<ToolCallStatus, string>> = {
  pending: '等待中',
  'awaiting-approval': '待批准',
  running: '运行中',
  done: '完成',
  error: '失败',
  rejected: '已拒绝',
};

const STATUS_CHIP: Readonly<Record<ToolCallStatus, string>> = {
  pending: '', 'awaiting-approval': 'amb', running: 'acc', done: 'grn', error: 'acc', rejected: 'amb',
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
    // 外部 CLI（opencode）
    case 'agent_cli': return `启动 ${str(i.agent)}：${str(i.command)}`;
    case 'write': return `写入 ${str(i.path) || str(i.filePath)}`;
    case 'edit': return `编辑 ${str(i.path) || str(i.filePath)}`;
    case 'read': return `读取 ${str(i.path) || str(i.filePath)}`;
    case 'bash': return `执行 ${str(i.command)}`;
    case 'glob': case 'grep': return `${call.name} ${str(i.pattern)}`;
    case 'todowrite': return '更新待办';
    default: return call.name;
  }
}

export type DecideFn = (approvalId: string, approved: boolean) => void;
/** 渲染 diff 的函数，由 diff 视图提供（彩色）；缺省为纯文本。 */
export type DiffRenderer = (diff: string) => HTMLElement;

const plainDiff: DiffRenderer = (diff) => h('pre', {}, diff);

export function renderToolCard(call: ToolCallRecord, approval: ApprovalRequest | undefined, onDecide: DecideFn, renderDiff: DiffRenderer = plainDiff): HTMLElement {
  const card = h('div', { class: 'verify tool', attrs: { 'data-call': call.id } },
    h('div', { class: 'h' },
      h('span', { class: 'fx8' }, icon(call.name === 'agent_cli' ? 'route' : 'check'), h('span', { class: 'nm' }, call.name)),
      h('span', { class: 'sm', title: toolSummary(call) }, toolSummary(call)),
      h('span', { class: `chip ${STATUS_CHIP[call.status]}` }, STATUS_LABELS[call.status])));
  if (call.diff) {
    const d = h('details', {}, h('summary', {}, 'Diff'), renderDiff(call.diff));
    d.open = call.status === 'awaiting-approval' || call.name === 'edit' || call.name === 'write';
    card.append(d);
  }
  // write 类的完整内容已体现在 diff 中，参数区只显示路径与长度
  const content = str(call.input.content);
  const showInput = content && call.diff ? { ...call.input, content: `（${content.length} 字符，见 Diff）` } : call.input;
  card.append(h('details', {}, h('summary', {}, '参数'), h('pre', {}, JSON.stringify(showInput, null, 2))));
  if (call.output) card.append(h('details', {}, h('summary', {}, '结果'), h('pre', {}, call.output)));
  if (call.status === 'awaiting-approval' && approval) {
    // 文案按种类区分（T128）；未知种类回退为权限名 + 模式，始终需要用户点击，不自动批准
    const p = approvalPrompt(approval, call.name);
    card.append(h('div', { class: p.tone === 'danger' ? 'appr danger' : 'appr', attrs: { 'data-kind': String(approval.kind) } },
      h('span', { class: 'q' }, approvalText(p)),
      h('button', { class: 'btn danger', on: { click: () => onDecide(approval.id, false) } }, '拒绝'),
      h('button', { class: 'btn pri', on: { click: () => onDecide(approval.id, true) } }, '批准')));
  }
  return card;
}
