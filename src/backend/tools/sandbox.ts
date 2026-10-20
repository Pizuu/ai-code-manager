/**
 * 项目根路径沙箱（宪法 十一、FR-006）。
 * 两层检查：词法（resolve + relative，不触盘）与真实路径（realpath，防符号链接逃逸）。
 */
import fs from 'node:fs/promises';
import path from 'node:path';

/** 路径越出项目根时抛出；message 以 E_PATH_ESCAPE 开头，便于 IPC 与工具结果识别。 */
export class PathEscapeError extends Error {
  constructor(input: string) {
    super(`E_PATH_ESCAPE: 路径 "${input}" 不在项目根目录内，已拒绝。`);
    this.name = 'PathEscapeError';
  }
}

function isOutside(rel: string, p: path.PlatformPath): boolean {
  if (rel === '') return false;
  if (p.isAbsolute(rel)) return true; // 跨盘符时 relative 返回绝对路径
  return rel === '..' || rel.startsWith(`..${p.sep}`);
}

/**
 * 把模型给出的路径解析为项目根内的绝对路径（纯词法，不访问磁盘）。
 * @param p 路径实现，默认当前平台；测试中可传 path.win32 / path.posix。
 */
export function resolveInsideRoot(root: string, input: string, p: path.PlatformPath = path): string {
  if (typeof input !== 'string') throw new PathEscapeError(String(input));
  if (input.includes('\0')) throw new PathEscapeError(input.replace(/\0/g, '\\0'));
  const normalizedRoot = p.resolve(root);
  const candidate = input.trim() === '' ? '.' : input;
  const abs = p.resolve(normalizedRoot, candidate);
  if (isOutside(p.relative(normalizedRoot, abs), p)) throw new PathEscapeError(input);
  return abs;
}

/** 相对项目根的显示路径，统一使用 / 分隔；根本身返回 "."。 */
export function toRelPosix(root: string, abs: string, p: path.PlatformPath = path): string {
  const rel = p.relative(p.resolve(root), abs);
  return rel === '' ? '.' : rel.split(p.sep).join('/');
}

async function nearestExisting(abs: string): Promise<{ existing: string; rest: string[] }> {
  const rest: string[] = [];
  let current = abs;
  for (;;) {
    try {
      await fs.lstat(current);
      return { existing: current, rest };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      const parent = path.dirname(current);
      if (parent === current) return { existing: current, rest };
      rest.unshift(path.basename(current));
      current = parent;
    }
  }
}

/**
 * 词法检查 + 真实路径检查：目标（或其最近存在的祖先）经 realpath 后仍须在项目根的 realpath 内。
 * 返回词法绝对路径（供后续读写）。
 */
export async function resolveSafe(root: string, input: string): Promise<string> {
  const abs = resolveInsideRoot(root, input);
  const realRoot = await fs.realpath(root);
  const { existing, rest } = await nearestExisting(abs);
  const realExisting = await fs.realpath(existing);
  const realTarget = path.join(realExisting, ...rest);
  if (isOutside(path.relative(realRoot, realTarget), path)) throw new PathEscapeError(input);
  return abs;
}
