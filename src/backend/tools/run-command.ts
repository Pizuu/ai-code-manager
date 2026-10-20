/**
 * run_command 执行（FR-008）：Windows 用 PowerShell，其余用 bash；cwd = 项目根；流式输出、超时、可中止。
 * 命令原文作为单个参数传给 shell，应用自身不做字符串拼接解析（宪法 九：命令原文已由用户逐条批准）。
 */
import { spawn } from 'node:child_process';
import { TOOL_LIMITS } from '../../../contracts/tools.ts';

export interface ShellSpec {
  file: string;
  args: string[];
  /** 展示给用户的 shell 名称。 */
  label: string;
}

/** PowerShell 默认按系统代码页输出（中文 Windows 为 GBK），先切到 UTF-8 避免乱码。 */
const PS_UTF8_PREAMBLE = '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [System.Text.Encoding]::UTF8; ';

export function shellFor(platform: NodeJS.Platform, command: string): ShellSpec {
  if (platform === 'win32') {
    return {
      file: 'powershell.exe',
      args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', PS_UTF8_PREAMBLE + command],
      label: 'powershell.exe',
    };
  }
  return { file: 'bash', args: ['-lc', command], label: 'bash' };
}

export function clampTimeout(ms: number | undefined): number {
  if (ms === undefined || !Number.isFinite(ms) || ms <= 0) return TOOL_LIMITS.commandDefaultTimeoutMs;
  return Math.min(Math.floor(ms), TOOL_LIMITS.commandMaxTimeoutMs);
}

export interface RunOptions {
  command: string;
  cwd: string;
  timeoutMs: number;
  signal: AbortSignal;
  onData: (stream: 'stdout' | 'stderr', data: string) => void;
  platform?: NodeJS.Platform;
}

export interface RunResult {
  exitCode: number | null;
  output: string;
  timedOut: boolean;
  aborted: boolean;
}

function killTree(pid: number, platform: NodeJS.Platform): void {
  try {
    if (platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch (err) {
    // 进程可能已退出；记录到 stderr 便于排查，不中断流程
    console.warn(`结束进程 ${pid} 失败：${(err as Error).message}`);
  }
}

export function runCommand(opts: RunOptions): Promise<RunResult> {
  const platform = opts.platform ?? process.platform;
  const spec = shellFor(platform, opts.command);
  return new Promise((resolve) => {
    let output = '';
    let timedOut = false;
    let aborted = false;
    const cap = TOOL_LIMITS.maxOutputChars * 2;
    const child = spawn(spec.file, spec.args, {
      cwd: opts.cwd,
      windowsHide: true,
      detached: platform !== 'win32',
      env: process.env,
    });
    const collect = (stream: 'stdout' | 'stderr') => (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      if (output.length < cap) output += text;
      opts.onData(stream, text);
    };
    child.stdout.on('data', collect('stdout'));
    child.stderr.on('data', collect('stderr'));
    const stop = () => {
      if (child.pid !== undefined && child.exitCode === null) killTree(child.pid, platform);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, opts.timeoutMs);
    const onAbort = () => {
      aborted = true;
      stop();
    };
    if (opts.signal.aborted) onAbort();
    else opts.signal.addEventListener('abort', onAbort, { once: true });
    let settled = false;
    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal.removeEventListener('abort', onAbort);
      resolve({ exitCode, output, timedOut, aborted });
    };
    child.on('error', (err) => {
      output += `\n无法启动 ${spec.label}：${err.message}`;
      finish(null);
    });
    child.on('close', (code) => finish(code));
  });
}
