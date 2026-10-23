/**
 * 斜杠命令（FR-013）：解析输入并给出本地动作或发送给 Agent 的模板化提示。纯函数。
 */

export interface SlashCommandInfo {
  name: string;
  usage: string;
  description: string;
}

export const SLASH_COMMANDS: readonly SlashCommandInfo[] = [
  { name: '/init', usage: '/init', description: '分析项目并生成或更新 AGENTS.md（写入前需批准）' },
  { name: '/clear', usage: '/clear', description: '清空当前会话的消息与待办' },
  { name: '/model', usage: '/model [模型名]', description: '查看或切换当前模型' },
  { name: '/help', usage: '/help', description: '显示可用命令' },
];

export type SlashResult =
  | { kind: 'none' }
  | { kind: 'prompt'; prompt: string }
  | { kind: 'clear' }
  | { kind: 'model'; model: string | null }
  | { kind: 'help'; text: string }
  | { kind: 'error'; text: string };

export function helpText(): string {
  return ['可用命令：', ...SLASH_COMMANDS.map((c) => `  ${c.usage.padEnd(22)} ${c.description}`)].join('\n');
}

/** 输入框中以 / 开头且未含空格时的候选命令。 */
export function suggestCommands(input: string): SlashCommandInfo[] {
  if (!input.startsWith('/') || /\s/.test(input)) return [];
  return SLASH_COMMANDS.filter((c) => c.name.startsWith(input.toLowerCase()));
}

const INIT_PROMPT = [
  '请为当前项目生成或更新根目录的 AGENTS.md，作为后续 AI 协作的规则入口：',
  '1. 用 list_dir 查看目录结构，阅读 README、包管理清单（package.json / pyproject.toml / go.mod / Cargo.toml 等）与 CI 配置；',
  '2. 总结：项目简介、目录职责、构建 / 测试 / Lint 的真实命令、代码风格约定、需要特别注意的事项；',
  '3. 如果已存在 AGENTS.md，保留其中人工编写的内容，只补充或修正过时的部分；',
  '4. 内容简洁（建议 200 行以内），用中文；最后用 write_file 写入 AGENTS.md（会请求我批准）。',
].join('\n');

export function parseSlashCommand(input: string): SlashResult {
  const text = input.trim();
  if (!text.startsWith('/')) return { kind: 'none' };
  const space = text.search(/\s/);
  const name = (space === -1 ? text : text.slice(0, space)).toLowerCase();
  const args = space === -1 ? '' : text.slice(space + 1).trim();
  switch (name) {
    case '/init':
      return { kind: 'prompt', prompt: INIT_PROMPT };
    case '/clear':
      return { kind: 'clear' };
    case '/model':
      return { kind: 'model', model: args === '' ? null : args };
    case '/help':
      return { kind: 'help', text: helpText() };
    default:
      return { kind: 'error', text: `未知命令 ${name}。\n${helpText()}` };
  }
}
