/**
 * 工具调用卡片的文字整理（对话回答的 UI 文字输出）：纯函数，便于单元测试。
 * - 工具名 → 中文标签：内部工具与外部 CLI 工具同名不同义，分别映射；未知工具回退原名。
 * - 工具摘要 → 目标参数：抽出卡片头要显示的关键目标（路径 / 命令 / 模式…）。
 * - 参数 → 键值行：已知键用中文标签，未知键回退原键名；长值截断并标注总字符数。
 * - 结果 → 合法 JSON 缩进美化；非 JSON（含 JSONL）原样返回。
 */

/** 内部工具与外部 CLI（opencode）工具的中文标签。 */
export const TOOL_LABELS: Readonly<Record<string, string>> = {
  // 内置 agent 工具
  list_dir: '列出目录',
  read_file: '读取文件',
  search: '搜索文件',
  write_file: '写入文件',
  edit_file: '编辑文件',
  run_command: '执行命令',
  todo_write: '更新待办',
  // 外部 CLI 工具
  agent_cli: '启动外部 CLI',
  read: '读取文件',
  write: '写入文件',
  edit: '编辑文件',
  bash: '执行命令',
  glob: '按模式查找',
  grep: '按内容搜索',
  todowrite: '更新待办',
  webfetch: '抓取网页',
  task: '子 Agent',
};

/** 工具参数键的中文标签。 */
export const PARAM_LABELS: Readonly<Record<string, string>> = {
  path: '路径',
  filePath: '文件路径',
  command: '命令',
  pattern: '匹配',
  content: '内容',
  old_string: '原内容',
  new_string: '新内容',
  replace_all: '全部替换',
  url: '地址',
  agent: 'Agent',
  model: '模型',
  query: '查询',
  limit: '上限',
  offset: '偏移',
  regex: '正则',
  glob: '文件名过滤',
  max_results: '最大条数',
  timeout_ms: '超时（毫秒）',
  todos: '待办',
};

/** 单个参数值的展示上限（超出截断并标注总字符数）。 */
export const PARAM_VALUE_LIMIT = 160;

/** 工具名 → 中文标签；未知工具返回原名。 */
export function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name;
}

export interface ToolParamRow {
  /** 原始键名。 */
  key: string;
  /** 中文标签（未知键回退原键名）。 */
  label: string;
  /** 展示文本（长值已截断）。 */
  value: string;
}

function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…（共 ${text.length} 字符）` : text;
}

function formatValue(value: unknown, limit: number): string {
  if (value === null || value === undefined) return '（空）';
  if (typeof value === 'string') return truncate(value, limit);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    // 纯字符串数组读作列表，其余按 JSON
    return truncate(value.every((v) => typeof v === 'string') ? value.join('、') : JSON.stringify(value), limit);
  }
  return truncate(JSON.stringify(value) ?? String(value), limit);
}

/** 工具输入 → 键值行（保持入参键序）。 */
export function toolParamRows(input: Record<string, unknown>, limit = PARAM_VALUE_LIMIT): ToolParamRow[] {
  return Object.entries(input).map(([key, value]) => ({
    key,
    label: PARAM_LABELS[key] ?? key,
    value: formatValue(value, limit),
  }));
}

/**
 * 工具卡片头要显示的关键目标（路径 / 命令 / 模式…）：按工具名取第一个有值的相关参数。
 * 取不到时返回空串（卡片头只显示工具名与原始名）。
 */
export function toolTarget(name: string, input: Record<string, unknown>): string {
  const s = (key: string): string => {
    const v = input[key];
    return typeof v === 'string' ? v.trim() : '';
  };
  switch (name) {
    case 'list_dir': return s('path');
    case 'read_file': case 'read': return s('path') || s('filePath');
    case 'search': case 'grep': return s('pattern') || s('query');
    case 'write_file': case 'write': return s('path') || s('filePath');
    case 'edit_file': case 'edit': return s('path') || s('filePath');
    case 'run_command': case 'bash': return s('command');
    case 'glob': return s('pattern');
    case 'webfetch': return s('url');
    case 'agent_cli': return s('command') || s('agent');
    default: return s('path') || s('command') || s('pattern') || s('url');
  }
}

/** 结果文本：合法 JSON 缩进美化；非 JSON 原样（不吞内容）。 */
export function formatToolOutput(output: string): string {
  const text = output.trim();
  if (!text) return output;
  const looksJson = (text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'));
  if (!looksJson) return output;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return output;
  }
}

/** 结果文本的行数（用于「结果（N 行）」提示）。 */
export function outputLineCount(output: string): number {
  return output ? output.split('\n').length : 0;
}
