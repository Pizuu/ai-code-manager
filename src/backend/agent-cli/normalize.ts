/**
 * 存量 Agent CLI 条目的运行时归一化（纯函数）。
 *
 * 背景：「自动检测」一键添加早期把所有 CLI 一律存为 {preset:'custom', args:['{prompt}'], outputFormat:'text'}，
 * 而 ACP/serve 分发只认 outputFormat==='opencode-json'，于是这样存的 opencode 永远走通用 run 通道。
 * 这里在 getAgentCliRuntime 出口做归一化（不改存盘数据）：command 是 opencode 的条目运行时按 opencode 对待；
 * 命中「检测添加指纹」的条目连参数模板一并升级为官方示例，已被用户改过的参数原样保留。
 */
import type { AgentCliOutputFormat, AgentCliPreset } from '../../../contracts/ipc.ts';
import { OPENCODE_EXAMPLE } from './presets.ts';

export interface CliRuntimeFields {
  preset: AgentCliPreset;
  args: string[];
  resumeArgs: string[];
  modelArgs: string[];
  outputFormat: AgentCliOutputFormat;
}

/**
 * command 的可执行名：剥目录（/ 与 \）与 .exe/.cmd/.bat 后缀、转小写。
 * resolve.ts / detect.ts 没有现成的同类工具（只有 PATH 解析与 shim 处理），故在此新写。
 */
export function executableBaseName(command: string): string {
  const base = command.trim().split(/[\\/]/).pop() ?? '';
  return base.replace(/\.(exe|cmd|bat)$/i, '').toLowerCase();
}

/** 「自动检测」添加的原样指纹：通用预设 + 文本格式 + 仅 {prompt} 参数 + 无续接/模型参数。 */
function isDetectAddedFingerprint(c: CliRuntimeFields): boolean {
  return c.preset === 'custom'
    && c.outputFormat === 'text'
    && c.args.length === 1 && c.args[0] === '{prompt}'
    && c.resumeArgs.length === 0
    && c.modelArgs.length === 0;
}

/**
 * 归一化运行时字段（入参取存储条目的对应字段，command 只用于判定、不在返回值内）。
 * 非 opencode 条目原样返回（数组仍拷贝，避免调用方改到存盘引用）。
 */
export function normalizeCliRuntimeFields(c: CliRuntimeFields & { command: string }): CliRuntimeFields {
  const out: CliRuntimeFields = {
    preset: c.preset,
    args: [...c.args],
    resumeArgs: [...c.resumeArgs],
    modelArgs: [...c.modelArgs],
    outputFormat: c.outputFormat,
  };
  if (executableBaseName(c.command) !== 'opencode') return out;
  if (isDetectAddedFingerprint(c)) {
    out.args = [...OPENCODE_EXAMPLE.args];
    out.resumeArgs = [...OPENCODE_EXAMPLE.resumeArgs];
    out.modelArgs = [...OPENCODE_EXAMPLE.modelArgs];
  }
  out.preset = 'opencode';
  out.outputFormat = 'opencode-json';
  return out;
}
