/**
 * opencode `run --format json` JSONL 事件解析（FR-112）。依据 opencode 1.19.3 真实输出
 * （contracts/fixtures/opencode-*.jsonl）。未知事件归为 other，由调用方作为终端输出显示。纯函数。
 */
import type { SessionUsage } from '../../../contracts/ipc.ts';

/** step_finish 的 token 用量（part.tokens 归一化形状，与契约 SessionUsage 同字段）。 */
export interface StepTokens {
  total: number;
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
}

/** 逐字段累加会话用量（v1.8）：prev 缺省按全 0。 */
export function accumulateUsage(prev: SessionUsage | undefined, t: StepTokens): SessionUsage {
  return {
    total: (prev?.total ?? 0) + t.total,
    input: (prev?.input ?? 0) + t.input,
    output: (prev?.output ?? 0) + t.output,
    reasoning: (prev?.reasoning ?? 0) + t.reasoning,
    cacheRead: (prev?.cacheRead ?? 0) + t.cacheRead,
    cacheWrite: (prev?.cacheWrite ?? 0) + t.cacheWrite,
  };
}

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
  | { kind: 'step-finish'; sessionId: string | null; reason: string; tokens: StepTokens | null }
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
      // tokens 整体缺失 / 非对象 → null（本步无用量）；各字段非 number 按 0；
      // total 缺失时以 input+output+reasoning+cache.read+cache.write 合成。
      const rawT = part.tokens;
      if (typeof rawT !== 'object' || rawT === null || Array.isArray(rawT)) {
        return { kind: 'step-finish', sessionId, reason: str(part.reason), tokens: null };
      }
      const t = rec(rawT);
      const cache = rec(t.cache);
      const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
      const input = num(t.input);
      const output = num(t.output);
      const reasoning = num(t.reasoning);
      const cacheRead = num(cache.read);
      const cacheWrite = num(cache.write);
      const total = typeof t.total === 'number' && Number.isFinite(t.total) ? t.total : input + output + reasoning + cacheRead + cacheWrite;
      return { kind: 'step-finish', sessionId, reason: str(part.reason), tokens: { total, input, output, reasoning, cacheRead, cacheWrite } };
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
