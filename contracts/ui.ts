/**
 * 渲染层 UI 契约 v1（功能 003）：全局右键「发送到任务会话」的来源模型、DOM 标记与文本上限，
 * 以及 Web 预览「UI 定位」的源位置标记。使用方：src/frontend（Electron 渲染进程与 Web 预览共用同一套源码）。
 *
 * 冻结规则同 ipc.ts（宪法 II）：只许加字段 / 加 kind；改字段须升 v2。
 */

export const UI_CONTRACT_VERSION = 'v1' as const;

/** 右键菜单项文案。 */
export const SEND_TO_SESSION_LABEL = '发送到任务会话' as const;

/**
 * 可发送元素上的 data 属性。渲染层在元素上声明 `data-send-kind` 与对应字段，
 * 全局 contextmenu 处理器沿 DOM 向上找到最近的声明元素并组装 SendSource。
 *
 * | kind   | 必填属性                       | 可选属性 |
 * |--------|--------------------------------|----------|
 * | file   | path                           | dir="1"  |
 * | card   | id, title                      | lane, status |
 * | commit | id（完整 sha）                 | title（提交说明） |
 * | branch | id（分支名）                   | sha, title |
 * | code   | path（代码查看器根元素）        | —（行号取自 `data-line`） |
 */
export const SEND_ATTR = Object.freeze({
  kind: 'data-send-kind',
  id: 'data-send-id',
  path: 'data-send-path',
  title: 'data-send-title',
  lane: 'data-send-lane',
  status: 'data-send-status',
  sha: 'data-send-sha',
  dir: 'data-send-dir',
  /** 代码查看器每一行上的 1-based 行号。 */
  line: 'data-line',
});

export type SendKind = 'selection' | 'code' | 'file' | 'card' | 'commit' | 'branch';

/** 右键时组装出的发送来源（插入任务会话输入框的文本由渲染层按此格式化，带来源标注）。 */
export type SendSource =
  /** 任意位置的选中文本；origin = 来源板块中文名（如「泳道看板」）。 */
  | { kind: 'selection'; text: string; origin: string }
  /** 代码查看器：选区（text 非空）或右键所在行（text 为空，startLine = endLine）或整个文件（startLine = 0）。 */
  | { kind: 'code'; path: string; startLine: number; endLine: number; text: string }
  | { kind: 'file'; path: string; dir: boolean }
  | { kind: 'card'; id: string; title: string; lane: string; status: string }
  | { kind: 'commit'; sha: string; subject: string }
  | { kind: 'branch'; name: string; sha: string; subject: string };

/** 插入输入框的单段文本上限（字符），超出截断并注明。 */
export const SEND_TEXT_MAX_CHARS = 20_000;

/** Web 预览 UI 定位：元素源位置标记，值形如 `src/frontend/views/chat.ts:57`（仅 Web 预览写入）。 */
export const LOCATOR_SRC_ATTR = 'data-src' as const;
