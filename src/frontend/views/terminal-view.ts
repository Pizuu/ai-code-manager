/**
 * 终端面板（FR-008）：run_command 的实时输出；stderr 与提示行分色。
 */
import { clear, h } from '../lib/dom.ts';
import { store } from '../store.ts';

export function mountTerminalPanel(container: HTMLElement): void {
  const term = h('div', { class: 'terminal' });
  const shellName = window.api.platform === 'win32' ? 'PowerShell' : 'bash';
  const clearBtn = h('button', { class: 'ghost', on: { click: () => { store.state.terminal = []; store.emit('terminal'); } } }, '清空');
  container.append(h('div', { class: 'panel-toolbar' }, h('span', { class: 'grow-text' }, `命令输出（${shellName}，工作目录为项目根）`), clearBtn), term);
  let rendered = 0;

  const render = () => {
    const chunks = store.state.terminal;
    if (chunks.length < rendered) {
      clear(term);
      rendered = 0;
    }
    if (chunks.length === 0) {
      term.textContent = '（暂无输出。Agent 执行命令前会先请求你的批准。）';
      return;
    }
    if (rendered === 0) clear(term);
    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 60;
    for (const c of chunks.slice(rendered)) term.append(h('span', { class: c.stream }, c.data));
    rendered = chunks.length;
    if (nearBottom) container.scrollTop = container.scrollHeight;
  };
  store.on('terminal', render);
  render();
}
