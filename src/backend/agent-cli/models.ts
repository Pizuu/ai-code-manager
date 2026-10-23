/**
 * opencode 可用模型枚举（契约 v1.5，agentCli:models）：运行 `<exe> models` 并逐行解析输出。
 * opencode 的 models 子命令每行输出一个 `provider/model` 形态的模型 id。
 * 定位是「尽力而为」的辅助查询：任何失败（解析不到可执行文件、非零退出、超时、输出超限）
 * 一律返回空数组，绝不抛错——调用方（设置 / 会话 UI）据此回退到手填模型。
 */
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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

// ───────── opencode 默认模型（契约 v1.15 defaultModel） ─────────

/** 去掉 JSONC 的注释与尾随逗号（跳过字符串内容），再 JSON.parse；失败返回 null。 */
export function parseJsonc(text: string): unknown {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 2;
    } else {
      out += c;
      i++;
    }
  }
  try {
    return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
  } catch {
    return null;
  }
}

const modelOf = (v: unknown): string | undefined => {
  const m = (v as { model?: unknown } | null)?.model;
  return typeof m === 'string' && m.trim() ? m.trim() : undefined;
};

/**
 * 推断 opencode 不带 -m 运行时使用的模型，按 opencode 配置优先级（后者覆盖前者）：
 * 全局 ~/.config/opencode/{config.json,opencode.json,opencode.jsonc} → OPENCODE_CONFIG 指向的文件
 * → 项目根 opencode.json / opencode.jsonc → OPENCODE_CONFIG_CONTENT；
 * 都没有 model 时取 ~/.local/state/opencode/model.json 的最近使用模型（TUI 上次选的）。推断不到返回 undefined。
 * 只读文件、不起子进程；任何读取 / 解析失败都跳过该来源。
 */
export async function readOpencodeDefaultModel(opts: {
  env: NodeJS.ProcessEnv;
  cwd?: string;
  home?: string;
  read?: (file: string) => Promise<string>;
}): Promise<string | undefined> {
  const read = opts.read ?? ((f: string) => readFile(f, 'utf8'));
  const home = opts.home ?? os.homedir();
  const cfgHome = opts.env.XDG_CONFIG_HOME || path.join(home, '.config');
  const stateHome = opts.env.XDG_STATE_HOME || path.join(home, '.local', 'state');
  const tryRead = async (f: string): Promise<unknown> => {
    try { return parseJsonc(await read(f)); } catch { return null; }
  };
  const files = [
    ...['config.json', 'opencode.json', 'opencode.jsonc'].map((n) => path.join(cfgHome, 'opencode', n)),
    ...(opts.env.OPENCODE_CONFIG ? [opts.env.OPENCODE_CONFIG] : []),
    ...(opts.cwd ? ['opencode.json', 'opencode.jsonc'].map((n) => path.join(opts.cwd!, n)) : []),
  ];
  let model: string | undefined;
  for (const f of files) model = modelOf(await tryRead(f)) ?? model;
  if (opts.env.OPENCODE_CONFIG_CONTENT) model = modelOf(parseJsonc(opts.env.OPENCODE_CONFIG_CONTENT)) ?? model;
  if (model) return model;
  const state = await tryRead(path.join(stateHome, 'opencode', 'model.json')) as { recent?: { providerID?: unknown; modelID?: unknown }[] } | null;
  const r = state?.recent?.[0];
  return typeof r?.providerID === 'string' && typeof r.modelID === 'string' ? `${r.providerID}/${r.modelID}` : undefined;
}
