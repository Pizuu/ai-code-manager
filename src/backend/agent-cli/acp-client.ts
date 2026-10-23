/**
 * ACP（Agent Client Protocol）客户端 peer：与 `opencode acp` 子进程以 stdio NDJSON 逐行 JSON-RPC 2.0 通信。
 * 实现形状参考 orca 的 acp-agent-connection（orca 源码深读结论，2026-10-20）：
 * - 出站请求带自增 id、待答表；入站请求交给 handlers.onRequest，通知交给 handlers.onNotification。
 * - 未声明的客户端能力方法（fs/*、terminal/* 等）在 runner 层回 -32601（见 acp-runner.ts）。
 * - stderr 只作诊断：保留尾巴，进程退出时随 AcpProcessExitError 一起带出。
 * - 关闭：先结束 stdin，再 SIGTERM（Windows 结束进程树），超时未退再 SIGKILL。
 * - JSON-RPC 错误码 -32000 视为「未登录」（opencode auth 约定）：isAcpAuthError 供上层给出登录提示。
 */
import { spawn, type ChildProcess } from 'node:child_process';

export const ACP_PROTOCOL_VERSION = 1;
/** opencode 以 JSON-RPC -32000 表示未登录 / 凭据无效。 */
export const ACP_AUTH_ERROR_CODE = -32000;
/** 方法未实现（本客户端不声明 fs / terminal 能力）。 */
export const ACP_METHOD_NOT_FOUND = -32601;

const STDERR_TAIL_CHARS = 2000;

export class AcpRpcError extends Error {
  readonly code: number;
  readonly data?: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = 'AcpRpcError';
    this.code = code;
    if (data !== undefined) this.data = data;
  }
}

export class AcpProcessExitError extends Error {
  readonly exitCode: number | null;
  readonly stderrTail: string;
  constructor(exitCode: number | null, stderrTail: string) {
    const tail = stderrTail.trim();
    super(`opencode acp 进程已退出（退出码 ${String(exitCode)}）${tail ? `：${tail.slice(-500)}` : ''}`);
    this.name = 'AcpProcessExitError';
    this.exitCode = exitCode;
    this.stderrTail = stderrTail;
  }
}

export function isAcpAuthError(err: unknown): boolean {
  return err instanceof AcpRpcError && err.code === ACP_AUTH_ERROR_CODE;
}

export interface AcpPeerHandlers {
  /** agent → client 通知（无 id）。 */
  onNotification?(method: string, params: unknown): void;
  /** agent → client 请求（有 id）：返回结果值；抛 AcpRpcError 按其 code 回复，其余异常回 -32603。 */
  onRequest?(method: string, params: unknown): Promise<unknown> | unknown;
}

interface PendingRequest {
  resolve(v: unknown): void;
  reject(e: Error): void;
  timer?: NodeJS.Timeout;
}

const rec = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** 一个 ACP 子进程连接（请求 / 通知 / 入站分发 / 待答表）。 */
export class AcpPeer {
  private readonly child: ChildProcess;
  private readonly handlers: AcpPeerHandlers;
  private readonly platform: NodeJS.Platform;
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private buf = '';
  private errTail = '';
  private exitedFlag = false;
  private exitCodeValue: number | null = null;
  private closedFlag = false;
  readonly exitPromise: Promise<{ code: number | null; signal: string | null }>;

  constructor(child: ChildProcess, handlers: AcpPeerHandlers = {}, opts: { platform?: NodeJS.Platform } = {}) {
    this.child = child;
    this.handlers = handlers;
    this.platform = opts.platform ?? process.platform;
    let resolveExit: (v: { code: number | null; signal: string | null }) => void = () => undefined;
    this.exitPromise = new Promise((r) => {
      resolveExit = r;
    });
    let exitSettled = false;
    const onExit = (code: number | null, signal: string | null) => {
      if (exitSettled) return;
      exitSettled = true;
      this.exitedFlag = true;
      this.exitCodeValue = code;
      resolveExit({ code, signal });
      const err = new AcpProcessExitError(code, this.errTail);
      for (const p of this.pending.values()) {
        if (p.timer) clearTimeout(p.timer);
        p.reject(err);
      }
      this.pending.clear();
    };
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => this.onData(chunk));
    child.stderr?.on('data', (chunk: string) => {
      this.errTail = (this.errTail + chunk).slice(-STDERR_TAIL_CHARS);
    });
    child.once('error', () => onExit(child.exitCode, null));
    child.once('exit', (code, signal) => onExit(code, signal));
  }

  get exited(): boolean {
    return this.exitedFlag;
  }

  stderrTail(): string {
    return this.errTail;
  }

  private write(msg: Record<string, unknown>): boolean {
    if (this.exitedFlag) return false;
    try {
      return this.child.stdin?.write(`${JSON.stringify(msg)}\n`) ?? false;
    } catch {
      return false;
    }
  }

  /** 发起请求；timeoutMs 缺省 = 不超时（如 session/prompt)。 */
  request<T = unknown>(method: string, params?: unknown, opts: { timeoutMs?: number } = {}): Promise<T> {
    if (this.exitedFlag) return Promise.reject(new AcpProcessExitError(this.exitCodeValue, this.errTail));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const entry: PendingRequest = {
        resolve: (v) => resolve(v as T),
        reject,
      };
      if (opts.timeoutMs !== undefined) {
        entry.timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`ACP 请求 ${method} 超时（${opts.timeoutMs}ms）`));
        }, opts.timeoutMs);
        entry.timer.unref?.();
      }
      this.pending.set(id, entry);
      if (!this.write({ jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) })) {
        this.pending.delete(id);
        if (entry.timer) clearTimeout(entry.timer);
        reject(new AcpProcessExitError(this.exitCodeValue, this.errTail));
      }
    });
  }

  /** 发送通知（无响应）。进程已退出时静默丢弃（失败会由在途请求 / 退出事件体现）。 */
  notify(method: string, params?: unknown): void {
    this.write({ jsonrpc: '2.0', method, ...(params !== undefined ? { params } : {}) });
  }

  private onData(chunk: string): void {
    this.buf += chunk;
    let nl: number;
    while ((nl = this.buf.indexOf('\n')) !== -1) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (line) this.dispatch(line);
    }
  }

  private dispatch(line: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = rec(JSON.parse(line));
    } catch {
      return; // 非 JSON 行（agent 的杂散 stdout）忽略
    }
    const id = msg.id;
    const method = typeof msg.method === 'string' ? msg.method : '';
    if (method && (typeof id === 'number' || typeof id === 'string')) {
      // agent → client 请求
      void (async () => {
        try {
          if (!this.handlers.onRequest) throw new AcpRpcError(ACP_METHOD_NOT_FOUND, `Method not found: ${method}`);
          const result = await this.handlers.onRequest(method, msg.params);
          this.write({ jsonrpc: '2.0', id, result: result ?? null });
        } catch (err) {
          const e = err instanceof AcpRpcError ? err : new AcpRpcError(-32603, err instanceof Error ? err.message : String(err));
          this.write({ jsonrpc: '2.0', id, error: { code: e.code, message: e.message, ...(e.data !== undefined ? { data: e.data } : {}) } });
        }
      })();
      return;
    }
    if (method) {
      try {
        this.handlers.onNotification?.(method, msg.params);
      } catch {
        // 通知处理异常不得中断读取循环
      }
      return;
    }
    if (typeof id === 'number') {
      const entry = this.pending.get(id);
      if (!entry) return;
      this.pending.delete(id);
      if (entry.timer) clearTimeout(entry.timer);
      const errObj = rec(msg.error);
      if (msg.error !== undefined && msg.error !== null) {
        entry.reject(new AcpRpcError(typeof errObj.code === 'number' ? errObj.code : -32603, typeof errObj.message === 'string' ? errObj.message : 'ACP 请求失败', errObj.data));
      } else {
        entry.resolve(msg.result);
      }
    }
  }

  /** 关闭：结束 stdin 后 SIGTERM（Windows 用 taskkill 结束进程树）；2.5s 仍未退出则强杀。 */
  close(): void {
    if (this.closedFlag) return;
    this.closedFlag = true;
    try {
      this.child.stdin?.end();
    } catch {
      // 已关闭的 stdin 忽略
    }
    if (this.exitedFlag || this.child.exitCode !== null || this.child.pid === undefined) return;
    const pid = this.child.pid;
    try {
      if (this.platform === 'win32') spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
      else this.child.kill('SIGTERM');
    } catch {
      try {
        this.child.kill('SIGKILL');
      } catch {
        // 进程已不在
      }
    }
    const t = setTimeout(() => {
      if (this.child.exitCode === null) {
        try {
          if (this.platform !== 'win32') process.kill(-pid, 'SIGKILL');
          else this.child.kill('SIGKILL');
        } catch {
          // 进程已退出
        }
      }
    }, 2500);
    t.unref?.();
  }
}

export interface StartAcpOptions {
  executable: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  /** 启动参数（默认 ['acp']）。 */
  args?: string[];
  spawnFn?: typeof spawn;
}

/** 启动 `<exe> acp` 并建 peer（shell:false；非 Windows 以进程组启动便于整组关闭）。 */
export function startAcpProcess(opts: StartAcpOptions, handlers: AcpPeerHandlers): { peer: AcpPeer; child: ChildProcess } {
  const platform = opts.platform ?? process.platform;
  const spawnFn = opts.spawnFn ?? spawn;
  const child = spawnFn(opts.executable, opts.args ?? ['acp'], {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    shell: false,
    windowsHide: true,
    detached: platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const peer = new AcpPeer(child, handlers, { platform });
  return { peer, child };
}
