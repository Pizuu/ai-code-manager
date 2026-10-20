/**
 * 泳道配置解析（FR-104）：.agents/lanes.conf、.agents/config.sh、multi-agent.md 泳道表。
 * 泳道判定与 scripts/check-lane.sh 同语义：bash `[[ f == pattern ]]`（`*` 可跨目录）、`!` 排除、`@shared` 优先。
 */

export interface LanesConfig {
  lanes: Array<{ name: string; globs: string[] }>;
  shared: string[];
}

export interface AgentsConfig {
  mainBranch: string;
  integrationBranch: string;
  branchPrefix: string;
  maxParallel: number | null;
}

export function parseLanesConf(text: string): LanesConfig {
  const lanes: LanesConfig['lanes'] = [];
  let shared: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [name, ...globs] = line.split(/\s+/);
    if (!name) continue;
    if (name === '@shared') shared = globs;
    else lanes.push({ name, globs });
  }
  return { lanes, shared };
}

export function parseAgentsConfig(text: string | null): AgentsConfig {
  const vars: Record<string, string> = {};
  for (const raw of (text ?? '').split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)=["']?([^"'#]*)["']?/.exec(raw);
    if (m?.[1]) vars[m[1]] = (m[2] ?? '').trim();
  }
  const max = Number.parseInt(vars.MAX_PARALLEL ?? '', 10);
  return {
    mainBranch: vars.MAIN_BRANCH || 'main',
    integrationBranch: vars.INTEGRATION_BRANCH || 'dev',
    branchPrefix: vars.BRANCH_PREFIX || 'feat',
    maxParallel: Number.isFinite(max) ? max : null,
  };
}

/** multi-agent.md 中「| `lane` | 负责角色 | …」表格 → 泳道负责角色。 */
export function parseLaneOwners(markdown: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of (markdown ?? '').matchAll(/^\|\s*`([\w@-]+)`\s*\|\s*([^|]+?)\s*\|/gm)) {
    if (m[1] && m[2] && !(m[1] in out)) out[m[1]] = m[2];
  }
  return out;
}

const cache = new Map<string, RegExp>();

/** bash 模式（`[[ == ]]` 右侧未加引号）→ 正则。`*` 匹配任意字符（含 /），`?` 单字符，`[...]` 字符类。 */
export function bashPatternToRegExp(pattern: string): RegExp {
  const hit = cache.get(pattern);
  if (hit) return hit;
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i] as string;
    if (c === '*') re += '.*';
    else if (c === '?') re += '.';
    else if (c === '[') {
      const end = pattern.indexOf(']', i + 2);
      if (end === -1) {
        re += '\\[';
      } else {
        let body = pattern.slice(i + 1, end);
        if (body.startsWith('!') || body.startsWith('^')) body = `^${body.slice(1)}`;
        re += `[${body.replace(/\\/g, '\\\\')}]`;
        i = end;
      }
    } else re += c.replace(/[.+^${}()|\\/]/g, '\\$&');
  }
  const out = new RegExp(`^${re}$`, 's');
  cache.set(pattern, out);
  return out;
}

export function matchesBashPattern(path: string, pattern: string): boolean {
  return bashPatternToRegExp(pattern).test(path);
}

export interface LaneCheck {
  ok: boolean;
  why: string;
}

/** 与 check-lane.sh 逐行一致：共享热点优先拒绝；按顺序匹配，`!` 命中立即判否并停止。 */
export function laneCheck(cfg: LanesConfig, path: string, lane: string): LaneCheck {
  for (const s of cfg.shared) if (matchesBashPattern(path, s)) return { ok: false, why: '共享热点文件，只能由 coordinator 修改' };
  const globs = cfg.lanes.find((l) => l.name === lane)?.globs ?? [];
  let ok = false;
  for (const p of globs) {
    if (p.startsWith('!')) {
      if (matchesBashPattern(path, p.slice(1))) {
        ok = false;
        break;
      }
    } else if (matchesBashPattern(path, p)) ok = true;
  }
  return ok ? { ok, why: '' } : { ok, why: `不属于泳道 ${lane}` };
}

/** 文件归属的泳道；共享热点为 '@shared'，无归属为 null。 */
export function owningLane(cfg: LanesConfig, path: string): string | null {
  for (const s of cfg.shared) if (matchesBashPattern(path, s)) return '@shared';
  for (const l of cfg.lanes) if (laneCheck(cfg, path, l.name).ok) return l.name;
  return null;
}
