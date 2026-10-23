/**
 * 文件树一层列举（FR-001），供左栏懒加载与 list_dir 共用忽略规则。
 */
import fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import type { FileNode } from '../../../contracts/ipc.ts';
import { resolveSafe, toRelPosix } from '../tools/sandbox.ts';
import path from 'node:path';

/** 文件树与搜索都跳过的目录名。 */
export const IGNORED_DIRS: ReadonlySet<string> = new Set([
  '.git', 'node_modules', 'dist', 'release', 'out', 'build', 'coverage', '.next', '.venv', '__pycache__',
]);

/** 单个目录最多返回的条目数，防止超大目录拖垮界面。 */
export const MAX_DIR_ENTRIES = 2000;

export async function listTree(root: string, relDir: string): Promise<FileNode[]> {
  const abs = await resolveSafe(root, relDir);
  // 目录不存在（如可选的 .specify/bugs）或路径是文件：视为空目录，不抛错打断界面
  let entries: Dirent[] = [];
  try {
    entries = await fs.readdir(abs, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT' && code !== 'ENOTDIR') throw err;
  }
  return entries
    .filter((e) => !(e.isDirectory() && IGNORED_DIRS.has(e.name)))
    .map((e): FileNode => ({
      name: e.name,
      relPath: toRelPosix(root, path.join(abs, e.name)),
      kind: e.isDirectory() ? 'dir' : 'file',
    }))
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1))
    .slice(0, MAX_DIR_ENTRIES);
}
