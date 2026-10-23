/**
 * 工具分发与审批闸门（FR-005/007/008/009/011，宪法 九）。
 * 所有副作用都先经 permissions.decide；ask 时通过 requestApproval 挂起，拒绝则不产生任何副作用。
 */
import type { ApprovalRequest, PermissionMode, TodoItem, ToolCallStatus } from '../../../contracts/ipc.ts';
import type {
  EditFileInput,
  JsonSchema,
  ListDirInput,
  ReadFileInput,
  RunCommandInput,
  SearchInput,
  TodoWriteInput,
  ToolDefinition,
  WriteFileInput,
} from '../../../contracts/tools.ts';
import { TOOL_DEFINITIONS, TOOL_LIMITS } from '../../../contracts/tools.ts';
import { diffStats } from './diff.ts';
import { commitWrite, listDir, prepareEdit, prepareWrite, readFile, type PreparedWrite } from './fs-tools.ts';
import { decide, denyMessage } from './permissions.ts';
import { clampTimeout, runCommand, shellFor } from './run-command.ts';
import { formatSearchResult, searchFiles } from './search.ts';

export type ApprovalInput = Omit<ApprovalRequest, 'id' | 'sessionId'>;

export interface ExecutorContext {
  projectRoot: string | null;
  mode: PermissionMode;
  signal: AbortSignal;
  /** 挂起直到用户批准（true）或拒绝/停止（false）。 */
  requestApproval(req: ApprovalInput): Promise<boolean>;
  onTerminal(toolCallId: string, stream: 'stdout' | 'stderr' | 'info', data: string): void;
  onTodos(todos: TodoItem[]): void;
  platform?: NodeJS.Platform;
}

export interface ToolCallInput {
  id: string;
  name: string;
  input: Record<string, unknown>;
  inputError?: string;
}

export interface ExecutionResult {
  status: Extract<ToolCallStatus, 'done' | 'error' | 'rejected'>;
  output: string;
  diff?: string;
}

/** 超出上限的输出截断并注明。 */
export function truncateOutput(text: string, max: number = TOOL_LIMITS.maxOutputChars): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.7);
  const tail = max - head;
  return `${text.slice(0, head)}\n…（输出过长，省略 ${text.length - max} 字符）…\n${text.slice(-tail)}`;
}

function typeMatches(schema: JsonSchema, value: unknown): boolean {
  switch (schema.type) {
    case 'string': return typeof value === 'string';
    case 'boolean': return typeof value === 'boolean';
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'array': return Array.isArray(value);
    case 'object': return typeof value === 'object' && value !== null && !Array.isArray(value);
    default: return false;
  }
}

/** 按契约中的 JSON Schema 做顶层参数校验；返回错误说明或 null。 */
export function validateToolInput(def: ToolDefinition, input: Record<string, unknown>): string | null {
  const props = def.inputSchema.properties ?? {};
  for (const key of def.inputSchema.required ?? []) {
    if (input[key] === undefined) return `缺少必填参数 ${key}`;
  }
  for (const [key, value] of Object.entries(input)) {
    const schema = props[key];
    if (!schema) return `未知参数 ${key}`;
    if (!typeMatches(schema, value)) return `参数 ${key} 类型应为 ${schema.type}`;
  }
  return null;
}

function normalizeTodos(input: TodoWriteInput): TodoItem[] | string {
  const todos = input.todos.map((t, i) => ({ id: t.id && t.id.trim() !== '' ? t.id : String(i + 1), content: t.content, status: t.status }));
  if (todos.some((t) => t.content.trim() === '')) return '待办内容不能为空';
  if (todos.some((t) => !['pending', 'in_progress', 'completed'].includes(t.status))) return '待办状态非法';
  if (todos.filter((t) => t.status === 'in_progress').length > 1) return '同一时间最多一个 in_progress 待办';
  return todos;
}

async function runWrite(call: ToolCallInput, prepared: PreparedWrite, needsApproval: boolean, ctx: ExecutorContext): Promise<ExecutionResult> {
  if (prepared.diff === '') return { status: 'done', output: `${prepared.rel} 内容无变化，未写入。` };
  if (needsApproval) {
    const approved = await ctx.requestApproval({ toolCallId: call.id, kind: 'edit', path: prepared.rel, diff: prepared.diff });
    if (!approved) return { status: 'rejected', output: `用户拒绝了对 ${prepared.rel} 的修改，文件未改动。`, diff: prepared.diff };
  }
  await commitWrite(prepared);
  const { added, removed } = diffStats(prepared.diff);
  const verb = prepared.oldContent === null ? '已创建' : '已修改';
  return { status: 'done', output: `${verb} ${prepared.rel}（+${added} -${removed}）`, diff: prepared.diff };
}

async function runShell(call: ToolCallInput, input: RunCommandInput, root: string, needsApproval: boolean, ctx: ExecutorContext): Promise<ExecutionResult> {
  const platform = ctx.platform ?? process.platform;
  const shell = shellFor(platform, input.command).label;
  // 只有权限裁决为 ask 时才挂起审批（allow-all 免审批；此前这里无条件询问，导致免审批模式仍弹出命令审批）。
  if (needsApproval) {
    const approved = await ctx.requestApproval({ toolCallId: call.id, kind: 'command', command: input.command, shell });
    if (!approved) return { status: 'rejected', output: '用户拒绝执行该命令。' };
  }
  ctx.onTerminal(call.id, 'info', `${shell}> ${input.command}\n`);
  const r = await runCommand({
    command: input.command,
    cwd: root,
    timeoutMs: clampTimeout(input.timeout_ms),
    signal: ctx.signal,
    platform,
    onData: (stream, data) => ctx.onTerminal(call.id, stream, data),
  });
  const note = r.timedOut ? '（超时，进程已终止）' : r.aborted ? '（已被用户停止）' : '';
  ctx.onTerminal(call.id, 'info', `\n[退出码 ${r.exitCode ?? '无'}]${note}\n`);
  return {
    status: r.exitCode === 0 ? 'done' : 'error',
    output: truncateOutput(`退出码：${r.exitCode ?? '无'}${note}\n${r.output}`),
  };
}

/** 执行一次工具调用。永不抛出：所有错误都转为 status=error 的结果回传给模型。 */
export async function executeTool(call: ToolCallInput, ctx: ExecutorContext): Promise<ExecutionResult> {
  const def = TOOL_DEFINITIONS.find((d) => d.name === call.name);
  if (!def) return { status: 'error', output: `未知工具 ${call.name}` };
  if (call.inputError) return { status: 'error', output: call.inputError };
  const invalid = validateToolInput(def, call.input);
  if (invalid) return { status: 'error', output: `参数错误：${invalid}` };

  const decision = decide(ctx.mode, def.effect);
  if (decision === 'deny') return { status: 'rejected', output: denyMessage(ctx.mode, def.effect) };

  if (def.name === 'todo_write') {
    const todos = normalizeTodos(call.input as unknown as TodoWriteInput);
    if (typeof todos === 'string') return { status: 'error', output: todos };
    ctx.onTodos(todos);
    const done = todos.filter((t) => t.status === 'completed').length;
    return { status: 'done', output: `待办已更新：共 ${todos.length} 项，已完成 ${done} 项。` };
  }

  const root = ctx.projectRoot;
  if (!root) return { status: 'error', output: 'E_NO_PROJECT: 尚未打开项目文件夹，无法使用文件或命令工具。' };

  try {
    switch (def.name) {
      case 'list_dir':
        return { status: 'done', output: truncateOutput(await listDir(root, call.input as ListDirInput)) };
      case 'read_file':
        return { status: 'done', output: truncateOutput(await readFile(root, call.input as unknown as ReadFileInput)) };
      case 'search': {
        const s = call.input as unknown as SearchInput;
        const r = await searchFiles(root, {
          pattern: s.pattern,
          signal: ctx.signal,
          ...(s.path !== undefined ? { dir: s.path } : {}),
          ...(s.glob !== undefined ? { glob: s.glob } : {}),
          ...(s.regex !== undefined ? { regex: s.regex } : {}),
          ...(s.max_results !== undefined ? { maxResults: s.max_results } : {}),
        });
        return { status: 'done', output: truncateOutput(formatSearchResult(r)) };
      }
      case 'write_file':
        return await runWrite(call, await prepareWrite(root, call.input as unknown as WriteFileInput), decision === 'ask', ctx);
      case 'edit_file':
        return await runWrite(call, await prepareEdit(root, call.input as unknown as EditFileInput), decision === 'ask', ctx);
      case 'run_command':
        return await runShell(call, call.input as unknown as RunCommandInput, root, decision === 'ask', ctx);
      default:
        return { status: 'error', output: `工具 ${def.name} 未实现` };
    }
  } catch (err) {
    return { status: 'error', output: (err as Error).message };
  }
}
