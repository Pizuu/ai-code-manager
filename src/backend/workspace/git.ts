/**
 * git CLI 运行器（FR-107）：只读命令、参数数组（不经 shell）、`--no-optional-locks`、超时与输出上限。
 */
import { execFile } from 'node:child_process';

export const GIT_TIMEOUT_MS = 15_000;
const MAX_BUFFER = 16 * 1024 * 1024;

export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  code: number | null;
}

export type GitRunner = (args: readonly string[]) => Promise<GitResult>;

/** 创建绑定到某个仓库根的运行器。 */
export function createGitRunner(root: string, gitBin = 'git'): GitRunner {
  return (args) =>
    new Promise((resolve) => {
      execFile(
        gitBin,
        ['--no-optional-locks', '-c', 'core.quotepath=false', '-C', root, ...args],
        { timeout: GIT_TIMEOUT_MS, maxBuffer: MAX_BUFFER, windowsHide: true, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' } },
        (err, stdout, stderr) => {
          if (err) {
            const code = typeof (err as NodeJS.ErrnoException & { code?: unknown }).code === 'number' ? ((err as unknown as { code: number }).code) : null;
            resolve({ ok: false, stdout: String(stdout ?? ''), stderr: String(stderr ?? err.message), code });
            return;
          }
          resolve({ ok: true, stdout: String(stdout), stderr: String(stderr), code: 0 });
        },
      );
    });
}

/** 运行并返回 stdout；失败返回空串（调用方把失败当作「无数据」）。 */
export async function gitOut(git: GitRunner, args: readonly string[]): Promise<string> {
  const r = await git(args);
  return r.ok ? r.stdout : '';
}

/** 判断目录是否在 git 工作树中；git 未安装时也返回 false 并给出原因。 */
export async function probeRepo(git: GitRunner): Promise<{ ok: boolean; reason?: string }> {
  const r = await git(['rev-parse', '--is-inside-work-tree']);
  if (r.ok && r.stdout.trim() === 'true') return { ok: true };
  if (/ENOENT|not found|不是内部或外部命令/i.test(r.stderr)) return { ok: false, reason: '未找到 git 可执行文件，请安装 Git 并确保在 PATH 中。' };
  return { ok: false, reason: '当前项目不是 Git 仓库。' };
}

/** 以有限并发映射（避免同时拉起过多 git 进程）。 */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
