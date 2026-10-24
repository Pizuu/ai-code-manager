/**
 * 任务会话 · 中列对话（FR-004/005/011、FR-109、FR-111）：DOM 与类名对应 HTML 原型 renderSession() 的
 * .thd / .log / .comp；消息、工具卡片、审批、斜杠命令、停止与 agent 选择器为真实功能。
 *
 * v1.8：改为主流对话样式（回合制）——用户消息为右侧气泡，助手消息为「头部（头像 / 名称 / 时间 / 操作）+
 * 正文」的回合；工具调用收进可折叠的「思考」区（默认折叠，有待批准时自动展开，见 lib/chat-turn.ts）。
 */
import type { AgentRef, BoardCard, ChatMessage, PermissionMode, Session, ToolCallRecord } from '../../../contracts/ipc.ts';
import { toast } from '../lib/toast.ts';
import { apiVendor } from '../lib/api-vendor.ts';
import { api, errorText } from '../api.ts';
import { agentSetupHint } from '../lib/agent-config.ts';
import { agentName, isCli } from '../lib/agent-label.ts';
import { insertBlock } from '../lib/context-send.ts';
import { composeMessageWithAttachments, splitMessageAttachments, type MessageAttachment } from '../lib/message-attachments.ts';
import { hm } from '../lib/board-format.ts';
import { avatarText } from '../lib/chat-turn.ts';
import { clear, h, setTrustedHtml } from '../lib/dom.ts';
import { favoriteId, isFavorite, onFavoritesChanged, toggleFavorite } from '../lib/favorites.ts';
import { icon } from '../lib/icons.ts';
import { renderMarkdown } from '../lib/markdown.ts';
import { locateText } from '../lib/text-locate.ts';
import { estimateConversationTokens } from '../lib/token-estimate.ts';
import { parseSlashCommand, suggestCommands, type SlashCommandInfo } from '../lib/slash-commands.ts';
import { filledTextFor, isPrimedText, wrapIndex } from '../lib/slash-menu.ts';
import { store } from '../store.ts';
import { renderToolCard, type DiffRenderer } from './tool-card.ts';

export const MODE_LABELS: Readonly<Record<PermissionMode, string>> = { ask: '每次询问', 'auto-edits': '自动批准编辑', plan: '仅规划（只读）', 'allow-all': '全部允许（免审批）' };
const MESSAGE_FOCUS_MS = 3000;

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return; }
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
}

function enhanceCodeBlocks(root: HTMLElement, autoFold = true, favorite?: { id: string; text: string }): void {
  const maxHeight = Math.max(240, Math.floor(window.innerHeight * 2 / 3));
  for (const pre of root.querySelectorAll('pre')) {
    if (pre.classList.contains('code-enhanced')) continue;
    const code = pre.querySelector('code');
    if (!code) continue;
    pre.classList.add('code-enhanced');
    // 语言标签（来自 ``` 标注或自动识别），显示在代码块左上角
    const langName = code.dataset.lang;
    if (langName) pre.append(h('span', { class: 'code-lang' }, langName));
    const actions = h('div', { class: 'code-actions' });
    const toggle = h('button', { class: 'code-action', attrs: { type: 'button', 'data-tip': '展开 / 折叠代码' }, on: { click: () => {
      pre.classList.toggle('collapsed');
      toggle.setAttribute('aria-label', pre.classList.contains('collapsed') ? '展开代码' : '折叠代码');
    } } }, icon('caret', 14));
    const copy = h('button', { class: 'code-action', attrs: { type: 'button', 'data-tip': '复制代码' }, on: { click: () => {
      void copyText(code.textContent ?? '').then(() => { copy.dataset.tip = '已复制'; window.setTimeout(() => { copy.dataset.tip = '复制代码'; }, 1200); });
    } } }, icon('copy', 14));
    const download = h('button', { class: 'code-action', attrs: { type: 'button', 'data-tip': '下载代码' }, on: { click: () => {
      const blob = new Blob([code.textContent ?? ''], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob); const a = document.createElement('a');
      const lang = [...code.classList].find((name) => name.startsWith('lang-'))?.slice(5).toLowerCase() ?? '';
      const ext: Readonly<Record<string, string>> = { ts: 'ts', typescript: 'ts', js: 'js', javascript: 'js', json: 'json', css: 'css', html: 'html', xml: 'xml', sh: 'sh', bash: 'sh', shell: 'sh', py: 'py', python: 'py', md: 'md', markdown: 'md', yaml: 'yaml', yml: 'yml', sql: 'sql', java: 'java', go: 'go', rs: 'rs', rust: 'rs', cpp: 'cpp', c: 'c' };
      window.dispatchEvent(new CustomEvent('acm-code-download', { detail: { sessionId: store.state.current?.id ?? '', content: code.textContent ?? '', ext: ext[lang] ?? 'txt', at: new Date().toISOString() } }));
      a.href = url; a.download = `code.${ext[lang] ?? 'txt'}`; a.click(); URL.revokeObjectURL(url);
    } } }, icon('download', 14));
    let fav: HTMLButtonElement | null = null;
    if (favorite) {
      fav = h('button', { class: `code-action code-favorite${isFavorite(favorite.id) ? ' on' : ''}`, attrs: { type: 'button', 'data-tip': '收藏回答' }, on: { click: () => {
        const s = store.state.current;
        if (!s || !fav) return;
        const active = toggleFavorite({ id: favorite.id, sessionId: s.id, sessionTitle: s.title, text: favorite.text, at: Date.now() });
        fav.classList.toggle('on', active);
      } } }, icon('star', 14));
    }
    actions.append(toggle, copy, download);
    if (fav) actions.append(fav);
    pre.append(actions);
    if (autoFold) requestAnimationFrame(() => {
      if (pre.scrollHeight > maxHeight) pre.classList.add('collapsed');
    });
  }
}

export interface ChatHooks {
  renderDiff?: DiffRenderer;
  onOpenAttachment?(path: string): void;
  onOpenSettings?(): void;
  onNewSession(): void;
  /** 空对话（未选中会话）发送时按需建会话；未提供或返回 null 时不发送。 */
  ensureSession?(): Promise<Session | null>;
  onToggleList(): void;
  /** 点击对话区红点时跳到目标出错会话（session-view 透传其 selectSession）；未提供时红点只开关错误日志层。 */
  onJumpToSession?(id: string): void;
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
  focusMessage(messageId: string, sourceText?: string): void;
  /** 在当前会话里找包含该文字的消息（从新到旧），滚动过去并高亮整条消息与文字；找不到返回 false。 */
  focusText(text: string): boolean;
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
  const ctxUsage = h('span', { class: 'chip ft-tokens' });
  ctxUsage.hidden = true;
  const slashMenu = h('div', { class: 'slash-menu' });
  slashMenu.hidden = true;
  // 规格 004 两段式预置条：与附件托盘同处 .box 内（托盘之上）；选择命令后显示，真正发送前一直保留。
  const primeName = h('span', { class: 'prime-name' });
  const primeCancel = h('button', { class: 'prime-x', attrs: { type: 'button', 'aria-label': '取消预置' } }, '×');
  const primebar = h('div', { class: 'primebar' },
    h('span', { class: 'prime-label' }, '已预置'),
    primeName,
    h('span', { class: 'prime-hint' }, '再按 Enter 执行；修改命令或清空将取消'),
    primeCancel);
  primebar.hidden = true;
  const textarea = h('textarea', { attrs: { placeholder: '' } });
  // 输入框不限高：高度全量跟随内容生长（scrollHeight），下限由 CSS min-height 兜住；内部不滚动、无滚动条。
  /** 输入框折叠预览：文本高度超过输入框 2 倍时，失焦后折叠为 2 倍原高度：首尾各 0.5 倍原高度的文字，中间 1 倍原高度为省略区；点击展开继续编辑。 */
  const foldHead = h('div', { class: 'cfold-head' });
  const foldTail = h('div', { class: 'cfold-tail' }, h('div', {}));
  const foldPreview = h('div', { class: 'cfold', attrs: { role: 'button', tabindex: '0', title: '点击展开继续编辑' } },
    foldHead, h('div', { class: 'cfold-gap', attrs: { 'aria-hidden': 'true' } }, '⋯'), foldTail);
  foldPreview.hidden = true;
  const unfoldInput = (focus: boolean) => {
    if (foldPreview.hidden) return;
    foldPreview.hidden = true;
    textarea.hidden = false;
    autoGrow();
    if (focus) { textarea.focus(); textarea.setSelectionRange(textarea.value.length, textarea.value.length); }
  };
  const foldInputIfLong = () => {
    const base = parseFloat(getComputedStyle(textarea).minHeight) || 44;
    if (!textarea.value.trim() || textarea.scrollHeight <= base * 2) return;
    foldPreview.style.setProperty('--cf-base', `${base}px`);
    foldHead.textContent = textarea.value;
    (foldTail.firstElementChild as HTMLElement).textContent = textarea.value;
    textarea.hidden = true;
    foldPreview.hidden = false;
  };
  foldPreview.addEventListener('click', () => unfoldInput(true));
  foldPreview.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); unfoldInput(true); } });
  textarea.addEventListener('blur', () => {
    // 点击发送等按钮时 blur 先于 click：延后一帧，若文本已被清空（已发送）就不折叠
    requestAnimationFrame(() => { if (document.activeElement !== textarea) foldInputIfLong(); });
  });
  const autoGrow = () => {
    if (!foldPreview.hidden && !textarea.value) unfoldInput(false);
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  };
  /** 在光标处插入文本并触发 autoGrow、回焦（ChatView.insertText 的实现体，系统文件选择共用）。 */
  const insertAtCursor = (text: string) => {
    unfoldInput(false);
    textarea.setRangeText(text, textarea.selectionStart, textarea.selectionEnd, 'end');
    autoGrow();
    textarea.focus();
  };
  const stopBtn = h('button', { class: 'stop' }, '停止');
  const sendBtn = h('button', { class: 'send', title: '发送' }, icon('up'));
  const attachBtn = h('button', { class: 'plus', title: '添加文件（项目外文件将上传到 uploads/）', attrs: { type: 'button' } }, '+');
  const modeSel = h('select', { class: 'mode', title: '权限模式' });
  for (const [v, l] of Object.entries(MODE_LABELS)) modeSel.append(h('option', { attrs: { value: v } }, `权限：${l}`));
  // CLI 模型切换器：.ft 第二个元素，仅 CLI 会话显示。
  // 生效模型 = session.cliModel（会话覆盖）?? 该 CLI 配置的 model ?? 'CLI 默认'。
  const modelLabel = h('span');
  const modelPick = h('span', { class: 'model-pick', title: '本会话的 CLI 模型（点击切换，下一轮生效）', attrs: { role: 'button', tabindex: '0' } },
    h('span', { class: 'md-sel' }, modelLabel, h('span', { class: 'mute vmid' }, icon('caret'))));
  modelPick.hidden = true;
  const agentPick = h('button', { class: 'agent-pick', attrs: { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false' } }, 'API');
  agentPick.hidden = true;
  const modelMenu = h('div', { class: 'ctxmenu model-menu', attrs: { role: 'menu' } });
  modelMenu.hidden = true;
  const agentMenu = h('div', { class: 'ctxmenu model-menu agent-menu', attrs: { role: 'menu', 'aria-label': '切换 API 或 CLI' } });
  agentMenu.hidden = true;
  document.body.append(modelMenu, agentMenu);
  /** 菜单当前锚定的会话与 CLI；会话切换后由 renderHeader 关闭过期菜单。 */
  let modelMenuFor: { sessionId: string; cliId: string } | null = null;
  let modelMenuMode: 'list' | 'custom' = 'list';
  /** 最近一次 agentCli:models 的结果（null = 尚未拉到；拉取失败按空数组，静默）。 */
  let modelCandidates: string[] | null = null;
  /** 各 CLI 最近一次拉到的非空候选列表：再次打开菜单先用缓存即时显示，后台再刷新。 */
  const modelCache = new Map<string, string[]>();
  /** 各 CLI 未指定模型时实际使用的默认模型（契约 v1.15 defaultModel）；null = 已查过但推断不到。 */
  const defaultModelCache = new Map<string, string | null>();
  const defaultModelPending = new Set<string>();
  /** 查询 CLI 的默认模型名并回填底栏标签（每个 CLI 只查一次；失败按推断不到处理）。 */
  const ensureDefaultModel = (cliId: string) => {
    if (defaultModelCache.has(cliId) || defaultModelPending.has(cliId)) return;
    defaultModelPending.add(cliId);
    void api.invoke('agentCli:models', cliId).then(
      (r) => {
        defaultModelCache.set(cliId, r.defaultModel ?? null);
        if (r.models.length) modelCache.set(cliId, r.models);
      },
      () => defaultModelCache.set(cliId, null),
    ).finally(() => {
      defaultModelPending.delete(cliId);
      renderHeader();
    });
  };
  /** API 模式下模型菜单是否打开（与 CLI 模式共用 modelMenu 元素）。 */
  let apiMenuOpen = false;
  /** API 模型列表缓存：按 provider|baseUrl 区分；error 为最近一次失败说明。 */
  let apiModels: { key: string; models: string[]; at: number } | null = null;
  let apiModelsError = '';
  const closeModelMenu = () => {
    modelMenu.hidden = true;
    modelMenuFor = null;
    apiMenuOpen = false;
  };
  let agentMenuSessionId: string | null = null;
  const closeAgentMenu = () => {
    agentMenu.hidden = true;
    agentMenuSessionId = null;
    agentPick.setAttribute('aria-expanded', 'false');
  };
  /** 待发送附件托盘（.box 内、textarea 上方）：选好的文件先停在这里，点发送时才拼进消息文本。 */
  const attray = h('div', { class: 'attray' });
  attray.hidden = true;
  const comp = h('div', { class: 'comp' },
    slashMenu,
    h('div', { class: 'box' }, primebar, attray, foldPreview, textarea, h('div', { class: 'bar' }, attachBtn, h('span', { class: 'right' }, stopBtn, sendBtn))),
    h('div', { class: 'ft' }, ctxUsage, agentPick, modelPick, modeSel));
  container.append(thd, log, comp);


  // ── 待发送附件：选好的文件先停在托盘（pendingAttachments），点发送时才经 composeMessageWithAttachments
  // 拼成「正文 + 尾随 @路径块」的完整消息（拼装/拆分口径唯一在 lib/message-attachments）。
  // 托盘是输入区状态而非会话状态：切换会话不清空；发送成功才清，失败保留等用户再发。──
  let pendingAttachments: MessageAttachment[] = [];

  /** path 的 basename（与 lib/message-attachments 的口径一致：同时兼容 '/' 与 '\' 分隔）。 */
  const attName = (p: string): string => p.split(/[\\/]/).filter((s) => s !== '').at(-1) ?? p;

  /** 附件 chip（托盘与用户回合共用 .attchip 样式；托盘版多一个 × 移除按钮）。 */
  const attChip = (a: MessageAttachment, removable: boolean): HTMLElement => {
    const chip = h('span', { class: `attchip${removable ? '' : ' attchip-link'}`, attrs: { title: a.path, ...(removable ? {} : { role: 'link', tabindex: '0' }) } },
      icon('file'),
      h('span', { class: 'att-name' }, a.name),
      removable
        ? h('button', { class: 'att-x', attrs: { type: 'button', 'aria-label': `移除附件 ${a.name}` }, on: {
            click: () => {
              pendingAttachments = pendingAttachments.filter((x) => x.path !== a.path);
              renderAttTray();
            },
          } }, '×')
        : null);
    if (!removable && hooks.onOpenAttachment) chip.addEventListener('click', () => hooks.onOpenAttachment?.(a.path));
    return chip;
  };

  const renderAttTray = () => {
    clear(attray);
    attray.hidden = pendingAttachments.length === 0;
    for (const a of pendingAttachments) attray.append(attChip(a, true));
  };

  // ── 附件添加（+）：弹系统文件选择框（契约 v1.12 files:pick），选中文件进待发送托盘（不再直接插入输入框）。
  // 项目内文件记其相对路径（按正斜杠）；项目外文件先经 files:import（契约 v1.14）上传到项目 uploads/，
  // 再记返回的相对路径。托盘内同 path 去重；顺序保持用户选择顺序。──
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
    // relOf 与 paths 同序：项目内文件先填相对路径，项目外文件先占位 null、待 import 后回填
    const external: string[] = [];
    const externalSlots: number[] = [];
    const relOf: (string | null)[] = paths.map((abs, i) => {
      const norm = abs.replace(/\\/g, '/');
      if (root && norm.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
        return norm.slice(root.length + 1);
      }
      external.push(abs);
      externalSlots.push(i);
      return null;
    });
    if (external.length) {
      if (!root) {
        // 无项目打开：外部文件无处上传，提示后整批跳过（此时内部组必然为空）
        notify('未打开项目，无法上传外部文件');
        return;
      }
      try {
        const imported = await api.invoke('files:import', external);
        imported.forEach((rel, j) => {
          const slot = externalSlots[j];
          if (slot !== undefined) relOf[slot] = rel;
        });
      } catch (e) {
        // 上传失败只跳过外部文件，已就绪的项目内引用照常插入
        notify(errorText(e));
      }
    }
    // 终点：相对路径逐个进待发送托盘（同 path 已在托盘则跳过），发送时才拼进消息。
    let added = 0;
    for (const rel of relOf) {
      if (rel === null || pendingAttachments.some((a) => a.path === rel)) continue;
      pendingAttachments.push({ name: attName(rel), path: rel });
      added++;
    }
    if (added) {
      renderAttTray();
      unfoldInput(false); textarea.focus();
    }
  };
  attachBtn.addEventListener('click', () => void pickSystemFiles());

  const pendingDeltas = new Set<string>();
  let frame = 0;
  const settings = () => store.state.settings;

  // ── v1.8：回合制的对话渲染 ──
  /** 过程区滚动位置（按消息 ID），重渲染后还原。 */
  const thinkScroll = new Map<string, { top: number; atBottom: boolean }>();
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
    const latestAssistantId = [...(store.state.current?.messages ?? [])].reverse().find((item) => item.role === 'assistant')?.id;
    const canReanswer = !(suppressReanswer && latestAssistantId === m.id);
    return h('span', { class: 'acts' },
      m.content ? h('button', { class: 'act', attrs: { type: 'button', 'data-tip': '复制' }, on: { click: () => void navigator.clipboard.writeText(m.content) } }, icon('copy')) : null,
      streaming ? null : h('button', { class: 'act act-fold', attrs: { type: 'button', 'data-tip': folded ? '展开' : '折叠' }, on: { click: (ev) => toggleFold(m.id, ev) } }, icon('caret')),
      canReanswer ? h('button', { class: 'act', attrs: { type: 'button', 'data-tip': '重新回答' }, on: { click: () => reanswerFrom(m.id) } }, icon('retry')) : null,
      m.content && fid ? h('button', { class: `act act-fav${isFavorite(fid) ? ' on' : ''}`, attrs: { type: 'button', 'data-fav': fid, 'data-tip': '收藏' }, on: { click: () => toggleFav(m, fid) } }, icon('star')) : null);
  };

  /**
   * 一次性「重提最近提问」武装标记：重提按钮（重新发送 / 重新回答）在触发前按目标 user 消息
   * 是否为会话最后一条 user 消息置位，输入框 send() 入口读取后立即清零并透传给
   * agent:send（契约 v1.11 reaskLatest，后端据此截断旧问答只保留最新一轮）。
   */
  let pendingReask = false;
  let suppressReanswer = false;

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

  /** 用户回合：附件标签（尾随 @ 引用块经 splitMessageAttachments 拆出，渲染为气泡上方的标签排）+ 右侧气泡 + 操作行。
   * 正文为空（纯附件消息）时不渲染气泡；回合按钮仍作用于整条 m（content 原文，含引用块）。 */
  const userTurn = (m: ChatMessage): HTMLElement => {
    const { text, attachments } = splitMessageAttachments(m.content);
    return h('article', { class: `turn user${turnFolded.has(m.id) ? ' folded' : ''}`, attrs: { 'data-id': m.id } },
      attachments.length ? h('div', { class: 'ubub-atts' }, ...attachments.map((a) => attChip(a, false))) : null,
      text ? h('div', { class: 'ubub-row' }, h('div', { class: 'ubub' }, text)) : null,
      h('div', { class: 'turn-ft' }, userTurnActions(m), h('span', { class: 'turn-tm' }, hm(m.createdAt))));
  };

  /**
   * 「思考」区：工具调用的可折叠容器。
   * - 默认折叠（对话读起来干净）；有调用待批准时强制展开，否则批准按钮点不到。
   * - 因待批准展开过的，在批准完成前保持展开（sticky），避免卡片突然消失。
   * - 用户的显式开合优先（重渲染与切换会话后保持）。
   * - v1.8+：正在思考（流式输出中）且用户未显式收起过时自动展开，思考过程可见。
   */
  const thinkBlock = (m: ChatMessage, calls: ToolCallRecord[]): HTMLElement => {
    // 过程区：已删除「思考过程 / 结果」标题行（不再折叠），工具卡片直接显示；
    // 固定高度、可滚动；待授权的调用卡片放在滚动区外（下方），授权按钮始终可见、不会被滚走。
    const det = h('div', { class: 'think' });
    const streaming = streamingMessage()?.id === m.id;
    const body = h('div', { class: 'think-body', attrs: { 'data-mid': m.id } });
    const asks = h('div', { class: 'think-approvals' });
    for (const call of calls) {
      const approval = [...store.state.approvals.values()].find((a) => a.toolCallId === call.id);
      const card = renderToolCard(call, approval, (id, ok) => void decideApproval(id, ok), hooks.renderDiff);
      (approval ? asks : body).append(card);
    }
    det.append(body);
    if (asks.childElementCount) det.append(asks);
    // 滚动位置跨重渲染保持；流式输出中且停在底部时自动跟随到底。
    const saved = thinkScroll.get(m.id);
    body.addEventListener('scroll', () => {
      thinkScroll.set(m.id, { top: body.scrollTop, atBottom: body.scrollHeight - body.scrollTop - body.clientHeight < 24 });
    }, { passive: true });
    requestAnimationFrame(() => {
      if (!body.isConnected) return;
      if (!saved || ((streaming || body.dataset.follow === '1') && saved.atBottom)) body.scrollTop = body.scrollHeight;
      else body.scrollTop = saved.top;
    });
    return det;
  };

  /** 合并回合时把后续消息的过程区并入第一个过程区（同一个滚动区域）。 */
  const mergeThink = (into: HTMLElement, from: HTMLElement): void => {
    const body = into.querySelector<HTMLElement>(':scope > .think-body');
    if (!body) return;
    body.append(...from.querySelectorAll<HTMLElement>(':scope > .think-body > *'));
    const moreAsks = [...from.querySelectorAll<HTMLElement>(':scope > .think-approvals > *')];
    if (moreAsks.length) {
      let asks = into.querySelector<HTMLElement>(':scope > .think-approvals');
      if (!asks) { asks = h('div', { class: 'think-approvals' }); into.append(asks); }
      asks.append(...moreAsks);
    }
    const sid = streamingMessage()?.id;
    if (sid && from.querySelector(':scope > .think-body')?.getAttribute('data-mid') === sid) body.dataset.follow = '1';
  };

  /** 助手回合：头部（头像 / 名称 / 时间 / 操作）+ 正文 + 可折叠的思考区。 */
  const assistantTurn = (m: ChatMessage): HTMLElement => {
    const body = h('div', { class: 'md' });
    setTrustedHtml(body, renderMarkdown(m.content));
    const sessionId = store.state.current?.id;
    enhanceCodeBlocks(body, !store.isRunning(), sessionId ? { id: favoriteId(sessionId, m.id), text: m.content } : undefined);
    const displayName = agentName(m.agent ?? 'builtin', settings());
    const turn = h('article', { class: `turn assistant${turnFolded.has(m.id) ? ' folded' : ''}` },
      h('header', { class: 'turn-hd' },
        h('span', { class: 'avatar', attrs: { 'aria-hidden': 'true' } }, avatarText(displayName)),
        h('span', { class: 'who', attrs: { title: displayName } }, displayName),
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

  /** 跳转高亮状态：渲染重建日志后会重新套用，直到超时（避免被随后的重绘冲掉）。 */
  let focusHold: { messageId: string; text?: string } | null = null;
  let focusTimer = 0;

  /** 不参与文字匹配的节点：操作按钮、语言标签、工具行的结果预览（与完整输出重复）等。 */
  const SKIP_TEXT = 'button, .code-lang, .code-actions, .tl-res, .tl-sep, .turn-ft, .caret-blink';

  const textNodesOf = (root: Element): Array<{ node: Text; start: number; end: number }> & { text?: string } => {
    const nodes: Array<{ node: Text; start: number; end: number }> & { text?: string } = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement?.closest(SKIP_TEXT) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    let raw = '';
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      const start = raw.length;
      raw += node.nodeValue ?? '';
      nodes.push({ node, start, end: raw.length });
    }
    nodes.text = raw;
    return nodes;
  };

  /** 在 root 内高亮来源文字（忽略空白差异、Markdown 标记；跨行内节点拆段包裹）。返回首个 mark。 */
  const markSource = (root: Element, sourceText: string): HTMLElement | null => {
    const nodes = textNodesOf(root);
    const hit = locateText(nodes.text ?? '', sourceText);
    if (!hit) return null;
    const segments = nodes.flatMap((entry) => {
      const start = Math.max(hit.start, entry.start);
      const end = Math.min(hit.end, entry.end);
      return end > start ? [{ node: entry.node, start: start - entry.start, end: end - entry.start }] : [];
    });
    let first: HTMLElement | null = null;
    // 从右往左包裹，保证每段仍落在单个文本节点内、前面的偏移不失效。
    for (const segment of segments.reverse()) {
      if (!segment.node.nodeValue?.slice(segment.start, segment.end).trim()) continue;
      const range = document.createRange();
      range.setStart(segment.node, segment.start);
      range.setEnd(segment.node, segment.end);
      const mark = document.createElement('mark');
      mark.className = 'source-highlight';
      range.surroundContents(mark);
      first = mark;
    }
    return first;
  };

  /** 把 el 所在的一切折叠层打开：回合折叠、工具结果、代码块折叠、<details>、输入式折叠。 */
  const revealAncestors = (el: Element): void => {
    const turn = el.closest<HTMLElement>('article.turn');
    if (turn?.classList.contains('folded')) {
      // 折叠状态可能记在用户消息 id 或回合内任一助手消息 id 上，全部清掉，重绘后也保持展开。
      if (turn.dataset.id) turnFolded.delete(turn.dataset.id);
      for (const msg of turn.querySelectorAll<HTMLElement>('.msg[data-id]')) if (msg.dataset.id) turnFolded.delete(msg.dataset.id);
      turn.classList.remove('folded');
      turn.querySelector('.act-fold')?.setAttribute('data-tip', '折叠');
    }
    for (let p: Element | null = el; p && p !== log; p = p.parentElement) {
      if (p instanceof HTMLDetailsElement) p.open = true;
      if (p.matches('.verify.tool') && !p.classList.contains('expanded') && p.querySelector('.tool-out')) {
        p.classList.add('expanded');
        p.querySelector('.tool-line')?.setAttribute('aria-expanded', 'true');
      }
      if (p.matches('pre.code-enhanced.collapsed')) p.classList.remove('collapsed');
    }
  };

  /** 把 el 滚进每一层可滚动祖先的可视区中央（过程区、代码块横向滚动），最后滚动对话日志。 */
  const scrollIntoCenter = (el: Element): void => {
    for (let p = el.parentElement; p && p !== log; p = p.parentElement) {
      const style = getComputedStyle(p);
      const r = el.getBoundingClientRect();
      const pr = p.getBoundingClientRect();
      if (/(auto|scroll)/.test(style.overflowY) && p.scrollHeight > p.clientHeight + 1) {
        p.scrollTop += r.top - pr.top - (p.clientHeight - r.height) / 2;
      }
      if (/(auto|scroll)/.test(style.overflowX) && p.scrollWidth > p.clientWidth + 1) {
        p.scrollLeft += r.left - pr.left - Math.max(0, (p.clientWidth - r.width) / 2);
      }
    }
    const r = el.getBoundingClientRect();
    const lr = log.getBoundingClientRect();
    log.scrollTop += r.top - lr.top - (log.clientHeight - Math.min(r.height, log.clientHeight)) / 2;
  };

  const clearFocus = (): void => {
    for (const el of log.querySelectorAll('.ctx-hit')) el.classList.remove('ctx-hit');
    for (const mark of log.querySelectorAll('mark.source-highlight')) mark.replaceWith(document.createTextNode(mark.textContent ?? ''));
    logIn.normalize();
  };

  /** 回合内参与匹配的区域，按优先级：用户气泡 / 助手正文（各条合并消息）→ 过程区（工具命令、结果、Diff）→ 整个回合。 */
  const searchAreas = (turn: HTMLElement, messageId?: string): Element[] => {
    const own = messageId ? turn.querySelector(`.msg[data-id="${CSS.escape(messageId)}"]`) : null;
    const areas = [
      own,
      ...turn.querySelectorAll('.ubub'),
      ...turn.querySelectorAll('.msg'),
      ...turn.querySelectorAll('.think'),
      turn,
    ].filter((x): x is Element => x instanceof Element);
    return [...new Set(areas)];
  };

  const turnOf = (messageId: string): HTMLElement | null =>
    log.querySelector<HTMLElement>(`.turn.user[data-id="${CSS.escape(messageId)}"]`)
      ?? log.querySelector(`.msg[data-id="${CSS.escape(messageId)}"]`)?.closest<HTMLElement>('.turn')
      ?? log.querySelector(`.think-body[data-mid="${CSS.escape(messageId)}"]`)?.closest<HTMLElement>('.turn')
      ?? null;

  /** 套用（或重新套用）高亮；返回滚动目标（命中的文字，否则回合）。 */
  const applyFocus = (): HTMLElement | null => {
    if (!focusHold) return null;
    const { messageId, text } = focusHold;
    const target = turnOf(messageId);
    if (!target) return null;
    target.classList.add('ctx-hit');
    revealAncestors(target);
    let mark = target.querySelector<HTMLElement>('mark.source-highlight');
    if (!mark && text?.trim()) {
      for (const area of searchAreas(target, messageId)) {
        mark = markSource(area, text);
        if (mark) break;
      }
    }
    if (mark) {
      for (const m of target.querySelectorAll('mark.source-highlight')) revealAncestors(m);
      return mark;
    }
    return target;
  };

  const focusMessage = (messageId: string, sourceText?: string): void => {
    clearFocus();
    window.clearTimeout(focusTimer);
    focusHold = { messageId, ...(sourceText?.trim() ? { text: sourceText } : {}) };
    const target = applyFocus();
    if (!target) { focusHold = null; return; }
    // 展开折叠层后布局才稳定，下一帧再定位，保证落在可视区中央。
    requestAnimationFrame(() => {
      if (!target.isConnected) { const again = applyFocus(); if (again) scrollIntoCenter(again); }
      else scrollIntoCenter(target);
    });
    focusTimer = window.setTimeout(() => { focusHold = null; clearFocus(); }, MESSAGE_FOCUS_MS);
  };

  /** 按文字找来源：从新到旧遍历回合，回合内任何文字（正文、气泡、工具命令与结果、Diff、折叠内容）都可命中。 */
  const focusText = (text: string): boolean => {
    if (!text.trim()) return false;
    const turns = [...log.querySelectorAll<HTMLElement>('article.turn')].reverse();
    for (const t of turns) {
      for (const area of searchAreas(t)) {
        if (!locateText(textNodesOf(area).text ?? '', text)) continue;
        const id = t.classList.contains('user')
          ? t.dataset.id
          : (area.closest<HTMLElement>('.msg[data-id]') ?? t.querySelector<HTMLElement>('.msg[data-id]'))?.dataset.id
            ?? t.querySelector<HTMLElement>('.think-body[data-mid]')?.dataset.mid;
        if (!id) continue;
        focusMessage(id, text);
        return true;
      }
    }
    return false;
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
    if (!isLastUserMessage(prev)) {
      // 较早的回答：沿用原逻辑，把该问题作为新消息重新发送
      textarea.value = prev.content;
      void send();
      return;
    }
    void regenerateLatest(prev);
  };

  /**
   * 最后一个回答的「重新回答」：删除该回答并重新生成，不经输入框、不重复追加问题。
   * 本地先移除该问题之后的消息（回答 / 工具），主进程 reaskLatest 截断并落盘后重新追加同一问题再生成。
   */
  const regenerateLatest = async (prev: ChatMessage): Promise<void> => {
    const s = store.state.current;
    if (!s) return;
    const setup = agentSetupHint(s.agent ?? settings()?.defaultAgent ?? 'builtin', settings());
    if (setup) { notify(setup); return; }
    const idx = s.messages.indexOf(prev);
    if (idx < 0) return;
    const removed = s.messages.splice(idx + 1);
    suppressReanswer = true;
    renderAll();
    try {
      await api.invoke('agent:send', { sessionId: s.id, text: prev.content, reaskLatest: true });
    } catch (e) {
      suppressReanswer = false;
      s.messages.push(...removed);
      renderAll();
      notify(errorText(e));
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
    const running = store.isRunning();
    stopBtn.hidden = !running;
    // 空对话也可发送：首条消息时按需建会话
    sendBtn.disabled = running;
    thTitle.textContent = s ? s.title : '';
    const estimatedTokens = s ? estimateConversationTokens(s.messages) : 0;
    ctxUsage.hidden = !s;
    ctxUsage.textContent = `约 ${fmtTokens(estimatedTokens)} tokens`;
    ctxUsage.title = '对话文本 Token 数估算值，仅供参考；不包含系统提示词及模型隐藏开销。';
    textarea.placeholder = ``;
    if (st) modeSel.value = st.permissionMode;
    agentPick.hidden = !st;
    agentPick.disabled = running;
    agentPick.textContent = agentDisplayName(agent, st?.agentClis ?? []);
    agentPick.title = running ? '会话运行中不可切换 Agent' : '切换 API / CLI（同时应用到当前会话和新会话默认值）';
    if (agentMenuSessionId && agentMenuSessionId !== s?.id) closeAgentMenu();
    // CLI 与内置 API 会话都显示模型切换器；CLI 打开候选模型菜单，API 打开服务商模型列表。
    if (s && cli) {
      modelPick.hidden = false;
      const override = s.cliModel?.trim() ? s.cliModel : undefined;
      const cliId = agent.slice(4);
      const cfgModel = st?.agentClis?.find((x) => x.id === cliId)?.model?.trim() || undefined;
      if (!override && !cfgModel) ensureDefaultModel(cliId);
      const defaultModel = defaultModelCache.get(cliId) ?? undefined;
      modelLabel.textContent = `模型：${override ?? cfgModel ?? defaultModel ?? 'CLI 默认'}`;
      modelPick.title = override || cfgModel
        ? '本会话的 CLI 模型（点击切换，下一轮生效）'
        : defaultModel ? `CLI 默认模型 ${defaultModel}（读自 opencode 配置；点击切换，下一轮生效）` : '本会话的 CLI 模型（点击切换，下一轮生效）';
    } else if (s) {
      modelPick.hidden = false;
      modelLabel.textContent = `模型：${st?.model || '未配置'}`;
      modelPick.title = '切换 API 模型（所有 API 会话共用，下一轮生效）';
    } else {
      modelPick.hidden = true;
    }
    // 菜单锚定的会话已切换（或不再是 CLI 会话）时关掉，避免对旧会话写模型。
    if (modelMenuFor && (modelMenuFor.sessionId !== s?.id || !cli)) closeModelMenu();
    if (apiMenuOpen && (cli || !s)) closeModelMenu();
  };

  const renderAll = () => {
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    clear(logIn);
    const s = store.state.current;
    // 切换会话时清掉上一会话的思考区展开状态（消息 ID 不跨会话复用）。
    const sid = s?.id ?? null;
    if (sid !== lastSessionId) {
      lastSessionId = sid;
      thinkScroll.clear();
      turnFolded.clear();
      suppressReanswer = false;
      // 规格 004：菜单与预置都是输入框状态，不跨会话残留（清预置、关菜单、清 Esc 抑制）。
      clearSlashState();
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
    // 连续的助手消息合并成一个回合：沿用第一条的头部，后续消息的正文与过程区接在同一个 article 里；
    // 头部操作（复制 / 折叠 / 重新回答 / 收藏）改指向最后一条。中间夹着提示时不合并。
    let merged: HTMLElement | null = null;
    for (const m of visible) {
      const notes = store.state.notices.filter((x) => x.afterMessageId === m.id);
      if (m.role === 'assistant' && merged) {
        const part = assistantTurn(m);
        const firstThink = merged.querySelector<HTMLElement>(':scope > .think');
        for (const el of [...part.children]) {
          if (el.matches('header.turn-hd')) continue;
          if (firstThink && el.matches('.think')) mergeThink(firstThink, el as HTMLElement);
          else merged.append(el);
        }
        merged.querySelector('header.turn-hd .acts')?.replaceWith(turnActions(m));
        merged.classList.toggle('folded', turnFolded.has(m.id));
      } else {
        const els = msgEls(m);
        logIn.append(...els);
        merged = m.role === 'assistant' ? els[0] ?? null : null;
      }
      for (const n of notes) logIn.append(noticeEl(n.text, n.kind));
      if (notes.length) merged = null;
    }
    const lastId = visible[visible.length - 1]?.id;
    for (const n of store.state.notices.filter((x) => x.afterMessageId === null && visible.length > 0)) {
      n.afterMessageId = lastId ?? null;
      logIn.append(noticeEl(n.text, n.kind));
    }
    // 错误明细不进对话流：错误条目（store.errorsOf）只驱动 .ctx 条红点计数，点击红点直接跳到错误位置定位。
    // 「正在思考…」提示永远挂在末尾；流式正文末尾另有一个光标。
    logIn.append(liveEl);
    updateLive();
    setCaret();
    renderHeader();
    // 跳转高亮期间日志被重建时重新套用，避免高亮被冲掉。
    if (focusHold) applyFocus();
    else if (nearBottom) log.scrollTop = log.scrollHeight;
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
        if (m && body) { setTrustedHtml(body, renderMarkdown(m.content)); enhanceCodeBlocks(body as HTMLElement, false); }
      }
      pendingDeltas.clear();
      if (nearBottom) log.scrollTop = log.scrollHeight;
    });
  };

  const notify = (text: string, kind: 'notice' | 'info' = 'notice') => {
    // 提示类消息只弹 toast，不再写进会话日志；错误仍留在日志里便于回看。
    if (kind === 'info') { toast(text); return; }
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

  const modelMenuItem = (label: string, sub: string, checked: boolean, fn: () => void, disabled = false) =>
    h('button', { class: 'mi', attrs: { type: 'button', role: 'menuitem', ...(disabled ? { disabled: '' } : {}) }, on: { click: fn } },
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

  const positionAgentMenu = () => {
    const r = agentPick.getBoundingClientRect();
    const rect = agentMenu.getBoundingClientRect();
    agentMenu.style.left = `${Math.max(4, Math.min(r.left, window.innerWidth - rect.width - 4))}px`;
    const above = r.top - rect.height - 4;
    agentMenu.style.top = `${above >= 4 ? above : Math.max(4, Math.min(r.bottom + 4, window.innerHeight - rect.height - 4))}px`;
  };

  const agentDisplayName = (agent: AgentRef, clis = settings()?.agentClis ?? []): string => agent === 'builtin'
    ? 'API'
    : clis.find((cli) => `cli:${cli.id}` === agent)?.name ?? 'CLI 不可用';

  const applyAgent = async (chosen: AgentRef): Promise<void> => {
    const session = store.state.current;
    const st = settings();
    if (!st) return;
    // 空对话：只改新会话默认 Agent，首条消息建会话时生效
    if (!session) {
      closeAgentMenu();
      try {
        store.state.settings = await api.invoke('settings:set', { defaultAgent: chosen });
        store.emit('settings');
        renderHeader();
      } catch (error) {
        notify(errorText(error));
      }
      return;
    }
    const sessionId = session.id;
    const previousDefault = st.defaultAgent ?? 'builtin';
    if (store.state.running.has(sessionId)) {
      closeAgentMenu();
      notify('会话运行中不可切换 Agent', 'info');
      return;
    }
    closeAgentMenu();
    let defaultUpdated = false;
    try {
      store.state.settings = await api.invoke('settings:set', { defaultAgent: chosen });
      defaultUpdated = true;
      store.emit('settings');
      if (store.state.current?.id !== sessionId) throw new Error('当前会话已切换，未应用新的 Agent。');
      if (store.state.running.has(sessionId)) throw new Error('会话已开始运行，未应用新的 Agent。');
      const updated = await api.invoke('sessions:setAgent', sessionId, chosen);
      const summary = store.state.sessions.find((item) => item.id === sessionId);
      if (summary) summary.agent = updated.agent ?? chosen;
      if (store.state.current?.id === sessionId) {
        store.state.current = updated;
        store.emit('current');
      }
      notify(`${agentDisplayName(chosen, st.agentClis ?? [])} 已应用到当前会话和新会话默认值。`, 'info');
    } catch (error) {
      if (!defaultUpdated) {
        notify(errorText(error));
        renderHeader();
        return;
      }
      try {
        store.state.settings = await api.invoke('settings:set', { defaultAgent: previousDefault });
        store.emit('settings');
        notify(errorText(error));
        renderHeader();
      } catch (rollbackError) {
        const [actualSettings, actualSession] = await Promise.allSettled([
          api.invoke('settings:get'),
          api.invoke('sessions:get', sessionId),
        ]);
        if (actualSettings.status === 'fulfilled') store.state.settings = actualSettings.value;
        if (actualSession.status === 'fulfilled') {
          const summary = store.state.sessions.find((item) => item.id === sessionId);
          if (summary) summary.agent = actualSession.value.agent ?? 'builtin';
          if (store.state.current?.id === sessionId) store.state.current = actualSession.value;
        }
        store.emit('settings', 'current');
        notify(`${errorText(error)}；恢复默认 Agent 失败，已刷新可读取的实际状态：${errorText(rollbackError)}`);
      }
    }
  };

  const openAgentMenu = () => {
    const session = store.state.current;
    const st = settings();
    if (!st || (session && store.state.running.has(session.id))) return;
    closeModelMenu();
    const current = session?.agent ?? st.defaultAgent ?? 'builtin';
    const choices: Array<{ value: AgentRef; label: string; detail: string }> = [
      { value: 'builtin', label: 'API', detail: apiVendor(st.provider, st.baseUrl) },
      ...(st.agentClis ?? []).map((cli) => ({ value: `cli:${cli.id}` as AgentRef, label: cli.name, detail: cli.model ? `CLI · ${cli.model}` : 'CLI · 使用其默认模型' })),
    ];
    const items = choices.map(({ value, label, detail }) => h('button', {
      class: 'mi',
      attrs: { type: 'button', role: 'menuitemradio', 'aria-checked': String(value === current) },
      on: { click: () => void applyAgent(value) },
    }, h('span', {}, `${value === current ? '✓ ' : ''}${label}`), h('span', { class: 'mute' }, detail)));
    agentMenu.replaceChildren(...items);
    agentMenuSessionId = session?.id ?? null;
    agentMenu.hidden = false;
    agentPick.setAttribute('aria-expanded', 'true');
    positionAgentMenu();
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
    const items: HTMLElement[] = [buildModelSelect(loading, cfgModel, override)];
    // 列表为空（拉取失败 / 超时）时给一个重试入口，不必关掉菜单重开
    if (!loading && !(modelCandidates ?? []).length) items.push(modelMenuItem('重新加载模型列表', '', false, () => fetchModels(target)));
    modelMenu.replaceChildren(...items);
    positionModelMenu();
  };

  const openModelMenu = () => {
    const s = store.state.current;
    const st = settings();
    const agent = s?.agent ?? st?.defaultAgent ?? 'builtin';
    if (!s || !isCli(agent, st)) return;
    const target = { sessionId: s.id, cliId: agent.slice(4) };
    modelMenuFor = target;
    modelCandidates = modelCache.get(target.cliId) ?? null;
    modelMenu.hidden = false;
    fetchModels(target);
  };

  /** 拉候选模型：有缓存先显示缓存，后台刷新；无缓存显示加载中。失败不清掉已有缓存。 */
  const fetchModels = (target: { sessionId: string; cliId: string }) => {
    buildModelMenu(modelCandidates === null || !modelCandidates.length);
    void (async () => {
      const list = await api.invoke('agentCli:models', target.cliId).then(
        (r) => {
          if (r.defaultModel) defaultModelCache.set(target.cliId, r.defaultModel);
          return r.models;
        },
        () => [] as string[]);
      if (list.length) modelCache.set(target.cliId, list);
      if (modelMenuFor !== target) return;
      modelCandidates = list.length ? list : (modelCache.get(target.cliId) ?? []);
      if (!modelMenu.hidden && modelMenuMode === 'list') buildModelMenu(false);
    })();
  };

  // ── API 模式模型切换（v1.16 settings:models 拉列表，settings:set 写全局 model） ──
  const apiKeyOf = (st: NonNullable<ReturnType<typeof settings>>) => `${st.provider}|${st.baseUrl.trim()}`;

  const applyApiModel = async (model: string) => {
    closeModelMenu();
    if (!model || model === settings()?.model) return;
    try {
      store.state.settings = await api.invoke('settings:set', { model });
      store.emit('settings');
      notify(`已切换 API 模型为 ${model}，下一条消息生效（所有 API 会话共用）。`, 'info');
    } catch (e) {
      notify(errorText(e));
    }
  };

  const buildApiMenu = (loading: boolean) => {
    const st = settings();
    if (!apiMenuOpen || !st) return;
    const sel = h('select', { class: 'mi-select', attrs: { 'aria-label': '选择 API 模型' } });
    sel.addEventListener('click', (ev) => ev.stopPropagation());
    sel.addEventListener('keydown', (ev) => ev.stopPropagation());
    sel.addEventListener('change', () => {
      if (sel.value) void applyApiModel(sel.value);
    });
    const list = apiModels && apiModels.key === apiKeyOf(st) ? apiModels.models : [];
    const items: HTMLElement[] = [sel];
    if (loading && !list.length) {
      sel.append(h('option', { attrs: { value: '' } }, '加载模型…'));
      sel.disabled = true;
    } else if (!list.length) {
      sel.append(h('option', { attrs: { value: '' } }, apiModelsError || '无可用模型列表'));
      sel.disabled = true;
      items.push(modelMenuItem('重新加载模型列表', '', false, () => fetchApiModels(true)));
    } else {
      const all = st.model && !list.includes(st.model) ? [st.model, ...list] : list;
      for (const m of all) sel.append(h('option', { attrs: { value: m } }, m));
      sel.value = st.model;
    }
    modelMenu.replaceChildren(...items);
    positionModelMenu();
  };

  /** 有 10 分钟内的缓存直接用（force 时仍刷新）；否则显示加载中并拉取。 */
  const fetchApiModels = (force = false) => {
    const st = settings();
    if (!st) return;
    const key = apiKeyOf(st);
    const fresh = apiModels && apiModels.key === key && Date.now() - apiModels.at < 10 * 60_000;
    buildApiMenu(true);
    if (fresh && !force) return;
    void api.invoke('settings:models').then(
      (r) => {
        if (r.models.length) apiModels = { key, models: r.models, at: Date.now() };
        apiModelsError = r.error ?? '';
      },
      (e) => { apiModelsError = errorText(e); },
    ).finally(() => buildApiMenu(false));
  };

  const openApiModelMenu = () => {
    modelMenuFor = null;
    apiMenuOpen = true;
    modelMenu.hidden = false;
    fetchApiModels();
  };

  const toggleModelMenu = () => {
    closeAgentMenu();
    const s = store.state.current;
    const st = settings();
    if (!s) return;
    if (!modelMenu.hidden) {
      closeModelMenu();
      return;
    }
    if (isCli(s.agent ?? st?.defaultAgent ?? 'builtin', st)) openModelMenu();
    else openApiModelMenu();
  };

  agentPick.addEventListener('click', () => {
    if (agentMenu.hidden) openAgentMenu();
    else closeAgentMenu();
  });
  modelPick.addEventListener('click', toggleModelMenu);
  modelPick.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      toggleModelMenu();
    }
  });
  // 与全局右键菜单同款的关闭方式：点外 / Esc / 失焦 / 缩放时关闭（点切换器本身由其 click 切换，不在此关）。
  document.addEventListener('mousedown', (ev) => {
    if (!agentMenu.hidden && ev.target instanceof Node && !agentMenu.contains(ev.target) && !agentPick.contains(ev.target)) closeAgentMenu();
    if (!modelMenu.hidden && ev.target instanceof Node && !modelMenu.contains(ev.target) && !modelPick.contains(ev.target)) closeModelMenu();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    if (!agentMenu.hidden) closeAgentMenu();
    else if (!modelMenu.hidden) closeModelMenu();
  });
  window.addEventListener('blur', () => { closeModelMenu(); closeAgentMenu(); });
  window.addEventListener('resize', () => { closeModelMenu(); closeAgentMenu(); });

  // ── 规格 004：斜杠菜单键盘 / 鼠标选择 + 两段式预置 ──
  // 候选签名 = 候选命令名拼接；签名变化（继续输入 / 删除使集合变窄或恢复）时选中项重置到第一条（FR-004）。
  // slashMenuOpen 是实际可见状态：有候选、未被 Esc 抑制、且不在预置态（预置条接棒呈现）时才为真。
  let slashIndex = 0;
  let slashSignature = '';
  let slashItems: SlashCommandInfo[] = [];
  let slashMenuOpen = false;
  let slashSuppressed = false;
  let slashSuppressedValue: string | null = null;
  let primedName: string | null = null;

  function renderPrimebar(): void {
    primebar.hidden = primedName === null;
    primeName.textContent = primedName ?? '';
  }

  function clearPrime(): void {
    if (primedName === null) return;
    primedName = null;
    renderPrimebar();
  }

  /** 同步候选与选中项：签名变化时 slashIndex 归 0；返回当前候选（被抑制时为空）。 */
  function currentSlashItems(): SlashCommandInfo[] {
    const items = slashSuppressed ? [] : suggestCommands(textarea.value);
    const signature = items.map((c) => c.name).join('\n');
    if (signature !== slashSignature) {
      slashSignature = signature;
      slashIndex = 0;
    }
    if (items.length === 0) slashIndex = 0;
    else if (slashIndex < 0 || slashIndex >= items.length) slashIndex = 0;
    slashItems = items;
    return items;
  }

  function renderSlashMenu(): void {
    const items = currentSlashItems();
    slashMenuOpen = primedName === null && items.length > 0;
    clear(slashMenu);
    slashMenu.hidden = !slashMenuOpen;
    if (!slashMenuOpen) return;
    items.forEach((c, idx) => {
      const item = h('div', { class: idx === slashIndex ? 'on' : '', attrs: { 'data-idx': String(idx) } },
        h('b', {}, c.usage), c.description);
      item.addEventListener('mouseenter', () => {
        if (slashIndex === idx) return;
        slashIndex = idx;
        renderSlashMenu();
      });
      item.addEventListener('click', () => pickSlashCommand(c));
      slashMenu.append(item);
    });
  }

  /** 键盘 Enter 与鼠标 click 共用的选择动作（FR-006）：只填入 + 进入预置，绝不在此执行（FR-009）。 */
  function pickSlashCommand(cmd: SlashCommandInfo): void {
    const filled = filledTextFor(cmd);
    textarea.value = filled;
    primedName = cmd.name;
    renderPrimebar();
    renderSlashMenu();
    autoGrow();
    unfoldInput(false); textarea.focus();
    textarea.setSelectionRange(filled.length, filled.length);
  }

  /** 切换会话时的残留清理：预置、菜单与 Esc 抑制一并清掉。 */
  function clearSlashState(): void {
    primedName = null;
    renderPrimebar();
    slashSuppressed = false;
    slashSuppressedValue = null;
    slashSignature = '';
    slashIndex = 0;
    slashItems = [];
    slashMenuOpen = false;
    clear(slashMenu);
    slashMenu.hidden = true;
  }

  /**
   * 输入变化时的状态复核：Esc 抑制在「值与抑制时不同」时解除；预置用 isPrimedText 复核，
   * 命令名被改动 / 文本被清空即取消（在参数区补字不取消）。最后按新内容重渲菜单。
   */
  function handleTextareaInput(): void {
    if (slashSuppressed && textarea.value !== slashSuppressedValue) {
      slashSuppressed = false;
      slashSuppressedValue = null;
    }
    if (primedName !== null && !isPrimedText(primedName, textarea.value)) clearPrime();
    renderSlashMenu();
  }

  primeCancel.addEventListener('click', () => {
    clearPrime();
    unfoldInput(false); textarea.focus();
  });

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

  /**
   * 输入框发送（自包含）：斜杠展开 → 配置校验 → 乐观追加 → agent:send。
   * 本地斜杠命令（/help、/clear、/model）在 runSlash 内消化（返回 null），不产生发送；
   * 配置未就绪 / 发送失败时把原文恢复进输入框并提示，runSlash 本地命令的失败只提示、不恢复原文。
   */
  const send = async () => {
    // 消费一次性重提标记：入口处读取并立即清零，发送失败回填 / 早退等路径都不残留。
    const reaskLatest = pendingReask;
    pendingReask = false;
    suppressReanswer = reaskLatest;
    const raw = textarea.value.trim();
    // 托盘附件只挂普通发送：重提路径发的就是消息原文（已含尾随引用块），不经托盘、不清托盘。
    const withTray = !reaskLatest && pendingAttachments.length > 0;
    // 准入：正文与待发送附件至少有一项（只有附件也能发）。
    if (!raw && !withTray) return;
    const composed = withTray ? composeMessageWithAttachments(raw, pendingAttachments) : raw;
    textarea.value = '';
    renderSlashMenu();
    autoGrow();
    let text: string | null;
    try {
      text = await runSlash(composed.trim());
    } catch (e) {
      notify(errorText(e));
      return;
    }
    // 被本地斜杠命令消化（未发送）：命令已执行，预置使命结束；托盘保留（附件根本没发出）。
    if (text === null) {
      clearPrime();
      return;
    }
    // 默认对话为空：首条消息发出时才建会话（归属当前项目）
    const s = store.state.current ?? await hooks.ensureSession?.() ?? null;
    if (!s) {
      textarea.value = raw;
      autoGrow();
      return;
    }
    const setup = agentSetupHint(s.agent ?? settings()?.defaultAgent ?? 'builtin', settings());
    if (setup) {
      textarea.value = raw;
      autoGrow();
      notify(setup);
      return;
    }
    // 乐观追加用户消息（主进程会写入同样内容；切换会话时以持久化版本为准）
    const local: ChatMessage = { id: `local-${Date.now()}`, role: 'user', content: text, createdAt: new Date().toISOString() };
    s.messages.push(local);
    renderAll();
    try {
      await api.invoke('agent:send', reaskLatest ? { sessionId: s.id, text, reaskLatest: true } : { sessionId: s.id, text });
    } catch (e) {
      suppressReanswer = false;
      s.messages.splice(s.messages.indexOf(local), 1);
      renderAll();
      textarea.value = raw;
      autoGrow();
      notify(errorText(e));
      return;
    }
    // 发送成功完成：清预置；托盘也只在真发送成功时清（失败保留，与回填文字一起等再发）。
    clearPrime();
    if (withTray) {
      pendingAttachments = [];
      renderAttTray();
    }
  };

  textarea.addEventListener('keydown', (ev) => {
    // 输入法组字期间整体豁免：方向键 / 确认键都归输入法，菜单与发送一律不接管（US3-4）。
    if (ev.isComposing) return;
    // 规格 004 接管必须排在 Enter 发送判断之前：菜单可见时 Enter 只 pick、绝不发送（FR-003 / SC-002）。
    currentSlashItems();
    if (slashMenuOpen) {
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        slashIndex = wrapIndex(slashIndex, ev.key === 'ArrowDown' ? 1 : -1, slashItems.length);
        renderSlashMenu();
        return;
      }
      if (ev.key === 'Enter' && !ev.shiftKey) {
        const cmd = slashItems[slashIndex];
        if (cmd) {
          ev.preventDefault();
          pickSlashCommand(cmd);
        }
        return;
      }
      if (ev.key === 'Escape') {
        ev.preventDefault();
        slashSuppressed = true;
        slashSuppressedValue = textarea.value;
        renderSlashMenu();
        return;
      }
    }
    // 菜单已关但有预置时，Esc 先取消预置（保留文本）；其余情形零干预。
    if (ev.key === 'Escape' && primedName !== null) {
      ev.preventDefault();
      clearPrime();
      return;
    }
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      void send();
    }
  });
  textarea.addEventListener('input', handleTextareaInput);
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
      notify(`权限已切换为「${MODE_LABELS[modeSel.value as PermissionMode]}」，当前会话下一条消息即生效。`, 'info');
    } catch (e) {
      notify(errorText(e));
    }
  });

  store.on('current', renderAll);
  store.on('messages', renderAll);
  store.on('approvals', renderAll);
  store.on('workspace', renderAll);
  // 运行状态变化：只更新头部与「正在思考…」提示 / 流式光标（不整体重渲染，避免打断流式输出）。
  // 挂起的错误跳转也在这里推进：目标会话回答一结束（running 移除）就执行跳转。
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
    focusMessage,
    focusText,
    insertText: insertAtCursor,
    insertBlock: (text) => {
      const r = insertBlock(textarea.value, textarea.selectionStart, textarea.selectionEnd, text);
      textarea.value = r.text;
      autoGrow();
      unfoldInput(false); textarea.focus();
      textarea.setSelectionRange(r.caret, r.caret);
      textarea.scrollTop = textarea.scrollHeight;
      renderSlashMenu();
    },
  };
}
