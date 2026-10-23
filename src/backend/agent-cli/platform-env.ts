/**
 * opencode 启动环境适配（系统判断）：三条通道（acp / serve / run）共用，解决两个实测失败：
 *
 * 1. question 工具失败（「couldn't be shown to the user in this client」）：
 *    本客户端三种嵌入方式都没有承接 opencode question 工具的界面，模型调用必然失败。
 *    ACP 通道原已以 OPENCODE_ENABLE_QUESTION_TOOL=false 禁用，此处统一为共用常量，推广到 serve / run。
 *
 * 2. bash 工具在 Windows 不可用（「No tool named bash is currently available」）：
 *    Windows 本身没有 bash，opencode 的命令工具需要 Git Bash 或配置 shell。
 *    win32 启动前先探测 Git Bash：用户既有 OPENCODE_GIT_BASH_PATH 优先，其次 Git 常见安装目录，
 *    其次 PATH 中的 bash.exe；命中则注入 OPENCODE_GIT_BASH_PATH 指给 opencode。
 *    探测不到时经 OPENCODE_CONFIG_CONTENT 指定 shell=powershell.exe
 *    （opencode 官方口径：shell 选项同样用于 agent 工具调用；与本应用 run_command 在 win32 用 PowerShell 一致）。
 *    用户已在 OPENCODE_CONFIG_CONTENT 里指定 shell、或其内容不是可合并的 JSON 对象时，一律不覆盖。
 *    非 win32 平台不注入任何 shell 相关变量。
 */
import { existsSync } from 'node:fs';
import path from 'node:path';

/** question 工具禁用（三条通道共用；ACP 通道原字面量与此一致）。 */
export const OPENCODE_QUESTION_ENV: Readonly<Record<string, string>> = Object.freeze({
  OPENCODE_ENABLE_QUESTION_TOOL: 'false',
});

export type ExistsFn = (p: string) => boolean;

const defaultExists: ExistsFn = (p) => {
  try {
    return existsSync(p);
  } catch {
    return false;
  }
};

/** Git Bash 候选路径（仅 win32 调用）：Git 常见安装目录 + PATH 各目录下的 bash.exe。 */
export function gitBashCandidates(env: NodeJS.ProcessEnv): string[] {
  const out: string[] = [];
  const roots = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA ? path.win32.join(env.LOCALAPPDATA, 'Programs') : undefined];
  for (const r of roots) if (r) out.push(path.win32.join(r, 'Git', 'bin', 'bash.exe'));
  for (const dir of (env.PATH ?? '').split(';')) {
    const d = dir.trim();
    if (d) out.push(path.win32.join(d, 'bash.exe'));
  }
  return out;
}

/** 探测 Git Bash 可执行文件；找不到返回 null。 */
export function findGitBash(env: NodeJS.ProcessEnv, exists: ExistsFn = defaultExists): string | null {
  for (const c of gitBashCandidates(env)) if (exists(c)) return c;
  return null;
}

/**
 * 按平台生成 opencode 的 shell 适配环境变量（纯判断 + 注入式文件探测）。
 * 返回 {} 表示无需适配：非 win32、用户已指定 GIT_BASH_PATH、或用户配置已指定 shell / 不可合并。
 */
export function opencodePlatformEnv(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  exists: ExistsFn = defaultExists,
): Record<string, string> {
  if (platform !== 'win32') return {};
  if ((env.OPENCODE_GIT_BASH_PATH ?? '').trim()) return {};
  const gitBash = findGitBash(env, exists);
  if (gitBash) return { OPENCODE_GIT_BASH_PATH: gitBash };
  const raw = (env.OPENCODE_CONFIG_CONTENT ?? '').trim();
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
      if ('shell' in parsed) return {};
      return { OPENCODE_CONFIG_CONTENT: JSON.stringify({ ...parsed, shell: 'powershell.exe' }) };
    } catch {
      // 用户的内联配置不是合法 JSON：不覆盖，维持原状。
      return {};
    }
  }
  return { OPENCODE_CONFIG_CONTENT: JSON.stringify({ shell: 'powershell.exe' }) };
}

/** 一次启动 opencode 需要的全部适配变量：question 禁用 + 平台 shell 适配。 */
export function opencodeLaunchEnv(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  exists: ExistsFn = defaultExists,
): Record<string, string> {
  return { ...OPENCODE_QUESTION_ENV, ...opencodePlatformEnv(platform, env, exists) };
}
