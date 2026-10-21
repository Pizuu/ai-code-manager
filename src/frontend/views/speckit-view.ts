/**
 * Spec Kit 视图：spec-kit 三个流程（规格驱动 SDD / 修 Bug / 评估想法）的整体状态面。
 * 数据全部真实来源：SDD 走看板快照（store.state.board，与顶栏/看板同源）；Bug / 评估走
 * fs:tree / fs:read 直读 .specify/bugs、.specify/assessments 目录与报告文件，阶段与结论
 * 由 lib/speckit.ts 的纯函数从文件名与报告正文提取。动作按钮打开页内「引导步进向导」
 * （讲解 → 填写 → 生成指令，定义与拼装在 lib/speckit-wizard.ts），最后经
 * hooks.sendInstruction 把拼好的对话指令真实发送到任务会话，不再是旧的
 * 「插入输入框并跳走」。
 */
import type { BoardFeature, BoardSnapshot } from '../../../contracts/ipc.ts';
import { api, errorText } from '../api.ts';
import { clear, h } from '../lib/dom.ts';
import {
  ASSESS_STAGES, BUG_STAGES, assessStageCount, bugStageCount, extractAssessDecision, extractBugVerdict,
} from '../lib/speckit.ts';
import { buildInstruction, getSpeckitAction, type SpeckitActionId } from '../lib/speckit-wizard.ts';
import { store } from '../store.ts';

export interface SpeckitHooks {
  /** 把向导生成的对话指令真实发送到任务会话（确保有会话、走完整发送流程、成功后切过去）；失败抛错。 */
  sendInstruction(text: string): Promise<void>;
  openProject(): void;
  /** 切换当前功能（board:setFeature），与顶栏规格下拉同款口径。 */
  setFeature(featureId: string): Promise<void>;
}

/** 阶段常量元素形状以 lib/speckit.ts 为准（字符串或带 label 的对象），此处只取展示名。 */
const stageLabels = (stages: readonly unknown[]): string[] => stages.map((s) => {
  if (typeof s === 'string') return s;
  const o = s as { label?: string; name?: string; key?: string };
  return o.label ?? o.name ?? o.key ?? '';
});

/** 与后端 tasks-parser 的 TASK_RE 同口径：带 T### 编号的勾选行才算任务。 */
const countTasksMd = (md: string): { done: number; total: number } => {
  let done = 0;
  let total = 0;
  for (const line of md.split(/\r?\n/)) {
    const m = /^\s*[-*]\s+\[([ xX])\]\s+T\d{3,}\b/.exec(line);
    if (!m) continue;
    total += 1;
    if (m[1] !== ' ') done += 1;
  }
  return { done, total };
};

interface BugRow { slug: string; files: string[]; verdict: string | null }
interface AssessRow { slug: string; files: string[]; decision: string | null }
interface FeatureRow { id: string; title: string; done: number; total: number }

const featureDone = (r: { done: number; total: number }): boolean => r.total > 0 && r.done >= r.total;

export function mountSpeckit(container: HTMLElement, hooks: SpeckitHooks): void {
  let token = 0;
  let constitution = false;
  let features: FeatureRow[] = [];
  let bugs: BugRow[] = [];
  let assesses: AssessRow[] = [];

  const readTextOrNull = async (rel: string): Promise<string | null> => {
    try {
      const f = await api.invoke('fs:read', rel);
      return f.kind === 'text' ? f.content : null;
    } catch {
      return null;
    }
  };

  /** 列目录下的一级子目录名；目录不存在/出错 → 空（该流程的空态）。 */
  const listSlugs = async (rel: string): Promise<string[]> => {
    try {
      const nodes = await api.invoke('fs:tree', rel);
      return nodes.filter((n) => n.kind === 'dir').map((n) => n.name);
    } catch {
      return [];
    }
  };

  const listFiles = async (rel: string): Promise<string[]> => {
    try {
      const nodes = await api.invoke('fs:tree', rel);
      return nodes.filter((n) => n.kind === 'file').map((n) => n.name);
    } catch {
      return [];
    }
  };

  const loadBugs = async (): Promise<BugRow[]> => {
    const slugs = await listSlugs('.specify/bugs');
    return Promise.all(slugs.map(async (slug) => {
      const files = await listFiles(`.specify/bugs/${slug}`);
      const report = files.find((f) => /verif/i.test(f)) ?? files.find((f) => /test/i.test(f));
      let verdict: string | null = null;
      if (report) {
        const content = await readTextOrNull(`.specify/bugs/${slug}/${report}`);
        if (content !== null) {
          const v = extractBugVerdict(content) as unknown;
          verdict = typeof v === 'string' ? v : null;
        }
      }
      return { slug, files, verdict };
    }));
  };

  const loadAssesses = async (): Promise<AssessRow[]> => {
    const slugs = await listSlugs('.specify/assessments');
    return Promise.all(slugs.map(async (slug) => {
      const files = await listFiles(`.specify/assessments/${slug}`);
      const decisionFile = files.find((f) => /decision|decide/i.test(f));
      let decision: string | null = null;
      if (decisionFile) {
        const content = await readTextOrNull(`.specify/assessments/${slug}/${decisionFile}`);
        if (content !== null) {
          const d = extractAssessDecision(content) as unknown;
          decision = typeof d === 'string' ? d : null;
        }
      }
      return { slug, files, decision };
    }));
  };

  /** 全部功能的 tasks 计数：当前功能用快照（权威），其余直读各自 tasks.md 按后端同口径计数。 */
  const loadFeatures = async (): Promise<FeatureRow[]> => {
    const snap = store.state.board;
    if (!snap) return [];
    const cur: BoardFeature | null = snap.feature;
    return Promise.all(snap.features.map(async (f) => {
      if (cur && f.id === cur.id) return { id: f.id, title: f.title, done: cur.tasksDone, total: cur.tasksTotal };
      // tasks.md 是阶段性产物（停在 spec/plan 阶段的功能还没有）：先列目录确认存在再读，
      // 避免盲读触发主进程 fs:read 的 E_NOT_FOUND 报错噪音（渲染层 catch 拦不住 handler 侧打印）。
      const names = await listFiles(`specs/${f.id}`);
      const md = names.includes('tasks.md') ? await readTextOrNull(`specs/${f.id}/tasks.md`) : null;
      const c = md !== null ? countTasksMd(md) : { done: 0, total: 0 };
      return { id: f.id, title: f.title, ...c };
    }));
  };

  const loadFs = async () => {
    const tk = ++token;
    const [mem, b, a, f] = await Promise.all([
      listFiles('.specify/memory'),
      loadBugs(),
      loadAssesses(),
      loadFeatures(),
    ]);
    if (tk !== token) return;
    constitution = mem.includes('constitution.md');
    bugs = b;
    assesses = a;
    features = f;
    render();
  };

  const chip = (cls: string, text: string) => h('span', { class: `chip ${cls}` }, text);

  /** 迷你步骤条：前 doneCount 段为完成态，紧随一段为当前态，其余待办。 */
  const miniSteps = (labels: string[], doneCount: number) => {
    const wrap = h('span', { class: 'sk-steps' });
    labels.forEach((label, i) => {
      const cls = i < doneCount ? 'ok' : i === doneCount ? 'cur' : '';
      wrap.append(h('span', { class: `sk-step ${cls}` }, `${i < doneCount ? '✓' : '○'} ${label}`));
    });
    return wrap;
  };

  const panelHead = (title: string, sub: string) =>
    h('div', { class: 'sk-head' }, h('span', { class: 'sk-title' }, title), h('span', { class: 'mute' }, sub));

  interface SddStep { label: string; done: boolean; detail: string }

  /** SDD 步骤条数据：快照阶段 + 实施 + 收敛，与面板步骤条、向导状态行同源。 */
  const sddStepsOf = (F: BoardFeature): SddStep[] => {
    const tasksAll = featureDone({ done: F.tasksDone, total: F.tasksTotal });
    const steps: SddStep[] = F.stages.map((s) => ({ label: s.label, done: s.done, detail: s.detail }));
    steps.push({ label: '实施', done: tasksAll, detail: `tasks ${F.tasksDone}/${F.tasksTotal}` });
    steps.push({ label: '收敛', done: tasksAll, detail: '按 tasks 完成度计（任务卡无功能归属）' });
    return steps;
  };

  /** 向导步 1 的「当前流程真实状态」一行，数据与三个面板同源。 */
  const wizardStatusLine = (id: SpeckitActionId): string => {
    if (id === 'bug') {
      const ok = bugs.filter((b) => b.verdict === 'verified').length;
      return `当前状态：已有 bug 记录 ${bugs.length} 个（已验证 ${ok}）`;
    }
    if (id === 'assess') {
      const go = assesses.filter((a) => a.decision === 'go').length;
      return `当前状态：已有评估记录 ${assesses.length} 个（已决策 go ${go}）`;
    }
    const snap: BoardSnapshot | null = store.state.board;
    if (!snap) return '当前状态：正在读取看板快照…';
    if (!snap.available) return `当前状态：${snap.reason ?? '看板不可用'}`;
    const F = snap.feature;
    if (!F) return '当前状态：暂无功能规格（specs/ 下没有 NNN-* 目录）';
    const steps = sddStepsOf(F);
    const doneCount = steps.filter((s) => s.done).length;
    return `当前功能：${F.id} · ${F.title} · 步骤进度 ${doneCount}/${steps.length} · tasks ${F.tasksDone}/${F.tasksTotal}`;
  };

  let wizard: HTMLDialogElement | null = null;

  /**
   * 引导步进向导（页内模态，打开不切换视图）：1 讲解 → 2 填写 → 3 生成并发送。
   * 步 3 的指令由 buildInstruction 拼装、可再编辑，发送以编辑值为准；发送失败留在
   * 向导内红字报错、不关闭。发送中禁止关闭（Esc / 遮罩 / 取消一律拦下），防重复发送。
   */
  const openWizard = (actionId: SpeckitActionId): void => {
    if (wizard?.open) return;
    const action = getSpeckitAction(actionId);
    const values: Record<string, string> = {};
    let step = 1;
    let sending = false;

    const dialog = h('dialog', { class: 'dialog skwiz', attrs: { 'aria-label': `${action.buttonText} 向导` } });
    wizard = dialog;
    const stepsBar = h('div', { class: 'skwiz-steps' });
    const body = h('div', { class: 'skwiz-body' });
    const err = h('div', { class: 'error-text' });
    const cancelBtn = h('button', { class: 'btn', attrs: { type: 'button' } }, '取消');
    const prevBtn = h('button', { class: 'btn', attrs: { type: 'button' } }, '上一步');
    const nextBtn = h('button', { class: 'btn', attrs: { type: 'button' } }, '下一步');
    const sendBtn = h('button', { class: 'btn pri', attrs: { type: 'button' } }, '生成并发送');
    const form = h('form', { attrs: { method: 'dialog' } },
      h('div', { class: 'dhead' }, h('h3', {}, action.buttonText), stepsBar),
      body, err,
      h('div', { class: 'actions' }, cancelBtn, prevBtn, nextBtn, sendBtn));
    form.addEventListener('submit', (ev) => ev.preventDefault());
    dialog.append(form);
    document.body.append(dialog);

    let inputs = new Map<string, HTMLInputElement | HTMLTextAreaElement>();
    let instructionBox: HTMLTextAreaElement | null = null;

    const collect = (): void => {
      for (const [k, el] of inputs) values[k] = el.value;
    };

    const renderStep = (): void => {
      clear(stepsBar);
      ['讲解', '填写', '生成并发送'].forEach((name, i) => {
        stepsBar.append(h('span', { class: `chip${i + 1 === step ? ' acc' : ''}` }, `${i + 1} ${name}`));
      });
      clear(body);
      err.textContent = '';
      inputs = new Map();
      instructionBox = null;
      if (step === 1) {
        const sec = (label: string, text: string) => h('div', { class: 'skwiz-sec' }, h('b', {}, label), h('span', {}, text));
        body.append(
          sec('场景', action.scene),
          sec('参与者', action.actors),
          sec('功能解释', action.explain),
          h('div', { class: 'skwiz-status' }, wizardStatusLine(actionId)),
        );
      } else if (step === 2) {
        for (const f of action.fields) {
          const control = f.multiline
            ? h('textarea', { attrs: { rows: '4', placeholder: f.placeholder, spellcheck: 'false' } })
            : h('input', { attrs: { type: 'text', placeholder: f.placeholder, spellcheck: 'false' } });
          control.value = values[f.key] ?? '';
          inputs.set(f.key, control);
          body.append(h('div', { class: 'field' },
            h('label', {}, f.required ? `${f.label}（必填）` : f.label),
            control));
        }
      } else {
        const built = buildInstruction(actionId, values);
        instructionBox = h('textarea', { attrs: { rows: '5', spellcheck: 'false' } });
        instructionBox.value = built.ok ? built.text : '';
        body.append(h('div', { class: 'field' },
          h('label', {}, '将发送到任务会话的指令（可编辑，发送以此为准）'),
          instructionBox,
          h('div', { class: 'help' }, '点「生成并发送」后指令会真实发出，并切换到任务会话。')));
      }
      prevBtn.hidden = step === 1;
      nextBtn.hidden = step === 3;
      sendBtn.hidden = step !== 3;
    };

    nextBtn.addEventListener('click', () => {
      if (step === 1) {
        step = 2;
        renderStep();
        return;
      }
      if (step === 2) {
        collect();
        const built = buildInstruction(actionId, values);
        if (!built.ok) {
          err.textContent = built.error;
          return;
        }
        step = 3;
        renderStep();
      }
    });
    prevBtn.addEventListener('click', () => {
      if (step === 2) collect();
      if (step > 1) {
        step -= 1;
        renderStep();
      }
    });
    cancelBtn.addEventListener('click', () => dialog.close());
    sendBtn.addEventListener('click', async () => {
      if (sending || !instructionBox) return;
      const text = instructionBox.value.trim();
      if (!text) {
        err.textContent = '指令不能为空';
        return;
      }
      sending = true;
      sendBtn.disabled = true;
      cancelBtn.disabled = true;
      prevBtn.disabled = true;
      sendBtn.textContent = '发送中…';
      err.textContent = '';
      try {
        await hooks.sendInstruction(text);
        dialog.close();
      } catch (e) {
        err.textContent = errorText(e);
        sending = false;
        sendBtn.disabled = false;
        cancelBtn.disabled = false;
        prevBtn.disabled = false;
        sendBtn.textContent = '生成并发送';
      }
    });
    dialog.addEventListener('click', (ev) => {
      if (ev.target === dialog && !sending) dialog.close();
    });
    dialog.addEventListener('cancel', (ev) => {
      if (sending) ev.preventDefault();
    });
    dialog.addEventListener('close', () => {
      dialog.remove();
      if (wizard === dialog) wizard = null;
    });
    renderStep();
    dialog.showModal();
  };

  const renderOverview = (): HTMLElement => {
    const fDone = features.filter(featureDone).length;
    const bOk = bugs.filter((b) => b.verdict === 'verified').length;
    const aGo = assesses.filter((a) => a.decision === 'go').length;
    return h('div', { class: 'panel sk-overview' },
      h('span', { class: 'sk-title' }, 'Spec Kit 总览'),
      constitution ? chip('grn', '宪法已建立') : chip('', '未建立宪法'),
      h('span', { class: 'sk-sum' }, `功能 ${features.length}（完成 ${fDone}） · Bug ${bugs.length}（已验证 ${bOk}） · 评估 ${assesses.length}（已决策 go ${aGo}）`),
    );
  };

  const renderSdd = (): HTMLElement => {
    const snap = store.state.board;
    const panel = h('div', { class: 'panel sk-panel' }, panelHead('流程一 · 规格驱动 SDD', 'Specify → Plan → Tasks → Implement → Converge'));
    if (!snap) {
      panel.append(h('div', { class: 'mute' }, '正在读取看板快照…'));
      return panel;
    }
    if (!snap.available) {
      panel.append(h('div', { class: 'mute' }, snap.reason ?? '看板不可用。'));
      return panel;
    }
    const F = snap.feature;
    if (!F) {
      panel.append(h('div', { class: 'mute' }, '暂无功能规格（specs/ 下没有 NNN-* 目录）。在任务会话用 /specify 新建。'));
      return panel;
    }
    // 步骤条：快照七步 + 实施 + 收敛。任务卡（docs/tasks/T-*.md）是项目级、无功能归属字段，
    // 无法按功能判「全部合入」，故收敛步按本功能 tasks 完成度计（与实施同源），不编造合入数。
    const steps = sddStepsOf(F);
    const firstOpen = steps.findIndex((s) => !s.done);
    const stg = h('div', { class: 'sk-steps big' });
    steps.forEach((s, i) => {
      stg.append(h('span', { class: `sk-step ${s.done ? 'ok' : i === firstOpen ? 'cur' : ''}`, title: s.detail }, `${s.done ? '✓' : '○'} ${s.label}${s.label === '实施' && !s.done && F.tasksTotal > 0 ? ` ${F.tasksDone}/${F.tasksTotal}` : ''}`));
    });
    panel.append(
      h('div', { class: 'sk-cur' }, h('span', { class: 'sk-fname' }, `${F.id} · ${F.title}`), F.status ? chip('acc', F.status) : null),
      stg,
      h('div', { class: 'sk-actions' },
        h('button', { class: 'btn', attrs: { type: 'button' }, on: { click: () => openWizard('specify') } }, '写规格 /specify'),
        h('button', { class: 'btn', attrs: { type: 'button' }, on: { click: () => openWizard('plan') } }, '做计划 /plan'),
        h('button', { class: 'btn', attrs: { type: 'button' }, on: { click: () => openWizard('tasks') } }, '拆任务 /tasks'),
        h('button', { class: 'btn pri', attrs: { type: 'button' }, on: { click: () => openWizard('implement') } }, '实施 /implement'),
      ),
    );
    if (features.length > 0) {
      const list = h('div', { class: 'sk-rows' });
      for (const r of features) {
        const isCur = r.id === F.id;
        list.append(h('a', {
          class: `sk-row${isCur ? ' on' : ''}`,
          title: isCur ? '当前功能' : '切换到此功能',
          on: { click: () => { if (!isCur) void hooks.setFeature(r.id).catch(() => undefined); } },
        },
          h('span', { class: 'sk-rid' }, r.id),
          h('span', { class: 'sk-rname' }, r.title),
          h('span', { class: 'mute' }, `tasks ${r.done}/${r.total}`),
          featureDone(r) ? chip('grn', '已完成') : chip('acc', '实施中'),
        ));
      }
      panel.append(h('div', { class: 'sk-sub' }, '全部功能'), list);
    }
    return panel;
  };

  const verdictChip = (v: string | null) => {
    switch (v) {
      case 'verified': return chip('grn', '已验证');
      case 'partial': return chip('amb', '部分修复');
      case 'failed': return chip('bad', '未通过');
      default: return chip('', '未验证');
    }
  };

  const renderBugs = (): HTMLElement => {
    const panel = h('div', { class: 'panel sk-panel' }, panelHead('流程二 · 修 Bug', '评估 → 修复 → 验证（.specify/bugs/）'));
    if (bugs.length === 0) {
      panel.append(h('div', { class: 'sk-empty' },
        h('span', { class: 'mute' }, '暂无 bug 记录'),
        h('button', { class: 'btn', attrs: { type: 'button' }, on: { click: () => openWizard('bug') } }, '发起 bug 评估'),
      ));
      return panel;
    }
    const labels = stageLabels(BUG_STAGES as readonly unknown[]);
    const list = h('div', { class: 'sk-rows' });
    for (const b of bugs) {
      list.append(h('div', { class: 'sk-row static' },
        h('span', { class: 'sk-rid' }, b.slug),
        miniSteps(labels, bugStageCount(b.files)),
        verdictChip(b.verdict),
      ));
    }
    panel.append(list, h('div', { class: 'sk-actions' },
      h('button', { class: 'btn', attrs: { type: 'button' }, on: { click: () => openWizard('bug') } }, '发起 bug 评估'),
    ));
    return panel;
  };

  const decisionChip = (d: string | null) => {
    switch (d) {
      case 'go': return chip('grn', 'Go · 值得做');
      case 'needs-clarification': return chip('amb', '待澄清');
      case 'kill': return chip('bad', 'Kill · 放弃');
      default: return chip('', '待决策');
    }
  };

  const renderAssesses = (): HTMLElement => {
    const panel = h('div', { class: 'panel sk-panel' }, panelHead('流程三 · 评估想法', '受理 → 调研 → 定义 → 塑形 → 决策（.specify/assessments/）'));
    if (assesses.length === 0) {
      panel.append(h('div', { class: 'sk-empty' },
        h('span', { class: 'mute' }, '暂无评估记录'),
        h('button', { class: 'btn', attrs: { type: 'button' }, on: { click: () => openWizard('assess') } }, '发起想法评估'),
      ));
      return panel;
    }
    const labels = stageLabels(ASSESS_STAGES as readonly unknown[]);
    const list = h('div', { class: 'sk-rows' });
    for (const a of assesses) {
      list.append(h('div', { class: 'sk-row static' },
        h('span', { class: 'sk-rid' }, a.slug),
        miniSteps(labels, assessStageCount(a.files)),
        decisionChip(a.decision),
      ));
    }
    panel.append(list, h('div', { class: 'sk-actions' },
      h('button', { class: 'btn', attrs: { type: 'button' }, on: { click: () => openWizard('assess') } }, '发起想法评估'),
    ));
    return panel;
  };

  const render = () => {
    clear(container);
    if (!store.state.project) {
      container.append(h('div', { class: 'empty-state' },
        h('b', {}, '请先打开项目'),
        'SPEC KIT 视图读取本项目的规格、Bug 与评估产物（specs/ 与 .specify/）。',
        h('div', {}, h('button', { class: 'btn', attrs: { type: 'button' }, on: { click: hooks.openProject } }, '打开项目文件夹')),
      ));
      return;
    }
    container.append(h('div', { class: 'sk-wrap' }, renderOverview(), renderSdd(), renderBugs(), renderAssesses()));
  };

  render();
  if (store.state.project) void loadFs();
  store.on('workspace', () => { render(); if (store.state.project) void loadFs(); });
  store.on('project', () => { render(); if (store.state.project) void loadFs(); });
}
