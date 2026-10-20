/**
 * Agent CLI 预设与安装指引（FR-110、FR-114）。参数依据 opencode 官方文档 https://opencode.ai/docs/cli/
 * 与沙箱实测 opencode 1.19.3（specs/002-workspace-boards/research.md R4）。
 */
import type { AgentCliInput } from '../../../contracts/ipc.ts';

export const OPENCODE_PRESET: Readonly<Omit<AgentCliInput, 'id'>> = Object.freeze({
  name: 'opencode',
  preset: 'opencode',
  command: 'opencode',
  args: ['run', '--format', 'json', '--dir', '{cwd}'],
  resumeArgs: ['--session', '{session}'],
  modelArgs: ['--model', '{model}'],
  model: '',
  outputFormat: 'opencode-json',
  env: [],
});

/** 找不到 / 无法启动 CLI 时附带的中文安装指引。 */
export function installHint(command: string, preset: string, platform: NodeJS.Platform): string {
  if (preset !== 'opencode') return `请确认「${command}」已安装，或在 设置 › Agent CLI 中填写可执行文件的完整路径。`;
  const win = platform === 'win32'
    ? '；Windows 也可 `scoop install opencode` 或 `choco install opencode`。npm 全局安装后可填写 `%APPDATA%\\npm\\node_modules\\opencode-ai\\bin\\opencode.exe` 完整路径'
    : '';
  return `安装 opencode：\`npm install -g opencode-ai\`${win}。安装后执行 \`opencode auth login\` 配置模型提供方，再到 设置 › Agent CLI 点「检查」。文档：https://opencode.ai/docs/`;
}
