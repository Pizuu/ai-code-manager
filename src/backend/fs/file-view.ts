/**
 * 只读代码查看（FR-301–FR-303，契约 v1.2 `fs:read`）。
 * 路径经项目根沙箱（含 realpath，宪法 十一）；只读普通文件；超大不返回内容、较大截断、二进制不返回内容。
 */
import fs from 'node:fs/promises';
import type { FileContent } from '../../../contracts/ipc.ts';
import { FILE_VIEW_LIMITS } from '../../../contracts/ipc.ts';
import { ipcError } from '../ipc/validate.ts';
import { resolveSafe, toRelPosix } from '../tools/sandbox.ts';

export interface FileViewLimits { maxBytes: number; previewBytes: number; binarySniffBytes: number }

const NEWLINE = 0x0a;

export async function readFileForView(root: string, relPath: string, limits: FileViewLimits = FILE_VIEW_LIMITS): Promise<FileContent> {
  const abs = await resolveSafe(root, relPath);
  const rel = toRelPosix(root, abs);
  if (rel === '.') throw ipcError('E_VALIDATION', '请指定文件路径。');
  let stat;
  try {
    stat = await fs.stat(abs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw ipcError('E_NOT_FOUND', `文件 ${rel} 不存在。`);
    throw err;
  }
  if (stat.isDirectory()) throw ipcError('E_VALIDATION', `${rel} 是目录，不能作为文件打开。`);
  if (!stat.isFile()) throw ipcError('E_VALIDATION', `${rel} 不是普通文件。`);
  const base = { relPath: rel, size: stat.size };
  if (stat.size > limits.maxBytes) return { ...base, kind: 'too-large', content: '', truncated: false };

  const want = Math.min(stat.size, limits.previewBytes);
  const fh = await fs.open(abs, 'r');
  let buf: Buffer;
  try {
    const out = Buffer.alloc(want);
    const { bytesRead } = await fh.read(out, 0, want, 0);
    buf = out.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
  if (buf.subarray(0, limits.binarySniffBytes).includes(0)) return { ...base, kind: 'binary', content: '', truncated: false };

  const truncated = stat.size > limits.previewBytes;
  if (truncated) {
    // 截到最后一个完整行，避免切断多字节字符
    const lastNl = buf.lastIndexOf(NEWLINE);
    if (lastNl > 0) buf = buf.subarray(0, lastNl + 1);
  }
  let content = buf.toString('utf8');
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
  return { ...base, kind: 'text', content, truncated };
}
