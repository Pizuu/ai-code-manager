/**
 * Spec Kit 扩展流程的真实状态推导（纯函数，无副作用）。
 *
 * SDD 主线的状态在看板快照里已有结构化数据；bug 修复与 idea 评估两条扩展流程的产物
 * 只是 `.specify/bugs/<slug>/`、`.specify/assessments/<slug>/` 下的 Markdown 文件，
 * 没有结构化状态，只能由「目录内文件名」推导走到第几阶段、由「报告文本」提取最终结论。
 * 关键字匹配一律大小写不敏感：文件名小写后按 includes 判断（容忍 assessment.md /
 * fix-report.md / test-results.md 一类命名差异），结论文本按词边界匹配（防误命中）。
 */

export const BUG_STAGES = ['评估', '修复', '验证'] as const;
export const ASSESS_STAGES = ['受理', '调研', '定义', '塑形', '决策'] as const;

export type BugVerdict = 'verified' | 'partial' | 'failed';
export type AssessDecision = 'go' | 'needs-clarification' | 'kill';

/** 每阶段的产物文件名关键字（小写 includes，任一命中即该阶段有产物）。 */
const BUG_STAGE_KEYS: readonly (readonly string[])[] = [
  ['assess'], // 评估：assessment.md / bug-assess.md
  ['fix'], // 修复：fix.md / fix-report.md
  ['test', 'verif'], // 验证：test-results.md / verification.md
];

const ASSESS_STAGE_KEYS: readonly (readonly string[])[] = [
  ['intake'], // 受理
  ['research'], // 调研
  ['define', 'definition'], // 定义
  ['shape'], // 塑形
  ['decision', 'decide'], // 决策：decision.md / decide.md
];

/**
 * 计「有产物的阶段组」个数。阶段是顺序流程、产物只增不减，正常目录里该计数即已到达的
 * 阶段数；个别靠后产物单独出现时只计实际存在的阶段，不虚报前序阶段已完成。
 */
function countStages(fileNames: readonly string[], stageKeys: readonly (readonly string[])[]): number {
  const names = fileNames.map((n) => n.toLowerCase());
  let count = 0;
  for (const keys of stageKeys) {
    if (names.some((n) => keys.some((k) => n.includes(k)))) count += 1;
  }
  return count;
}

/** 由目录内文件名推导 bug 流程已到达的阶段数 0..3（含 assess 关键字=评估产物、fix=修复、test/verif=验证）。 */
export function bugStageCount(fileNames: readonly string[]): number {
  return countStages(fileNames, BUG_STAGE_KEYS);
}

/** 同理评估流程 0..5（intake/research/define/shape/decision|decide 关键字）。 */
export function assessStageCount(fileNames: readonly string[]): number {
  return countStages(fileNames, ASSESS_STAGE_KEYS);
}

function linesOf(text: string): string[] {
  return text.split(/\r?\n/);
}

/* ── bug 验证结论 ─────────────────────────────────────────────── */

// 词边界是关键：'unverified' 里的 verified 前一位是词字符 n，不构成边界，不会误判。
const VERDICT_RE = /\b(verified|partial|failed)\b/i;

function verdictIn(text: string): BugVerdict | null {
  const m = VERDICT_RE.exec(text);
  return m?.[1] ? (m[1].toLowerCase() as BugVerdict) : null;
}

/**
 * 从验证报告文本提取结论：优先含 verdict/结论/结果 的行里的词边界匹配 verified|partial|failed，
 * 都没有时全文词边界兜底；提取不到返回 null。
 * 结论行优先于正文兜底——正文顺带提到的 failed/verified（如「上次运行 failed」）不能盖过最终结论。
 */
export function extractBugVerdict(text: string): BugVerdict | null {
  for (const line of linesOf(text)) {
    if (/verdict/i.test(line) || line.includes('结论') || line.includes('结果')) {
      const v = verdictIn(line);
      if (v) return v;
    }
  }
  return verdictIn(text);
}

/* ── idea 评估决策 ────────────────────────────────────────────── */

// needs-clarification 兼容连字符/下划线/空格三种写法，统一归一为 'needs-clarification'。
const NEEDS_CLARIFICATION_RE = /\bneeds[-\s_]+clarification\b/i;
const KILL_RE = /\bkill\b/i;
// 词边界防误判：'ongoing' 的 go 前一位是词字符、'good' 的 go 后一位是词字符，都不构成 \bgo\b。
const GO_RE = /\bgo\b/i;

/** 在一段文本里取出现位置最早的决策词（同一行同时出现多个时以先出现者为准）。 */
function decisionIn(text: string): AssessDecision | null {
  const hits: { index: number; value: AssessDecision }[] = [];
  const needs = NEEDS_CLARIFICATION_RE.exec(text);
  if (needs) hits.push({ index: needs.index, value: 'needs-clarification' });
  const kill = KILL_RE.exec(text);
  if (kill) hits.push({ index: kill.index, value: 'kill' });
  const go = GO_RE.exec(text);
  if (go) hits.push({ index: go.index, value: 'go' });
  hits.sort((a, b) => a.index - b.index);
  return hits[0]?.value ?? null;
}

/**
 * 从 decision.md 文本提取决策：优先含 decision/决策 的行，匹配 needs-clarification|kill|go
 * （needs-clarification 长串按位置参与比较，不会被同一行靠前的短词抢先误判）；兜底全文；
 * 没有返回 null。
 */
export function extractAssessDecision(text: string): AssessDecision | null {
  for (const line of linesOf(text)) {
    if (/decision/i.test(line) || line.includes('决策')) {
      const d = decisionIn(line);
      if (d) return d;
    }
  }
  return decisionIn(text);
}
