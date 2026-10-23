/**
 * 会话持久化（FR-012，宪法 十三）：<dir>/<id>.json，每会话一个文件，原子写入。
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AgentRef, Session, SessionSummary } from '../../../contracts/ipc.ts';
import { DEFAULT_SESSION_TITLE } from '../agent/agent-loop.ts';
import { ipcError } from '../ipc/validate.ts';

const SESSION_ID_RE = /^[A-Za-z0-9-]{1,64}$/;

export function newSessionId(now: number = Date.now()): string {
  return `s-${now.toString(36)}-${randomBytes(4).toString('hex')}`;
}

/**
 * 最后一个完整问答的耗时（v1.9）：本轮完成时间与其之前最近的一个 user 消息的时间差。
 * 优先使用会话 updatedAt 作为完成时间；若旧数据的 updatedAt 早于 assistant 时间，则回退到最后
 * 一个 assistant 消息时间。这样会把流式输出和中间 tool 执行完整计入，而不是只计算 assistant
 * 消息创建到 user 消息的短暂间隔。找不到完整问答、时间戳非法或差值 <= 0 时返回 undefined。
 */
export function lastTurnMs(s: Session): number | undefined {
  let userAt: number | undefined;
  let answerAt: number | undefined;
  for (const m of s.messages) {
    if (m.role === 'user') {
      userAt = Date.parse(m.createdAt);
      answerAt = undefined;
    } else if (m.role === 'assistant' && userAt !== undefined && Number.isFinite(userAt)) {
      const at = Date.parse(m.createdAt);
      if (Number.isFinite(at) && at > userAt) answerAt = at;
    }
  }
  if (userAt === undefined || answerAt === undefined || !Number.isFinite(userAt)) return undefined;
  const updatedAt = Date.parse(s.updatedAt);
  const end = Number.isFinite(updatedAt) && updatedAt > answerAt ? updatedAt : answerAt;
  const ms = end - userAt;
  return Number.isFinite(ms) && ms > 0 ? ms : undefined;
}

export function summarizeSession(s: Session): SessionSummary {
  const turnMs = lastTurnMs(s);
  // v1.10：usage 随摘要走 session-updated 实时推送（回合中途的 step-finish / usage_update 落盘即带上），
  // 渲染进程据此刷新 Tokens chip，不必等回合结束重拉整会话。传副本，避免下游改动回写会话对象。
  return { id: s.id, title: s.title, projectPath: s.projectPath, updatedAt: s.updatedAt, messageCount: s.messages.length, ...(s.agent ? { agent: s.agent } : {}), ...(turnMs !== undefined ? { lastTurnMs: turnMs } : {}), ...(s.usage ? { usage: { ...s.usage } } : {}), ...(s.todos.length ? { todos: s.todos.map((todo) => ({ ...todo })) } : {}) };
}

interface SaveWaiter {
  seq: number;
  resolve: () => void;
  reject: (err: unknown) => void;
}

/** 单个会话的写队列状态：同时只允许一个写在飞，后到者只覆盖待写 payload。 */
interface SaveQueueState {
  seq: number;
  running: boolean;
  pending: { seq: number; payload: string } | null;
  waiters: SaveWaiter[];
}

export class SessionStore {
  private readonly dir: string;
  private dirReady: Promise<void> | null = null;
  private readonly saveQueues = new Map<string, SaveQueueState>();

  constructor(dir: string) {
    this.dir = dir;
  }

  private fileFor(id: string): string {
    if (!SESSION_ID_RE.test(id)) throw ipcError('E_VALIDATION', `会话 ID 非法：${id}`);
    return path.join(this.dir, `${id}.json`);
  }

  async create(projectPath: string | null, agent?: AgentRef): Promise<Session> {
    const now = new Date().toISOString();
    const session: Session = {
      schemaVersion: 1,
      id: newSessionId(),
      title: DEFAULT_SESSION_TITLE,
      projectPath,
      createdAt: now,
      updatedAt: now,
      messages: [],
      todos: [],
      ...(agent && agent !== 'builtin' ? { agent } : {}),
    };
    await this.save(session);
    return session;
  }

  async get(id: string): Promise<Session> {
    let raw: string;
    try {
      raw = await fs.readFile(this.fileFor(id), 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw ipcError('E_NOT_FOUND', `会话 ${id} 不存在`);
      throw err;
    }
    const parsed = JSON.parse(raw) as Session;
    if (parsed.schemaVersion !== 1) throw new Error(`会话 ${id} 的格式版本 ${String(parsed.schemaVersion)} 不受支持`);
    return parsed;
  }

  /**
   * 保存（带突发合并）：回合内每个步骤都会 persist 一次，全量重写很浪费。
   * 语义：调用瞬间先 JSON.stringify 定型快照（之后调用方再改 session 对象不影响本次）；
   * 同一会话同时只允许一个写在飞，在飞期间新到的 save 只保留最新 payload（覆盖待写），
   * 在飞写完后至多再补写这一次——一批突发 N 次最多落盘 2 次。不同会话互不阻塞。
   * 每次 save 的 Promise 在「序号 >= 本次提交序号的写」完成后才 resolve；该写失败则
   * 它覆盖的等待者（序号 <= 该写序号）reject，待写的更新 payload 继续由同一队列尝试，
   * 队列不会被一次失败卡死。
   */
  async save(session: Session): Promise<void> {
    const file = this.fileFor(session.id);
    const payload = JSON.stringify(session);
    await this.ensureDir();
    const q = this.queueFor(session.id);
    const seq = ++q.seq;
    return new Promise<void>((resolve, reject) => {
      q.waiters.push({ seq, resolve, reject });
      q.pending = { seq, payload };
      if (!q.running) void this.drain(session.id, file, q);
    });
  }

  /** 目录只确保一次；失败后清掉缓存，下一次 save 重试。 */
  private ensureDir(): Promise<void> {
    if (!this.dirReady) {
      this.dirReady = fs.mkdir(this.dir, { recursive: true }).then(
        () => undefined,
        (err: unknown) => {
          this.dirReady = null;
          throw err;
        },
      );
    }
    return this.dirReady;
  }

  private queueFor(id: string): SaveQueueState {
    let q = this.saveQueues.get(id);
    if (!q) {
      q = { seq: 0, running: false, pending: null, waiters: [] };
      this.saveQueues.set(id, q);
    }
    return q;
  }

  /** 串行消费一个会话的写队列：取最新待写 payload 落盘，循环到没有待写为止。 */
  private async drain(id: string, file: string, q: SaveQueueState): Promise<void> {
    q.running = true;
    try {
      while (q.pending) {
        const { seq, payload } = q.pending;
        q.pending = null;
        try {
          await this.writeFileAtomic(file, payload);
          this.settle(q, seq, null);
        } catch (err) {
          // 目录被外部删掉时写会 ENOENT：失效目录缓存，让下一次 save 重新建目录；
          // 本次覆盖的等待者照常 reject，待写的更新 payload 继续尝试，不卡死队列。
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') this.dirReady = null;
          this.settle(q, seq, err);
        }
      }
    } finally {
      q.running = false;
      if (q.waiters.length === 0 && !q.pending) this.saveQueues.delete(id);
    }
  }

  /** 序号 <= writtenSeq 的等待者被这次写覆盖：成功 resolve、失败 reject；更新的等待者留下。 */
  private settle(q: SaveQueueState, writtenSeq: number, err: unknown): void {
    const rest: SaveWaiter[] = [];
    for (const w of q.waiters) {
      if (w.seq > writtenSeq) rest.push(w);
      else if (err) w.reject(err);
      else w.resolve();
    }
    q.waiters = rest;
  }

  /** 原子写：临时文件 + rename；临时名带 pid，避免多进程互相踩（同会话的写已由队列串行化）。 */
  private async writeFileAtomic(file: string, payload: string): Promise<void> {
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, payload, 'utf8');
    await fs.rename(tmp, file);
  }

  async delete(id: string): Promise<void> {
    await fs.rm(this.fileFor(id), { force: true });
  }

  async clear(id: string): Promise<Session> {
    const s = await this.get(id);
    // 清空同时丢弃外部 CLI 的续接 ID，下一轮开启新的 CLI 会话
    const { cliSessions: _drop, ...rest } = s;
    void _drop;
    const cleared: Session = { ...rest, title: DEFAULT_SESSION_TITLE, messages: [], todos: [], updatedAt: new Date().toISOString() };
    await this.save(cleared);
    return cleared;
  }

  async setAgent(id: string, agent: AgentRef): Promise<Session> {
    const s = await this.get(id);
    const next: Session = { ...s, agent, updatedAt: new Date().toISOString() };
    await this.save(next);
    return next;
  }

  /** v1.5：设置 / 清除会话级 CLI 模型覆盖（model 为 null 时删除字段，回到 CLI 配置的模型）。 */
  async setCliModel(id: string, model: string | null): Promise<Session> {
    const s = await this.get(id);
    const next: Session = { ...s, updatedAt: new Date().toISOString() };
    if (model) next.cliModel = model;
    else delete next.cliModel;
    await this.save(next);
    return next;
  }

  /** 按最近更新倒序；损坏的文件跳过并在控制台告警，不影响其余会话。 */
  async list(): Promise<SessionSummary[]> {
    let names: string[];
    try {
      names = await fs.readdir(this.dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const out: SessionSummary[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const id = name.slice(0, -'.json'.length);
      if (!SESSION_ID_RE.test(id)) continue;
      try {
        out.push(summarizeSession(await this.get(id)));
      } catch (err) {
        console.warn(`跳过无法读取的会话 ${name}：${(err as Error).message}`);
      }
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}
