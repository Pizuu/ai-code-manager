/**
 * Diff 渲染（FR-007）：把统一 diff 按行着色。待批准的修改在任务会话右列「文件修改」与工具卡片中显示批准按钮。
 */
import { h } from '../lib/dom.ts';
import { classifyDiff } from '../lib/diff-lines.ts';

export function renderDiff(diff: string): HTMLElement {
  return h('div', { class: 'diff' }, ...classifyDiff(diff).map((l) => h('div', { class: l.kind }, l.text || ' ')));
}
