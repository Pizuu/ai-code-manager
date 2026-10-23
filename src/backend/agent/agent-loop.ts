/**
 * Agent 循环：用户消息 → 模型（流式）→ 工具调用 → 结果回传 → … 直到模型不再调用工具。
 * 所有副作用经 executor 的审批闸门；每轮工具执行后持久化会话（宪法 十三）。
 */
import type {
  AgentEvent,
  ApprovalRequest,
  ChatMessage,
  PermissionMode,
  Session,
  ToolCallRecord,
} from '../../../contracts/ipc.ts';
import { TOOL_DEFINITIONS } from '../../../contracts/tools.ts';
import { executeTool, type ApprovalInput } from '../tools/executor.ts';
import type { Provider } from './providers/types.ts';

/** 单条用户消息内最多的模型调用轮数（spec Edge Cases）。 */
export const MAX_TOOL_TURNS = 25;
const TITLE_MAX_CHARS = 40;
export const DEFAULT_SESSION_TITLE = '新会话';

export interface AgentDeps {
  provider: Provider;
  model: string;
  mode: PermissionMode;
  projectRoot: string | null;
  system: string;
  signal: AbortSignal;
  emit(event: AgentEvent): void;
  /** 由 app-state 的审批登记表实现；停止时以 false 解析。 */
  requestApproval(req: ApprovalRequest): Promise<boolean>;
  persist(session: Session): Promise<void>;
  newId(): string;
  now(): string;
  platform?: NodeJS.Platform;
}

function summarize(session: Session) {
  return {
    id: session.id,
    title: session.title,
    projectPath: session.projectPath,
    updatedAt: session.updatedAt,
    messageCount: session.messages.length,
  };
}

/** 去掉 agent 中途停止时留下的空助手消息。 */
function historyForModel(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((m) => !(m.role === 'assistant' && m.content === '' && !m.toolCalls?.length));
}

export async function runAgentTurn(session: Session, userText: string, deps: AgentDeps): Promise<void> {
  const touch = () => {
    session.updatedAt = deps.now();
  };
  const save = async () => {
    touch();
    await deps.persist(session);
    deps.emit({ type: 'session-updated', summary: summarize(session) });
  };

  session.messages.push({ id: deps.newId(), role: 'user', content: userText, createdAt: deps.now() });
  if (session.title === DEFAULT_SESSION_TITLE || session.title === '') {
    session.title = userText.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX_CHARS) || DEFAULT_SESSION_TITLE;
  }
  if (!session.projectPath) session.projectPath = deps.projectRoot;
  await save();

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    if (deps.signal.aborted) return;
    const history = historyForModel(session.messages);
    const assistant: ChatMessage = { id: deps.newId(), role: 'assistant', content: '', createdAt: deps.now() };
    session.messages.push(assistant);
    deps.emit({ type: 'message-start', sessionId: session.id, message: { ...assistant } });

    const result = await deps.provider.stream(
      { model: deps.model, system: deps.system, messages: history, tools: TOOL_DEFINITIONS, signal: deps.signal },
      (delta) => {
        assistant.content += delta;
        deps.emit({ type: 'text-delta', sessionId: session.id, messageId: assistant.id, delta });
      },
    );
    if (result.toolCalls.length === 0) {
      await save();
      return;
    }

    assistant.toolCalls = result.toolCalls.map((c): ToolCallRecord => ({ id: c.id, name: c.name, input: c.input, status: 'pending' }));
    for (const [i, call] of result.toolCalls.entries()) {
      const record = assistant.toolCalls[i] as ToolCallRecord;
      const update = (patch: Partial<ToolCallRecord>) => {
        Object.assign(record, patch);
        deps.emit({ type: 'tool-call', sessionId: session.id, messageId: assistant.id, call: { ...record } });
      };
      if (deps.signal.aborted) {
        update({ status: 'rejected', output: '已被用户停止。' });
      } else {
        update({ status: 'running' });
        const exec = await executeTool(call, {
          projectRoot: deps.projectRoot,
          mode: deps.mode,
          signal: deps.signal,
          ...(deps.platform ? { platform: deps.platform } : {}),
          requestApproval: async (req: ApprovalInput) => {
            update({ status: 'awaiting-approval', ...(req.diff ? { diff: req.diff } : {}) });
            const approved = await deps.requestApproval({ ...req, id: deps.newId(), sessionId: session.id });
            if (approved) update({ status: 'running' });
            return approved;
          },
          onTerminal: (toolCallId, stream, data) => deps.emit({ type: 'terminal', sessionId: session.id, toolCallId, stream, data }),
          onTodos: (todos) => {
            session.todos = todos;
            deps.emit({ type: 'todos', sessionId: session.id, todos });
          },
        });
        update({ status: exec.status, output: exec.output, ...(exec.diff ? { diff: exec.diff } : {}) });
      }
      session.messages.push({ id: deps.newId(), role: 'tool', toolCallId: call.id, content: record.output ?? '', createdAt: deps.now() });
    }
    await save();
  }
  deps.emit({ type: 'error', sessionId: session.id, message: `已达到单次请求最多 ${MAX_TOOL_TURNS} 轮工具调用，已停止。可以发送「继续」让 Agent 接着做。` });
  await save();
}
