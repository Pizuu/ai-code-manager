/**
 * 「Worktree 与 Agent」视图（T-040）：从 Git 分支与集成页拆出的 Worktree 小节（含「发布到 main」门禁），
 * 加上泳道 → Agent 分工与相关配置。数据全部来自既有通道：git:get / board:get（快照）、fs:read（只读
 * .agents/config.sh）；不新增契约，配置文件只读展示。
 */
import type { BoardCard } from '../../../contracts/ipc.ts';
import { api, errorText } from '../api.ts';
import { STATUS_META } from '../lib/board-format.ts';
import { sendAttrs } from '../lib/context-send.ts';
import { clear, h } from '../lib/dom.ts';
import { icon } from '../lib/icons.ts';
import { store } from '../store.ts';
import type { SettingsTab } from './settings-dialog.ts';

export interface AgentsHooks {
  openGit(): void;
  openProject(): void;
  /** 在任务会话中列打开文件（代码查看）。 */
  openFile(relPath: string): void;
  openSettings(tab: SettingsTab): void;
  notify(text: string): void;
}

const CONFIG_FILE = '.agents/config.sh';
const LANES_FILE = '.agents/lanes.conf';
const MULTI_AGENT_DOC = 'docs/development/multi-agent.md';

function emptyState(title: string, text: string, action?: HTMLElement): HTMLElement {
  return h('div', { class: 'empty-state' }, h('b', {}, title), text, action ? h('div', {}, action) : null);
}

/** 只取 config.sh 中形如 KEY="value" / KEY=value 的赋值行用于展示（不执行、不写回）。 */
function readAssignments(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line);
    if (m?.[1] && m[2] !== undefined) out.set(m[1], m[2].trim().replace(/^(["'])(.*)\1$/, '$2'));
  }
  return out;
}

export function mountAgents(container: HTMLElement, hooks: AgentsHooks): void {
  /** 最近一次读取的 config.sh 赋值；null = 未读取 / 读取失败（cfgErr 给出原因）。 */
  let cfg: Map<string, string> | null = null;
  let cfgErr = '';
  let cfgToken = 0;

  const loadConfig = async () => {
    const token = ++cfgToken;
    if (!store.state.project) return;
    try {
      const f = await api.invoke('fs:read', CONFIG_FILE);
      if (token !== cfgToken) return;
      cfg = f.kind === 'text' ? readAssignments(f.content) : null;
      cfgErr = f.kind === 'text' ? '' : '不是文本文件';
    } catch (e) {
      if (token !== cfgToken) return;
      cfg = null;
      cfgErr = errorText(e);
    }
    render();
  };

  const kv = (k: string, v: Node | string, hint?: string) =>
    h('div', { class: 'kv' }, h('span', { class: 'k' }, k), h('span', { class: 'v' }, v), hint ? h('span', { class: 'hint' }, hint) : null);
  const fileBtn = (label: string, rel: string) => h('button', { class: 'btn sm', title: `在任务会话中打开 ${rel}（只读查看）`, on: { click: () => hooks.openFile(rel) } }, label);

  const render = () => {
    clear(container);
    const g = store.state.git;
    const b = store.state.board;
    if (!store.state.project) {
      container.append(emptyState('请先打开项目', 'Worktree 与 Agent 视图读取本机 git worktree、泳道与多 Agent 配置。', h('button', { class: 'btn', on: { click: hooks.openProject } }, '打开项目文件夹')));
      return;
    }
    if (!g || !b) {
      container.append(emptyState('读取中…', store.state.workspaceError ?? '正在读取 git 与看板快照。'));
      return;
    }
    const cards: BoardCard[] = b.available ? b.cards : [];
    const integ = b.available ? b.integrationBranch : g.integrationBranch;
    const F = b.feature;
    const cardFor = (branch: string | null) => (branch ? cards.find((c) => c.branch === branch) : undefined);
    const wtList = g.available ? g.worktrees : [];
    const extraWts = wtList.filter((w) => !w.isMain).length;
    const maxPar = b.maxParallel ?? (cfg?.get('MAX_PARALLEL') ? Number(cfg.get('MAX_PARALLEL')) : null);

    const left = h('div');
    // 发布到 main（T-039 应负责人要求放在 Worktree 小节下，随小节一起迁来）
    const merged = cards.filter((c) => c.status === 'merged').length;
    const allM = cards.length > 0 && merged === cards.length;
    const tasksAll = F ? F.tasksDone === F.tasksTotal && F.tasksTotal > 0 : false;
    left.append(h('div', { class: 'sec first' }, h('span', {}, 'Worktree'), h('span', { class: 'mute' }, maxPar ? `${extraWts} / ${maxPar} 个并行 worktree（不含主工作区）` : `${extraWts} 个并行 worktree`)));
    left.append(h('div', { class: 'panel w pub' },
      h('div', { class: 'h start' }, icon('lock'), h('span', {}, '发布到 main'), h('span', { class: 'chip' }, 'Owner')),
      h('div', { class: 'mute mt12' }, `${integ} → main · 仅 Owner（人类）可批准`, h('br'), `${merged} / ${cards.length} 张任务卡已合入，${integ} 领先 main ${g.available ? g.integrationAheadOfMain : 0} 个提交`),
      h('div', { class: 'gate' },
        `${allM ? '✓' : '○'} 所有任务卡合入 ${integ}（${merged}/${cards.length}）`, h('br'),
        '○ CI / lane-guard 运行记录（暂无：本地无远端）', h('br'),
        `${tasksAll ? '✓' : '○'} tasks.md 全部勾选（${F?.tasksDone ?? 0}/${F?.tasksTotal ?? 0}）`, h('br'),
        '○ Converge 无新增缺口（暂无记录）'),
      h('div', { class: 'fx8 mt16' }, h('button', { class: 'btn', attrs: { disabled: '' } }, '合入 main'), h('span', { class: 'chip amb' }, '门禁未满足')),
      h('div', { class: 'mute mt14' }, '满足门禁后，由 Owner 人类批准合入并发布；Agent 无权推进 main。')));
    const wts = h('div', { class: 'wts' });
    for (const w of wtList) {
      const c = cardFor(w.branch);
      wts.append(h('div', { class: 'wt', attrs: w.branch ? sendAttrs({ kind: 'branch', name: w.branch, sha: w.head, subject: c ? `${c.id} ${c.title}` : w.path }) : {} },
        h('span', { class: 'mute' }, icon('wt')), h('div', { class: 'grow0' },
          h('div', { class: 'between' }, h('span', {}, c ? `${c.assignee} · ${c.lane}` : w.isMain ? '主工作区' : 'worktree'), h('span', { class: 'acc' }, c?.id ?? '')),
          h('div', { class: 'mono' }, `${w.path}\u3000[${w.branch ?? 'detached'}]`),
          h('div', { class: 'ink2' }, `${w.head} · ${w.dirtyCount ? `${w.dirtyCount} 个未提交文件` : '工作区干净'}`))));
    }
    for (let i = wtList.length; i < 3; i++) {
      wts.append(h('div', { class: 'wt dash' }, h('span', { class: 'mute' }, icon('wt')), h('div', { class: 'mute' }, '暂无其它 worktree', h('div', { class: 'mono fs10' }, 'scripts/agent-worktree.sh new <泳道> <任务>'))));
    }
    left.append(wts);

    // 泳道 → Agent 分工（整块位于右栏：先构建，随右栏一起挂载）
    const lanesSec = h('div', { class: 'sec' }, h('span', {}, '泳道与 Agent'), h('span', { class: 'mute' }, `${b.available ? b.lanes.length : 0} 个泳道 · 每个泳道最多一个在途 Agent`));
    const table = h('div', { class: 'lanes' }, h('div', { class: 'lr lh' }, h('span', {}, '泳道'), h('span', {}, '负责角色'), h('span', {}, '在途任务'), h('span', {}, '允许修改')));
    for (const lane of b.available ? b.lanes : []) {
      const live = cards.filter((c) => c.lane === lane.name && (c.status === 'active' || c.status === 'review'));
      const next = cards.find((c) => c.lane === lane.name && c.status === 'ready');
      const doneN = cards.filter((c) => c.lane === lane.name && c.status === 'merged').length;
      table.append(h('div', { class: 'lr' },
        h('span', { class: 'b600' }, lane.name),
        h('span', { class: 'ink2' }, lane.ownerRole ?? '—'),
        h('span', { class: 'tasks' }, ...(live.length
          ? live.map((c) => h('span', { class: 'chip blu', title: `${c.title}\n${c.branch ?? ''}`, attrs: sendAttrs({ kind: 'card', id: c.id, title: c.title, lane: c.lane, status: STATUS_META[c.status].label }) }, `${c.id} · ${c.assignee}`))
          : [h('span', { class: 'mute' }, next ? `空闲 · 下一张 ${next.id}` : '空闲')]),
          doneN ? h('span', { class: 'mute' }, `已合入 ${doneN}`) : null),
        h('span', { class: 'mono globs', title: lane.globs.join(' ') }, lane.globs.join(' '))));
    }
    if (!b.available) table.append(h('div', { class: 'mute pad8' }, b.reason ?? '未读取到泳道配置'));

    // ── 右栏续：Agent 工作情况（按任务卡执行者聚合，数据只来自 cards）──
    const PENDING_ASSIGNEE = '（待派发）';
    const byAgent = new Map<string, BoardCard[]>();
    let pendingN = 0;
    for (const c of cards) {
      const a = c.assignee.trim();
      if (!a) continue;
      if (a === PENDING_ASSIGNEE) {
        pendingN++;
        continue;
      }
      const arr = byAgent.get(a);
      if (arr) arr.push(c);
      else byAgent.set(a, [c]);
    }
    interface AgentRow { name: string; rank: number; active: BoardCard[]; reviewN: number; doneN: number; lane: string }
    const agentRows: AgentRow[] = [...byAgent.entries()].map(([name, mine]) => {
      const active = mine.filter((c) => c.status === 'active');
      const reviewN = mine.filter((c) => c.status === 'review').length;
      const fly = active[0] ?? mine.find((c) => c.status === 'review') ?? mine[0];
      return {
        name,
        rank: active.length ? 0 : reviewN ? 1 : 2,
        active,
        reviewN,
        doneN: mine.filter((c) => c.status === 'merged').length,
        lane: fly?.lane ?? '',
      };
    }).sort((x, y) => x.rank - y.rank || x.name.localeCompare(y.name));
    const busyN = agentRows.filter((r) => r.rank === 0).length;
    const agentsSec = h('div', { class: 'sec' }, h('span', {}, 'Agent 工作情况'), h('span', { class: 'mute' }, `${agentRows.length} 位执行者 · ${busyN} 位在途`));
    const agentsList = h('div', { class: 'lanes agents' },
      h('div', { class: 'lr lh' }, h('span', {}, '执行者'), h('span', {}, '状态'), h('span', {}, '泳道'), h('span', {}, '已合入')));
    for (const r of agentRows) {
      agentsList.append(h('div', { class: 'lr' },
        h('span', { class: 'b600 who', title: r.name }, r.name),
        r.active.length
          ? h('span', { class: 'tasks' }, h('span', { class: 'ink2' }, '执行中'),
            ...r.active.map((c) => h('span', { class: 'chip blu', title: `${c.title}\n${c.branch ?? ''}`, attrs: sendAttrs({ kind: 'card', id: c.id, title: c.title, lane: c.lane, status: STATUS_META[c.status].label }) }, c.id)))
          : h('span', { class: 'tasks' }, h('span', { class: r.reviewN ? 'ink2' : 'mute' }, r.reviewN ? `待审查 ${r.reviewN}` : '空闲')),
        h('span', { class: 'ink2' }, r.lane || '—'),
        h('span', { class: 'ink2' }, String(r.doneN))));
    }
    if (!agentRows.length && !pendingN) {
      agentsList.append(h('div', { class: 'mute pad8' }, cards.length ? '暂无已指派执行者的任务卡' : '暂无任务卡'));
    }
    if (pendingN) agentsList.append(h('div', { class: 'mute pad8' }, `另有 ${pendingN} 张待派发`));

    // ── 左栏续：多 Agent 配置（原右栏面板，整块换列至此，接在 wts 列表之后；标题已移出面板作栏目头）──
    const prefix = cfg?.get('BRANCH_PREFIX') ?? 'feat';
    left.append(h('div', { class: 'sec' }, h('span', {}, '多 Agent 配置'), h('span', { class: 'mute mono' }, CONFIG_FILE)));
    left.append(h('div', { class: 'panel cfg' },
      kv('集成分支', h('span', { class: 'mono' }, integ), '任务分支从这里切出并 --no-ff 合回'),
      kv('主分支', h('span', { class: 'mono' }, b.available ? b.mainBranch : g.mainBranch), '仅 Owner 批准后发布'),
      kv('最大并行', maxPar !== null ? `${maxPar} 个 worktree` : '—', `当前已用 ${extraWts}`),
      kv('Worktree 根目录', h('span', { class: 'mono' }, cfg?.get('WORKTREE_DIR') ?? (cfgErr ? '读取失败' : '读取中…')), '相对项目根；agent-worktree.sh new 在此创建'),
      kv('分支命名', h('span', { class: 'mono' }, `${prefix}/<泳道>/<任务>`)),
      cfgErr ? h('div', { class: 'error-text mt8' }, `${CONFIG_FILE}：${cfgErr}`) : null,
      h('div', { class: 'mute fs12 mt12' }, '配置文件由 coordinator 维护，此处只读；需修改请在任务分支中编辑文件。'),
      h('div', { class: 'fx8 mt12 wrap' }, fileBtn('查看 config.sh', CONFIG_FILE), fileBtn('查看 lanes.conf', LANES_FILE), fileBtn('协作流程', MULTI_AGENT_DOC))));

    // ── 右栏：泳道与 Agent（整块换列至此），其下接 Agent 工作情况 ──
    const right = h('div', { class: 'cfgcol' });
    right.append(lanesSec, table, agentsSec, agentsList);

    container.append(h('div', { class: 'gx agx' }, left, right));
  };

  store.on('workspace', () => {
    render();
    void loadConfig();
  });
  store.on('project', () => {
    cfg = null;
    cfgErr = '';
    render();
  });
  store.on('settings', render);
  render();
  void loadConfig();
}
