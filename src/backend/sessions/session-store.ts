/**
 * 会话持久化（FR-012，宪法 十三）：<dir>/<id>.json，每会话一个文件，原子写入。
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Session, SessionSummary } from '../../../contracts/ipc.ts';
import { DEFAULT_SESSION_TITLE } from '../agent/agent-loop.ts';
import { ipcError } from '../ipc/validate.ts';

const SESSION_ID_RE = /^[A-Za-z0-9-]{1,64}$/;

export function newSessionId(now: number = Date.now()): string {
  return `s-${now.toString(36)}-${randomBytes(4).toString('hex')}`;
}

export function summarizeSession(s: Session): SessionSummary {
  return { id: s.id, title: s.title, projectPath: s.projectPath, updatedAt: s.updatedAt, messageCount: s.messages.length };
}

export class SessionStore {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  private fileFor(id: string): string {
    if (!SESSION_ID_RE.test(id)) throw ipcError('E_VALIDATION', `会话 ID 非法：${id}`);
    return path.join(this.dir, `${id}.json`);
  }

  async create(projectPath: string | null): Promise<Session> {
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

  async save(session: Session): Promise<void> {
    const file = this.fileFor(session.id);
    await fs.mkdir(this.dir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(session), 'utf8');
    await fs.rename(tmp, file);
  }

  async delete(id: string): Promise<void> {
    await fs.rm(this.fileFor(id), { force: true });
  }

  async clear(id: string): Promise<Session> {
    const s = await this.get(id);
    const cleared: Session = { ...s, title: DEFAULT_SESSION_TITLE, messages: [], todos: [], updatedAt: new Date().toISOString() };
    await this.save(cleared);
    return cleared;
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
