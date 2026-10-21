/**
 * 上传真实文件（契约 v1.14 `files:import`）：把系统文件选择（`files:pick`）得到的项目外
 * 文件复制进当前项目根的 `uploads/` 目录，返回项目相对路径（正斜杠，如 `uploads/报告.pdf`），
 * 前端据此以 @ 引用插入输入框，agent 的文件工具（项目根沙箱，宪法 十一）才能真正读到内容。
 *
 * 整批口径：先全量校验并定好每个文件的目标名（此阶段不写任何文件），任一源无效
 * （不存在 / 不是普通文件 / 文件名不可用）则整批抛错、不复制任何文件；
 * 复制阶段的 IO 错误（磁盘满等）仍可能留下已复制的前几项——uploads/ 是导入专用目录，
 * 残留文件无副作用，故不做回滚，原始错误如实抛出。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { ipcError } from '../ipc/validate.ts';
import { toRelPosix } from '../tools/sandbox.ts';

/** 导入目标目录名（项目根下）。 */
export const UPLOADS_DIR_NAME = 'uploads';

/**
 * 文件名清洗：剥掉路径分隔符与控制字符（源路径已经过 basename 取名，这里是防穿越的
 * 第二道防线）；清洗后为空或纯点名（`.` / `..` / `...`）不可用，整批拒绝。
 */
function cleanBaseName(raw: string, srcForError: string): string {
  const name = [...raw.replace(/[/\\]/g, '')]
    .filter((ch) => { const c = ch.codePointAt(0) ?? 0; return c > 0x1f && c !== 0x7f; })
    .join('')
    .trim();
  if (name === '' || /^\.+$/.test(name)) {
    throw ipcError('E_VALIDATION', `文件名无法用于导入：${srcForError}`);
  }
  return name;
}

/** 路径相等比较（win32 大小写不敏感）。 */
function samePath(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** 本批占用名的集合键（与 samePath 同口径）。 */
function takenKey(name: string): string {
  return process.platform === 'win32' ? name.toLowerCase() : name;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * 把 absPaths 逐个复制进 `<projectRoot>/uploads/`，返回与入参同序的项目相对路径。
 * 重名处理：目标已存在且不是源文件本身（或已被同批前项占用）时，依次在扩展名前
 * 加 `-1`、`-2`… 后缀（无扩展名加在末尾）。源已在 uploads/ 内且就是目标本身时不复制、原样返回。
 */
export async function importFiles(projectRoot: string, absPaths: readonly string[]): Promise<string[]> {
  if (absPaths.length === 0) return [];
  const root = path.resolve(projectRoot);
  const uploadsAbs = path.join(root, UPLOADS_DIR_NAME);

  // 一、全量校验 + 定目标名（不写任何文件）
  const plan: { srcAbs: string; targetAbs: string; rel: string; copy: boolean }[] = [];
  const taken = new Set<string>();
  for (const src of absPaths) {
    const srcAbs = path.resolve(src);
    let stat;
    try {
      stat = await fs.stat(srcAbs);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw ipcError('E_NOT_FOUND', `文件不存在，无法导入：${src}`);
      }
      throw err;
    }
    if (!stat.isFile()) throw ipcError('E_VALIDATION', `不是文件，无法导入：${src}`);

    const base = cleanBaseName(path.basename(srcAbs), src);
    const ext = path.extname(base);
    const stem = ext ? base.slice(0, -ext.length) : base;
    let name = base;
    let n = 0;
    for (;;) {
      const candidate = path.join(uploadsAbs, name);
      // 防穿越兜底：最终路径必须落在 uploads/ 内
      const relIn = path.relative(uploadsAbs, candidate);
      if (relIn.startsWith('..') || path.isAbsolute(relIn)) {
        throw ipcError('E_VALIDATION', `文件名无法用于导入：${src}`);
      }
      if (taken.has(takenKey(name))) {
        n += 1;
        name = `${stem}-${n}${ext}`;
        continue;
      }
      if (samePath(candidate, srcAbs)) break; // 源就是这个目标本身
      if (await exists(candidate)) {
        n += 1;
        name = `${stem}-${n}${ext}`;
        continue;
      }
      break;
    }
    taken.add(takenKey(name));
    const targetAbs = path.join(uploadsAbs, name);
    plan.push({ srcAbs, targetAbs, rel: toRelPosix(root, targetAbs), copy: !samePath(targetAbs, srcAbs) });
  }

  // 二、逐个复制（源即目标的跳过）；uploads/ 在第一次真正复制前才建
  let dirReady = false;
  for (const item of plan) {
    if (!item.copy) continue;
    if (!dirReady) {
      await fs.mkdir(uploadsAbs, { recursive: true });
      dirReady = true;
    }
    await fs.copyFile(item.srcAbs, item.targetAbs);
  }
  return plan.map((p) => p.rel);
}
