/**
 * agent 显示名与选项（FR-111）。纯函数。
 */
import type { AgentRef, PublicSettings } from '../../../contracts/ipc.ts';

export interface AgentOption {
  ref: AgentRef;
  label: string;
}

export function builtinLabel(s: Pick<PublicSettings, 'provider' | 'model'> | null): string {
  if (!s) return '内置 Agent';
  // 只显示模型名称，不再带提供方前缀（如「OpenAI 兼容 · 」）
  return s.model.trim() || '未配置模型';
}

export function agentOptions(s: PublicSettings | null): AgentOption[] {
  const out: AgentOption[] = [{ ref: 'builtin', label: `内置：${builtinLabel(s)}` }];
  for (const c of s?.agentClis ?? []) out.push({ ref: `cli:${c.id}`, label: `${c.name}${c.model ? ` · ${c.model}` : ''}（CLI）` });
  return out;
}

/** 顶栏 / 会话列表里显示的短名。未知 CLI（已被删除）显示「已删除的 CLI」。 */
export function agentName(ref: AgentRef | undefined, s: PublicSettings | null): string {
  const r = ref ?? s?.defaultAgent ?? 'builtin';
  if (r === 'builtin') return builtinLabel(s);
  const c = s?.agentClis?.find((x) => `cli:${x.id}` === r);
  return c ? `${c.name}${c.model ? ` · ${c.model}` : ''}` : '已删除的 CLI';
}

/** 会话列表 `.who` 列的极短名。 */
export function agentWho(ref: AgentRef | undefined, s: PublicSettings | null): string {
  const r = ref ?? s?.defaultAgent ?? 'builtin';
  if (r === 'builtin') return s?.provider === 'anthropic' ? 'claude' : 'openai';
  return s?.agentClis?.find((x) => `cli:${x.id}` === r)?.name ?? 'cli';
}

export function isCli(ref: AgentRef | undefined, s: PublicSettings | null): boolean {
  return (ref ?? s?.defaultAgent ?? 'builtin') !== 'builtin';
}

/**
 * 真实「使用中」的 agent：优先当前打开会话的 agent，否则默认 agent；
 * 指向已删除 CLI 时返回 null（没有任何条目真正在用）。
 */
export function activeAgentRef(s: PublicSettings | null, sessionAgent?: AgentRef): AgentRef | null {
  const r = sessionAgent ?? s?.defaultAgent ?? 'builtin';
  if (r === 'builtin') return r;
  return s?.agentClis?.some((x) => `cli:${x.id}` === r) ? r : null;
}
