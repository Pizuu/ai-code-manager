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
  { name: '/specify', usage: '/specify <需求描述>', description: 'Spec Kit：编写功能规格 spec.md' },
  { name: '/plan', usage: '/plan [技术约束]', description: 'Spec Kit：根据 spec.md 生成 plan.md 等设计文档' },
  { name: '/tasks', usage: '/tasks', description: 'Spec Kit：根据 plan.md 生成 tasks.md' },
  { name: '/implement', usage: '/implement [任务号…]', description: 'Spec Kit：按 tasks.md 逐项实现' },
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

function specKitPreamble(step: string): string {
  return [
    `请按 GitHub Spec Kit 的「${step}」步骤工作：`,
    `1. 如果存在 .agents/skills/speckit-${step}/SKILL.md、.claude/commands/speckit.${step}.md 或 .specify/templates/ 下对应模板，先用 read_file 阅读并严格按其中的步骤与格式执行；`,
    '2. 先阅读 .specify/memory/constitution.md（如存在）与 AGENTS.md（如存在），遵守其中原则；',
    '3. 文档写入 specs/<NNN-功能名>/ 目录，使用 write_file / edit_file（会请求我批准）；',
  ].join('\n');
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
    case '/specify':
      if (args === '') return { kind: 'error', text: '用法：/specify <需求描述>' };
      return { kind: 'prompt', prompt: `${specKitPreamble('specify')}\n4. 只写做什么与为什么（用户故事、FR-xxx、SC-xxx），不写技术实现；不清楚之处标 [NEEDS CLARIFICATION]。\n\n需求：${args}` };
    case '/plan':
      return { kind: 'prompt', prompt: `${specKitPreamble('plan')}\n4. 基于当前功能的 spec.md 生成 plan.md（以及 research.md、data-model.md、quickstart.md、契约），逐条做宪法检查。${args ? `\n\n技术约束：${args}` : ''}` };
    case '/tasks':
      return { kind: 'prompt', prompt: `${specKitPreamble('tasks')}\n4. 基于 plan.md 生成 tasks.md：任务按用户故事分组，编号 T001…，可并行的标 [P]，每个任务写明文件路径${args ? `\n\n补充：${args}` : ''}。` };
    case '/implement':
      return { kind: 'prompt', prompt: `${specKitPreamble('implement')}\n4. 按 tasks.md ${args ? `中的 ${args}` : '的顺序'}逐项实现：先用 todo_write 列出本次要做的任务，完成一项就在 tasks.md 中勾选 [x]，需要时运行测试验证。` };
    default:
      return { kind: 'error', text: `未知命令 ${name}。\n${helpText()}` };
  }
}
