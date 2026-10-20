/**
 * opencode 可用模型枚举（契约 v1.5，agentCli:models）：运行 `<exe> models` 并逐行解析输出。
 * opencode 的 models 子命令每行输出一个 `provider/model` 形态的模型 id。
 * 定位是「尽力而为」的辅助查询：任何失败（解析不到可执行文件、非零退出、超时、输出超限）
 * 一律返回空数组，绝不抛错——调用方（设置 / 会话 UI）据此回退到手填模型。
 */
import { execFile } from 'node:child_process';
import { resolveExecutable, type ResolveDeps } from './resolve.ts';

export const MODELS_TIMEOUT_MS = 10_000;
export const MAX_MODELS = 200;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
/** `provider/model` 形态：恰一个 '/'、两侧均非空且不含空白（模型 id 本身不含空白）。 */
const MODEL_LINE_RE = /^[^\s/]+\/[^\s/]+$/;

/** 逐行解析 `opencode models` 输出：去空白、只留 provider/model 形态、去重保序、上限 200 条。 */
export function parseModelsOutput(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || !MODEL_LINE_RE.test(line) || seen.has(line)) continue;
    seen.add(line);
    out.push(line);
    if (out.length >= MAX_MODELS) break;
  }
  return out;
}

function runModels(file: string, env: NodeJS.ProcessEnv, cwd: string | undefined): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(file, ['models'], { timeout: MODELS_TIMEOUT_MS, windowsHide: true, env, cwd, encoding: 'utf8', maxBuffer: MAX_OUTPUT_BYTES }, (err, stdout) => {
      resolve(err ? null : String(stdout ?? ''));
    });
  });
}

/**
 * 解析可执行文件并运行 `<exe> models`，返回模型 id 列表；任何失败返回 []。
 * 参数数组执行、不经 shell（与 resolve.ts / 版本探测同一安全口径）。
 */
export async function listOpencodeModels(opts: {
  command: string;
  resolveDeps: ResolveDeps;
  env: NodeJS.ProcessEnv;
  cwd?: string;
}): Promise<string[]> {
  try {
    const r = await resolveExecutable(opts.command, opts.resolveDeps);
    if (!r.ok) return [];
    const out = await runModels(r.path, opts.env, opts.cwd);
    return out === null ? [] : parseModelsOutput(out);
  } catch {
    return [];
  }
}
