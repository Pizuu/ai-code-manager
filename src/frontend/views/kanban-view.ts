/**
 * 「看板」标签页：原泳道看板 / Agents / Git 三个板块合并为一页，按 Spec Kit 视角的信息重要性自上而下排列：
 *   1. 任务进度（功能概览 · 容量 · 根因 / 不一致 · 任务矩阵）——spec 推进到哪、卡在哪；
 *   2. Agent 执行（泳道与 Agent · Agent 工作情况）——谁在做哪张卡；
 *   3. 集成与 Git（按序集成 · 提交图 · Pull requests）——做完的东西是否合入；
 *   4. Worktree 与配置（并行 worktree · 多 Agent 配置）——基础设施，最少看。
 * 各节仍由原视图模块渲染（board-view / agents-view / git-view），这里只负责布局、节标题与节内跳转。
 * 未打开项目时只显示任务进度节的「请先打开项目」，其余节隐藏，避免同一提示出现三次。
 */
import { h } from '../lib/dom.ts';
import { store } from '../store.ts';

export type KanbanSection = 'tasks' | 'agents' | 'git' | 'infra';

export interface KanbanView {
  /** 各节内容容器：tasks → mountBoard，agents / infra → mountAgents，git → mountGit。 */
  hosts: Record<KanbanSection, HTMLElement>;
  /** 滚动到指定节（节标题顶到视口上沿）。 */
  scrollTo(section: KanbanSection): void;
}

const TITLES: Readonly<Record<KanbanSection, string>> = {
  tasks: '任务进度',
  agents: 'Agent 执行',
  git: '集成与 Git',
  infra: 'Worktree 与配置',
};

export function mountKanban(container: HTMLElement): KanbanView {
  const order: KanbanSection[] = ['tasks', 'agents', 'git', 'infra'];
  // 保留 #wb-git / #wb-agents 作为节内容容器 id（样式与 e2e 选择器沿用）
  const ids: Record<KanbanSection, string> = { tasks: 'kb-tasks', agents: 'wb-agents', git: 'wb-git', infra: 'kb-infra' };
  const hosts = {} as Record<KanbanSection, HTMLElement>;
  const sections = {} as Record<KanbanSection, HTMLElement>;
  for (const id of order) {
    hosts[id] = h('div', { class: 'kb-body', attrs: { id: ids[id] } });
    const head = h('div', { class: 'kb-h' }, h('span', {}, TITLES[id]));
    sections[id] = h('section', { class: `kb-sec kb-${id}`, attrs: { 'data-kb': id } }, head, hosts[id]);
  }
  // 节内快速跳转（页内锚点条）
  const jump = h('nav', { class: 'kb-jump', attrs: { 'aria-label': '看板分节' } },
    ...order.map((id) => h('button', { class: 'btn sm', attrs: { type: 'button' }, on: { click: () => scrollTo(id) } }, TITLES[id])));
  container.append(jump, ...order.map((id) => sections[id]));

  const scrollTo = (section: KanbanSection) => {
    const el = sections[section];
    const top = container.scrollTop + el.getBoundingClientRect().top - container.getBoundingClientRect().top - jump.offsetHeight;
    container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  };

  const syncProject = () => {
    const has = !!store.state.project;
    jump.hidden = !has;
    for (const id of order) if (id !== 'tasks') sections[id].hidden = !has;
  };
  store.on('project', syncProject);
  syncProject();
  return { hosts, scrollTo };
}
