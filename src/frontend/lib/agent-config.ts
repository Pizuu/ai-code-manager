/**
 * 内置 agent 是否已配置（FR-307、FR-308）。纯函数。003 起 Base URL / 模型默认空白，由用户填写。
 */
import type { AgentRef, PublicSettings } from '../../../contracts/ipc.ts';

export const NOT_CONFIGURED_TEXT = '请先在设置中配置 agent';

/** 内置 agent 缺少的项（中文名），空数组 = 已配置。 */
export function builtinMissing(s: Pick<PublicSettings, 'provider' | 'baseUrl' | 'model' | 'hasApiKey'> | null): string[] {
  if (!s) return ['Base URL', '模型', 'API Key'];
  const out: string[] = [];
  if (!s.baseUrl.trim()) out.push('Base URL');
  if (!s.model.trim()) out.push('模型');
  if (!s.hasApiKey[s.provider]) out.push('API Key');
  return out;
}

/** 当前会话 agent 需要先配置时返回提示文本，否则 null（外部 CLI 的可用性由「检查」与发送时报错给出）。 */
export function agentSetupHint(agent: AgentRef, s: PublicSettings | null): string | null {
  if (agent !== 'builtin') return null;
  const missing = builtinMissing(s);
  return missing.length ? `${NOT_CONFIGURED_TEXT}：内置 agent 尚未填写 ${missing.join('、')}（左侧齿轮「设置」）；或在 设置 › Agent CLI 中添加外部 CLI 并在顶部切换。` : null;
}
