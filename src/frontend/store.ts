/**
 * 前端状态与按主题的变更通知。状态只在 main.ts 的事件处理与各视图的用户操作中修改。
 */
import type {
  ApprovalRequest,
  BoardSnapshot,
  GitSnapshot,
  ProjectInfo,
  PublicSettings,
  Session,
  SessionSummary,
  SpecTaskFile,
  TerminalInfo,
  ToolCallStatus,
} from '../../contracts/ipc.ts';

export interface DiffEntry {
  toolCallId: string;
  path: string;
  diff: string;
  status: ToolCallStatus;
}

export interface TerminalChunk {
  toolCallId: string;
  stream: 'stdout' | 'stderr' | 'info';
  data: string;
}

/**
 * v1.6：任务会话「终端模式」的运行态（按会话 ID 索引）。
 * buffer 为累计原始输出（含 ANSI 序列），渲染时按帧解析。
 */
export interface TerminalLive {
  sessionId: string;
  id: string;
  program: string;
  cwd: string;
  kind: 'shell' | 'cli';
  alive: boolean;
  /** 累计输出（超出上限时丢弃最早的片段）。 */
  buffer: string;
  /** 进程退出码；未退出为 null。 */
  exitCode: number | null;
}

/** 仅在界面显示、不持久化的提示（错误、本地命令结果）。 */
export interface Notice {
  afterMessageId: string | null;
  kind: 'notice' | 'info';
  text: string;
}

/** P1-6：会话级错误条目（「出错」状态与错误 / 日志分区的数据源）。 */
export interface SessionError {
  id: string;
  kind: 'agent' | 'tool';
  text: string;
  detail: string;
  at: string;
}

export interface UiState {
  settings: PublicSettings | null;
  project: ProjectInfo | null;
  sessions: SessionSummary[];
  current: Session | null;
  running: Set<string>;
  approvals: Map<string, ApprovalRequest>;
  diffs: DiffEntry[];
  terminal: TerminalChunk[];
  /** v1.6：终端模式运行态（会话 ID → 终端）。 */
  terminals: Map<string, TerminalLive>;
  tasks: SpecTaskFile[];
  notices: Notice[];
  /** P1-6：各会话的错误条目（会话 ID → 条目）。 */
  errors: Map<string, SessionError[]>;
  /** 002：当前板块与两个只读快照。 */
  view: ViewId;
  board: BoardSnapshot | null;
  git: GitSnapshot | null;
  workspaceError: string | null;
}

/** agents = 「Worktree 与 Agent」（T-040，从 Git 页拆出的子视图，导航中缩进挂在 Git 与集成下）。 */
export type ViewId = 'board' | 'session' | 'git' | 'agents' | 'speckit';

export type Topic = 'settings' | 'project' | 'sessions' | 'current' | 'messages' | 'running' | 'approvals' | 'diffs' | 'terminal' | 'terminals' | 'tasks' | 'todos' | 'view' | 'workspace' | 'errors';

/** 终端面板保留的最大片段数。 */
const MAX_TERMINAL_CHUNKS = 5000;
/** v1.6：单个终端保留的最大输出字符数（超出丢最早的部分）。 */
const MAX_TERMINAL_BUFFER_CHARS = 200_000;

class Store {
  readonly state: UiState = {
    settings: null,
    project: null,
    sessions: [],
    current: null,
    running: new Set(),
    approvals: new Map(),
    diffs: [],
    terminal: [],
    terminals: new Map(),
    tasks: [],
    notices: [],
    errors: new Map(),
    view: 'session',
    board: null,
    git: null,
    workspaceError: null,
  };

  private readonly listeners = new Map<Topic, Set<() => void>>();

  on(topic: Topic, fn: () => void): void {
    const set = this.listeners.get(topic) ?? new Set();
    set.add(fn);
    this.listeners.set(topic, set);
  }

  /** 与 on 对称的解绑：短生命周期订阅方（如对话框页）在销毁时调用，不留悬挂监听。 */
  off(topic: Topic, fn: () => void): void {
    this.listeners.get(topic)?.delete(fn);
  }

  emit(...topics: Topic[]): void {
    for (const t of topics) for (const fn of this.listeners.get(t) ?? []) fn();
  }

  appendTerminal(chunk: TerminalChunk): void {
    this.state.terminal.push(chunk);
    if (this.state.terminal.length > MAX_TERMINAL_CHUNKS) this.state.terminal.splice(0, this.state.terminal.length - MAX_TERMINAL_CHUNKS);
    this.emit('terminal');
  }

  upsertDiff(entry: DiffEntry): void {
    const idx = this.state.diffs.findIndex((d) => d.toolCallId === entry.toolCallId);
    if (idx === -1) this.state.diffs.unshift(entry);
    else this.state.diffs[idx] = { ...this.state.diffs[idx], ...entry };
    this.emit('diffs');
  }

  // ── v1.6：终端模式 ──

  /** 记录（或复用）某会话的终端。同一会话重复 open 幂等。 */
  setTerminal(info: TerminalInfo): void {
    const cur = this.state.terminals.get(info.sessionId);
    if (cur) {
      cur.id = info.id;
      cur.program = info.program;
      cur.cwd = info.cwd;
      cur.kind = info.kind;
      cur.alive = info.alive;
    } else {
      this.state.terminals.set(info.sessionId, {
        sessionId: info.sessionId, id: info.id, program: info.program, cwd: info.cwd,
        kind: info.kind, alive: info.alive, buffer: '', exitCode: null,
      });
    }
    this.emit('terminals');
  }

  /** 追加终端输出（超上限时丢弃最早的部分）。terminalId 不匹配时忽略（重启前的旧终端残事件）。 */
  appendTerminalOutput(sessionId: string, terminalId: string, data: string): void {
    const t = this.state.terminals.get(sessionId);
    if (!t || t.id !== terminalId || !data) return;
    t.buffer += data;
    if (t.buffer.length > MAX_TERMINAL_BUFFER_CHARS) t.buffer = t.buffer.slice(t.buffer.length - MAX_TERMINAL_BUFFER_CHARS);
    this.emit('terminals');
  }

  /** 终端进程退出。terminalId 不匹配时忽略（重启前的旧终端残事件不算在新终端头上）。 */
  markTerminalExited(sessionId: string, terminalId: string, code: number | null): void {
    const t = this.state.terminals.get(sessionId);
    if (!t || t.id !== terminalId) return;
    t.alive = false;
    t.exitCode = code;
    this.emit('terminals');
  }

  /** 清空终端显示缓冲（不影响进程）。 */
  clearTerminalOutput(sessionId: string): void {
    const t = this.state.terminals.get(sessionId);
    if (!t) return;
    t.buffer = '';
    this.emit('terminals');
  }

  /** 结束某会话的终端（界面侧状态清理）。 */
  dropTerminal(sessionId: string): void {
    if (!this.state.terminals.delete(sessionId)) return;
    this.emit('terminals');
  }

  isRunning(): boolean {
    return this.state.current !== null && this.state.running.has(this.state.current.id);
  }

  // ── v1.7：会话级错误（P1-6）──

  /** 追加一条会话错误（同 id 覆盖旧条目）。 */
  addError(sessionId: string, entry: SessionError): void {
    const list = this.state.errors.get(sessionId) ?? [];
    const i = list.findIndex((e) => e.id === entry.id);
    if (i === -1) list.push(entry);
    else list[i] = entry;
    this.state.errors.set(sessionId, list);
    this.emit('errors');
  }

  /** 用持久化数据（会话消息）重建某会话的错误条目（切换会话时调用，保证重启后仍可追溯）。 */
  setErrors(sessionId: string, entries: SessionError[]): void {
    this.state.errors.set(sessionId, entries);
    this.emit('errors');
  }

  /** 某会话的错误条目。 */
  errorsOf(sessionId: string): SessionError[] {
    return this.state.errors.get(sessionId) ?? [];
  }
}

export const store = new Store();
