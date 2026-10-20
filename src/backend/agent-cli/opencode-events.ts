/**
 * opencode `run --format json` JSONL 事件解析（FR-112）。依据 opencode 1.19.3 真实输出
 * （contracts/fixtures/opencode-*.jsonl）。未知事件归为 other，由调用方作为终端输出显示。纯函数。
 */

export type OpencodeEvent =
  | { kind: 'text'; sessionId: string | null; partId: string; text: string }
  | {
      kind: 'tool';
      sessionId: string | null;
      callId: string;
      tool: string;
      status: 'pending' | 'running' | 'completed' | 'error';
      input: Record<string, unknown>;
      output: string;
      error: string;
      title: string;
      metadata: Record<string, unknown>;
    }
  | { kind: 'step-finish'; sessionId: string | null; reason: string; tokens: number | null }
  | { kind: 'step-start'; sessionId: string | null }
  | { kind: 'error'; sessionId: string | null; message: string }
  | { kind: 'other'; sessionId: string | null; raw: string }
  | { kind: 'invalid'; raw: string };

const rec = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export function parseOpencodeLine(line: string): OpencodeEvent {
  const raw = line.trim();
  let j: Record<string, unknown>;
  try {
    j = rec(JSON.parse(raw));
  } catch {
    return { kind: 'invalid', raw };
  }
  const sessionId = str(j.sessionID) || null;
  const part = rec(j.part);
  switch (j.type) {
    case 'text':
      return { kind: 'text', sessionId, partId: str(part.id), text: str(part.text) };
    case 'tool_use': {
      const state = rec(part.state);
      const s = str(state.status);
      return {
        kind: 'tool', sessionId, callId: str(part.callID) || str(part.id), tool: str(part.tool) || 'tool',
        status: s === 'completed' || s === 'error' || s === 'running' ? s : 'pending',
        input: rec(state.input), output: str(state.output), error: str(state.error), title: str(state.title), metadata: rec(state.metadata),
      };
    }
    case 'step_finish': {
      const t = rec(part.tokens);
      const total = typeof t.total === 'number' ? t.total : null;
      return { kind: 'step-finish', sessionId, reason: str(part.reason), tokens: total };
    }
    case 'step_start':
      return { kind: 'step-start', sessionId };
    case 'error': {
      const e = rec(j.error);
      const data = rec(e.data);
      return { kind: 'error', sessionId, message: str(data.message) || str(e.message) || str(e.name) || 'opencode 返回错误' };
    }
    default:
      return { kind: 'other', sessionId, raw };
  }
}

/** opencode 工具状态 → ToolCallStatus。被权限拒绝的调用记为 rejected。 */
export function toolStatus(ev: Extract<OpencodeEvent, { kind: 'tool' }>): 'running' | 'done' | 'error' | 'rejected' {
  if (ev.status === 'completed') return 'done';
  if (ev.status === 'error') return /rejected permission|permission.*(denied|rejected)/i.test(ev.error) ? 'rejected' : 'error';
  return 'running';
}

/** opencode todowrite 的 todos → 应用待办状态。 */
export function mapTodoStatus(s: unknown): 'pending' | 'in_progress' | 'completed' {
  if (s === 'in_progress') return 'in_progress';
  if (s === 'completed' || s === 'cancelled') return 'completed';
  return 'pending';
}
