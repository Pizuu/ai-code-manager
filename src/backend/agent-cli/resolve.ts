/**
 * 可执行文件解析（FR-112、FR-114，ADR 0006）：PATH + PATHEXT 查找；Windows 上不经 shell 执行 .cmd/.bat，
 * 遇到 npm 生成的包装脚本时从脚本中定位真实 .exe（例如 node_modules/opencode-ai/bin/opencode.exe）。
 */
import fs from 'node:fs/promises';
import path from 'node:path';

export interface ResolveDeps {
  platform: NodeJS.Platform;
  pathEnv: string;
  pathExt: string;
  isFile(p: string): Promise<boolean>;
  readText(p: string): Promise<string | null>;
}

export type ResolveResult = { ok: true; path: string } | { ok: false; reason: string };

export function defaultResolveDeps(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): ResolveDeps {
  return {
    platform,
    pathEnv: env.PATH ?? env.Path ?? '',
    pathExt: env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD',
    isFile: async (p) => {
      try {
        return (await fs.stat(p)).isFile();
      } catch {
        return false;
      }
    },
    readText: async (p) => {
      try {
        return await fs.readFile(p, 'utf8');
      } catch {
        return null;
      }
    },
  };
}

const SHIM_EXT = /\.(cmd|bat)$/i;

/** 从 npm cmd-shim 内容中找出目标 .exe（相对脚本目录）。 */
export function exeFromCmdShim(shimPath: string, content: string, p: path.PlatformPath): string | null {
  const m = /"%(?:dp0|~dp0)%\\?([^"%]+?\.exe)"/i.exec(content) ?? /%~dp0\\?([^"\s%]+?\.exe)/i.exec(content);
  return m?.[1] ? p.join(p.dirname(shimPath), m[1]) : null;
}

export async function resolveExecutable(command: string, deps: ResolveDeps): Promise<ResolveResult> {
  const win = deps.platform === 'win32';
  const p = win ? path.win32 : path.posix;
  const cmd = command.trim();
  if (!cmd) return { ok: false, reason: '未填写可执行文件。' };
  const exts = win ? ['', ...deps.pathExt.split(';').filter(Boolean).map((e) => e.toLowerCase())] : [''];
  const hasDir = /[\\/]/.test(cmd) || p.isAbsolute(cmd);
  const dirs = hasDir ? [''] : deps.pathEnv.split(win ? ';' : ':').filter(Boolean);

  let shim: string | null = null;
  for (const dir of dirs) {
    const base = dir ? p.join(dir, cmd) : cmd;
    // 已带扩展名时只试原样
    const candidates = win && p.extname(cmd) ? [base] : exts.map((e) => base + e);
    for (const c of candidates) {
      if (!(await deps.isFile(c))) continue;
      if (win && SHIM_EXT.test(c)) {
        shim ??= c;
        continue;
      }
      if (win && p.extname(c) === '' ) continue; // Windows 上无扩展名的文件（如 npm 的 sh 脚本）无法直接执行
      return { ok: true, path: c };
    }
  }
  if (shim) {
    const content = (await deps.readText(shim)) ?? '';
    const exe = exeFromCmdShim(shim, content, p);
    if (exe && (await deps.isFile(exe))) return { ok: true, path: exe };
    const guess = p.join(p.dirname(shim), 'node_modules', 'opencode-ai', 'bin', 'opencode.exe');
    if (/opencode\.cmd$/i.test(shim) && (await deps.isFile(guess))) return { ok: true, path: guess };
    return { ok: false, reason: `找到的是包装脚本 ${shim}，出于安全考虑不经 shell 执行，且无法从中定位 .exe。请在设置中填写 .exe 的完整路径。` };
  }
  return { ok: false, reason: hasDir ? `可执行文件不存在：${cmd}` : `在 PATH 中找不到「${cmd}」。` };
}
