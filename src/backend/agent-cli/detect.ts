/**
 * 热门 Agent CLI 自动检测（agentCli:detect）：按候选清单顺序在 PATH 中解析可执行文件，
 * 解析复用 resolve.ts；版本探测与 handlers 的 agentCli:check 同一方式（`<exe> --version`、15s 超时、取首行）。
 * 单个候选解析不到直接跳过；版本探测失败只令其 version 为 null，不影响整体。
 */
import { execFile } from 'node:child_process';
import path from 'node:path';
import type { AgentCliDetection } from '../../../contracts/ipc.ts';
import { defaultResolveDeps, resolveExecutable, type ResolveDeps } from './resolve.ts';

export interface PopularCli {
  name: string;
  command: string;
}

/** 热门 Agent CLI 候选清单（20 个；展示顺序即检测结果顺序）。 */
export const POPULAR_CLIS: readonly PopularCli[] = [
  { name: 'Claude Code', command: 'claude' },
  { name: 'OpenAI Codex', command: 'codex' },
  { name: 'opencode', command: 'opencode' },
  { name: 'Gemini CLI', command: 'gemini' },
  { name: 'Aider', command: 'aider' },
  { name: 'Qwen Code', command: 'qwen' },
  { name: 'GitHub Copilot CLI', command: 'copilot' },
  { name: 'Cursor Agent', command: 'cursor-agent' },
  { name: 'Goose', command: 'goose' },
  { name: 'Amp', command: 'amp' },
  { name: 'Cline', command: 'cline' },
  { name: 'Kilo Code', command: 'kilocode' },
  { name: 'Crush', command: 'crush' },
  { name: 'Kimi CLI', command: 'kimi' },
  { name: 'Droid', command: 'droid' },
  { name: 'Plandex', command: 'plandex' },
  { name: 'Junie', command: 'junie' },
  { name: 'Kiro CLI', command: 'kiro' },
  { name: 'Trae', command: 'trae' },
  { name: 'Windsurf', command: 'windsurf' },
];

export interface DetectDeps {
  resolveDeps: ResolveDeps;
  /** 运行 `<file> --version` 并返回首行版本文本（与 agentCli:check 同语义）；失败或超时返回 null。 */
  probeVersion(file: string, cwd: string): Promise<string | null>;
}

const VERSION_TIMEOUT_MS = 15_000;

/** 与 handlers 中 runVersion 相同的版本探测：执行 --version、15s 超时、输出截断后取首行。 */
export function probeCliVersion(file: string, cwd: string, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(file, ['--version'], { timeout: VERSION_TIMEOUT_MS, windowsHide: true, env, cwd, encoding: 'utf8', maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return resolve(null);
      const out = String(stdout || stderr || '').trim().slice(0, 300);
      resolve(out ? (out.split('\n')[0] ?? out) : null);
    });
  });
}

export function defaultDetectDeps(): DetectDeps {
  return {
    resolveDeps: defaultResolveDeps(),
    probeVersion: (file, cwd) => probeCliVersion(file, cwd),
  };
}

/** 逐个检测候选：只返回在 PATH 中解析成功的，顺序与 POPULAR_CLIS 一致。 */
export async function detectInstalledClis(deps: DetectDeps = defaultDetectDeps()): Promise<AgentCliDetection[]> {
  const found: AgentCliDetection[] = [];
  for (const c of POPULAR_CLIS) {
    const r = await resolveExecutable(c.command, deps.resolveDeps);
    if (!r.ok) continue;
    // 单个版本探测失败不影响整体：version 落为 null
    const version = await deps.probeVersion(r.path, path.dirname(r.path)).catch(() => null);
    found.push({ name: c.name, command: c.command, resolvedPath: r.path, version });
  }
  return found;
}
