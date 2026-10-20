/**
 * 外部 CLI agent 的一轮对话（FR-112–FR-116，ADR 0006）：
 * 记录用户消息 →（每次询问模式）批准命令行 → spawn（cwd = 项目根，shell:false）→ 解析输出为 AgentEvent →
 * 续接 ID 写回会话 → 停止时结束进程树 → 持久化（宪法 十三）。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import type { AgentEvent, AgentRef, ApprovalRequest, ChatMessage, PermissionMode, Session, TodoItem, ToolCallRecord } from '../../../contracts/ipc.ts';
import { DEFAULT_SESSION_TITLE } from '../agent/agent-loop.ts';
import { summarizeSession } from '../sessions/session-store.ts';
import { createUnifiedDiff } from '../tools/diff.ts';
import { buildArgs, describePermission, formatCommandLine, needsTurnApproval, permissionEnv, type InvocationConfig } from './invocation.ts';
import { mapTodoStatus, parseOpencodeLine, toolStatus, type OpencodeEvent } from './opencode-events.ts';

/** 主进程内部的 CLI 配置（env 已解密，绝不进入 IPC）。 */
export interface CliRuntimeConfig extends InvocationConfig {
  id: string;
  name: string;
  env: Record<string, string>;
}

export interface CliTurnDeps {
  config: CliRuntimeConfig;
  /** 已解析的可执行文件绝对路径。 */
  executable: string;
  projectRoot: string;
  mode: PermissionMode;
  platform: NodeJS.Platform;
  signal: AbortSignal;
  emit(event: AgentEvent): void;
  requestApproval(req: ApprovalRequest): Promise<boolean>;
  persist(session: Session): Promise<void>;
  newId(): string;
  now(): string;
  baseEnv?: NodeJS.ProcessEnv;
}

export const STDERR_TAIL_CHARS = 2000;
const TITLE_MAX_CHARS = 40;
export const CLI_INVOKE_TOOL = 'agent_cli';

function killTree(child: ChildProcess, platform: NodeJS.Platform): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  try {
    if (platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

function relPath(root: string, p: unknown): string {
  if (typeof p !== 'string' || !p) return '';
  const rel = path.isAbsolute(p) ? path.relative(root, p) : p;
  return rel.split(path.sep).join('/');
}

/** 由 opencode 工具事件推出 diff（有 metadata.diff 用之；新建文件由内容生成）。 */
export function diffForTool(root: string, ev: Extract<OpencodeEvent, { kind: 'tool' }>): string | undefined {
  const md = ev.metadata;
  if (typeof md.diff === 'string' && md.diff.trim()) return md.diff;
  const file = relPath(root, ev.input.filePath ?? ev.input.path ?? md.filepath);
  if (ev.tool === 'write' && typeof ev.input.content === 'string') {
    // 覆盖已有文件时 opencode 不回传旧内容，diff 只能显示新内容（工具结果中注明）
    return createUnifiedDiff(null, ev.input.content, file || 'file');
  }
  if (ev.tool === 'edit' && typeof ev.input.oldString === 'string' && typeof ev.input.newString === 'string') {
    return createUnifiedDiff(ev.input.oldString, ev.input.newString, file || 'file');
  }
  return undefined;
}

/** 一轮 CLI 对话的助手消息与事件落地（run 与 serve 两种模式共用）。 */
export interface CliTurnSink {
  assistant: ChatMessage;
  calls: ToolCallRecord[];
  upsert(rec: ToolCallRecord): void;
  appendText(t: string): void;
  /** 增量文本（serve 模式 message.part.delta）；与同一 part 的整段 text 事件去重。 */
  appendDelta(partId: string, delta: string): void;
  handle(ev: OpencodeEvent): void;
  terminal(toolCallId: string, stream: 'stdout' | 'stderr' | 'info', data: string): void;
  readonly sawError: boolean;
  save(): Promise<void>;
}

export interface CliTurnSinkDeps {
  config: Pick<CliRuntimeConfig, 'id' | 'name'>;
  projectRoot: string;
  emit(event: AgentEvent): void;
  persist(session: Session): Promise<void>;
  newId(): string;
  now(): string;
  /** 续接 ID 写入 session.cliSessions 的键（run 模式 = CLI id）。 */
  sessionKey: string;
  /** 步骤结束等信息行写到哪个工具调用的终端。 */
  infoToolCallId(): string;
}

/** 记录用户消息、设置标题并开始助手消息。 */
export async function beginCliTurn(session: Session, userText: string, deps: CliTurnSinkDeps): Promise<CliTurnSink> {
  const agent: AgentRef = `cli:${deps.config.id}`;
  const sid = session.id;
  const save = async () => {
    session.updatedAt = deps.now();
    await deps.persist(session);
    deps.emit({ type: 'session-updated', summary: summarizeSession(session) });
  };

  session.messages.push({ id: deps.newId(), role: 'user', content: userText, createdAt: deps.now() });
  if (session.title === DEFAULT_SESSION_TITLE || session.title === '') {
    session.title = userText.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX_CHARS) || DEFAULT_SESSION_TITLE;
  }
  if (!session.projectPath) session.projectPath = deps.projectRoot;
  await save();

  const assistant: ChatMessage = { id: deps.newId(), role: 'assistant', content: '', createdAt: deps.now(), agent, toolCalls: [] };
  session.messages.push(assistant);
  deps.emit({ type: 'message-start', sessionId: sid, message: { ...assistant, toolCalls: [] } });
  const calls = assistant.toolCalls as ToolCallRecord[];
  const upsert = (rec: ToolCallRecord) => {
    const i = calls.findIndex((c) => c.id === rec.id);
    if (i === -1) calls.push(rec);
    else calls[i] = rec;
    deps.emit({ type: 'tool-call', sessionId: sid, messageId: assistant.id, call: { ...rec } });
  };
  const appendText = (t: string) => {
    if (!t) return;
    assistant.content += t;
    deps.emit({ type: 'text-delta', sessionId: sid, messageId: assistant.id, delta: t });
  };
  let sawError = false;
  const partText = new Map<string, number>();
  const terminal = (toolCallId: string, stream: 'stdout' | 'stderr' | 'info', data: string) => deps.emit({ type: 'terminal', sessionId: sid, toolCallId, stream, data });

  const appendDelta = (partId: string, delta: string) => {
    if (!delta) return;
    const seen = partText.get(partId);
    if (seen === undefined && assistant.content && !assistant.content.endsWith('\n')) appendText('\n\n');
    appendText(delta);
    partText.set(partId, (seen ?? 0) + delta.length);
  };

  const handle = (ev: OpencodeEvent) => {
    if ('sessionId' in ev && ev.sessionId && session.cliSessions?.[deps.sessionKey] !== ev.sessionId) {
      session.cliSessions = { ...(session.cliSessions ?? {}), [deps.sessionKey]: ev.sessionId };
    }
    switch (ev.kind) {
      case 'text': {
        const seen = partText.get(ev.partId);
        if (seen === undefined) {
          if (assistant.content && !assistant.content.endsWith('\n')) appendText('\n\n');
          appendText(ev.text);
        } else if (ev.text.length > seen) appendText(ev.text.slice(seen));
        partText.set(ev.partId, Math.max(seen ?? 0, ev.text.length));
        break;
      }
      case 'tool': {
        const status = toolStatus(ev);
        const diff = diffForTool(deps.projectRoot, ev);
        const input = { ...ev.input };
        if (typeof input.filePath === 'string') input.path = relPath(deps.projectRoot, input.filePath);
        upsert({ id: ev.callId, name: ev.tool, input, status, output: ev.error || ev.output || ev.title, ...(diff ? { diff } : {}) });
        if (ev.tool === 'bash' && (status === 'done' || status === 'error')) {
          if (typeof ev.input.command === 'string') terminal(ev.callId, 'info', `$ ${ev.input.command}\n`);
          if (ev.output) terminal(ev.callId, 'stdout', ev.output.endsWith('\n') ? ev.output : `${ev.output}\n`);
        }
        if (ev.tool === 'todowrite' && Array.isArray(ev.input.todos)) {
          const todos: TodoItem[] = (ev.input.todos as unknown[]).map((t, i) => {
            const r = (t ?? {}) as Record<string, unknown>;
            return { id: typeof r.id === 'string' ? r.id : String(i + 1), content: typeof r.content === 'string' ? r.content : '', status: mapTodoStatus(r.status) };
          });
          session.todos = todos;
          deps.emit({ type: 'todos', sessionId: sid, todos });
        }
        break;
      }
      case 'step-finish':
        if (ev.tokens !== null) terminal(deps.infoToolCallId(), 'info', `[${deps.config.name}] 步骤结束（${ev.reason || 'stop'}）· tokens ${ev.tokens}\n`);
        break;
      case 'error':
        sawError = true;
        deps.emit({ type: 'error', sessionId: sid, message: `${deps.config.name}：${ev.message}` });
        break;
      case 'other':
        terminal(deps.infoToolCallId(), 'stdout', `${ev.raw}\n`);
        break;
      case 'invalid':
        if (ev.raw) terminal(deps.infoToolCallId(), 'stdout', `${ev.raw}\n`);
        break;
      default:
        break;
    }
  };

  return {
    assistant, calls, upsert, appendText, appendDelta, handle, terminal, save,
    get sawError() {
      return sawError;
    },
  };
}

export async function runCliTurn(session: Session, userText: string, deps: CliTurnDeps): Promise<void> {
  const sid = session.id;
  let invokeId = '';
  const sink = await beginCliTurn(session, userText, { ...deps, sessionKey: deps.config.id, infoToolCallId: () => invokeId });
  const { upsert, appendText, handle, save, calls } = sink;

  const cliSession = session.cliSessions?.[deps.config.id] ?? null;
  const args = buildArgs({ config: deps.config, prompt: userText, cwd: deps.projectRoot, cliSessionId: cliSession, mode: deps.mode });
  const cmdline = formatCommandLine(deps.executable, args.map((a) => (a === userText ? (a.length > 120 ? `${a.slice(0, 120)}…` : a) : a)), deps.platform);
  const perm = describePermission(deps.config, deps.mode);
  const invoke: ToolCallRecord = { id: `cli-${deps.newId()}`, name: CLI_INVOKE_TOOL, input: { agent: deps.config.name, command: cmdline, cwd: deps.projectRoot, permission: perm }, status: 'pending' };
  invokeId = invoke.id;
  if (needsTurnApproval(deps.mode)) {
    upsert({ ...invoke, status: 'awaiting-approval' });
    const approved = await deps.requestApproval({
      id: deps.newId(), sessionId: sid, toolCallId: invoke.id, kind: 'command',
      command: `${cmdline}\n# ${perm}`, shell: '直接执行（不经 shell）',
    });
    if (!approved) {
      upsert({ ...invoke, status: 'rejected', output: '用户拒绝启动外部 CLI。' });
      await save();
      return;
    }
  }
  if (deps.signal.aborted) {
    upsert({ ...invoke, status: 'rejected', output: '已被用户停止。' });
    await save();
    return;
  }
  upsert({ ...invoke, status: 'running' });

  const env: NodeJS.ProcessEnv = { ...(deps.baseEnv ?? process.env), ...deps.config.env, ...permissionEnv(deps.config, deps.mode) };
  const child = spawn(deps.executable, args, {
    cwd: deps.projectRoot, env, shell: false, windowsHide: true, detached: deps.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
  });
  const onAbort = () => killTree(child, deps.platform);
  deps.signal.addEventListener('abort', onAbort, { once: true });

  let stderrTail = '';
  let buffer = '';
  const terminal = (stream: 'stdout' | 'stderr' | 'info', data: string) => sink.terminal(invoke.id, stream, data);

  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    if (deps.config.outputFormat === 'text') {
      appendText(chunk);
      return;
    }
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (line.trim()) handle(parseOpencodeLine(line));
    }
  });
  child.stderr?.on('data', (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_CHARS);
    terminal('stderr', chunk);
  });

  const { code, spawnError } = await new Promise<{ code: number | null; spawnError: Error | null }>((resolve) => {
    child.once('error', (err) => resolve({ code: null, spawnError: err }));
    child.once('close', (c) => resolve({ code: c, spawnError: null }));
  });
  deps.signal.removeEventListener('abort', onAbort);
  if (buffer.trim() && deps.config.outputFormat !== 'text') handle(parseOpencodeLine(buffer));

  const aborted = deps.signal.aborted;
  for (const c of calls) if (c.status === 'running' && c.id !== invoke.id) upsert({ ...c, status: aborted ? 'rejected' : 'error', output: c.output || (aborted ? '已被用户停止。' : '进程结束时仍未完成。') });
  if (spawnError) {
    upsert({ ...invoke, status: 'error', output: `无法启动：${spawnError.message}` });
    deps.emit({ type: 'error', sessionId: sid, message: `无法启动 ${deps.config.name}：${spawnError.message}` });
  } else if (aborted) {
    upsert({ ...invoke, status: 'rejected', output: '已被用户停止（进程已结束）。' });
  } else if (code !== 0) {
    upsert({ ...invoke, status: 'error', output: `退出码 ${String(code)}` });
    if (!sink.sawError) deps.emit({ type: 'error', sessionId: sid, message: `${deps.config.name} 异常退出（退出码 ${String(code)}）${stderrTail.trim() ? `：${stderrTail.trim()}` : ''}` });
  } else {
    upsert({ ...invoke, status: 'done', output: `完成（退出码 0）${session.cliSessions?.[deps.config.id] ? ` · 会话 ${session.cliSessions[deps.config.id]}` : ''}` });
  }
  await save();
}
