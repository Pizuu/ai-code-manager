/**
 * 任务会话「终端模式」的后端（v1.6，ADR 0010）。
 *
 * - 一个会话至多一个终端；终端由主进程托管子进程（PowerShell / bash / 外部 CLI），
 *   渲染进程只送入「用户输入的文本」，收「子进程输出」，不接触路径与命令构造。
 * - 工作目录恒为项目根（宪法 十一）：渲染进程不能指定 cwd；命令由主进程按 kind 决定。
 * - 不是真 PTY（无 node-pty）：以管道方式收发，行为是「行式」交互（PowerShell `-Command -` / bash `-s`）。
 *   代价：全屏 TUI（方向键画屏）不工作；ANSI 颜色与光标控制序列由渲染进程解析（见前端 lib/ansi.ts）。
 * - 停止：结束进程树（Windows `taskkill /T /F`；POSIX 进程组 SIGKILL），与既有 CLI 通道同口径。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import type { TerminalKind } from '../../../contracts/ipc.ts';

/** 启动一个终端所需的全部信息（由主进程决定，渲染进程不可控）。 */
export interface TerminalSpec {
  sessionId: string;
  kind: TerminalKind;
  /** 工作目录（恒为项目根）。 */
  cwd: string;
  /** 可执行文件（绝对路径或 PATH 中的命令名）。 */
  file: string;
  /** 参数数组（不经 shell，不做字符串拼接）。 */
  args: string[];
  /** 展示名（PowerShell / bash / CLI 名称）。 */
  program: string;
  /** 追加到子进程的环境变量（不含敏感值时由调用方负责）。 */
  env?: Record<string, string>;
}

/** 终端句柄。 */
export interface TerminalHandle {
  readonly id: string;
  readonly sessionId: string;
  readonly kind: TerminalKind;
  readonly program: string;
  readonly cwd: string;
  readonly startedAt: string;
  /** 进程是否仍在运行（退出后为 false）。 */
  alive: boolean;
  /** 写入用户输入。 */
  write(data: string): void;
  /** 结束进程（结束进程树）。 */
  close(): void;
}

export interface TerminalManagerDeps {
  platform: NodeJS.Platform;
  /** 注入点（测试用）：默认 node:child_process.spawn。 */
  spawnFn?: typeof spawn;
  /** 子进程基础环境（默认 process.env）。 */
  baseEnv?: NodeJS.ProcessEnv;
  /** 注入点（测试用）：ID 生成。 */
  newId?: () => string;
  /** 注入点（测试用）：时间戳。 */
  now?: () => string;
  /** 子进程输出回调。 */
  onData?(sessionId: string, terminalId: string, data: string): void;
  /** 子进程退出回调。 */
  onExit?(sessionId: string, terminalId: string, code: number | null): void;
}

/** 结束进程树（与 agent-cli/cli-runner.ts 同口径）。 */
export function killTerminalTree(child: ChildProcess, platform: NodeJS.Platform): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  try {
    if (platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

/**
 * shell 命令行（按平台）。
 * - Windows：PowerShell `-Command -` 从 stdin 逐行读入并执行（实测可用，无提示符噪声）。
 * - POSIX：bash `--noprofile --norc -s` 从 stdin 读入脚本。
 */
export function shellCommand(platform: NodeJS.Platform): { file: string; args: string[]; program: string } {
  if (platform === 'win32') return { file: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-Command', '-'], program: 'PowerShell' };
  return { file: '/bin/bash', args: ['--noprofile', '--norc', '-s'], program: 'bash' };
}

/**
 * 外部 CLI 的「终端形态」参数：去掉 JSON 输出参数，让输出以人可读形式出现在终端里
 * （`opencode run --format json` → `opencode run`）。其余参数原样保留。
 */
export function interactiveArgs(args: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i] ?? '';
    if (a === '--format') {
      const next = args[i + 1];
      if (next === 'json' || next === 'jsonl') {
        i += 1;
        continue;
      }
    }
    if (a.startsWith('--format=')) {
      const v = a.slice('--format='.length);
      if (v === 'json' || v === 'jsonl') continue;
    }
    out.push(a);
  }
  return out;
}

/** 终端进程池：一个会话一个终端，退出后从池中移除。 */
export class TerminalManager {
  private readonly pool = new Map<string, TerminalHandle>();
  private readonly deps: TerminalManagerDeps;

  constructor(deps: TerminalManagerDeps) {
    this.deps = deps;
  }

  private newId(): string {
    return this.deps.newId ? this.deps.newId() : `t-${crypto.randomUUID()}`;
  }

  private now(): string {
    return this.deps.now ? this.deps.now() : new Date().toISOString();
  }

  /** 取得会话的终端（不存在返回 null）。 */
  get(sessionId: string): TerminalHandle | null {
    return this.pool.get(sessionId) ?? null;
  }

  /** 终端数量（测试与状态展示用）。 */
  get size(): number {
    return this.pool.size;
  }

  /**
   * 打开终端。已有存活终端时直接返回（幂等）；restart=true 时先结束旧终端再新建。
   * 返回的句柄在进程退出后 alive=false。
   */
  open(spec: TerminalSpec, restart = false): TerminalHandle {
    const existing = this.pool.get(spec.sessionId);
    if (existing && existing.alive) {
      if (!restart) return existing;
      existing.close();
    }
    const spawnFn = this.deps.spawnFn ?? spawn;
    const id = this.newId();
    const startedAt = this.now();
    const child = spawnFn(spec.file, spec.args, {
      cwd: spec.cwd,
      env: { ...(this.deps.baseEnv ?? process.env), ...(spec.env ?? {}) },
      shell: false,
      windowsHide: true,
      detached: this.deps.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const handle: TerminalHandle = {
      id,
      sessionId: spec.sessionId,
      kind: spec.kind,
      program: spec.program,
      cwd: spec.cwd,
      startedAt,
      alive: true,
      write: (data: string) => {
        if (!handle.alive) return;
        try {
          child.stdin?.write(data);
        } catch {
          // 进程已退出：忽略（退出事件另行通知）
        }
      },
      close: () => {
        if (!handle.alive) return;
        try {
          child.stdin?.end();
        } catch {
          // 忽略
        }
        killTerminalTree(child, this.deps.platform);
      },
    };
    this.pool.set(spec.sessionId, handle);
    const decode = (chunk: Buffer | string): string => (typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    child.stdout?.on('data', (chunk: Buffer | string) => this.deps.onData?.(spec.sessionId, id, decode(chunk)));
    child.stderr?.on('data', (chunk: Buffer | string) => this.deps.onData?.(spec.sessionId, id, decode(chunk)));
    const finish = (code: number | null) => {
      if (!handle.alive) return;
      handle.alive = false;
      if (this.pool.get(spec.sessionId) === handle) this.pool.delete(spec.sessionId);
      this.deps.onExit?.(spec.sessionId, id, code);
    };
    child.once('error', () => finish(null));
    child.once('close', (code: number | null) => finish(code));
    return handle;
  }

  /** 写入用户输入；无终端或已退出返回 false。 */
  write(sessionId: string, data: string): boolean {
    const t = this.pool.get(sessionId);
    if (!t || !t.alive) return false;
    t.write(data);
    return true;
  }

  /** 结束终端（幂等）。 */
  close(sessionId: string): void {
    const t = this.pool.get(sessionId);
    if (!t) return;
    t.close();
  }

  /** 应用退出时调用：结束全部终端。 */
  closeAll(): void {
    for (const t of [...this.pool.values()]) t.close();
    this.pool.clear();
  }
}
