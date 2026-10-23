/**
 * 文件类工具：list_dir、read_file（只读）与 write_file、edit_file（两阶段：prepare 计算 diff → commit 写入）。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { EditFileInput, ListDirInput, ReadFileInput, WriteFileInput } from '../../../contracts/tools.ts';
import { TOOL_LIMITS } from '../../../contracts/tools.ts';
import { listTree } from '../fs/file-tree.ts';
import { createUnifiedDiff } from './diff.ts';
import { applyEdit } from './edit.ts';
import { resolveSafe, toRelPosix } from './sandbox.ts';

/** read_file 拒绝读取超过该大小的文件。 */
const MAX_READ_BYTES = 5_000_000;
const BINARY_SNIFF_BYTES = 8000;

export async function listDir(root: string, input: ListDirInput): Promise<string> {
  const nodes = await listTree(root, input.path ?? '');
  if (nodes.length === 0) return '（空目录）';
  return nodes.map((n) => (n.kind === 'dir' ? `${n.name}/` : n.name)).join('\n');
}

export async function readFile(root: string, input: ReadFileInput): Promise<string> {
  const abs = await resolveSafe(root, input.path);
  const stat = await fs.stat(abs);
  if (stat.isDirectory()) return `${input.path} 是目录，请使用 list_dir。`;
  if (stat.size > MAX_READ_BYTES) return `文件过大（${stat.size} 字节），请用 search 定位后分段读取。`;
  const buf = await fs.readFile(abs);
  if (buf.subarray(0, BINARY_SNIFF_BYTES).includes(0)) return `${input.path} 看起来是二进制文件，未读取。`;
  const lines = buf.toString('utf8').split(/\r?\n/);
  const offset = Math.max(1, Math.floor(input.offset ?? 1));
  const limit = Math.max(1, Math.floor(input.limit ?? TOOL_LIMITS.readDefaultLines));
  const slice = lines.slice(offset - 1, offset - 1 + limit);
  const body = slice.map((l, i) => `${String(offset + i).padStart(6)}\t${l}`).join('\n');
  const remaining = lines.length - (offset - 1 + slice.length);
  return remaining > 0 ? `${body}\n…（还有 ${remaining} 行，可用 offset=${offset + slice.length} 继续读取）` : body;
}

/** 已计算好 diff、尚未落盘的写入。 */
export interface PreparedWrite {
  abs: string;
  rel: string;
  oldContent: string | null;
  newContent: string;
  diff: string;
}

async function readIfExists(abs: string): Promise<string | null> {
  try {
    return await fs.readFile(abs, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function prepareWrite(root: string, input: WriteFileInput): Promise<PreparedWrite> {
  const abs = await resolveSafe(root, input.path);
  const rel = toRelPosix(root, abs);
  const oldContent = await readIfExists(abs);
  return { abs, rel, oldContent, newContent: input.content, diff: createUnifiedDiff(oldContent, input.content, rel) };
}

export async function prepareEdit(root: string, input: EditFileInput): Promise<PreparedWrite> {
  const abs = await resolveSafe(root, input.path);
  const rel = toRelPosix(root, abs);
  const oldContent = await readIfExists(abs);
  if (oldContent === null) throw new Error(`文件 ${rel} 不存在；新建文件请使用 write_file。`);
  const outcome = applyEdit(oldContent, input.old_string, input.new_string, input.replace_all ?? false);
  if (!outcome.ok) throw new Error(outcome.error);
  return { abs, rel, oldContent, newContent: outcome.content, diff: createUnifiedDiff(oldContent, outcome.content, rel) };
}

/** 落盘前再次确认文件未被外部修改，避免覆盖用户在审批期间的改动。 */
export async function commitWrite(prepared: PreparedWrite): Promise<void> {
  const current = await readIfExists(prepared.abs);
  if (current !== prepared.oldContent) {
    throw new Error(`文件 ${prepared.rel} 在等待批准期间被修改，已放弃写入。请重新读取后再修改。`);
  }
  await fs.mkdir(path.dirname(prepared.abs), { recursive: true });
  await fs.writeFile(prepared.abs, prepared.newContent, 'utf8');
}
