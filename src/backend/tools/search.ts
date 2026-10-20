/**
 * 文本搜索（类 ripgrep，纯 Node 实现）。跳过忽略目录、符号链接、二进制与超大文件。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { TOOL_LIMITS } from '../../../contracts/tools.ts';
import { IGNORED_DIRS } from '../fs/file-tree.ts';
import { matchesGlob } from './glob.ts';
import { resolveSafe, toRelPosix } from './sandbox.ts';

export interface SearchOptions {
  pattern: string;
  dir?: string;
  glob?: string;
  regex?: boolean;
  maxResults?: number;
  signal?: AbortSignal;
}

export interface SearchMatch {
  path: string;
  line: number;
  text: string;
}

export interface SearchResult {
  matches: SearchMatch[];
  truncated: boolean;
  filesScanned: number;
}

const MAX_LINE_PREVIEW = 300;
const BINARY_SNIFF_BYTES = 8000;

function buildMatcher(pattern: string, regex: boolean): (line: string) => boolean {
  if (!regex) return (line) => line.includes(pattern);
  let re: RegExp;
  try {
    re = new RegExp(pattern);
  } catch (err) {
    throw new Error(`正则表达式无效：${(err as Error).message}`, { cause: err });
  }
  return (line) => re.test(line);
}

export async function searchFiles(root: string, opts: SearchOptions): Promise<SearchResult> {
  const max = Math.min(Math.max(1, opts.maxResults ?? TOOL_LIMITS.searchDefaultResults), TOOL_LIMITS.searchMaxResults);
  const matcher = buildMatcher(opts.pattern, opts.regex ?? false);
  const start = await resolveSafe(root, opts.dir ?? '');
  const result: SearchResult = { matches: [], truncated: false, filesScanned: 0 };
  const stack = [start];

  while (stack.length > 0) {
    if (opts.signal?.aborted) break;
    const dir = stack.pop() as string;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue; // 无权限目录：跳过（结果中不报错，避免噪声）
    }
    entries.sort((a, b) => b.name.localeCompare(a.name)); // 出栈顺序即字母序
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (!IGNORED_DIRS.has(e.name)) stack.push(abs);
        continue;
      }
      if (!e.isFile()) continue;
      const rel = toRelPosix(root, abs);
      if (opts.glob && !matchesGlob(rel, opts.glob)) continue;
      const stat = await fs.stat(abs);
      if (stat.size > TOOL_LIMITS.searchMaxFileBytes) continue;
      const buf = await fs.readFile(abs);
      if (buf.subarray(0, BINARY_SNIFF_BYTES).includes(0)) continue;
      result.filesScanned++;
      const lines = buf.toString('utf8').split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] as string;
        if (!matcher(line)) continue;
        if (result.matches.length >= max) {
          result.truncated = true;
          return result;
        }
        result.matches.push({ path: rel, line: i + 1, text: line.trim().slice(0, MAX_LINE_PREVIEW) });
      }
    }
  }
  return result;
}

export function formatSearchResult(r: SearchResult): string {
  if (r.matches.length === 0) return `未找到匹配（扫描了 ${r.filesScanned} 个文件）。`;
  const lines = r.matches.map((m) => `${m.path}:${m.line}: ${m.text}`);
  if (r.truncated) lines.push(`…结果已截断（达到上限 ${r.matches.length} 条），请缩小范围。`);
  return lines.join('\n');
}
