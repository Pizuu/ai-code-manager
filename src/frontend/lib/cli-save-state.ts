/**
 * 设置对话框「Agent CLI」页底部「保存」按钮的状态判定（T-052）。
 *
 * 缺陷背景：按钮的 disabled / title 原先只在打开对话框时按当时快照算一次，
 * 同一会话内新增第一条 CLI 后不刷新，用户只能关窗重开。判定抽成纯函数后，
 * 初始渲染与 store 'settings' 订阅刷新共用同一口径。
 */
import type { AgentCliConfig } from '../../../contracts/ipc.ts';

export interface CliSaveState {
  disabled: boolean;
  /** title 文案；null 表示不带 title 属性。 */
  title: string | null;
}

export const CLI_SAVE_EMPTY_TITLE = '先添加一个 Agent CLI';

/** agentClis 为空（含未加载的 null / undefined）→ 禁用 + 提示；非空 → 可用 + 无 title。 */
export function cliSaveState(agentClis: readonly AgentCliConfig[] | null | undefined): CliSaveState {
  return (agentClis ?? []).length > 0
    ? { disabled: false, title: null }
    : { disabled: true, title: CLI_SAVE_EMPTY_TITLE };
}
