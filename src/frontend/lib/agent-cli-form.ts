/**
 * 设置「Agent CLI」表单与契约类型之间的转换（FR-110）。纯函数，便于单测。
 * 参数模板每行一个参数（不做 shell 拆分，避免引号歧义）。
 */
import type { AgentCliConfig, AgentCliInput, AgentCliOutputFormat, AgentCliPreset } from '../../../contracts/ipc.ts';

export const OPENCODE_FORM_PRESET: Readonly<AgentCliForm> = Object.freeze({
  name: 'opencode',
  preset: 'opencode',
  command: 'opencode',
  args: 'run\n--format\njson\n--dir\n{cwd}',
  resumeArgs: '--session\n{session}',
  modelArgs: '--model\n{model}',
  model: '',
  outputFormat: 'opencode-json',
  env: [],
});

export interface EnvRow {
  name: string;
  secret: boolean;
  /** 敏感变量：undefined = 保持原值（界面显示「已保存」）；'' = 删除。 */
  value?: string;
  hasValue?: boolean;
}

export interface AgentCliForm {
  id?: string;
  name: string;
  preset: AgentCliPreset;
  command: string;
  args: string;
  resumeArgs: string;
  modelArgs: string;
  model: string;
  outputFormat: AgentCliOutputFormat;
  env: EnvRow[];
}

export const splitLines = (text: string): string[] => text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '');

export function configToForm(c: AgentCliConfig): AgentCliForm {
  return {
    id: c.id, name: c.name, preset: c.preset, command: c.command,
    args: c.args.join('\n'), resumeArgs: c.resumeArgs.join('\n'), modelArgs: c.modelArgs.join('\n'),
    model: c.model, outputFormat: c.outputFormat,
    env: c.env.map((e) => (e.secret ? { name: e.name, secret: true, hasValue: e.hasValue } : { name: e.name, secret: false, value: e.value ?? '', hasValue: e.hasValue })),
  };
}

export function formToInput(f: AgentCliForm): AgentCliInput {
  const env = f.env
    .filter((e) => e.name.trim() !== '')
    .map((e) => {
      const name = e.name.trim();
      if (!e.secret) return { name, secret: false, value: e.value ?? '' };
      return e.value === undefined ? { name, secret: true } : { name, secret: true, value: e.value };
    });
  return {
    ...(f.id ? { id: f.id } : {}),
    name: f.name.trim(), preset: f.preset, command: f.command.trim(),
    args: splitLines(f.args), resumeArgs: splitLines(f.resumeArgs), modelArgs: splitLines(f.modelArgs),
    model: f.model.trim(), outputFormat: f.outputFormat, env,
  };
}

/** 预览命令行（仅显示；实际由主进程以参数数组执行）。 */
export function previewCommand(f: AgentCliForm, opts: { session?: boolean } = {}): string {
  const parts = [f.command.trim() || '<可执行文件>', ...splitLines(f.args)];
  if (f.model.trim()) parts.push(...splitLines(f.modelArgs).map((a) => a.replace('{model}', f.model.trim())));
  if (opts.session) parts.push(...splitLines(f.resumeArgs).map((a) => a.replace('{session}', '<会话ID>')));
  const usesPrompt = [f.args, f.modelArgs, f.resumeArgs].some((t) => t.includes('{prompt}'));
  if (!usesPrompt) parts.push('--', '<消息>');
  return parts.map((p) => p.replace('{cwd}', '<项目根>').replace('{prompt}', '<消息>')).map((p) => (/\s/.test(p) ? `"${p}"` : p)).join(' ');
}
