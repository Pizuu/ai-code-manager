/**
 * Spec Kit 专页「引导步进向导」的纯逻辑：六个动作的定义（讲解三段 + 字段）与指令拼装。
 *
 * 讲解口径源自官方 Spec Kit 语义：SDD 四步（specify / plan / tasks / implement）只给
 * 斜杠命令加参数；修 Bug 与评估想法是扩展流程，命令形态为
 * `/speckit-bug-assess "症状" slug=<slug>`、`/speckit-assess-intake "想法" slug=<slug>`。
 * 本模块无 DOM、无副作用，向导 UI（views/speckit-view.ts）只负责渲染与收集输入，
 * 拼装与校验全部收敛到 buildInstruction 以便单测。
 */

export type SpeckitActionId = 'specify' | 'plan' | 'tasks' | 'implement' | 'bug' | 'assess';

export interface WizardField {
  key: string;
  label: string;
  required: boolean;
  placeholder: string;
  multiline: boolean;
}

export interface SpeckitAction {
  id: SpeckitActionId;
  /** 按钮文案（视图原样渲染）。 */
  buttonText: string;
  /** 命令前缀，如 '/specify'、'/speckit-bug-assess'。 */
  commandPrefix: string;
  /** 讲解一：场景——什么时候用这一步。 */
  scene: string;
  /** 讲解二：参与者——谁和谁在互动。 */
  actors: string;
  /** 讲解三：功能解释——这一步做什么、产出什么。 */
  explain: string;
  fields: readonly WizardField[];
}

export const SPECKIT_ACTIONS: readonly SpeckitAction[] = [
  {
    id: 'specify',
    buttonText: '写规格 /specify',
    commandPrefix: '/specify',
    scene: '新功能立项时——只有想法、还没有规格。',
    actors: '你（描述需求）+ agent（起草规格）',
    explain: '只谈做什么与为什么：用户故事、需求、成功标准，不谈技术栈（那是做计划的事）。产出 specs/ 下新功能的 spec.md。',
    fields: [
      { key: 'description', label: '功能描述', required: true, placeholder: '例：给任务会话加一个收藏夹，能把任意一条消息收藏起来、集中查看', multiline: true },
    ],
  },
  {
    id: 'plan',
    buttonText: '做计划 /plan',
    commandPrefix: '/plan',
    scene: '规格已定版、要定技术路线时。',
    actors: '你（给技术约束）+ agent（做设计）',
    explain: '产出 plan.md 及调研、数据模型、接口契约等设计产物，全程受项目宪法约束。',
    fields: [
      { key: 'constraints', label: '技术栈与约束', required: false, placeholder: '例：沿用现有存储层，不引入新依赖；界面只改前端', multiline: true },
    ],
  },
  {
    id: 'tasks',
    buttonText: '拆任务 /tasks',
    commandPrefix: '/tasks',
    scene: '计划已定版、要排活时。',
    actors: 'agent（生成清单）+ 你（审清单）',
    explain: '按「准备 → 基础 → 每个用户故事一段 → 收尾」生成 tasks.md：依赖已排序、可并行的任务有标记，每条任务带文件路径。',
    fields: [
      { key: 'notes', label: '补充要求', required: false, placeholder: '例：测试任务也要', multiline: false },
    ],
  },
  {
    id: 'implement',
    buttonText: '实施 /implement',
    commandPrefix: '/implement',
    scene: 'tasks 就绪、开始写代码时。',
    actors: 'agent（执行）+ 你（分阶段验收）',
    explain: '按任务顺序逐条执行；未勾完的检查表会先询问。功能大时建议限定范围、分段做，逐段验收。',
    fields: [
      { key: 'scope', label: '范围限定', required: false, placeholder: '例：只做准备与基础阶段', multiline: false },
    ],
  },
  {
    id: 'bug',
    buttonText: '发起 bug 评估',
    commandPrefix: '/speckit-bug-assess',
    scene: '发现异常行为时——先定因与影响范围，而不是直接改。',
    actors: '你（给症状）+ agent（调查）',
    explain: '修 Bug 三段流程（评估 → 修复 → 验证）的第一步，产物落在 .specify/bugs/<slug>/；最终只有 verified 才算修好。',
    fields: [
      { key: 'symptom', label: '症状描述', required: true, placeholder: '例：提交空密码时登录表单崩溃', multiline: true },
      { key: 'slug', label: 'slug', required: true, placeholder: '例：login-crash', multiline: false },
    ],
  },
  {
    id: 'assess',
    buttonText: '发起想法评估',
    commandPrefix: '/speckit-assess-intake',
    scene: '有个想法、不确定值不值得投入时。',
    actors: '你（提想法）+ agent（取证评估）',
    explain: '五段流程（受理 → 调研 → 定义 → 塑形 → 决策），结论为 go / needs-clarification / kill；不需要先有代码或规格。',
    fields: [
      { key: 'idea', label: '想法描述', required: true, placeholder: '例：让用户离线工作、重连后自动同步', multiline: true },
      { key: 'slug', label: 'slug', required: true, placeholder: '例：offline-mode', multiline: false },
    ],
  },
];

const BY_ID = new Map<SpeckitActionId, SpeckitAction>(SPECKIT_ACTIONS.map((a) => [a.id, a]));

export function getSpeckitAction(id: SpeckitActionId): SpeckitAction {
  const a = BY_ID.get(id);
  if (!a) throw new Error(`未知 Spec Kit 动作：${id}`);
  return a;
}

/** slug 口径与官方一致：小写字母 / 数字 / 连字符，字母或数字开头。 */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

export type InstructionResult = { ok: true; text: string } | { ok: false; error: string };

/**
 * 拼装一条可直接发送的对话指令。必填缺失 / slug 非法时返回 { ok:false, error }，
 * 不产出半成品指令。选填为空时只出命令本身（不带尾随空格）。
 * bug / assess 的症状 / 想法要进双引号：文本内的双引号统一替换为单引号，避免引号嵌套破词。
 */
export function buildInstruction(actionId: SpeckitActionId, values: Readonly<Record<string, string>>): InstructionResult {
  const action = getSpeckitAction(actionId);
  const v: Record<string, string> = {};
  for (const f of action.fields) v[f.key] = (values[f.key] ?? '').trim();

  for (const f of action.fields) {
    if (f.required && !v[f.key]) return { ok: false, error: `请填写「${f.label}」` };
  }
  if (v.slug !== undefined && v.slug && !SLUG_RE.test(v.slug)) {
    return { ok: false, error: 'slug 格式不正确：只能用小写字母、数字与连字符，且以字母或数字开头' };
  }

  const p = action.commandPrefix;
  // 必填已在上方校验过非空；索引取值仍可能为 undefined（noUncheckedIndexedAccess），用 ?? '' 收口。
  switch (actionId) {
    case 'specify':
      return { ok: true, text: `${p} ${v.description ?? ''}` };
    case 'plan':
      return { ok: true, text: v.constraints ? `${p} ${v.constraints}` : p };
    case 'tasks':
      return { ok: true, text: v.notes ? `${p} ${v.notes}` : p };
    case 'implement':
      return { ok: true, text: v.scope ? `${p} ${v.scope}` : p };
    case 'bug':
      return { ok: true, text: `${p} "${(v.symptom ?? '').replaceAll('"', "'")}" slug=${v.slug ?? ''}` };
    case 'assess':
      return { ok: true, text: `${p} "${(v.idea ?? '').replaceAll('"', "'")}" slug=${v.slug ?? ''}` };
  }
}
