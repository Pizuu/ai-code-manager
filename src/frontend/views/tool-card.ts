/**
 * 工具调用卡片（FR-005、FR-112）：沿用 HTML 原型「验证证据」卡片 .verify 的样式；
 * 名称、摘要、状态、可折叠的 diff / 参数 / 结果，以及待批准时的批准 / 拒绝按钮。
 * 内置工具与外部 CLI 的工具（opencode 的 write / edit / bash / read …，以及启动记录 agent_cli）共用。
 */
import type { ApprovalRequest, ToolCallRecord, ToolCallStatus } from '../../../contracts/ipc.ts';
import { approvalPrompt, approvalText } from '../lib/approval-prompt.ts';
import { h } from '../lib/dom.ts';
import { formatToolOutput, toolTarget } from '../lib/tool-card-text.ts';

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
  const summary = toolSummary(call);
  // 单行格式：命令 ---- 结果 ---- 状态（已删除图标+工具名、参数区与折叠按钮；点击该行展开完整结果）
  const command = toolTarget(call.name, call.input) || call.name;
  const text = call.output ? formatToolOutput(call.output) : '';
  const preview = text.split(/\r?\n/).find((l) => l.trim())?.trim() ?? '';
  const full = text ? h('pre', { class: 'tool-out' }, text) : null;
  const head = h('div', { class: 'h tool-line', attrs: full ? { role: 'button', tabindex: '0', 'aria-expanded': 'false' } : {} },
    h('span', { class: 'tl-cmd', title: `${call.name} · ${summary}` }, command),
    h('span', { class: 'tl-sep', attrs: { 'aria-hidden': 'true' } }),
    h('span', { class: 'tl-res', title: preview }, preview || '—'),
    h('span', { class: 'tl-sep', attrs: { 'aria-hidden': 'true' } }),
    h('span', { class: `chip ${STATUS_CHIP[call.status]}` }, STATUS_LABELS[call.status]));
  const card = h('div', { class: 'verify tool', attrs: { 'data-call': call.id, 'data-tool-call-id': call.id, 'data-tool': call.name } }, head);
  if (full) {
    const toggle = (): void => {
      const open = card.classList.toggle('expanded');
      head.setAttribute('aria-expanded', String(open));
    };
    head.addEventListener('click', toggle);
    head.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(); } });
  }
  if (call.diff) {
    const d = h('details', {}, h('summary', {}, 'Diff'), renderDiff(call.diff));
    d.open = call.status === 'awaiting-approval' || call.name === 'edit' || call.name === 'write';
    card.append(d);
  }
  if (full) card.append(full);
  if (call.status === 'awaiting-approval' && approval) {
    // 文案按种类区分（T128）；未知种类回退为权限名 + 模式，始终需要用户点击，不自动批准
    const p = approvalPrompt(approval, call.name);
    const isOpenCli = call.name === 'agent_cli';
    card.append(h('div', { class: p.tone === 'danger' ? 'appr danger' : 'appr', attrs: { 'data-kind': String(approval.kind) } },
      h('span', { class: 'q' }, approvalText(p)),
      h('button', { class: 'btn danger', title: isOpenCli ? '拒绝启动本次 OpenCLI' : '拒绝此操作', on: { click: () => onDecide(approval.id, false) } }, isOpenCli ? '拒绝启动' : '拒绝'),
      h('button', { class: 'btn pri', title: isOpenCli ? '批准后继续本次 OpenCLI 回答' : '批准此操作', on: { click: () => onDecide(approval.id, true) } }, isOpenCli ? '允许本次' : '批准')));
  }
  return card;
}
