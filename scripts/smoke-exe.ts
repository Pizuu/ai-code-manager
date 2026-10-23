/**
 * 打包后可执行文件启动冒烟（T041，卡片 T-012）。
 *
 *   node scripts/smoke-exe.ts [<exe>] [--ms <毫秒>]
 *
 * 启动 exe，等待 --ms（默认 20000）毫秒：期间进程仍存活 = 启动成功（退出 0），随后结束整个进程树；
 * 期间提前退出 = 启动失败（打印退出码与输出，退出 1）。
 *
 * - 不传 exe 时默认 `release/win-unpacked/AI Code Manager.exe`，且只在 Windows 上运行；
 *   非 Windows 打印 `SKIP` 与原因后退出 0（无图形界面 / 平台不符时跳过并注明，不假装通过）。
 * - 显式传入 exe 时在任何平台上都真实执行（便于本地验证失败路径）。
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const APP_ROOT = path.resolve(import.meta.dirname, '..');
const DEFAULT_EXE = path.join(APP_ROOT, 'release', 'win-unpacked', 'AI Code Manager.exe');

function killTree(pid: number): void {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // 进程已退出，无需处理。
    }
  }
}

async function main(argv: string[]): Promise<number> {
  let ms = 20_000;
  let exe: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === '--ms') ms = Number(argv[++i]);
    else exe = path.resolve(a);
  }
  if (!Number.isFinite(ms) || ms <= 0) {
    console.error('--ms 必须是正数。');
    return 1;
  }
  if (!exe) {
    if (process.platform !== 'win32') {
      console.log(`SKIP: 当前平台 ${process.platform} 不是 Windows，未运行 exe 启动冒烟（需在 windows-latest CI 上验证）。`);
      return 0;
    }
    exe = DEFAULT_EXE;
  }
  if (!fs.existsSync(exe)) {
    console.error(`未找到可执行文件: ${exe}（请先 npm run dist）`);
    return 1;
  }

  console.log(`启动 ${exe}，观察 ${ms} ms ...`);
  const child = spawn(exe, [], {
    cwd: path.dirname(exe),
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  });
  let output = '';
  const keep = (b: Buffer): void => {
    output = (output + b.toString('utf8')).slice(-8000);
  };
  child.stdout?.on('data', keep);
  child.stderr?.on('data', keep);

  const result = await new Promise<{ exited: boolean; code: number | null; signal: string | null; error?: Error }>((resolve) => {
    const timer = setTimeout(() => resolve({ exited: false, code: null, signal: null }), ms);
    child.once('error', (error) => {
      clearTimeout(timer);
      resolve({ exited: true, code: null, signal: null, error });
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ exited: true, code, signal });
    });
  });

  if (!result.exited) {
    if (child.pid !== undefined) killTree(child.pid);
    console.log(`✓ 进程在 ${ms} ms 内保持运行，判定启动成功；已结束进程树。`);
    return 0;
  }
  console.error(
    `✗ 进程提前退出：${result.error ? result.error.message : `code=${String(result.code)} signal=${String(result.signal)}`}`,
  );
  if (output.trim()) console.error(`--- 最后输出 ---\n${output}`);
  return 1;
}

process.exitCode = await main(process.argv.slice(2));
