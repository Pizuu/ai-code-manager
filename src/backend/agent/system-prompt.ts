/**
 * Agent 系统提示。项目根存在 AGENTS.md 时附上其开头部分，作为项目规则。
 */
import type { PermissionMode } from '../../../contracts/ipc.ts';

/** AGENTS.md 附入系统提示的最大字符数。 */
export const MAX_AGENTS_MD_CHARS = 8000;

const MODE_TEXT: Readonly<Record<PermissionMode, string>> = {
  ask: '每次询问：文件修改与命令执行都需要用户逐条批准。',
  'auto-edits': '自动批准编辑：文件修改自动生效，命令执行仍需用户批准。',
  plan: '仅规划（只读）：不能修改文件或执行命令，只能阅读代码并给出计划。',
  'allow-all': '全部允许：文件修改与命令执行都自动生效，不再逐条询问；但仍只能在项目根内操作，越界路径一律拒绝。',
};

export interface SystemPromptInput {
  projectRoot: string | null;
  platform: NodeJS.Platform;
  mode: PermissionMode;
  today: string;
  agentsMd: string | null;
}

export function buildSystemPrompt(input: SystemPromptInput): string {
  const shell = input.platform === 'win32' ? 'PowerShell' : 'bash';
  const parts = [
    '你是 AI Code Manager，一个在用户本地项目中工作的编程助手。默认使用简体中文回答，代码与命令保持原样。',
    '',
    '## 工作方式',
    '- 先理解再动手：用 list_dir、search、read_file 了解相关代码，不要凭空猜测文件内容。',
    '- 多步骤任务先用 todo_write 列出计划，并在推进时更新状态。',
    '- 修改已有文件优先用 edit_file（old_string 需包含足够上下文以保证唯一）；新建或整体重写才用 write_file。',
    `- 需要运行测试、构建或其他命令时用 run_command（${shell}，工作目录为项目根）。命令要简短明确，避免破坏性操作。`,
    '- 用户拒绝某个修改或命令时，不要重复同样的请求；询问原因或换一种方式。',
    '- 回答简洁，用 Markdown；引用代码位置时写 `路径:行号`。',
    '',
    '## 环境',
    `- 日期：${input.today}`,
    `- 平台：${input.platform}`,
    `- 项目根：${input.projectRoot ?? '（未打开项目，文件与命令工具不可用）'}`,
    `- 权限模式：${MODE_TEXT[input.mode]}`,
  ];
  if (input.agentsMd) {
    parts.push('', '## 项目规则（AGENTS.md 摘录，必须遵守）', input.agentsMd.slice(0, MAX_AGENTS_MD_CHARS));
  }
  return parts.join('\n');
}
