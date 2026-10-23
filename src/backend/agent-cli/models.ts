/**
 * opencode 可用模型枚举（契约 v1.5，agentCli:models）：运行 `<exe> models` 并逐行解析输出。
 * opencode 的 models 子命令每行输出一个 `provider/model` 形态的模型 id。
 * 定位是「尽力而为」的辅助查询：任何失败（解析不到可执行文件、非零退出、超时、输出超限）
 * 一律返回空数组，绝不抛错——调用方（设置 / 会话 UI）据此回退到手填模型。
 */
import { execFile } from 'node:child_process';
import { resolveExecutable, type ResolveDeps } from './resolve.ts';

/** 首次运行 opencode 会刷新模型目录，Windows 上常超过 10 秒，放宽到 30 秒。 */
export const MODELS_TIMEOUT_MS = 30_000;
/** 成功结果缓存时长：菜单反复打开不再每次起子进程。 */
export const MODELS_CACHE_MS = 10 * 60_000;
export const MAX_MODELS = 200;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
/** `provider/model` 形态：至少一个 '/'、各段非空且不含空白；允许 openrouter/anthropic/claude-x 这类多段 id。 */
const MODEL_LINE_RE = /^[^\s/]+(?:\/[^\s/]+)+$/;

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
const cache = new Map<string, { at: number; models: string[] }>();
const inflight = new Map<string, Promise<string[]>>();

/** 测试用：清空缓存。 */
export function clearModelsCache(): void { cache.clear(); inflight.clear(); }

export async function listOpencodeModels(opts: {
  command: string;
  resolveDeps: ResolveDeps;
  env: NodeJS.ProcessEnv;
  cwd?: string;
  /** 可注入运行器（测试用），默认 execFile。 */
  run?: (file: string, env: NodeJS.ProcessEnv, cwd: string | undefined) => Promise<string | null>;
  now?: () => number;
}): Promise<string[]> {
  const now = opts.now ?? Date.now;
  const key = `${opts.command}\u0000${opts.cwd ?? ''}`;
  const hit = cache.get(key);
  if (hit && now() - hit.at < MODELS_CACHE_MS) return hit.models;
  // 同时多次打开菜单只起一个子进程
  const running = inflight.get(key);
  if (running) return running;
  const run = opts.run ?? runModels;
  const p = (async () => {
    try {
      const r = await resolveExecutable(opts.command, opts.resolveDeps);
      if (!r.ok) return [];
      // 失败或空输出重试一次（首次刷新目录、偶发超时）
      for (let attempt = 0; attempt < 2; attempt++) {
        const out = await run(r.path, opts.env, opts.cwd);
        const models = out === null ? [] : parseModelsOutput(out);
        if (models.length) {
          cache.set(key, { at: now(), models });
          return models;
        }
      }
      return hit?.models ?? [];
    } catch {
      return hit?.models ?? [];
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}
