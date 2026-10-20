/**
 * 任务会话 · 中列对话（FR-004/005/011、FR-109、FR-111）：DOM 与类名对应 HTML 原型 renderSession() 的
 * .ctop / .thd / .log / .comp；消息、工具卡片、审批、斜杠命令、停止与 agent 选择器为真实功能。
 *
 * v1.8：改为主流对话样式（回合制）——用户消息为右侧气泡，助手消息为「头部（头像 / 名称 / 时间 / 操作）+
 * 正文」的回合；工具调用收进可折叠的「思考」区（默认折叠，有待批准时自动展开，见 lib/chat-turn.ts）。
 */
import type { BoardCard, ChatMessage, PermissionMode, ToolCallRecord } from '../../../contracts/ipc.ts';
import { api, errorText } from '../api.ts';
import { agentSetupHint } from '../lib/agent-config.ts';
import { agentName, agentOptions, agentWho, isCli } from '../lib/agent-label.ts';
import { insertBlock } from '../lib/context-send.ts';
import { hm } from '../lib/board-format.ts';
import { avatarText, hasPendingApproval, thinkCountText, thinkLastAction, thinkStatusText } from '../lib/chat-turn.ts';
import { clear, h, setTrustedHtml } from '../lib/dom.ts';
import { errorSectionTitle } from '../lib/error-log.ts';
import { icon } from '../lib/icons.ts';
import { renderMarkdown } from '../lib/markdown.ts';
import { parseSlashCommand, suggestCommands } from '../lib/slash-commands.ts';
import { store } from '../store.ts';
import { renderToolCard, type DiffRenderer } from './tool-card.ts';

export const MODE_LABELS: Readonly<Record<PermissionMode, string>> = { ask: '每次询问', 'auto-edits': '自动批准编辑', plan: '仅规划（只读）', 'allow-all': '全部允许（免审批）' };

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
  const thTitle = h('span', { class: 'th-title' });
  const thRight = h('span', { class: 'mute' });
  const thChip = h('span', { class: 'chip acc' });
  const thDesc = h('span', { class: 'mute' });
  const thd = h('div', { class: 'thd' },
    h('div', { class: 'r' }, thTitle, thRight),
    h('div', { class: 'r' }, h('span', { class: 'fx8' }, thChip, thDesc)));
  const log = h('div', { class: 'log' });
  // v1.8：对话正文限宽居中（长文更好读）；「正在思考…」提示固定挂在末尾。
  const logIn = h('div', { class: 'log-in' });
  log.append(logIn);
  const liveEl = h('div', { class: 'live', attrs: { 'aria-live': 'polite' } },
    h('span', { class: 'live-dots' }, h('i'), h('i'), h('i')),
    h('span', {}, '正在思考…'));
  liveEl.hidden = true;
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
  // CLI 模型切换器：占用 hint 的位置（.ft 第二个元素），仅 CLI 会话显示（内置 agent 会话仍用 hint 文案）。
  // 生效模型 = session.cliModel（会话覆盖）?? 该 CLI 配置的 model ?? 'CLI 默认'。
  const modelLabel = h('span');
  const modelPick = h('span', { class: 'model-pick', title: '本会话的 CLI 模型（点击切换，下一轮生效）', attrs: { role: 'button', tabindex: '0' } },
    h('span', { class: 'md-sel' }, modelLabel, h('span', { class: 'mute vmid' }, icon('caret'))));
  modelPick.hidden = true;
  const modelMenu = h('div', { class: 'ctxmenu model-menu', attrs: { role: 'menu' } });
  modelMenu.hidden = true;
  document.body.append(modelMenu);
  /** 菜单当前锚定的会话与 CLI；会话切换后由 renderHeader 关闭过期菜单。 */
  let modelMenuFor: { sessionId: string; cliId: string } | null = null;
  let modelMenuMode: 'list' | 'custom' = 'list';
  /** 最近一次 agentCli:models 的结果（null = 尚未拉到；拉取失败按空数组，静默）。 */
  let modelCandidates: string[] | null = null;
  const closeModelMenu = () => {
    modelMenu.hidden = true;
    modelMenuFor = null;
  };
  const comp = h('div', { class: 'comp' },
    h('div', { class: 'ctx' }, ctxChip, ctxText),
    slashMenu,
    h('div', { class: 'box' }, textarea, h('div', { class: 'bar' }, h('span', { class: 'mute plus', title: '插入 @文件：在左侧项目结构中点击文件' }, '+'), h('span', { class: 'right' }, stopBtn, sendBtn))),
    h('div', { class: 'ft' }, h('span', {}, 'Enter 发送 · Shift + Enter 换行'), hint, modelPick, modeSel));
  container.append(ctop, thd, log, comp);

  const pendingDeltas = new Set<string>();
  let frame = 0;
  const settings = () => store.state.settings;

  // ── v1.8：回合制的对话渲染 ──
  /** 思考区展开状态（消息 ID → 用户显式选择）；未记录时按「有待批准则展开」处理。 */
  const thinkOpen = new Map<string, boolean>();
  /** 因待批准而自动展开过的消息：用户手动收起前保持展开（否则批准后卡片会突然消失）。 */
  const thinkSticky = new Set<string>();
  /** 当前会话 ID（切换会话时清掉展开状态）。 */
  let lastSessionId: string | null = null;

  /** 助手回合头部的操作按钮（复制 / 重新提问）。悬停回合时显示。 */
  const turnActions = (m: ChatMessage): HTMLElement => h('span', { class: 'acts' },
    m.content ? h('button', { class: 'act', title: '复制', attrs: { type: 'button' }, on: { click: () => void navigator.clipboard.writeText(m.content) } }, icon('copy')) : null,
    h('button', { class: 'act', title: '重新提问（把上一条消息放回输入框）', attrs: { type: 'button' }, on: { click: () => retryFrom(m.id) } }, icon('retry')));

  /** 用户回合：右侧气泡 + 时间戳。 */
  const userTurn = (m: ChatMessage): HTMLElement => h('article', { class: 'turn user' },
    h('div', { class: 'ubub-row' }, h('div', { class: 'ubub' }, m.content)),
    h('div', { class: 'turn-ft' }, h('span', { class: 'turn-tm' }, hm(m.createdAt))));

  /**
   * 「思考」区：工具调用的可折叠容器。
   * - 默认折叠（对话读起来干净）；有调用待批准时强制展开，否则批准按钮点不到。
   * - 因待批准展开过的，在批准完成前保持展开（sticky），避免卡片突然消失。
   * - 用户的显式开合优先（重渲染与切换会话后保持）。
   */
  const thinkBlock = (m: ChatMessage, calls: ToolCallRecord[]): HTMLElement => {
    const det = h('details', { class: 'think' });
    const summary = h('summary', { class: 'think-sum', attrs: { title: '展开 / 折叠思考过程' } },
      h('span', { class: 'think-caret' }, icon('caret')),
      h('span', { class: 'think-label' }, '思考过程'),
      h('span', { class: 'mute think-count' }, thinkCountText(calls)));
    const status = thinkStatusText(calls);
    if (status) summary.append(h('span', { class: 'mute think-detail' }, status));
    const last = thinkLastAction(calls);
    if (last) summary.append(h('span', { class: 'mute think-last', attrs: { title: last } }, last));
    const body = h('div', { class: 'think-body' });
    for (const call of calls) {
      const approval = [...store.state.approvals.values()].find((a) => a.toolCallId === call.id);
      body.append(renderToolCard(call, approval, (id, ok) => void decideApproval(id, ok), hooks.renderDiff));
    }
    det.append(summary, body);

    // 展开判定（优先级从高到低）：
    // 1. 有待批准的调用 → 强制展开：批准按钮被折叠就点不到了；
    // 2. 用户显式选择过 → 用用户的选择；
    // 3. 曾因待批准自动展开过（sticky）→ 保持展开，避免批准后卡片突然消失；
    // 4. 其余 → 折叠（对话读起来干净）。
    const pending = hasPendingApproval(calls) || calls.some((c) => [...store.state.approvals.values()].some((a) => a.toolCallId === c.id));
    let open: boolean;
    if (pending) {
      open = true;
      thinkOpen.delete(m.id); // 强制展开覆盖用户此前的收起选择
      thinkSticky.add(m.id);
    } else {
      const explicit = thinkOpen.get(m.id);
      open = explicit !== undefined ? explicit : thinkSticky.has(m.id);
    }
    det.open = open;
    // 自行接管开合（阻止 summary 的默认行为），保证重渲染后状态可还原。
    summary.addEventListener('click', (ev) => {
      ev.preventDefault();
      const next = !det.open;
      det.open = next;
      thinkOpen.set(m.id, next);
    });
    return det;
  };

  /** 助手回合：头部（头像 / 名称 / 时间 / 操作）+ 正文 + 可折叠的思考区。 */
  const assistantTurn = (m: ChatMessage): HTMLElement => {
    const body = h('div', { class: 'md' });
    setTrustedHtml(body, renderMarkdown(m.content));
    const who = agentWho(m.agent ?? 'builtin', settings());
    const turn = h('article', { class: 'turn assistant' },
      h('header', { class: 'turn-hd' },
        h('span', { class: 'avatar', attrs: { 'aria-hidden': 'true' } }, avatarText(who)),
        h('span', { class: 'who', attrs: { title: agentName(m.agent ?? 'builtin', settings()) } }, who),
        h('span', { class: 'tm' }, hm(m.createdAt)),
        turnActions(m)),
      h('div', { class: 'msg', attrs: { 'data-id': m.id } }, body));
    const calls = m.toolCalls ?? [];
    if (calls.length) turn.append(thinkBlock(m, calls));
    return turn;
  };

  const msgEls = (m: ChatMessage): HTMLElement[] => {
    if (m.role === 'tool') return [];
    if (m.role === 'user') return [userTurn(m)];
    return [assistantTurn(m)];
  };

  /** 正在流式输出的最后一条助手消息（运行中才有）。 */
  const streamingMessage = (): ChatMessage | null => {
    if (!store.isRunning()) return null;
    const msgs = store.state.current?.messages.filter((m) => m.role !== 'tool') ?? [];
    const last = msgs.at(-1);
    return last && last.role === 'assistant' ? last : null;
  };

  /** 流式光标：挂在正在输出的助手正文末尾。 */
  const setCaret = (): void => {
    for (const el of log.querySelectorAll('.caret-blink')) el.remove();
    const id = streamingMessage()?.id;
    if (!id) return;
    const body = log.querySelector(`.msg[data-id="${CSS.escape(id)}"]`);
    if (body) body.append(h('span', { class: 'caret-blink', attrs: { 'aria-hidden': 'true' } }));
  };

  /** 「正在思考…」提示：运行中且还没有正文时显示（有正文时改为正文末尾的光标）。 */
  const updateLive = (): void => {
    const wasHidden = liveEl.hidden;
    liveEl.hidden = !store.isRunning() || streamingMessage() !== null;
    // 提示刚出现时把对话底部带进视野（否则提示会被裁在可视区外）。
    if (wasHidden && !liveEl.hidden && log.scrollHeight - log.scrollTop - log.clientHeight < 80) {
      log.scrollTop = log.scrollHeight;
    }
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
    // CLI 会话：底栏 hint 位置换成模型切换器；内置 agent 会话保持原 hint 文案。
    if (cli && s) {
      hint.hidden = true;
      modelPick.hidden = false;
      const override = s.cliModel?.trim() ? s.cliModel : undefined;
      const cfgModel = st?.agentClis?.find((x) => x.id === agent.slice(4))?.model;
      modelLabel.textContent = `模型：${override ?? (cfgModel ? cfgModel : 'CLI 默认')}`;
    } else {
      modelPick.hidden = true;
      hint.hidden = false;
      hint.textContent = cli ? '外部 CLI：每次询问 = 每轮批准命令行；仅规划 = 禁止编辑与命令' : agentSetupHint(agent, st) ? '请先在设置中配置 agent（左侧齿轮「设置」）' : '写入与命令执行前会请求批准';
    }
    // 菜单锚定的会话已切换（或不再是 CLI 会话）时关掉，避免对旧会话写模型。
    if (modelMenuFor && (modelMenuFor.sessionId !== s?.id || !cli)) closeModelMenu();
  };

  const renderAll = () => {
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    clear(logIn);
    const s = store.state.current;
    // 切换会话时清掉上一会话的思考区展开状态（消息 ID 不跨会话复用）。
    const sid = s?.id ?? null;
    if (sid !== lastSessionId) {
      lastSessionId = sid;
      thinkOpen.clear();
      thinkSticky.clear();
    }
    const sysb = sysbEl();
    if (sysb) logIn.append(sysb);
    const visible = s?.messages.filter((m) => m.role !== 'tool') ?? [];
    if (!s || (visible.length === 0 && store.state.notices.length === 0)) {
      logIn.append(h('div', { class: 'meta center' }, '— 开始一个任务 —'),
        h('div', { class: 'ev' }, icon('route'), h('span', {}, '例如：「解释这个项目的结构」「给 README 加上安装说明」「运行测试并修复失败」。输入 / 查看 /init、/specify、/plan、/tasks、/implement 等命令；顶部可切换内置 agent 或外部 CLI（如 opencode）。')));
      const setup = agentSetupHint(s?.agent ?? settings()?.defaultAgent ?? 'builtin', settings());
      if (setup) logIn.append(h('div', { class: 'notice setup' }, setup));
    }
    for (const n of store.state.notices.filter((x) => x.afterMessageId === null && visible.length === 0)) logIn.append(noticeEl(n.text, n.kind));
    for (const m of visible) {
      logIn.append(...msgEls(m));
      for (const n of store.state.notices.filter((x) => x.afterMessageId === m.id)) logIn.append(noticeEl(n.text, n.kind));
    }
    const lastId = visible[visible.length - 1]?.id;
    for (const n of store.state.notices.filter((x) => x.afterMessageId === null && visible.length > 0)) {
      n.afterMessageId = lastId ?? null;
      logIn.append(noticeEl(n.text, n.kind));
    }
    // P1-6：错误 / 日志分区——把错误集中到一处，便于追溯（不再淹没在消息流里）
    const errEntries = s ? store.errorsOf(s.id) : [];
    if (errEntries.length) {
      const box = h('details', { class: 'errlog' },
        h('summary', {}, h('b', { class: 'b600' }, errorSectionTitle(errEntries))),
        h('div', { class: 'list' }, ...errEntries.map((e) => h('div', { class: 'e' },
          h('div', { class: 'h' }, h('span', { class: `chip ${e.kind === 'tool' ? 'amb' : 'acc'}` }, e.kind === 'tool' ? '工具失败' : 'Agent 错误'), h('span', { class: 't' }, e.text), h('span', { class: 'mute mono' }, hm(e.at))),
          e.detail ? h('pre', {}, e.detail) : null))));
      box.open = true;
      logIn.append(box);
    }
    // 「正在思考…」提示永远挂在末尾；流式正文末尾另有一个光标。
    logIn.append(liveEl);
    updateLive();
    setCaret();
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

  // ── CLI 模型切换（agent:setSessionModel 写会话覆盖；agentCli:models 拉候选，仅 opencode 有） ──
  /** 切换只影响下一轮，不打断运行中的一轮（与 agentSel 切换 agent 的写回方式一致）。 */
  const applySessionModel = async (model: string | null) => {
    const s = store.state.current;
    if (!s) return;
    const sessionId = s.id;
    closeModelMenu();
    try {
      const updated = await api.invoke('agent:setSessionModel', { sessionId, model });
      if (store.state.current?.id === sessionId) {
        store.state.current = updated;
        store.emit('current');
      }
      notify(model ? `已切换本会话模型为 ${model}，下一条消息生效。` : '已清除本会话的模型覆盖，使用 CLI 默认，下一条消息生效。', 'info');
    } catch (e) {
      notify(errorText(e));
      renderHeader();
    }
  };

  const modelMenuItem = (label: string, sub: string, checked: boolean, fn: () => void) =>
    h('button', { class: 'mi', attrs: { type: 'button', role: 'menuitem' }, on: { click: fn } },
      h('span', {}, `${checked ? '✓ ' : ''}${label}`), sub ? h('span', { class: 'mute' }, sub) : null);

  const positionModelMenu = () => {
    const r = modelPick.getBoundingClientRect();
    const { innerWidth: W, innerHeight: H } = window;
    const rect = modelMenu.getBoundingClientRect();
    modelMenu.style.left = `${Math.max(4, Math.min(r.left, W - rect.width - 4))}px`;
    // 底栏在窗口底部，菜单优先向上展开；放不下再向下。
    const above = r.top - rect.height - 4;
    modelMenu.style.top = `${above >= 4 ? above : Math.max(4, Math.min(r.bottom + 4, H - rect.height - 4))}px`;
  };

  const buildModelMenu = (loading: boolean) => {
    const s = store.state.current;
    const target = modelMenuFor;
    if (!s || !target) return;
    modelMenuMode = 'list';
    const cfg = settings()?.agentClis?.find((x) => x.id === target.cliId);
    const override = s.cliModel?.trim() ? s.cliModel : undefined;
    const cfgModel = cfg?.model?.trim() ? cfg.model : undefined;
    const items: HTMLElement[] = [
      modelMenuItem('CLI 默认', cfgModel ? `解析为配置模型 ${cfgModel}` : '使用 CLI 自身默认模型', !override, () => void applySessionModel(null)),
    ];
    if (cfgModel) items.push(modelMenuItem(cfgModel, '配置', override === cfgModel, () => void applySessionModel(cfgModel)));
    if (loading) {
      items.push(h('div', { class: 'mi dis' }, '加载模型…'));
    } else {
      for (const m of modelCandidates ?? []) {
        if (m === cfgModel) continue;
        items.push(modelMenuItem(m, '', override === m, () => void applySessionModel(m)));
      }
    }
    const customCurrent = override && override !== cfgModel && !(modelCandidates ?? []).includes(override) ? `当前：${override}` : '';
    items.push(modelMenuItem('自定义…', customCurrent, false, showCustomModelForm));
    modelMenu.replaceChildren(...items);
    positionModelMenu();
  };

  /** 「自定义…」：在菜单内输入任意 model 字符串（Enter 提交、Esc 回列表）。 */
  const showCustomModelForm = () => {
    const s = store.state.current;
    if (!s || !modelMenuFor) return;
    modelMenuMode = 'custom';
    const input = h('input', { class: 'mi-input', attrs: { type: 'text', placeholder: '如 opencode/gpt-5', value: s.cliModel ?? '' } });
    const back = () => buildModelMenu(false);
    const submit = () => {
      const v = input.value.trim();
      if (!v) {
        back();
        return;
      }
      void applySessionModel(v);
    };
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        submit();
      } else if (ev.key === 'Escape') {
        ev.stopPropagation();
        back();
      }
    });
    modelMenu.replaceChildren(
      h('div', { class: 'mi-form' },
        h('span', { class: 'mute' }, '自定义模型（仅本会话）'),
        input,
        h('div', { class: 'mi-btns' },
          h('button', { attrs: { type: 'button' }, on: { click: back } }, '取消'),
          h('button', { class: 'pri', attrs: { type: 'button' }, on: { click: submit } }, '确定'))));
    positionModelMenu();
    input.focus();
    input.select();
  };

  const openModelMenu = () => {
    const s = store.state.current;
    const st = settings();
    const agent = s?.agent ?? st?.defaultAgent ?? 'builtin';
    if (!s || !isCli(agent, st)) return;
    const target = { sessionId: s.id, cliId: agent.slice(4) };
    modelMenuFor = target;
    modelCandidates = null;
    modelMenu.hidden = false;
    buildModelMenu(true);
    void (async () => {
      // 拉取失败静默（then 的第二分支）：菜单只保留「CLI 默认 / 配置 / 自定义…」。
      const list = await api.invoke('agentCli:models', target.cliId).then(
        (r) => r.models,
        () => [] as string[]);
      if (modelMenuFor !== target) return;
      modelCandidates = list;
      if (!modelMenu.hidden && modelMenuMode === 'list') buildModelMenu(false);
    })();
  };

  modelPick.addEventListener('click', () => {
    if (modelMenu.hidden) openModelMenu();
    else closeModelMenu();
  });
  modelPick.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      if (modelMenu.hidden) openModelMenu();
      else closeModelMenu();
    }
  });
  // 与全局右键菜单同款的关闭方式：点外 / Esc / 失焦 / 缩放时关闭（点切换器本身由其 click 切换，不在此关）。
  document.addEventListener('mousedown', (ev) => {
    if (!modelMenu.hidden && ev.target instanceof Node && !modelMenu.contains(ev.target) && !modelPick.contains(ev.target)) closeModelMenu();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !modelMenu.hidden) closeModelMenu();
  });
  window.addEventListener('blur', closeModelMenu);
  window.addEventListener('resize', closeModelMenu);

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
  // 运行状态变化：只更新头部与「正在思考…」提示 / 流式光标（不整体重渲染，避免打断流式输出）。
  store.on('running', () => {
    renderHeader();
    updateLive();
    setCaret();
  });
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
