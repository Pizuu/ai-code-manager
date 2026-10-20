/**
 * IPC 契约 v1：Electron 主进程（src/backend）↔ 渲染进程（src/frontend）。
 *
 * 唯一权威来源。双方只从这里 `import type`，禁止手抄。
 * 冻结规则（宪法 II）：v1 冻结后只许加可选字段；改/删字段须升 v2 并走 contract-change PR。
 *
 * 安全约束（宪法 X）：本文件中任何发往渲染进程的类型都不得包含 API Key 明文。
 */

export const IPC_CONTRACT_VERSION = 'v1' as const;

// ───────────────────────── 基础模型 ─────────────────────────

/** 模型服务提供方。openai = 任何 OpenAI 兼容 /chat/completions 端点。 */
export type ProviderId = 'openai' | 'anthropic';

/** 权限模式（FR-009）。 */
export type PermissionMode = 'ask' | 'auto-edits' | 'plan';

/** 发往渲染进程的设置：不含密钥，只含是否已配置（FR-003）。 */
export interface PublicSettings {
  provider: ProviderId;
  /** 例：https://api.openai.com/v1 或 https://api.anthropic.com */
  baseUrl: string;
  model: string;
  permissionMode: PermissionMode;
  /** 每个 provider 是否已保存 Key（加密存储于主进程）。 */
  hasApiKey: Record<ProviderId, boolean>;
  /** safeStorage 是否可用；不可用时拒绝保存 Key。 */
  encryptionAvailable: boolean;
  /** 最近打开的项目根目录（绝对路径），可为 null。 */
  lastProjectPath: string | null;
}

/** 渲染进程可提交的设置更新。apiKey 只进不出：写入后主进程立即加密，永不回传。 */
export interface SettingsUpdate {
  provider?: ProviderId;
  baseUrl?: string;
  model?: string;
  permissionMode?: PermissionMode;
  /** 为 provider 设置 Key；空字符串表示删除该 provider 的 Key。 */
  apiKey?: { provider: ProviderId; value: string };
}

export interface ProjectInfo {
  /** 项目根绝对路径。 */
  root: string;
  /** 目录名，用于显示。 */
  name: string;
}

export interface FileNode {
  name: string;
  /** 相对项目根，使用 / 分隔。 */
  relPath: string;
  kind: 'file' | 'dir';
}

export type ToolCallStatus =
  | 'pending'          // 已由模型提出，尚未执行
  | 'awaiting-approval'
  | 'running'
  | 'done'
  | 'error'
  | 'rejected'         // 用户拒绝或 Plan 模式拒绝
  ;

export interface ToolCallRecord {
  /** 模型给出的调用 ID（OpenAI tool_call.id / Anthropic tool_use.id）。 */
  id: string;
  /** contracts/tools.ts 中的 ToolName；保留 string 以容纳模型给出的未知名。 */
  name: string;
  input: Record<string, unknown>;
  status: ToolCallStatus;
  /** 回传给模型的文本结果（截断后）。 */
  output?: string;
  /** write_file / edit_file 的统一 diff。 */
  diff?: string;
}

export type ChatRole = 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  /** 文本内容；tool 角色为工具结果文本。 */
  content: string;
  /** assistant 消息提出的工具调用。 */
  toolCalls?: ToolCallRecord[];
  /** tool 角色对应的调用 ID。 */
  toolCallId?: string;
  /** ISO 8601 时间戳。 */
  createdAt: string;
}

export type TodoStatus = 'pending' | 'in_progress' | 'completed';

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
}

export interface SessionSummary {
  id: string;
  title: string;
  projectPath: string | null;
  updatedAt: string;
  messageCount: number;
}

export interface Session {
  /** 会话文件格式版本，便于迁移。 */
  schemaVersion: 1;
  id: string;
  title: string;
  projectPath: string | null;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  todos: TodoItem[];
}

/** 解析自 specs/<NNN>/tasks.md 的任务（FR-014）。 */
export interface SpecTask {
  id: string;            // T001
  done: boolean;
  parallel: boolean;     // [P]
  story: string | null;  // US1
  lane: string | null;   // backend（来自 [lane:backend] 或 [backend]）
  description: string;
  phase: string | null;  // 所在 "## Phase N: ..." 标题
  line: number;          // 1-based 行号
}

export interface SpecTaskFile {
  /** 相对项目根，例如 specs/001-agent-desktop/tasks.md */
  relPath: string;
  feature: string;       // 001-agent-desktop
  tasks: SpecTask[];
}

export type ApprovalKind = 'edit' | 'command';

export interface ApprovalRequest {
  id: string;
  sessionId: string;
  toolCallId: string;
  kind: ApprovalKind;
  /** edit：目标文件相对路径。 */
  path?: string;
  /** edit：统一 diff。 */
  diff?: string;
  /** command：将要执行的命令原文。 */
  command?: string;
  /** command：实际使用的 shell（powershell.exe / bash）。 */
  shell?: string;
}

// ───────────────────────── invoke 通道（渲染 → 主） ─────────────────────────

/**
 * 每个通道：args = 参数元组，result = 返回值。
 * 主进程对每个参数做运行时校验（信任边界），渲染进程按此类型调用。
 */
export interface IpcInvokeMap {
  'settings:get':    { args: [];                         result: PublicSettings };
  'settings:set':    { args: [update: SettingsUpdate];   result: PublicSettings };
  'project:pick':    { args: [];                         result: ProjectInfo | null };
  'project:current': { args: [];                         result: ProjectInfo | null };
  /** 列出某目录下一层（懒加载）；relDir '' 为根。 */
  'fs:tree':         { args: [relDir: string];           result: FileNode[] };
  'sessions:list':   { args: [];                         result: SessionSummary[] };
  'sessions:create': { args: [];                         result: Session };
  'sessions:get':    { args: [id: string];               result: Session };
  'sessions:delete': { args: [id: string];               result: void };
  /** 清空消息与待办，保留会话（/clear）。 */
  'sessions:clear':  { args: [id: string];               result: Session };
  /** 发送用户消息并启动 agent 循环；增量通过 agent:event 推送。 */
  'agent:send':      { args: [req: AgentSendRequest];    result: void };
  'agent:stop':      { args: [sessionId: string];        result: void };
  'agent:approve':   { args: [decision: ApprovalDecision]; result: void };
  'tasks:list':      { args: [];                         result: SpecTaskFile[] };
}

export type IpcInvokeChannel = keyof IpcInvokeMap;

export interface AgentSendRequest {
  sessionId: string;
  text: string;
}

export interface ApprovalDecision {
  approvalId: string;
  approved: boolean;
}

// ───────────────────────── 事件通道（主 → 渲染） ─────────────────────────

/** 主进程推送事件统一走这一个通道。 */
export const AGENT_EVENT_CHANNEL = 'agent:event' as const;

export type AgentEvent =
  | { type: 'message-start'; sessionId: string; message: ChatMessage }
  | { type: 'text-delta'; sessionId: string; messageId: string; delta: string }
  | { type: 'tool-call'; sessionId: string; messageId: string; call: ToolCallRecord }
  | { type: 'approval-request'; sessionId: string; approval: ApprovalRequest }
  | { type: 'approval-resolved'; sessionId: string; approvalId: string; approved: boolean }
  | { type: 'terminal'; sessionId: string; toolCallId: string; stream: 'stdout' | 'stderr' | 'info'; data: string }
  | { type: 'todos'; sessionId: string; todos: TodoItem[] }
  | { type: 'session-updated'; summary: SessionSummary }
  | { type: 'status'; sessionId: string; running: boolean }
  | { type: 'error'; sessionId: string; message: string }
  ;

export type AgentEventType = AgentEvent['type'];

// ───────────────────────── preload 暴露给渲染进程的桥 ─────────────────────────

/** window.api 的形状（preload 通过 contextBridge 暴露）。 */
export interface RendererApi {
  invoke<C extends IpcInvokeChannel>(channel: C, ...args: IpcInvokeMap[C]['args']): Promise<IpcInvokeMap[C]['result']>;
  /** 订阅主进程事件，返回取消订阅函数。 */
  onEvent(listener: (event: AgentEvent) => void): () => void;
  /** 运行平台，用于 UI 文案（例如 PowerShell）。 */
  platform: string;
}

/** IPC 错误：主进程 handler 抛出的 Error.message 以此前缀开头，渲染进程据此显示。 */
export type IpcErrorCode =
  | 'E_VALIDATION'      // 参数校验失败
  | 'E_NO_PROJECT'      // 未打开项目
  | 'E_NOT_FOUND'       // 会话/文件不存在
  | 'E_PATH_ESCAPE'     // 路径越界（FR-006）
  | 'E_NO_API_KEY'      // 当前 provider 未配置 Key
  | 'E_ENCRYPTION'      // safeStorage 不可用
  | 'E_BUSY'            // 会话已有运行中的 agent
  | 'E_PROVIDER'        // 模型服务返回错误
  ;
