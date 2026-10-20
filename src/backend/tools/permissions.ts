/**
 * 权限模式决策（FR-009，宪法 九）。纯函数，单测覆盖全部组合。
 */
import type { PermissionMode } from '../../../contracts/ipc.ts';
import type { ToolEffect } from '../../../contracts/tools.ts';

export type PermissionDecision = 'allow' | 'ask' | 'deny';

/**
 * - read / meta：任何模式都放行。
 * - write：ask → 询问；auto-edits → 放行；plan → 拒绝；allow-all（v1.6）→ 放行。
 * - execute：plan → 拒绝；allow-all（v1.6）→ 放行；其余一律询问（命令默认永远需要批准）。
 */
export function decide(mode: PermissionMode, effect: ToolEffect): PermissionDecision {
  if (effect === 'read' || effect === 'meta') return 'allow';
  if (mode === 'plan') return 'deny';
  if (mode === 'allow-all') return 'allow';
  if (effect === 'execute') return 'ask';
  return mode === 'auto-edits' ? 'allow' : 'ask';
}

/** 拒绝时回传给模型与界面的说明。 */
export function denyMessage(mode: PermissionMode, effect: ToolEffect): string {
  if (mode === 'plan') {
    return effect === 'execute'
      ? '当前为「仅规划」模式（只读），不允许执行命令。请给出计划，由用户切换模式后再执行。'
      : '当前为「仅规划」模式（只读），不允许修改文件。请给出计划，由用户切换模式后再修改。';
  }
  return '操作被权限策略拒绝。';
}

export const PERMISSION_MODE_LABELS: Readonly<Record<PermissionMode, string>> = {
  ask: '每次询问',
  'auto-edits': '自动批准编辑',
  plan: '仅规划（只读）',
  'allow-all': '全部允许（免审批）',
};
