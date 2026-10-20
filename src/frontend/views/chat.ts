/**
 * 任务会话 · 中列对话（FR-004/005/011、FR-109、FR-111）：DOM 与类名对应 HTML 原型 renderSession() 的
 * .ctop / .thd / .log / .comp；消息、工具卡片、审批、斜杠命令、停止与 agent 选择器为真实功能。
 */
import type { BoardCard, ChatMessage, PermissionMode } from '../../../contracts/ipc.ts';
import { api, errorText } from '../api.ts';
import { agentSetupHint } from '../lib/agent-config.ts';
import { agentName, agentOptions, isCli } from '../lib/agent-label.ts';
import { insertBlock } from '../lib/context-send.ts';
import { hm } from '../lib/board-format.ts';
import { clear, h, setTrustedHtml } from '../lib/dom.ts';
import { icon } from '../lib/icons.ts';
import { renderMarkdown } from '../lib/markdown.ts';
import { parseSlashCommand, suggestCommands } from '../lib/slash-commands.ts';
import { store } from '../store.ts';
import { renderToolCard, type DiffRenderer } from './tool-card.ts';

export const MODE_LABELS: Readonly<Record<PermissionMode, string>> = { ask: '每次询问', 'auto-edits': '自动批准编辑', plan: '仅规划（只读）' };

export interface ChatHooks {
  renderDiff?: DiffRenderer;
  onNewSession(): void;
  onToggleList(): void;
  /** 会话标题含任务号时关联的任务卡（显示原型 .sysb 任务卡摘要）。 */
  linkedCard(): BoardCard | null;
}

export interface ChatView {
  renderAll(): void;
  appendDelta(messageId: string): void;
  insertText(text: string): void;
  /** 003：在光标处插入一段带来源标注的内容（前后补换行），不发送。 */
  insertBlock(text: string): void;
  notify(text: string, kind?: 'notice' | 'info'): void;
}

export async function decideApproval(approvalId: string, approved: boolean): Promise<void> {
  try {
    await api.invoke('agent:approve', { approvalId, approved });
  } catch (e) {
    store.state.notices.push({ afterMessageId: null, kind: 'notice', text: errorText(e) });
    store.emit('messages');
  }
}

export function mountChat(container: HTMLElement, hooks: ChatHooks): ChatView {
  clear(container);
  // ── .ctop：菜单 · agent 选择器 · 新建 ──
  const agentLabel = h('span');
  const agentSel = h('select', { title: '选择本会话使用的 agent' });
  const runningDot = h('span', { class: 'running-dot', title: 'Agent 运行中' });
  const ctop = h('div', { class: 'ctop' },
    h('button', { class: 'circ', title: '会话列表', on: { click: hooks.onToggleList } }, icon('menu')),
    h('span', { class: 'agent-pick' }, h('span', { class: 'md-sel' }, agentLabel, h('span', { class: 'mute vmid' }, icon('caret'))), agentSel, runningDot),
    h('button', { class: 'circ acc', title: '新建会话', on: { click: hooks.onNewSession } }, icon('plus')));
  // ── .thd ──
  const thTitle = h('span');
  const thRight = h('span', { class: 'mute' });
  const thChip = h('span', { class: 'chip acc' });
  const thDesc = h('span', { class: 'mute' });
  const thd = h('div', { class: 'thd' },
    h('div', { class: 'r' }, thTitle, thRight),
    h('div', { class: 'r' }, h('span', { class: 'fx8' }, thChip, thDesc), h('span', { class: 'mute' }, '会话记录（本机持久化，含每次工具调用）')));
  const log = h('div', { class: 'log' });
  // ── .comp ──
  const ctxChip = h('span', { class: 'chip acc' });
  const ctxText = h('span');
  const slashMenu = h('div', { class: 'slash-menu' });
  slashMenu.hidden = true;
  const textarea = h('textarea', { attrs: { placeholder: '回复…（Enter 发送，Shift+Enter 换行，/ 查看命令）' } });
  const stopBtn = h('button', { class: 'stop' }, '停止');
  const sendBtn = h('button', { class: 'send', title: '发送' }, icon('up'));
  const modeSel = h('select', { class: 'mode', title: '权限模式' });
  for (const [v, l] of Object.entries(MODE_LABELS)) modeSel.append(h('option', { attrs: { value: v } }, `权限：${l}`));
  const hint = h('span');
  const comp = h('div', { class: 'comp' },
    h('div', { class: 'ctx' }, ctxChip, ctxText),
    slashMenu,
    h('div', { class: 'box' }, textarea, h('div', { class: 'bar' }, h('span', { class: 'mute plus', title: '插入 @文件：在左侧项目结构中点击文件' }, '+'), h('span', { class: 'right' }, stopBtn, sendBtn))),
    h('div', { class: 'ft' }, h('span', {}, 'Enter 发送 · Shift + Enter 换行'), hint, modeSel));
  container.append(ctop, thd, log, comp);

  const pendingDeltas = new Set<string>();
  let frame = 0;
  const settings = () => store.state.settings;

  const msgEls = (m: ChatMessage): HTMLElement[] => {
    if (m.role === 'tool') return [];
    if (m.role === 'user') {
      return [h('div', { class: 'meta umeta' }, h('span', {}, '你'), h('span', {}, hm(m.createdAt))), h('div', { class: 'ubub-row' }, h('div', { class: 'ubub' }, m.content))];
    }
    const body = h('div', { class: 'md' });
    setTrustedHtml(body, renderMarkdown(m.content));
    const out: HTMLElement[] = [
      h('div', { class: 'meta' }, icon('star'), h('span', {}, agentName(m.agent ?? 'builtin', settings())), h('span', {}, hm(m.createdAt))),
      h('div', { class: 'msg', attrs: { 'data-id': m.id } }, body),
    ];
    for (const call of m.toolCalls ?? []) {
      const approval = [...store.state.approvals.values()].find((a) => a.toolCallId === call.id);
      out.push(renderToolCard(call, approval, (id, ok) => void decideApproval(id, ok), hooks.renderDiff));
    }
    if (m.content) {
      out.push(h('div', { class: 'fb msg' },
        h('button', { title: '复制', on: { click: () => void navigator.clipboard.writeText(m.content) } }, icon('copy')),
        h('button', { title: '重新提问（把上一条消息放回输入框）', on: { click: () => retryFrom(m.id) } }, icon('retry'))));
    }
    return out;
  };

  const retryFrom = (assistantId: string) => {
    const msgs = store.state.current?.messages ?? [];
    const i = msgs.findIndex((x) => x.id === assistantId);
    const prev = msgs.slice(0, i).reverse().find((x) => x.role === 'user');
    if (prev) {
      textarea.value = prev.content;
      textarea.focus();
    }
  };

  const noticeEl = (text: string, kind: 'notice' | 'info') => h('div', { class: `notice${kind === 'info' ? ' info' : ''}` }, text);

  const sysbEl = (): HTMLElement | null => {
    const c = hooks.linkedCard();
    if (!c) return null;
    return h('div', { class: 'sysb' }, h('b', { class: 'b600' }, `任务卡 ${c.file}`), h('br'), `目标：${c.goal || '—'}`, h('br'),
      `对应需求 ${c.frsLabel}\u3000·\u3000包含任务号 ${c.specTaskIds.join(', ') || '—'}\u3000·\u3000前置 ${c.deps.join('、') || '无'}`);
  };

  const renderHeader = () => {
    const s = store.state.current;
    const st = settings();
    const agent = s?.agent ?? st?.defaultAgent ?? 'builtin';
    const cli = isCli(agent, st);
    agentLabel.textContent = agentName(agent, st);
    clear(agentSel);
    for (const o of agentOptions(st)) agentSel.append(h('option', { attrs: { value: o.ref } }, o.label));
    agentSel.value = agent;
    const running = store.isRunning();
    runningDot.hidden = !running;
    agentSel.disabled = running;
    stopBtn.hidden = !running;
    sendBtn.disabled = running || !s;
    thTitle.textContent = s ? s.title : '';
    const cliSid = s && agent !== 'builtin' ? s.cliSessions?.[agent.slice(4)] : undefined;
    thRight.textContent = cli ? (cliSid ? `CLI 会话 ${cliSid}` : 'CLI 会话：首轮后建立') : `${s?.messages.length ?? 0} 条消息`;
    thChip.textContent = cli ? `外部 CLI · ${agentName(agent, st)}` : `内置 · ${agentName(agent, st)}`;
    thDesc.textContent = store.state.project ? `工作目录 ${store.state.project.name} · ${MODE_LABELS[st?.permissionMode ?? 'ask']}` : '未打开项目（外部 CLI 需要项目；内置 agent 仅对话）';
    ctxChip.textContent = `@${cli ? (st?.agentClis?.find((x) => `cli:${x.id}` === agent)?.name ?? 'cli') : 'agent'}`;
    const card = hooks.linkedCard();
    ctxText.textContent = `上下文：${card ? `${card.id} · ` : ''}${store.state.project ? `${store.state.project.name} · AGENTS.md` : '无项目'}`;
    textarea.placeholder = `回复 ${agentName(agent, st)}…（Enter 发送，Shift+Enter 换行，/ 查看命令）`;
    if (st) modeSel.value = st.permissionMode;
    hint.textContent = cli ? '外部 CLI：每次询问 = 每轮批准命令行；仅规划 = 禁止编辑与命令' : agentSetupHint(agent, st) ? '请先在设置中配置 agent（左侧齿轮「设置」）' : '写入与命令执行前会请求批准';
  };

  const renderAll = () => {
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    clear(log);
    const s = store.state.current;
    const sysb = sysbEl();
    if (sysb) log.append(sysb);
    const visible = s?.messages.filter((m) => m.role !== 'tool') ?? [];
    if (!s || (visible.length === 0 && store.state.notices.length === 0)) {
      log.append(h('div', { class: 'meta center' }, '— 开始一个任务 —'),
        h('div', { class: 'ev' }, icon('route'), h('span', {}, '例如：「解释这个项目的结构」「给 README 加上安装说明」「运行测试并修复失败」。输入 / 查看 /init、/specify、/plan、/tasks、/implement 等命令；顶部可切换内置 agent 或外部 CLI（如 opencode）。')));
      const setup = agentSetupHint(s?.agent ?? settings()?.defaultAgent ?? 'builtin', settings());
      if (setup) log.append(h('div', { class: 'notice setup' }, setup));
    }
    for (const n of store.state.notices.filter((x) => x.afterMessageId === null && visible.length === 0)) log.append(noticeEl(n.text, n.kind));
    for (const m of visible) {
      log.append(...msgEls(m));
      for (const n of store.state.notices.filter((x) => x.afterMessageId === m.id)) log.append(noticeEl(n.text, n.kind));
    }
    const lastId = visible[visible.length - 1]?.id;
    for (const n of store.state.notices.filter((x) => x.afterMessageId === null && visible.length > 0)) {
      n.afterMessageId = lastId ?? null;
      log.append(noticeEl(n.text, n.kind));
    }
    renderHeader();
    if (nearBottom) log.scrollTop = log.scrollHeight;
  };

  /** 流式增量按帧合并渲染（SC-006）。 */
  const appendDelta = (messageId: string) => {
    pendingDeltas.add(messageId);
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
      for (const id of pendingDeltas) {
        const m = store.state.current?.messages.find((x) => x.id === id);
        const body = log.querySelector(`.msg[data-id="${CSS.escape(id)}"] .md`);
        if (m && body) setTrustedHtml(body, renderMarkdown(m.content));
      }
      pendingDeltas.clear();
      if (nearBottom) log.scrollTop = log.scrollHeight;
    });
  };

  const notify = (text: string, kind: 'notice' | 'info' = 'notice') => {
    const last = store.state.current?.messages.filter((m) => m.role !== 'tool').at(-1);
    store.state.notices.push({ afterMessageId: last?.id ?? null, kind, text });
    renderAll();
  };

  const renderSlashMenu = () => {
    const items = suggestCommands(textarea.value);
    clear(slashMenu);
    slashMenu.hidden = items.length === 0;
    for (const c of items) slashMenu.append(h('div', {}, h('b', {}, c.usage), c.description));
  };

  /** 斜杠命令（FR-013）：本地动作在此执行；返回要发送给 Agent 的文本，或 null 表示已处理。 */
  const runSlash = async (text: string): Promise<string | null> => {
    const r = parseSlashCommand(text);
    const s = store.state.current;
    switch (r.kind) {
      case 'none': return text;
      case 'prompt': return r.prompt;
      case 'help': notify(r.text, 'info'); return null;
      case 'error': notify(r.text); return null;
      case 'clear':
        if (s) {
          store.state.current = await api.invoke('sessions:clear', s.id);
          store.state.notices = [];
          store.emit('current', 'todos');
        }
        return null;
      case 'model': {
        const st = settings();
        if (r.model === null) {
          notify(`内置 agent 当前模型：${st?.model ?? '未知'}（${st?.provider === 'anthropic' ? 'Anthropic' : 'OpenAI 兼容'}）。外部 CLI 的模型在 设置 › Agent CLI 中配置。`, 'info');
          return null;
        }
        store.state.settings = await api.invoke('settings:set', { model: r.model });
        store.emit('settings');
        notify(`已切换内置 agent 模型为 ${r.model}，下一条消息生效。`, 'info');
        return null;
      }
    }
  };

  const send = async () => {
    const raw = textarea.value.trim();
    const s = store.state.current;
    if (!raw || !s) return;
    textarea.value = '';
    renderSlashMenu();
    let text: string | null;
    try {
      text = await runSlash(raw);
    } catch (e) {
      notify(errorText(e));
      return;
    }
    if (text === null) return;
    const setup = agentSetupHint(s.agent ?? settings()?.defaultAgent ?? 'builtin', settings());
    if (setup) {
      textarea.value = raw;
      notify(setup);
      return;
    }
    // 乐观追加用户消息（主进程会写入同样内容；切换会话时以持久化版本为准）
    const local: ChatMessage = { id: `local-${Date.now()}`, role: 'user', content: text, createdAt: new Date().toISOString() };
    s.messages.push(local);
    renderAll();
    try {
      await api.invoke('agent:send', { sessionId: s.id, text });
    } catch (e) {
      s.messages.splice(s.messages.indexOf(local), 1);
      textarea.value = raw;
      notify(errorText(e));
    }
  };

  textarea.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) {
      ev.preventDefault();
      void send();
    }
  });
  textarea.addEventListener('input', renderSlashMenu);
  sendBtn.addEventListener('click', () => void send());
  stopBtn.addEventListener('click', () => {
    const s = store.state.current;
    if (s) void api.invoke('agent:stop', s.id).catch((e: unknown) => notify(errorText(e)));
  });
  agentSel.addEventListener('change', async () => {
    const s = store.state.current;
    if (!s) return;
    try {
      store.state.current = await api.invoke('sessions:setAgent', s.id, agentSel.value as 'builtin');
      store.emit('current');
    } catch (e) {
      notify(errorText(e));
      renderHeader();
    }
  });
  modeSel.addEventListener('change', async () => {
    try {
      store.state.settings = await api.invoke('settings:set', { permissionMode: modeSel.value as PermissionMode });
      store.emit('settings');
    } catch (e) {
      notify(errorText(e));
    }
  });

  store.on('current', renderAll);
  store.on('messages', renderAll);
  store.on('approvals', renderAll);
  store.on('workspace', renderAll);
  store.on('running', renderHeader);
  store.on('settings', renderAll);
  store.on('project', renderHeader);
  renderAll();

  return {
    renderAll,
    appendDelta,
    notify,
    insertText: (text) => {
      textarea.setRangeText(text, textarea.selectionStart, textarea.selectionEnd, 'end');
      textarea.focus();
    },
    insertBlock: (text) => {
      const r = insertBlock(textarea.value, textarea.selectionStart, textarea.selectionEnd, text);
      textarea.value = r.text;
      textarea.focus();
      textarea.setSelectionRange(r.caret, r.caret);
      textarea.scrollTop = textarea.scrollHeight;
      renderSlashMenu();
    },
  };
}
