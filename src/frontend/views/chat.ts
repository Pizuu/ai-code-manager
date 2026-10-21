/**
 * 任务会话 · 中列对话（FR-004/005/011、FR-109、FR-111）：DOM 与类名对应 HTML 原型 renderSession() 的
 * .thd / .log / .comp；消息、工具卡片、审批、斜杠命令、停止与 agent 选择器为真实功能。
 *
 * v1.8：改为主流对话样式（回合制）——用户消息为右侧气泡，助手消息为「头部（头像 / 名称 / 时间 / 操作）+
 * 正文」的回合；工具调用收进可折叠的「思考」区（默认折叠，有待批准时自动展开，见 lib/chat-turn.ts）。
 */
import type { BoardCard, ChatMessage, PermissionMode, ToolCallRecord } from '../../../contracts/ipc.ts';
import { api, errorText } from '../api.ts';
import { agentSetupHint } from '../lib/agent-config.ts';
import { agentName, agentWho, isCli } from '../lib/agent-label.ts';
import { formatSendText, insertBlock } from '../lib/context-send.ts';
import { hm } from '../lib/board-format.ts';
import { avatarText, hasPendingApproval, thinkCountText, thinkStatusText } from '../lib/chat-turn.ts';
import { clear, h, setTrustedHtml } from '../lib/dom.ts';
import { favoriteId, isFavorite, onFavoritesChanged, toggleFavorite } from '../lib/favorites.ts';
import { icon } from '../lib/icons.ts';
import { renderMarkdown } from '../lib/markdown.ts';
import { errorSectionTitle } from '../lib/error-log.ts';
import { activityTarget, sessionStateCounts } from '../lib/session-activity.ts';
import { parseSlashCommand, suggestCommands } from '../lib/slash-commands.ts';
import { store } from '../store.ts';
import { renderToolCard, type DiffRenderer } from './tool-card.ts';

export const MODE_LABELS: Readonly<Record<PermissionMode, string>> = { ask: '每次询问', 'auto-edits': '自动批准编辑', plan: '仅规划（只读）', 'allow-all': '全部允许（免审批）' };

export interface ChatHooks {
  renderDiff?: DiffRenderer;
  onNewSession(): void;
  onToggleList(): void;
  /** 点击对话区红点时跳到目标出错会话（session-view 透传其 selectSession）；未提供时红点只开关错误日志层。 */
  onJumpToSession?(id: string): void;
  /** 会话标题含任务号时关联的任务卡（显示原型 .sysb 任务卡摘要）。 */
  linkedCard(): BoardCard | null;
}

export interface ChatView {
  renderAll(): void;
  appendDelta(messageId: string): void;
  /** 程序化发送（如 Spec Kit 向导）：与输入框发送同一路径（斜杠展开 → 配置校验 → 乐观追加 → agent:send，失败回滚）；无当前会话 / 配置未就绪 / 发送失败时抛错。不操作输入框 DOM。 */
  sendText(text: string): Promise<void>;
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

/** token 总数格式化：<1000 显示原数；>=1000 显示 (n/1000) 保留一位小数加 'k'（如 12.3k）。 */
function fmtTokens(n: number): string {
  return n < 1000 ? String(n) : `${(n / 1000).toFixed(1)}k`;
}

export function mountChat(container: HTMLElement, hooks: ChatHooks): ChatView {
  clear(container);
  // ── .thd ──
  const menuBtn = h('button', { class: 'circ', title: '会话列表', on: { click: hooks.onToggleList } }, icon('menu'));
  const thTitle = h('span', { class: 'th-title' });
  // 标题行三列 grid：左端菜单按钮 · 中间标题 · 右端空占位（新建按钮已迁到会话列表 .hd；保留空格维持标题真居中）
  const thRightBox = h('span', { class: 'fx8' });
  const thd = h('div', { class: 'thd' },
    h('div', { class: 'r' }, menuBtn, thTitle, thRightBox));
  const log = h('div', { class: 'log' });
  // v1.8：对话正文限宽居中（长文更好读）；「正在思考…」提示固定挂在末尾。
  const logIn = h('div', { class: 'log-in' });
  log.append(logIn);
  const liveEl = h('div', { class: 'live', attrs: { 'aria-live': 'polite' } },
    h('span', { class: 'live-dots' }, h('i'), h('i'), h('i')),
    h('span', {}, '正在思考…'));
  liveEl.hidden = true;
  // ── .comp ──
  /** 当前会话累计 token 数（Session.usage，opencode 聚合；无数据时隐藏）。 */
  const ctxUsage = h('span', { class: 'chip' });
  ctxUsage.hidden = true;
  /** 会话三态计数圆点组（原状态栏三色圆，红 / 黄 / 绿依次为出错 / 回答中 / 回答完成，本批全数迁入 .ctx 条靠右成组）：
   * 计数与显隐口径与状态栏时期一致（0 时淡显 .zero 且无点击行为）；红点点击优先跳其它出错会话，
   * 无处可跳且当前会话有错误条目时开关错误日志层；黄 / 绿点点击跳到该状态的第一个会话（经 hooks.onJumpToSession）。 */
  const errDot = h('button', { class: 'st-dot r zero', attrs: { type: 'button' } }, '0');
  const runDot = h('button', { class: 'st-dot y zero', attrs: { type: 'button' } }, '0');
  const doneDot = h('button', { class: 'st-dot g zero', attrs: { type: 'button' } }, '0');
  const stDots = h('span', { class: 'st-dots' }, errDot, runDot, doneDot);
  const slashMenu = h('div', { class: 'slash-menu' });
  slashMenu.hidden = true;
  const textarea = h('textarea', { attrs: { placeholder: '回复…（Enter 发送，Shift+Enter 换行，/ 查看命令）' } });
  // 输入框不限高：高度全量跟随内容生长（scrollHeight），下限由 CSS min-height 兜住；内部不滚动、无滚动条。
  const autoGrow = () => {
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  };
  /** 在光标处插入文本并触发 autoGrow、回焦（ChatView.insertText 的实现体，系统文件选择共用）。 */
  const insertAtCursor = (text: string) => {
    textarea.setRangeText(text, textarea.selectionStart, textarea.selectionEnd, 'end');
    autoGrow();
    textarea.focus();
  };
  const stopBtn = h('button', { class: 'stop' }, '停止');
  const sendBtn = h('button', { class: 'send', title: '发送' }, icon('up'));
  const attachBtn = h('button', { class: 'plus', title: '添加文件', attrs: { type: 'button' } }, '+');
  const modeSel = h('select', { class: 'mode', title: '权限模式' });
  for (const [v, l] of Object.entries(MODE_LABELS)) modeSel.append(h('option', { attrs: { value: v } }, `权限：${l}`));
  // CLI 模型切换器：.ft 第二个元素，仅 CLI 会话显示。
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
    h('div', { class: 'ctx' }, ctxUsage, stDots),
    slashMenu,
    h('div', { class: 'box' }, textarea, h('div', { class: 'bar' }, attachBtn, h('span', { class: 'right' }, stopBtn, sendBtn))),
    h('div', { class: 'ft' }, modelPick, modeSel));
  container.append(thd, log, comp);

  // ── 当前会话错误日志层：原对话流内的 .errlog 聚合块移出，改挂 .ctx 条红点上方弹出 ──
  // 条目呈现沿用 .errlog 内部结构（chip + 文本 + 时间 + detail pre）；开关口径与全站浮层一致
  //（锚点 stopPropagation + 点层外 / Esc 关闭）。renderStatusDots 每次重渲时经 refreshErrPop 同步：
  // 层开着就重渲内容，当前会话错误清空则自动关。（本块与红点原在 shell.ts 状态栏，本批整体迁入。）
  const errPop = h('div', { class: 'errpop errlog', attrs: { role: 'dialog', 'aria-label': '当前会话错误日志' } });
  errPop.hidden = true;
  document.body.append(errPop);
  const closeErrPop = () => { errPop.hidden = true; };
  const renderErrPop = () => {
    const cur = store.state.current;
    const entries = cur ? store.errorsOf(cur.id) : [];
    errPop.replaceChildren(
      h('div', { class: 'errpop-hd' }, h('b', { class: 'b600' }, errorSectionTitle(entries)), h('span', { class: 'mute errpop-sess' }, cur?.title ?? '')),
      h('div', { class: 'list' }, ...entries.map((e) => h('div', { class: 'e' },
        h('div', { class: 'h' }, h('span', { class: `chip ${e.kind === 'tool' ? 'amb' : 'acc'}` }, e.kind === 'tool' ? '工具失败' : 'Agent 错误'), h('span', { class: 't' }, e.text), h('span', { class: 'mute mono' }, hm(e.at))),
        e.detail ? h('pre', {}, e.detail) : null))));
  };
  /** 锚点定位：横向钳制在视口内，层底贴红点顶部上方 8px（与原状态栏时期的公式一致）。 */
  const anchorErrPop = () => {
    const r = errDot.getBoundingClientRect();
    errPop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - errPop.offsetWidth - 8))}px`;
    errPop.style.bottom = `${window.innerHeight - r.top + 8}px`;
  };
  const toggleErrPop = () => {
    if (!errPop.hidden) { closeErrPop(); return; }
    renderErrPop();
    errPop.hidden = false;
    anchorErrPop();
  };
  const refreshErrPop = () => {
    if (errPop.hidden) return;
    const cur = store.state.current;
    if (!cur || !store.errorsOf(cur.id).length) { closeErrPop(); return; }
    renderErrPop();
    anchorErrPop();
  };
  document.addEventListener('click', (ev) => { if (!errPop.hidden && !errPop.contains(ev.target as Node) && !errDot.contains(ev.target as Node)) closeErrPop(); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeErrPop(); });

  /** 三点计数：与图标栏徽标共用 lib 的 sessionStateCounts，口径永不漂移。 */
  const dotCounts = () => sessionStateCounts({
    sessions: store.state.sessions,
    running: store.state.running,
    approvalSessionIds: [...store.state.approvals.values()].map((a) => a.sessionId),
    errorsOf: (id) => store.errorsOf(id),
  });
  /** 黄点跳转目标的活动入参（与状态栏时期 renderActivity 传给 activityTarget 的入参构造逐字一致）。 */
  const activityInput = () => {
    const cur = store.state.current;
    const approvals = [...store.state.approvals.values()];
    return {
      running: store.state.running,
      pending: approvals.length,
      toolCalls: (cur?.messages ?? []).flatMap((m) => m.toolCalls ?? []),
      currentSessionId: cur?.id ?? null,
      approvalSessionIds: approvals.map((a) => a.sessionId),
    };
  };
  const renderStatusDots = () => {
    const { nErr, nRun, nDone } = dotCounts();
    errDot.textContent = String(nErr);
    errDot.className = `st-dot r${nErr ? '' : ' zero'}`;
    errDot.title = `出错会话 ${nErr}`;
    runDot.textContent = String(nRun);
    runDot.className = `st-dot y${nRun ? '' : ' zero'}`;
    runDot.title = `回答中会话 ${nRun}`;
    doneDot.textContent = String(nDone);
    doneDot.className = `st-dot g${nDone ? '' : ' zero'}`;
    doneDot.title = `回答完成会话 ${nDone}`;
    refreshErrPop();
  };
  errDot.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const { nErr, isAnswering, isErrored } = dotCounts();
    if (!nErr) return; // 计数为 0 时无点击行为（与状态栏时期「0 不挂监听」等效）
    // 优先跳到其它出错会话；无处可跳且当前会话有错误条目时开关错误日志层
    const curId = store.state.current?.id ?? null;
    const other = store.state.sessions.find((s) => s.id !== curId && !isAnswering(s.id) && isErrored(s.id));
    if (other) {
      closeErrPop();
      hooks.onJumpToSession?.(other.id);
    } else if (curId && isErrored(curId)) {
      toggleErrPop();
    }
  });
  runDot.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const { nRun } = dotCounts();
    if (!nRun) return; // 计数为 0 时无点击行为（与红点一致）
    // 跳到第一个回答中的会话（运行中优先、其次待批准），口径与状态栏时期一致
    const input = activityInput();
    const target = activityTarget('running', input) ?? activityTarget('pending', input);
    if (target) hooks.onJumpToSession?.(target);
  });
  doneDot.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const { nDone, isAnswering, isErrored } = dotCounts();
    if (!nDone) return; // 计数为 0 时无点击行为（与红点一致）
    // 跳到第一个回答完成的会话（非回答中、非出错），口径与状态栏时期一致
    const target = store.state.sessions.find((s) => !isAnswering(s.id) && !isErrored(s.id));
    if (target) hooks.onJumpToSession?.(target.id);
  });

  // ── 附件添加（+）：弹系统文件选择框（契约 v1.12 files:pick），选中路径逐个插入输入框光标处。
  // 项目内文件与点文件树发送同格式（formatSendText({ kind:'file', path, dir:false }) → `@<相对路径>`，
  // 相对路径按正斜杠）；项目外 / 无项目时插绝对路径原文（带空格时双引号包裹）。多个文件空格分隔、末尾留一空格。──
  const pickSystemFiles = async () => {
    let paths: string[];
    try {
      paths = await api.invoke('files:pick');
    } catch (e) {
      notify(errorText(e));
      return;
    }
    if (!paths.length) return; // 用户取消：什么都不做
    const root = store.state.project?.root.replace(/\\/g, '/').replace(/\/$/, '') ?? null;
    const parts = paths.map((abs) => {
      const norm = abs.replace(/\\/g, '/');
      if (root && norm.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
        return formatSendText({ kind: 'file', path: norm.slice(root.length + 1), dir: false });
      }
      return abs.includes(' ') ? `"${abs}"` : abs;
    });
    insertAtCursor(`${parts.join(' ')} `);
  };
  attachBtn.addEventListener('click', () => void pickSystemFiles());

  const pendingDeltas = new Set<string>();
  let frame = 0;
  const settings = () => store.state.settings;

  // ── v1.8：回合制的对话渲染 ──
  /** 思考区展开状态（消息 ID → 用户显式选择）；未记录时按「有待批准则展开」处理。 */
  const thinkOpen = new Map<string, boolean>();
  /** 因待批准而自动展开过的消息：用户手动收起前保持展开（否则批准后卡片会突然消失）。 */
  const thinkSticky = new Set<string>();
  /** 回合折叠状态（被折叠的回合消息 ID，用户 / 助手回合共用；仅前端内存，不落盘，切换会话时清掉）。 */
  const turnFolded = new Set<string>();
  /** 当前会话 ID（切换会话时清掉展开状态）。 */
  let lastSessionId: string | null = null;

  /** 折叠 / 展开一个回合：状态记进 turnFolded（重渲染可还原），同时直接切换该回合的 class 免整表重渲染。 */
  const toggleFold = (messageId: string, ev: MouseEvent) => {
    const btn = ev.currentTarget as HTMLElement | null;
    const folded = !turnFolded.has(messageId);
    if (folded) turnFolded.add(messageId);
    else turnFolded.delete(messageId);
    btn?.closest('article.turn')?.classList.toggle('folded', folded);
    if (btn) btn.setAttribute('data-tip', folded ? '展开' : '折叠');
  };

  /** 收藏 / 取消收藏一个回合（状态变更经 onFavoritesChanged 同步回按钮选中态）。 */
  const toggleFav = (m: ChatMessage, fid: string) => {
    const s = store.state.current;
    if (!s) return;
    toggleFavorite({ id: fid, sessionId: s.id, sessionTitle: s.title, text: m.content, at: Date.now() });
  };

  /** 助手回合头部的操作按钮（复制 / 折叠 / 重新回答 / 收藏）。悬停回合时显示。 */
  const turnActions = (m: ChatMessage): HTMLElement => {
    const s = store.state.current;
    const fid = s ? favoriteId(s.id, m.id) : null;
    const folded = turnFolded.has(m.id);
    // 流式生成中的回合不显示折叠按钮（正文还在变长，折叠无意义）；回合结束重渲染后出现。
    const streaming = streamingMessage()?.id === m.id;
    return h('span', { class: 'acts' },
      m.content ? h('button', { class: 'act', attrs: { type: 'button', 'data-tip': '复制' }, on: { click: () => void navigator.clipboard.writeText(m.content) } }, icon('copy')) : null,
      streaming ? null : h('button', { class: 'act act-fold', attrs: { type: 'button', 'data-tip': folded ? '展开' : '折叠' }, on: { click: (ev) => toggleFold(m.id, ev) } }, icon('caret')),
      h('button', { class: 'act', attrs: { type: 'button', 'data-tip': '重新回答' }, on: { click: () => reanswerFrom(m.id) } }, icon('retry')),
      m.content && fid ? h('button', { class: `act act-fav${isFavorite(fid) ? ' on' : ''}`, attrs: { type: 'button', 'data-fav': fid, 'data-tip': '收藏' }, on: { click: () => toggleFav(m, fid) } }, icon('star')) : null);
  };

  /**
   * 一次性「重提最近提问」武装标记：重提按钮（重新发送 / 重新回答）在触发前按目标 user 消息
   * 是否为会话最后一条 user 消息置位，输入框 send() 入口读取后立即清零并透传给 sendText →
   * agent:send（契约 v1.11 reaskLatest，后端据此截断旧问答只保留最新一轮）。
   */
  let pendingReask = false;

  /** 目标 user 消息是否为当前会话最后一条 user 消息（从尾部向前找第一条 user 消息比对）。 */
  const isLastUserMessage = (m: ChatMessage): boolean => {
    const msgs = store.state.current?.messages ?? [];
    const lastUser = [...msgs].reverse().find((x) => x.role === 'user');
    return lastUser?.id === m.id;
  };

  /** 用户回合「重新发送」：把本条用户消息经现行发送路径（与发送按钮同一入口 send）再发一次。会话运行中不并发发送，只给提示（与助手侧「重新回答」一致）。 */
  const resendUser = (m: ChatMessage) => {
    if (store.isRunning()) {
      notify('正在回答中，稍后再试', 'info');
      return;
    }
    pendingReask = isLastUserMessage(m);
    textarea.value = m.content;
    void send();
  };

  /** 用户回合的操作按钮（复制 / 折叠 / 重新发送 / 收藏），与助手回合 turnActions 同款同序；悬停回合时显示，位于气泡下方 .turn-ft 行、时间戳左侧。 */
  const userTurnActions = (m: ChatMessage): HTMLElement => {
    const s = store.state.current;
    const fid = s ? favoriteId(s.id, m.id) : null;
    const folded = turnFolded.has(m.id);
    return h('span', { class: 'acts' },
      m.content ? h('button', { class: 'act', attrs: { type: 'button', 'data-tip': '复制' }, on: { click: () => void navigator.clipboard.writeText(m.content) } }, icon('copy')) : null,
      h('button', { class: 'act act-fold', attrs: { type: 'button', 'data-tip': folded ? '展开' : '折叠' }, on: { click: (ev) => toggleFold(m.id, ev) } }, icon('caret')),
      h('button', { class: 'act', attrs: { type: 'button', 'data-tip': '重新发送' }, on: { click: () => resendUser(m) } }, icon('retry')),
      m.content && fid ? h('button', { class: `act act-fav${isFavorite(fid) ? ' on' : ''}`, attrs: { type: 'button', 'data-fav': fid, 'data-tip': '收藏' }, on: { click: () => toggleFav(m, fid) } }, icon('star')) : null);
  };

  /** 用户回合：右侧气泡 + 操作行（按钮 + 时间戳）。 */
  const userTurn = (m: ChatMessage): HTMLElement => h('article', { class: `turn user${turnFolded.has(m.id) ? ' folded' : ''}` },
    h('div', { class: 'ubub-row' }, h('div', { class: 'ubub' }, m.content)),
    h('div', { class: 'turn-ft' }, userTurnActions(m), h('span', { class: 'turn-tm' }, hm(m.createdAt))));

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
    const turn = h('article', { class: `turn assistant${turnFolded.has(m.id) ? ' folded' : ''}` },
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

  /**
   * 重新回答：取该回合对应的上一条 user 消息，经现行发送路径（与发送按钮同一入口 send）作为新回合再发一次。
   * 取代旧「重新提问（放回输入框）」行为。会话运行中不并发发送，只给提示。
   */
  const reanswerFrom = (assistantId: string) => {
    if (store.isRunning()) {
      notify('正在回答中，稍后再试', 'info');
      return;
    }
    const msgs = store.state.current?.messages ?? [];
    const i = msgs.findIndex((x) => x.id === assistantId);
    const prev = msgs.slice(0, i).reverse().find((x) => x.role === 'user');
    if (!prev) return;
    pendingReask = isLastUserMessage(prev);
    textarea.value = prev.content;
    void send();
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
    const running = store.isRunning();
    stopBtn.hidden = !running;
    sendBtn.disabled = running || !s;
    thTitle.textContent = s ? s.title : '';
    // 当前会话累计 token 用量（s.usage，后端聚合的 opencode 会话用量；内置 agent 无此字段 → 隐藏）。
    const usage = s?.usage;
    if (usage && usage.total > 0) {
      ctxUsage.hidden = false;
      ctxUsage.textContent = `Tokens ${fmtTokens(usage.total)}`;
      ctxUsage.title = `累计 token：输入 ${usage.input} · 输出 ${usage.output} · 推理 ${usage.reasoning} · 缓存读 ${usage.cacheRead} / 写 ${usage.cacheWrite}`;
    } else {
      ctxUsage.hidden = true;
    }
    textarea.placeholder = `回复 ${agentName(agent, st)}…（Enter 发送，Shift+Enter 换行，/ 查看命令）`;
    if (st) modeSel.value = st.permissionMode;
    // CLI 会话：底栏显示模型切换器；内置 agent 会话不显示。
    if (cli && s) {
      modelPick.hidden = false;
      const override = s.cliModel?.trim() ? s.cliModel : undefined;
      const cfgModel = st?.agentClis?.find((x) => x.id === agent.slice(4))?.model;
      modelLabel.textContent = `模型：${override ?? (cfgModel ? cfgModel : 'CLI 默认')}`;
    } else {
      modelPick.hidden = true;
    }
    // 菜单锚定的会话已切换（或不再是 CLI 会话）时关掉，避免对旧会话写模型。
    if (modelMenuFor && (modelMenuFor.sessionId !== s?.id || !cli)) closeModelMenu();
    // .ctx 条三点随头部一并刷新（计数源含 current / sessions / approvals 等多路变化）。
    renderStatusDots();
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
      turnFolded.clear();
    }
    const sysb = sysbEl();
    if (sysb) logIn.append(sysb);
    const visible = s?.messages.filter((m) => m.role !== 'tool') ?? [];
    if (!s || (visible.length === 0 && store.state.notices.length === 0)) {
      // 空会话不放任何占位行：示例提示（.ev）与「开始一个任务」标题行均属非主动提示，已按用户要求删除；
      // 只保留未配置 agent 时的配置引导块（agentSetupHint）。
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
    // 错误明细已移出对话流：当前会话的错误条目改由 .ctx 条红点上方的错误日志层呈现（本文件 errPop，数据同为 store.errorsOf）。
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
  /** 切换只影响下一轮，不打断运行中的一轮。 */
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

  /** 候选模型下拉：加载中 / 有候选 / 无候选三态；选中非空值即应用（applySessionModel 内部关菜单）。 */
  const buildModelSelect = (loading: boolean, cfgModel: string | undefined, override: string | undefined): HTMLSelectElement => {
    const sel = h('select', { class: 'mi-select', attrs: { 'aria-label': '选择 CLI 模型' } });
    // 隔离菜单的全局关闭逻辑（点外 / Esc）：下拉展开与键盘选择只作用于下拉本身，不关菜单。
    sel.addEventListener('click', (ev) => ev.stopPropagation());
    sel.addEventListener('keydown', (ev) => ev.stopPropagation());
    sel.addEventListener('change', () => {
      if (sel.value) void applySessionModel(sel.value);
    });
    if (loading) {
      sel.append(h('option', { attrs: { value: '' } }, '加载模型…'));
      sel.disabled = true;
      return sel;
    }
    const candidates = (modelCandidates ?? []).filter((m) => m !== cfgModel);
    if (!candidates.length) {
      sel.append(h('option', { attrs: { value: '' } }, '无可用模型列表'));
      sel.disabled = true;
      return sel;
    }
    sel.append(h('option', { attrs: { value: '' } }, '选择模型…'));
    for (const m of candidates) sel.append(h('option', { attrs: { value: m } }, m));
    if (override && candidates.includes(override)) sel.value = override;
    return sel;
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
    items.push(buildModelSelect(loading, cfgModel, override));
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

  /** 发送失败中应把原文恢复进输入框的一类（配置未就绪、agent:send 失败），message 即应展示的文案；runSlash 本地命令的失败不属此类（旧行为：不恢复原文）。 */
  class RestoreInputError extends Error {}

  /**
   * 发送核心（输入框发送与 ChatView.sendText 共用）：斜杠展开 → 配置校验 → 乐观追加 → agent:send。
   * 本地斜杠命令（/help、/clear、/model）在 runSlash 内消化（返回 null），不产生发送。
   * 内容为空 / 无当前会话 / 配置未就绪 / 发送失败均抛错；不操作输入框 DOM，原文恢复与提示由调用方处理。
   */
  const sendText = async (rawText: string, opts?: { reaskLatest?: boolean }): Promise<void> => {
    const raw = rawText.trim();
    const s = store.state.current;
    if (!raw) throw new Error('发送内容为空');
    if (!s) throw new Error('当前没有打开的会话');
    const text = await runSlash(raw);
    if (text === null) return;
    const setup = agentSetupHint(s.agent ?? settings()?.defaultAgent ?? 'builtin', settings());
    if (setup) throw new RestoreInputError(setup);
    // 乐观追加用户消息（主进程会写入同样内容；切换会话时以持久化版本为准）
    const local: ChatMessage = { id: `local-${Date.now()}`, role: 'user', content: text, createdAt: new Date().toISOString() };
    s.messages.push(local);
    renderAll();
    try {
      await api.invoke('agent:send', opts?.reaskLatest ? { sessionId: s.id, text, reaskLatest: true } : { sessionId: s.id, text });
    } catch (e) {
      s.messages.splice(s.messages.indexOf(local), 1);
      renderAll();
      throw new RestoreInputError(errorText(e));
    }
  };

  const send = async () => {
    // 消费一次性重提标记：入口处读取并立即清零，发送失败回填 / 早退等路径都不残留。
    const reaskLatest = pendingReask;
    pendingReask = false;
    const raw = textarea.value.trim();
    if (!raw || !store.state.current) return;
    textarea.value = '';
    renderSlashMenu();
    autoGrow();
    try {
      await sendText(raw, reaskLatest ? { reaskLatest: true } : undefined);
    } catch (e) {
      if (e instanceof RestoreInputError) {
        textarea.value = raw;
        autoGrow();
        notify(e.message);
      } else {
        notify(errorText(e));
      }
    }
  };

  textarea.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) {
      ev.preventDefault();
      void send();
    }
  });
  textarea.addEventListener('input', renderSlashMenu);
  textarea.addEventListener('input', autoGrow);
  sendBtn.addEventListener('click', () => void send());
  stopBtn.addEventListener('click', () => {
    const s = store.state.current;
    if (s) void api.invoke('agent:stop', s.id).catch((e: unknown) => notify(errorText(e)));
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
  // 错误条目变化（新增 / 清空）时头部未必重渲，三点计数与打开的错误层单独订阅刷新。
  store.on('errors', renderStatusDots);
  // 运行状态变化：只更新头部与「正在思考…」提示 / 流式光标（不整体重渲染，避免打断流式输出）。
  store.on('running', () => {
    renderHeader();
    updateLive();
    setCaret();
  });
  store.on('settings', renderAll);
  store.on('project', renderHeader);
  // v1.10：session-updated（'sessions' 主题）会带回回合进行中的累计 token 用量（已由 main 合并进
  // current.usage）；只重渲染标题行刷新 Tokens chip，不整体重渲染，避免打断流式输出。
  store.on('sessions', renderHeader);
  // 收藏变更（chat 按钮 / shell 收藏栏共用 favorites 库）：只同步各收藏按钮的选中态，
  // 不重渲染日志，避免打断流式输出；按钮靠 data-fav 定位。
  onFavoritesChanged(() => {
    for (const btn of container.querySelectorAll<HTMLElement>('[data-fav]')) {
      btn.classList.toggle('on', isFavorite(btn.dataset.fav ?? ''));
    }
  });
  renderAll();

  return {
    renderAll,
    appendDelta,
    notify,
    sendText,
    insertText: insertAtCursor,
    insertBlock: (text) => {
      const r = insertBlock(textarea.value, textarea.selectionStart, textarea.selectionEnd, text);
      textarea.value = r.text;
      autoGrow();
      textarea.focus();
      textarea.setSelectionRange(r.caret, r.caret);
      textarea.scrollTop = textarea.scrollHeight;
      renderSlashMenu();
    },
  };
}
