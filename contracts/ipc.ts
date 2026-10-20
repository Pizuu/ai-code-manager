/**
 * IPC 契约 v1：Electron 主进程（src/backend）↔ 渲染进程（src/frontend）。
 *
 * 唯一权威来源。双方只从这里 `import type`，禁止手抄。
 * 冻结规则（宪法 II）：v1 冻结后只许加可选字段；改/删字段须升 v2 并走 contract-change PR。
 *
 * 安全约束（宪法 X）：本文件中任何发往渲染进程的类型都不得包含 API Key 明文。
 */

export const IPC_CONTRACT_VERSION = 'v1' as const;
/**
 * 契约修订号：v1.1 = 功能 002（三板块 + Agent CLI）的纯增量扩展——只新增通道、类型与可选字段，
 * 未修改或删除任何 v1 字段，因此主版本保持 v1（宪法 II）。
 */
export const IPC_CONTRACT_REVISION = 'v1.3' as const;
// v1.2 = 功能 003（只读代码查看、配置空白）的纯增量：新增 `fs:read` 通道、`FileContent` 类型、`FILE_VIEW_LIMITS`
// 常量与错误码 `E_NOT_CONFIGURED`；未修改或删除任何既有字段。
// v1.3 = 任务卡 T-033（为接入 opencode serve 逐条审批做准备，ADR 0006 修订）的纯增量：`ApprovalKind` 新增
// 'webfetch' | 'loop' | 'subagent' | 'external-dir' | 'other'，`ApprovalRequest` 新增可选字段 `url`、`tool`、`permission`、
// `patterns`、`description`；既有 'edit' / 'command' 及其字段语义不变。

// ───────────────────────── 基础模型 ─────────────────────────

/** 模型服务提供方。openai = 任何 OpenAI 兼容 /chat/completions 端点。 */
export type ProviderId = 'openai' | 'anthropic';

/** 权限模式（FR-009）。 */
export type PermissionMode = 'ask' | 'auto-edits' | 'plan';

/** 发往渲染进程的设置：不含密钥，只含是否已配置（FR-003）。 */
export interface PublicSettings {
  provider: ProviderId;
  /** 由用户填写，默认 ''（v1.2 起不预填任何服务商地址）。例：https://<你的服务>/v1 */
  baseUrl: string;
  /** 由用户填写，默认 ''（v1.2 起不预填任何模型名）。 */
  model: string;
  permissionMode: PermissionMode;
  /** 每个 provider 是否已保存 Key（加密存储于主进程）。 */
  hasApiKey: Record<ProviderId, boolean>;
  /** safeStorage 是否可用；不可用时拒绝保存 Key。 */
  encryptionAvailable: boolean;
  /** 最近打开的项目根目录（绝对路径），可为 null。 */
  lastProjectPath: string | null;
  /** v1.1：已配置的外部 Agent CLI（敏感环境变量只给出 hasValue，永不回传值）。 */
  agentClis?: AgentCliConfig[];
  /** v1.1：新会话默认使用的 agent。缺省 = 'builtin'。 */
  defaultAgent?: AgentRef;
}

/** 渲染进程可提交的设置更新。apiKey 只进不出：写入后主进程立即加密，永不回传。 */
export interface SettingsUpdate {
  provider?: ProviderId;
  baseUrl?: string;
  model?: string;
  permissionMode?: PermissionMode;
  /** 为 provider 设置 Key；空字符串表示删除该 provider 的 Key。 */
  apiKey?: { provider: ProviderId; value: string };
  /** v1.1：新会话默认 agent。 */
  defaultAgent?: AgentRef;
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
  /** v1.1：产生该 assistant 消息的 agent（缺省 = 'builtin'）。 */
  agent?: AgentRef;
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
  /** v1.1：会话所用 agent（缺省 = 'builtin'）。 */
  agent?: AgentRef;
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
  /** v1.1：会话所用 agent（缺省 = 'builtin'）。 */
  agent?: AgentRef;
  /** v1.1：外部 CLI 的会话 ID（键 = AgentCliConfig.id），用于多轮续接同一 CLI 会话。 */
  cliSessions?: Record<string, string>;
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

/**
 * 审批种类（宪法 九：写入与命令逐条批准）。
 *
 * - `edit`：写入 / 修改文件（内置 agent 的 edit_file / write_file，或 opencode `edit` 权限）。
 * - `command`：执行命令（内置 agent 的 run_command、外部 CLI 每轮启动，或 opencode `bash` 权限）。
 * - `webfetch`（v1.3）：抓取网页（opencode `webfetch` 权限）；读 `url`。
 * - `loop`（v1.3）：同一工具以相同参数重复调用，疑似死循环，询问是否继续（opencode `doom_loop` 权限）；读 `tool`、`description`。
 * - `subagent`（v1.3）：启动子 agent（opencode `task` 权限）；读 `description`（子任务说明）、`patterns`（子 agent 类型）。
 * - `external-dir`（v1.3）：访问项目根以外的目录（opencode `external_directory` 权限）；读 `path`（绝对路径）、`patterns`。
 *   宪法 十一要求项目根沙箱，提供方默认应直接拒绝此类权限；此种类仅用于「无法预先拒绝时」如实展示。
 * - `other`（v1.3）：未知或未单独建模的权限（兜底，向前兼容外部 CLI 新增的权限名）；读 `permission`、`patterns`、`description`。
 *
 * 使用方（渲染进程）必须为不认识的种类回退到 `other` 的展示方式（显示 `permission` + `patterns`），不得静默批准或丢弃。
 */
export type ApprovalKind = 'edit' | 'command' | 'webfetch' | 'loop' | 'subagent' | 'external-dir' | 'other';

export interface ApprovalRequest {
  id: string;
  sessionId: string;
  toolCallId: string;
  kind: ApprovalKind;
  /** edit：目标文件相对路径。external-dir（v1.3）：请求访问的项目外绝对路径。 */
  path?: string;
  /** edit：统一 diff。 */
  diff?: string;
  /** command：将要执行的命令原文。 */
  command?: string;
  /** command：实际使用的 shell（powershell.exe / bash）。 */
  shell?: string;
  // ── v1.3（T-033）：以下均为可选，旧种类不使用 ──
  /** webfetch：将要抓取的完整 URL。例：https://opencode.ai/docs/cli/ */
  url?: string;
  /** loop：被重复调用的工具名。例：read */
  tool?: string;
  /**
   * 外部 CLI 原始权限名（审计与兜底展示用），任何种类均可附带。
   * 例：'webfetch'、'doom_loop'、'task'、'external_directory'、'skill'。
   */
  permission?: string;
  /** 权限匹配模式（外部 CLI 原样给出），例：['https://example.com/*']、['/etc/*']、['general']。 */
  patterns?: string[];
  /** 面向用户的一句话说明（提供方生成或取自 CLI 元数据），例：子 agent 的任务描述、循环检测的说明。 */
  description?: string;
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
  /** 在系统文件管理器中打开当前项目根目录。 */
  'project:openRoot': { args: [];                        result: void };
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
  // ── v1.1（功能 002）──
  /** 新增或更新一个 Agent CLI 配置（id 缺省 = 新增）；返回最新设置。 */
  'agentCli:save':    { args: [input: AgentCliInput];     result: PublicSettings };
  'agentCli:delete':  { args: [id: string];               result: PublicSettings };
  /** 解析可执行文件并运行版本命令，检查 CLI 是否可用（不发送任何提示词）。 */
  'agentCli:check':   { args: [id: string];               result: AgentCliCheck };
  /** 切换会话使用的 agent（运行中不可切换）。 */
  'sessions:setAgent': { args: [id: string, agent: AgentRef]; result: Session };
  /** 泳道看板：读取当前项目的 lanes.conf / 任务卡 / BOARD.md / tasks.md 并与 git 交叉核对。 */
  'board:get':        { args: [];                         result: BoardSnapshot };
  /** Git 分支与集成：主进程用 git CLI 只读采集。 */
  'git:get':          { args: [];                         result: GitSnapshot };
  // ── v1.2（功能 003）──
  /** 只读读取项目内文件供代码查看器显示；路径经项目根沙箱（宪法 十一），大文件截断 / 拒绝，二进制不返回内容。 */
  'fs:read':          { args: [relPath: string];          result: FileContent };
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
  | 'E_CLI'             // v1.1：外部 Agent CLI 不可用或异常退出
  | 'E_NOT_CONFIGURED'  // v1.2：内置 agent 未配置 Base URL / 模型（界面提示「请先在设置中配置 agent」）
  ;

// ───────────────────────── v1.1：Agent CLI 配置（功能 002） ─────────────────────────

/** agent 引用：'builtin' = 内置 API agent（OpenAI 兼容 / Anthropic）；'cli:<id>' = 外部 CLI agent。 */
export type AgentRef = 'builtin' | `cli:${string}`;

/** CLI 输出解析方式：opencode-json = `opencode run --format json` 的 JSONL 事件流；text = 纯文本 stdout。 */
export type AgentCliOutputFormat = 'opencode-json' | 'text';

export type AgentCliPreset = 'opencode' | 'custom';

/** 发往渲染进程的环境变量：secret=true 时永不回传 value，只给 hasValue（宪法 十）。 */
export interface AgentCliEnvVar {
  name: string;
  secret: boolean;
  /** 仅非敏感变量回传。 */
  value?: string;
  hasValue: boolean;
}

/**
 * 外部 CLI agent 配置（发往渲染进程的形状）。
 * 参数模板占位符：{prompt} {model} {session} {cwd}。prompt 若未出现在任何模板中，则在末尾以 `--` 分隔追加。
 * 工作目录固定为当前项目根，不可配置（宪法 十一）。
 */
export interface AgentCliConfig {
  id: string;
  name: string;
  preset: AgentCliPreset;
  /** 可执行文件名或绝对路径（Windows 建议填 opencode.exe 完整路径）。 */
  command: string;
  /** 每轮固定参数，例如 ["run","--format","json"]。 */
  args: string[];
  /** 已有 CLI 会话 ID 时追加，例如 ["--session","{session}"]。 */
  resumeArgs: string[];
  /** model 非空时追加，例如 ["--model","{model}"]。 */
  modelArgs: string[];
  /** 例：<provider>/<model>；空 = 用 CLI 自身默认。 */
  model: string;
  outputFormat: AgentCliOutputFormat;
  env: AgentCliEnvVar[];
}

/** 渲染进程提交的 CLI 配置。secret 变量 value 缺省 = 保持原值，'' = 删除。 */
export interface AgentCliInput {
  id?: string;
  name: string;
  preset: AgentCliPreset;
  command: string;
  args: string[];
  resumeArgs: string[];
  modelArgs: string[];
  model: string;
  outputFormat: AgentCliOutputFormat;
  env: Array<{ name: string; secret: boolean; value?: string }>;
}

export interface AgentCliCheck {
  ok: boolean;
  /** 解析到的可执行文件绝对路径。 */
  resolvedPath: string | null;
  version: string | null;
  /** 中文说明；不可用时含安装指引。 */
  message: string;
}

// ───────────────────────── v1.1：泳道看板（功能 002） ─────────────────────────

/** 由 git 推导的任务卡状态（不是 BOARD.md 的声明值）。 */
export type BoardCardStatus = 'ready' | 'active' | 'review' | 'blocked' | 'merged';

export interface BoardLane {
  name: string;
  /** lanes.conf 原样 glob（含 ! 排除项）。 */
  globs: string[];
  /** multi-agent.md 泳道表中的负责角色，可为 null。 */
  ownerRole: string | null;
}

export interface BoardAcceptance {
  text: string;
  done: boolean;
}

export interface BoardCard {
  id: string;              // T-008
  title: string;
  lane: string;
  frs: string[];
  /** 「对应需求」原文的简写（FR 很多或写「全部」时）。 */
  frsLabel: string;
  specTaskIds: string[];
  branch: string | null;
  prTarget: string | null;
  deps: string[];
  unmetDeps: string[];
  assignee: string;
  /** 任务卡 / BOARD.md 声明的状态原文。 */
  declaredStatus: string;
  status: BoardCardStatus;
  /** 声明 done 但 git 中未合入集成分支。 */
  declaredMismatch: boolean;
  goal: string;
  acceptance: BoardAcceptance[];
  /** 相对项目根。 */
  file: string;
  merge: { sha: string; short: string; time: string } | null;
  ahead: number | null;
  behind: number | null;
  worktree: string | null;
  /** 分支改动是否全部落在本泳道（check-lane 同语义）；无分支或无改动为 null。 */
  laneOk: boolean | null;
  changedFiles: number;
  /** 最近一次相关提交时间（ISO 8601），无则 null。 */
  lastActivity: string | null;
}

export interface FeatureStage {
  key: string;
  label: string;
  done: boolean;
  detail: string;
}

export interface BoardFeature {
  id: string;              // 002-xxx
  dir: string;             // specs/002-xxx
  title: string;
  status: string;
  stages: FeatureStage[];
  tasksDone: number;
  tasksTotal: number;
}

export interface BoardSnapshot {
  /** 项目未打开或缺少 .agents/lanes.conf 时为 false，reason 给出中文原因。 */
  available: boolean;
  reason?: string;
  generatedAt: string;
  integrationBranch: string;
  mainBranch: string;
  maxParallel: number | null;
  lanes: BoardLane[];
  shared: string[];
  /** 最新（编号最大）的功能。 */
  feature: BoardFeature | null;
  cards: BoardCard[];
  contractVersion: string | null;
  /** BOARD.md 相对路径，缺失为 null。 */
  boardFile: string | null;
  /** 声明与 git 不一致等冲突的中文描述。 */
  conflicts: string[];
}

// ───────────────────────── v1.1：Git 分支与集成（功能 002） ─────────────────────────

export type GitBranchKind = 'main' | 'integration' | 'worker' | 'int' | 'other';

export interface GitCommitNode {
  sha: string;
  short: string;
  parents: string[];
  author: string;
  /** ISO 8601。 */
  time: string;
  subject: string;
  refs: string[];
}

export interface GitBranchInfo {
  name: string;
  sha: string;
  short: string;
  time: string;
  subject: string;
  kind: GitBranchKind;
  lane: string | null;
  task: string | null;
  /** 相对集成分支。 */
  ahead: number;
  behind: number;
  mergedIntoIntegration: boolean;
  worktree: string | null;
  current: boolean;
}

export interface GitMergeInfo {
  sha: string;
  short: string;
  time: string;
  subject: string;
  /** 从合并提交说明解析出的分支名（分支已删除时仍可追溯）。 */
  branch: string | null;
  /** 被合入分支的头提交短 sha。 */
  tip: string;
  /** 被合入分支自身的提交数。 */
  commitCount: number;
}

export interface GitWorktreeInfo {
  path: string;
  branch: string | null;
  head: string;
  dirtyCount: number;
  isMain: boolean;
}

export interface GitSnapshot {
  available: boolean;
  reason?: string;
  generatedAt: string;
  currentBranch: string | null;
  integrationBranch: string;
  mainBranch: string;
  integrationHead: string | null;
  mainHead: string | null;
  integrationAheadOfMain: number;
  mainAheadOfIntegration: number;
  branches: GitBranchInfo[];
  /** 最近提交（topo 顺序，新 → 旧，最多 200 条）。 */
  commits: GitCommitNode[];
  /** 集成分支 first-parent 上的合并（旧 → 新）。 */
  merges: GitMergeInfo[];
  /** main first-parent 上的合并（旧 → 新）。 */
  mainMerges: GitMergeInfo[];
  worktrees: GitWorktreeInfo[];
  tags: string[];
  remotes: string[];
  /** 当前工作区未提交文件数。 */
  dirtyCount: number;
  /** 本地仓库读不到 PR / CI / 审查者：恒为 null，界面显示「暂无」。 */
  pullRequests: null;
  ci: null;
}

// ───────────────────────── v1.2：只读代码查看（功能 003） ─────────────────────────

/** 代码查看的大小上限（字节）。 */
export const FILE_VIEW_LIMITS = Object.freeze({
  /** 超过即 kind='too-large'，不返回内容。 */
  maxBytes: 2_000_000,
  /** 超过即只返回前 previewBytes 字节（截到最后一个完整行），truncated=true。 */
  previewBytes: 512_000,
  /** 前 N 字节含 NUL 视为二进制。 */
  binarySniffBytes: 8_000,
});

/** text = 可显示文本；binary = 二进制（不返回内容）；too-large = 超过 maxBytes（不返回内容）。 */
export type FileContentKind = 'text' | 'binary' | 'too-large';

export interface FileContent {
  /** 规范化后的相对项目根路径（/ 分隔）。 */
  relPath: string;
  /** 文件字节数。 */
  size: number;
  kind: FileContentKind;
  /** kind='text' 时为 UTF-8 文本（可能被截断）；其余为 ''。 */
  content: string;
  /** 内容是否被截断到 previewBytes。 */
  truncated: boolean;
}
