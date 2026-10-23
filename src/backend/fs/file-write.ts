/**
 * 项目内文本文件写入：复用 realpath 沙箱校验，只覆盖已有普通文件，采用同目录临时文件再替换。
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { FileContent } from '../../../contracts/ipc.ts';
import { FILE_VIEW_LIMITS } from '../../../contracts/ipc.ts';
import { ipcError } from '../ipc/validate.ts';
import { resolveSafe, toRelPosix } from '../tools/sandbox.ts';

export const MAX_EDIT_BYTES = FILE_VIEW_LIMITS.maxBytes;

export async function writeTextFile(root: string, relPath: string, content: string): Promise<FileContent> {
  const abs = await resolveSafe(root, relPath);
  const rel = toRelPosix(root, abs);
  if (rel === '.') throw ipcError('E_VALIDATION', '请指定文件路径。');
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > MAX_EDIT_BYTES) throw ipcError('E_VALIDATION', `文件内容超过 ${MAX_EDIT_BYTES} 字节上限。`);
  let stat;
  try {
    stat = await fs.stat(abs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw ipcError('E_NOT_FOUND', `文件 ${rel} 不存在。`);
    throw err;
  }
  if (!stat.isFile()) throw ipcError('E_VALIDATION', `${rel} 不是普通文件。`);
  const temp = path.join(path.dirname(abs), `.${path.basename(abs)}.aicm-${crypto.randomUUID()}.tmp`);
  try {
    await fs.writeFile(temp, content, { encoding: 'utf8', flag: 'wx' });
    await fs.rename(temp, abs);
  } finally {
    await fs.rm(temp, { force: true }).catch(() => undefined);
  }
  return { relPath: rel, size: bytes, kind: 'text', content, truncated: false };
}
