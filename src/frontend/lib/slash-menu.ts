/**
 * 斜杠命令菜单的纯逻辑（规格 004，plan Key Decision 2）：选中序号循环、命令参数位判定、
 * 选中填入文本、两段式预置的有效性谓词。状态与接线在 views/chat.ts，本模块只做可测的判定。
 */
import type { SlashCommandInfo } from './slash-commands.ts';

/** 选中序号在 [0, count) 内首尾循环（FR-002）；index 先归一化，delta 可为任意整数步数；count<=0（无候选）返回 -1。 */
export function wrapIndex(index: number, delta: number, count: number): number {
  if (count <= 0) return -1;
  const start = ((index % count) + count) % count;
  return (((start + delta) % count) + count) % count;
}

/** 命令是否带参数位：usage 与 name 不一致即带参数（如 '/model [模型名]'），与现有命令表口径一致。 */
export function commandHasArgs(cmd: SlashCommandInfo): boolean {
  return cmd.usage !== cmd.name;
}

/** 选中填入输入框的文本：命令名 +（带参时一个尾随空格，光标正落在参数位）；无参命令不加空格。 */
export function filledTextFor(cmd: SlashCommandInfo): string {
  return cmd.name + (commandHasArgs(cmd) ? ' ' : '');
}

/**
 * 预置有效性谓词（FR-009 两段式确认的「修改即取消」落点）：current 的首个 token
 * （以空白切分的第一段）恒等于 primedName 才算预置未取消——在参数区补字不取消；
 * 命令名被改动、文本被清空或不再以该命令开头，一律取消。
 */
export function isPrimedText(primedName: string, current: string): boolean {
  const first = current.split(/\s/, 1)[0] ?? '';
  return first !== '' && first === primedName;
}
