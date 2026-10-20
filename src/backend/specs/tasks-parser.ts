/**
 * 解析 Spec Kit tasks.md（FR-014）。语法见 specs/001-agent-desktop/data-model.md「SpecTask」。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { SpecTask, SpecTaskFile } from '../../../contracts/ipc.ts';

const TASK_RE = /^\s*[-*]\s+\[([ xX])\]\s+(T\d{3,})\b(.*)$/;
const TAG_RE = /^\s*\[([^\]]+)\]/;
const PLAIN_LANES: ReadonlySet<string> = new Set(['contracts', 'frontend', 'backend', 'docs', 'infra', '@shared']);
/** 最多读取的 feature 目录数，防止异常项目拖慢界面。 */
const MAX_FEATURES = 100;

export function parseTasksMarkdown(markdown: string): SpecTask[] {
  const tasks: SpecTask[] = [];
  let phase: string | null = null;
  const lines = markdown.split(/\r?\n/);
  lines.forEach((line, idx) => {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading && !line.startsWith('###')) {
      phase = heading[1] ?? null;
      return;
    }
    const m = TASK_RE.exec(line);
    if (!m) return;
    let rest = m[3] ?? '';
    let parallel = false;
    let story: string | null = null;
    let lane: string | null = null;
    for (;;) {
      const tag = TAG_RE.exec(rest);
      if (!tag) break;
      const value = (tag[1] ?? '').trim();
      if (value === 'P') parallel = true;
      else if (/^US\d+$/.test(value)) story = value;
      else if (value.startsWith('lane:')) lane = value.slice('lane:'.length).trim();
      else if (PLAIN_LANES.has(value)) lane = value;
      else break; // 不是已知标签：属于描述正文
      rest = rest.slice(tag[0].length);
    }
    tasks.push({
      id: m[2] ?? '',
      done: m[1] !== ' ',
      parallel,
      story,
      lane,
      description: rest.trim(),
      phase,
      line: idx + 1,
    });
  });
  return tasks;
}

/** 读取 <root>/specs/<feature>/tasks.md；没有 specs 目录时返回空数组。 */
export async function loadSpecTasks(root: string): Promise<SpecTaskFile[]> {
  const specsDir = path.join(root, 'specs');
  let entries;
  try {
    entries = await fs.readdir(specsDir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const features = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort().slice(0, MAX_FEATURES);
  const out: SpecTaskFile[] = [];
  for (const feature of features) {
    const file = path.join(specsDir, feature, 'tasks.md');
    let md: string;
    try {
      md = await fs.readFile(file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw err;
    }
    out.push({ relPath: `specs/${feature}/tasks.md`, feature, tasks: parseTasksMarkdown(md) });
  }
  return out;
}
