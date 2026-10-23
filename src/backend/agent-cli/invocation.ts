/**
 * 参数模板展开与权限映射（FR-112、FR-116，ADR 0006）。纯函数。
 * 占位符：{prompt} {model} {session} {cwd}。结果是参数数组，永不拼成 shell 字符串执行。
 */
import type { AgentCliOutputFormat, AgentCliPreset, PermissionMode } from '../../../contracts/ipc.ts';
import { OPENCODE_QUESTION_ENV } from './platform-env.ts';

export interface InvocationConfig {
  preset: AgentCliPreset;
  args: string[];
  resumeArgs: string[];
  modelArgs: string[];
  model: string;
  outputFormat: AgentCliOutputFormat;
}

export interface InvocationInput {
  config: InvocationConfig;
  prompt: string;
  cwd: string;
  cliSessionId: string | null;
  mode: PermissionMode;
}

export interface OpencodePermission {
  edit: 'allow' | 'deny';
  bash: 'allow' | 'deny';
}

const PLACEHOLDER = /\{(prompt|model|session|cwd)\}/g;

export function expandTemplate(tpl: readonly string[], vars: Record<'prompt' | 'model' | 'session' | 'cwd', string>): string[] {
  return tpl.map((a) => a.replace(PLACEHOLDER, (_m, k: 'prompt' | 'model' | 'session' | 'cwd') => vars[k]));
}

const usesPrompt = (tpl: readonly string[]) => tpl.some((a) => a.includes('{prompt}'));

/**
 * opencode 权限映射：plan 禁止编辑与命令；auto-edits 允许编辑、禁止命令；
 * ask（每轮已批准）与 allow-all（v1.6，免审批）全部允许。
 */
export function opencodePermission(mode: PermissionMode): OpencodePermission {
  if (mode === 'plan') return { edit: 'deny', bash: 'deny' };
  if (mode === 'auto-edits') return { edit: 'allow', bash: 'deny' };
  return { edit: 'allow', bash: 'allow' };
}

/** 是否在启动前需要用户批准本轮命令行（宪法 九：命令默认永远需要批准；allow-all 模式除外）。 */
export function needsTurnApproval(mode: PermissionMode): boolean {
  return mode === 'ask';
}

export function buildArgs(input: InvocationInput): string[] {
  const { config, prompt, cwd, cliSessionId, mode } = input;
  const vars = { prompt, model: config.model, session: cliSessionId ?? '', cwd };
  const out = expandTemplate(config.args, vars);
  if (config.model.trim()) out.push(...expandTemplate(config.modelArgs, vars));
  if (cliSessionId) out.push(...expandTemplate(config.resumeArgs, vars));
  if (config.outputFormat === 'opencode-json' && mode === 'plan' && !out.includes('--agent')) out.push('--agent', 'plan');
  const all = [config.args, config.modelArgs, config.resumeArgs];
  if (!all.some(usesPrompt)) out.push('--', prompt);
  return out;
}

/** 注入子进程的额外环境变量（不含用户配置的 env）。run 模式同样禁用 question 工具：本客户端没有承接它的界面（见 platform-env.ts）。 */
export function permissionEnv(config: InvocationConfig, mode: PermissionMode): Record<string, string> {
  if (config.outputFormat !== 'opencode-json') return {};
  return { OPENCODE_PERMISSION: JSON.stringify(opencodePermission(mode)), ...OPENCODE_QUESTION_ENV };
}

/** 展示给用户的命令行（仅显示用途；实际以参数数组执行）。 */
export function formatCommandLine(file: string, args: readonly string[], platform: NodeJS.Platform): string {
  const quote = (s: string) => {
    if (s !== '' && /^[\w@%+=:,./\\-]+$/.test(s)) return s;
    return platform === 'win32' ? `"${s.replace(/"/g, '\\"')}"` : `'${s.replace(/'/g, `'\\''`)}'`;
  };
  return [file, ...args].map(quote).join(' ');
}

/** 权限说明（批准卡片文案）。 */
export function describePermission(config: InvocationConfig, mode: PermissionMode): string {
  if (config.outputFormat !== 'opencode-json') return '外部 CLI 将以其自身权限运行（应用无法逐条拦截其工具调用）。';
  const p = opencodePermission(mode);
  return `本轮授予 opencode：编辑文件 ${p.edit === 'allow' ? '允许' : '禁止'}，执行命令 ${p.bash === 'allow' ? '允许' : '禁止'}（OPENCODE_PERMISSION）。`;
}
