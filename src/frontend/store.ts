/**
 * 前端状态与按主题的变更通知。状态只在 main.ts 的事件处理与各视图的用户操作中修改。
 */
import type {
  ApprovalRequest,
  ProjectInfo,
  PublicSettings,
  Session,
  SessionSummary,
  SpecTaskFile,
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

/** 仅在界面显示、不持久化的提示（错误、本地命令结果）。 */
export interface Notice {
  afterMessageId: string | null;
  kind: 'notice' | 'info';
  text: string;
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
  tasks: SpecTaskFile[];
  notices: Notice[];
}

export type Topic = 'settings' | 'project' | 'sessions' | 'current' | 'messages' | 'running' | 'approvals' | 'diffs' | 'terminal' | 'tasks' | 'todos';

/** 终端面板保留的最大片段数。 */
const MAX_TERMINAL_CHUNKS = 5000;

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
    tasks: [],
    notices: [],
  };

  private readonly listeners = new Map<Topic, Set<() => void>>();

  on(topic: Topic, fn: () => void): void {
    const set = this.listeners.get(topic) ?? new Set();
    set.add(fn);
    this.listeners.set(topic, set);
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

  isRunning(): boolean {
    return this.state.current !== null && this.state.running.has(this.state.current.id);
  }
}

export const store = new Store();
