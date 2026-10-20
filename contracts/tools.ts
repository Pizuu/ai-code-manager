/**
 * 工具契约 v1：Agent 核心（src/backend/agent）↔ 大模型（OpenAI function tools / Anthropic tools）。
 *
 * 唯一权威来源：TOOL_DEFINITIONS 中的 JSON Schema 原样发送给模型，
 * 对应 TS 输入类型由执行器使用。v1 冻结后只许加可选参数。
 */

export const TOOLS_CONTRACT_VERSION = 'v1' as const;

export type ToolName =
  | 'list_dir'
  | 'read_file'
  | 'search'
  | 'write_file'
  | 'edit_file'
  | 'run_command'
  | 'todo_write';

/** 工具副作用类别，权限策略据此决定 allow / ask / deny。 */
export type ToolEffect = 'read' | 'write' | 'execute' | 'meta';

export interface ListDirInput { path?: string }
export interface ReadFileInput { path: string; offset?: number; limit?: number }
export interface SearchInput { pattern: string; path?: string; glob?: string; regex?: boolean; max_results?: number }
export interface WriteFileInput { path: string; content: string }
export interface EditFileInput { path: string; old_string: string; new_string: string; replace_all?: boolean }
export interface RunCommandInput { command: string; timeout_ms?: number }
export interface TodoWriteInput { todos: Array<{ id?: string; content: string; status: 'pending' | 'in_progress' | 'completed' }> }

export interface ToolInputMap {
  list_dir: ListDirInput;
  read_file: ReadFileInput;
  search: SearchInput;
  write_file: WriteFileInput;
  edit_file: EditFileInput;
  run_command: RunCommandInput;
  todo_write: TodoWriteInput;
}

/** JSON Schema 子集（足够描述工具参数）。 */
export interface JsonSchema {
  type: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array';
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: string[];
  additionalProperties?: boolean;
}

export interface ToolDefinition {
  name: ToolName;
  effect: ToolEffect;
  description: string;
  inputSchema: JsonSchema;
}

/** 上限（契约冻结检查单：写明上限/超时）。 */
export const TOOL_LIMITS = {
  /** read_file 默认最多返回的行数。 */
  readDefaultLines: 2000,
  /** 任一工具回传给模型的最大字符数，超出截断并注明。 */
  maxOutputChars: 30000,
  /** search 默认 / 最大结果数。 */
  searchDefaultResults: 100,
  searchMaxResults: 500,
  /** search 跳过超过该字节数的文件。 */
  searchMaxFileBytes: 1_000_000,
  /** run_command 默认 / 最大超时（毫秒）。 */
  commandDefaultTimeoutMs: 120_000,
  commandMaxTimeoutMs: 600_000,
} as const;

const pathProp: JsonSchema = { type: 'string', description: '相对项目根的路径，使用 / 分隔；不得越出项目根。' };

export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    name: 'list_dir',
    effect: 'read',
    description: '列出项目内某个目录的直接子项（目录以 / 结尾）。省略 path 表示项目根。',
    inputSchema: { type: 'object', properties: { path: pathProp }, additionalProperties: false },
  },
  {
    name: 'read_file',
    effect: 'read',
    description: '读取项目内文本文件，返回带行号的内容。可用 offset（从 1 开始的行号）与 limit 分页。',
    inputSchema: {
      type: 'object',
      properties: {
        path: pathProp,
        offset: { type: 'integer', description: '起始行号（1 起），默认 1。' },
        limit: { type: 'integer', description: '最多读取行数，默认 2000。' },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  {
    name: 'search',
    effect: 'read',
    description: '在项目文件内容中搜索文本（类似 ripgrep），返回 "路径:行号: 内容"。默认按字面量匹配，regex=true 时按正则。自动跳过 .git、node_modules、dist 与二进制文件。',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: '要搜索的文本或正则。' },
        path: { type: 'string', description: '限定搜索的子目录（相对项目根），默认整个项目。' },
        glob: { type: 'string', description: '文件名过滤，例如 *.ts 或 src/**/*.md。' },
        regex: { type: 'boolean', description: '是否把 pattern 当作正则，默认 false。' },
        max_results: { type: 'integer', description: '最多返回条数，默认 100，最大 500。' },
      },
      required: ['pattern'],
      additionalProperties: false,
    },
  },
  {
    name: 'write_file',
    effect: 'write',
    description: '创建或整体覆盖项目内文件。执行前会向用户展示 diff 并按权限模式请求批准。',
    inputSchema: {
      type: 'object',
      properties: { path: pathProp, content: { type: 'string', description: '完整文件内容。' } },
      required: ['path', 'content'],
      additionalProperties: false,
    },
  },
  {
    name: 'edit_file',
    effect: 'write',
    description: '把文件中的 old_string 精确替换为 new_string。old_string 必须在文件中唯一出现（除非 replace_all=true）。执行前展示 diff 并按权限模式请求批准。',
    inputSchema: {
      type: 'object',
      properties: {
        path: pathProp,
        old_string: { type: 'string', description: '要替换的原文，需包含足够上下文以保证唯一。' },
        new_string: { type: 'string', description: '替换后的文本。' },
        replace_all: { type: 'boolean', description: '替换全部出现，默认 false。' },
      },
      required: ['path', 'old_string', 'new_string'],
      additionalProperties: false,
    },
  },
  {
    name: 'run_command',
    effect: 'execute',
    description: '在项目根目录执行一条 shell 命令（Windows 为 PowerShell，其他平台为 bash），返回退出码与输出。每次执行都需要用户批准；Plan 模式下不可用。',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '要执行的命令。' },
        timeout_ms: { type: 'integer', description: '超时毫秒数，默认 120000，最大 600000。' },
      },
      required: ['command'],
      additionalProperties: false,
    },
  },
  {
    name: 'todo_write',
    effect: 'meta',
    description: '整体替换当前任务的待办清单，用于规划与汇报进度。同一时间最多一个 in_progress。',
    inputSchema: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              content: { type: 'string' },
              status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
            },
            required: ['content', 'status'],
            additionalProperties: false,
          },
        },
      },
      required: ['todos'],
      additionalProperties: false,
    },
  },
];

/** 工具结果：回传给模型的文本 + 可选 diff（供 UI 展示）。 */
export interface ToolResult {
  ok: boolean;
  output: string;
  diff?: string;
}
