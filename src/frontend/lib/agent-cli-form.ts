/**
 * 设置「Agent CLI」表单与契约类型之间的转换（FR-110）。纯函数，便于单测。
 * 参数模板每行一个参数（不做 shell 拆分，避免引号歧义）。
 */
import type { AgentCliConfig, AgentCliInput, AgentCliOutputFormat, AgentCliPreset } from '../../../contracts/ipc.ts';

/** 003：opencode 预设只给类型（preset / 输出格式）与名称，字段值为空，由用户填写。 */
export const OPENCODE_FORM_PRESET: Readonly<AgentCliForm> = Object.freeze({
  name: 'opencode',
  preset: 'opencode',
  command: '',
  args: '',
  resumeArgs: '',
  modelArgs: '',
  model: '',
  outputFormat: 'opencode-json',
  env: [],
});

/** opencode 官方文档的示例写法：用作 placeholder，用户点「按示例填写」时才填入（不是默认值）。 */
export const OPENCODE_FORM_EXAMPLE: Readonly<Pick<AgentCliForm, 'command' | 'args' | 'resumeArgs' | 'modelArgs' | 'model'>> = Object.freeze({
  command: 'opencode',
  args: 'run\n--format\njson\n--dir\n{cwd}',
  resumeArgs: '--session\n{session}',
  modelArgs: '--model\n{model}',
  model: '<provider>/<model>',
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

/** command 的可执行名：剥目录（/ 与 \）与 .exe/.cmd/.bat 后缀、转小写，用于按命令名识别 CLI。 */
export function commandBaseName(command: string): string {
  const base = command.trim().split(/[\\/]/).pop() ?? '';
  return base.replace(/\.(exe|cmd|bat)$/i, '').toLowerCase();
}

/**
 * 「自动检测」结果 → 新增表单。opencode 必须以 opencode-json 存入（ACP/serve 分发只认该格式），
 * 故按官方示例模板预填参数；其它 CLI 用通用文本模板（消息经 {prompt} 传入）。
 */
export function detectedToForm(d: { name: string; command: string }): AgentCliForm {
  if (commandBaseName(d.command) === 'opencode') {
    return {
      name: d.name, preset: 'opencode', command: d.command,
      args: OPENCODE_FORM_EXAMPLE.args, resumeArgs: OPENCODE_FORM_EXAMPLE.resumeArgs, modelArgs: OPENCODE_FORM_EXAMPLE.modelArgs,
      model: '', outputFormat: 'opencode-json', env: [],
    };
  }
  return { name: d.name, preset: 'custom', command: d.command, args: '{prompt}', resumeArgs: '', modelArgs: '', model: '', outputFormat: 'text', env: [] };
}

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
