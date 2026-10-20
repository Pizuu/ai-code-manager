/**
 * 左栏（FR-001）：项目文件夹选择 + 懒加载文件树；点击文件把 @路径 插入输入框。
 */
import type { FileNode } from '../../../contracts/ipc.ts';
import { api, errorText } from '../api.ts';
import { clear, h } from '../lib/dom.ts';
import { store } from '../store.ts';
import { openSettings } from './settings-dialog.ts';

export interface SidebarHooks {
  insertText(text: string): void;
  notify(text: string): void;
}

function treeNode(node: FileNode, hooks: SidebarHooks): HTMLElement {
  const label = h('div', { class: 'tree-node', title: node.relPath }, `${node.kind === 'dir' ? '▸ ' : '  '}${node.name}`);
  const wrap = h('div', {}, label);
  if (node.kind === 'file') {
    label.addEventListener('click', () => hooks.insertText(`@${node.relPath} `));
    return wrap;
  }
  let children: HTMLElement | null = null;
  label.addEventListener('click', async () => {
    if (children) {
      children.remove();
      children = null;
      label.textContent = `▸ ${node.name}`;
      return;
    }
    try {
      const nodes = await api.invoke('fs:tree', node.relPath);
      children = h('div', { class: 'tree-children' }, ...nodes.map((n) => treeNode(n, hooks)));
      wrap.append(children);
      label.textContent = `▾ ${node.name}`;
    } catch (e) {
      hooks.notify(errorText(e));
    }
  });
  return wrap;
}

export function mountProjectSection(container: HTMLElement, hooks: SidebarHooks): void {
  const name = h('div', { class: 'project-name' });
  const tree = h('div', { class: 'tree' });
  const refresh = h('button', { class: 'ghost', title: '刷新文件树' }, '⟳');
  const pick = h('button', {}, '打开文件夹');

  const render = async () => {
    const p = store.state.project;
    name.textContent = p ? p.name : '未打开项目';
    name.title = p ? p.root : '';
    clear(tree);
    if (!p) {
      tree.append(h('div', { class: 'empty-hint' }, '打开一个本地项目文件夹，Agent 才能读写文件与执行命令。'));
      return;
    }
    try {
      const nodes = await api.invoke('fs:tree', '');
      tree.append(...nodes.map((n) => treeNode(n, hooks)));
    } catch (e) {
      tree.append(h('div', { class: 'error-text' }, errorText(e)));
    }
  };

  pick.addEventListener('click', async () => {
    try {
      const info = await api.invoke('project:pick');
      if (info) {
        store.state.project = info;
        store.emit('project');
      }
    } catch (e) {
      hooks.notify(errorText(e));
    }
  });
  refresh.addEventListener('click', () => void render());
  store.on('project', () => void render());

  container.append(h('div', { class: 'section grow' },
    h('div', { class: 'section-title' }, h('span', {}, '项目'), h('span', {}, refresh, pick)),
    name,
    tree));
  void render();
}

export function mountSidebarFooter(container: HTMLElement): void {
  const label = h('div', { class: 'grow-text' });
  const render = () => {
    const s = store.state.settings;
    label.textContent = s ? `${s.provider === 'anthropic' ? 'Anthropic' : 'OpenAI 兼容'} · ${s.model}` : '';
  };
  store.on('settings', render);
  render();
  container.append(h('div', { class: 'sidebar-footer' }, h('button', { on: { click: openSettings } }, '⚙ 设置'), label));
}

export function mountSidebar(container: HTMLElement, hooks: SidebarHooks): void {
  clear(container);
  container.append(h('div', { class: 'brand' }, h('span', { class: 'dot' }), 'AI Code Manager'));
  mountProjectSection(container, hooks);
  mountSidebarFooter(container);
}
