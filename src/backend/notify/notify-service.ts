/**
 * 主进程通知服务（功能 005 / T-047，FR-501 / FR-503 / FR-504 / FR-506 / FR-512 / FR-513）。
 *
 * 职责：审批请求（P0）与会话出错（P1）在「窗口不在前台」时发系统通知；P0 按 approvalId
 * 去重、等待满 3 分钟升级恰一次；审批解决 / 会话删除后撤下通知状态并清定时器；点击通知
 * 只做聚焦窗口 + 经 'notify-activate' 回传跳转目标——系统通知永不承载批准 / 拒绝（FR-508）。
 *
 * 通知器与时钟都是可注入替身：生产用 Electron Notification + 全局定时器（见
 * electron-notifier.ts 与 main.ts 接线），测试用假通知器 + 假时钟，绝不真弹窗。
 * 应用内弹窗 / 收件箱是前端的事（T-048 / T-049），本服务只决定「要不要调通知器」。
 */
import type { AgentEvent, ApprovalRequest, NotifySettings, ReminderLevel } from '../../../contracts/ipc.ts';
import { DEFAULT_NOTIFY_SETTINGS } from '../../../contracts/ipc.ts';

/** 发给系统通知器的载荷（与 Electron Notification 的字段对齐，但不依赖 Electron 类型）。 */
export interface NativeNotificationPayload {
  title: string;
  subtitle?: string;
  body: string;
  /** true = 静音（提醒偏好 sound[level] 为关时置 true）。 */
  silent: boolean;
}

/** 一条已发出的系统通知的句柄。 */
export interface NotificationHandle {
  close(): void;
  /** 注册点击回调（服务在 show 后立即注册，真实点击不可能早于注册）。 */
  onClick(cb: () => void): void;
}

/** 通知器接口：生产实现 = Electron Notification；测试 = 假实现。 */
export interface Notifier {
  /** 当前环境是否具备系统通知能力（FR-513 的降级判定）。 */
  isSupported(): boolean;
  show(payload: NativeNotificationPayload): NotificationHandle;
}

/** 时钟接口：now 仅用于可测性保留，升级计时走 setTimeout / clearTimeout。 */
export interface NotifyClock {
  now(): number;
  setTimeout(cb: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const systemClock: NotifyClock = {
  now: () => Date.now(),
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** P0 升级等待时长（FR-506）：3 分钟。 */
export const ESCALATION_MS = 3 * 60 * 1000;

export interface NotifyServiceDeps {
  notifier: Notifier;
  clock?: NotifyClock;
  /** 窗口当前是否聚焦（走既有窗口管理，main.ts 注入）。 */
  isWindowFocused(): boolean;
  /** 点击通知时聚焦 / 恢复窗口（走既有窗口管理，main.ts 注入）。 */
  focusWindow(): void;
  /** 向渲染进程推 agent:event（与 handlers 共用同一 emit）。 */
  emit(event: AgentEvent): void;
  /** 读当前提醒偏好（settings-store；缺省由调用方以 DEFAULT_NOTIFY_SETTINGS 兜底）。 */
  getSettings(): NotifySettings;
  /** 测试可注入更短的升级时长；生产缺省 = ESCALATION_MS。 */
  escalationMs?: number;
}

interface PendingApprovalNotify {
  sessionId: string;
  sessionTitle?: string;
  req: ApprovalRequest;
  handle: NotificationHandle | null;
  escalationHandle: NotificationHandle | null;
  timer: unknown;
  escalated: boolean;
}

const KIND_LABEL: Record<ApprovalRequest['kind'], string> = {
  edit: '修改文件',
  command: '执行命令',
  webfetch: '抓取网页',
  loop: '疑似死循环，询问是否继续',
  subagent: '启动子 agent',
  'external-dir': '访问项目外目录',
  other: '未知权限请求',
};

function firstLine(text: string): string {
  return text.split('\n').map((s) => s.trim()).find((s) => s !== '') ?? '';
}

/** 审批通知正文：系统通知正文有限，给关键要点（命令首行 + shell / 路径 + diff 规模 / 说明）。 */
export function approvalNotificationBody(req: ApprovalRequest): string {
  const parts: string[] = [];
  if (req.kind === 'command' && req.command) {
    parts.push(firstLine(req.command));
    if (req.shell) parts.push(`shell：${req.shell}`);
  } else if (req.path) {
    parts.push(req.path);
  } else if (req.url) {
    parts.push(req.url);
  }
  if (req.diff) {
    const lines = req.diff.split('\n');
    const add = lines.filter((l) => l.startsWith('+') && !l.startsWith('+++')).length;
    const del = lines.filter((l) => l.startsWith('-') && !l.startsWith('---')).length;
    parts.push(`改动 +${add} / -${del} 行`);
  }
  if (req.description) parts.push(firstLine(req.description));
  if (req.patterns?.length) parts.push(req.patterns.slice(0, 3).join('、'));
  return parts.filter(Boolean).join('\n') || '请打开应用查看待批内容。';
}

export class NotifyService {
  private readonly notifier: Notifier;
  private readonly clock: NotifyClock;
  private readonly deps: NotifyServiceDeps;
  private readonly escalationMs: number;
  private readonly approvals = new Map<string, PendingApprovalNotify>();
  private readonly sessionErrors = new Map<string, NotificationHandle | null>();

  constructor(deps: NotifyServiceDeps) {
    this.deps = deps;
    this.notifier = deps.notifier;
    this.clock = deps.clock ?? systemClock;
    this.escalationMs = deps.escalationMs ?? ESCALATION_MS;
  }

  /** 该级别现在能不能发系统通知：偏好开 + 环境支持 + 窗口不在前台，三者缺一不可。 */
  private canNotify(level: ReminderLevel): boolean {
    const settings = this.deps.getSettings();
    if (!settings.systemNotify[level]) return false;
    if (!this.notifier.isSupported()) return false;
    if (this.deps.isWindowFocused()) return false;
    return true;
  }

  private showWithClick(level: ReminderLevel, payload: Omit<NativeNotificationPayload, 'silent'>, onClick: () => void): NotificationHandle | null {
    const settings = this.deps.getSettings();
    const handle = this.notifier.show({ ...payload, silent: !settings.sound[level] });
    handle.onClick(onClick);
    return handle;
  }

  /** 审批请求产生（handlers 的 approval-request 汇合点调用）。按 approvalId 去重（FR-504）。 */
  onApprovalRequest(sessionId: string, req: ApprovalRequest, sessionTitle?: string): void {
    if (this.approvals.has(req.id)) return;
    const pending: PendingApprovalNotify = {
      sessionId,
      ...(sessionTitle ? { sessionTitle } : {}),
      req,
      handle: null,
      escalationHandle: null,
      timer: null,
      escalated: false,
    };
    this.approvals.set(req.id, pending);
    if (this.canNotify('P0')) {
      pending.handle = this.showWithClick('P0', this.approvalPayload(pending, false), () => this.activateApproval(pending));
    }
    // 升级计时恒挂（与首发是否被聚焦抑制无关）：3 分钟后仍未解决且窗口不在前台才发，
    // 负责人当时在看应用、事后走开的情形靠升级兜住（FR-506）。
    pending.timer = this.clock.setTimeout(() => this.escalate(req.id), this.escalationMs);
  }

  private approvalPayload(p: PendingApprovalNotify, escalated: boolean): Omit<NativeNotificationPayload, 'silent'> {
    const label = KIND_LABEL[p.req.kind] ?? KIND_LABEL.other;
    return {
      title: escalated ? `审批已等待 3 分钟：${label}` : `待批准：${label}`,
      subtitle: p.sessionTitle ? `会话「${p.sessionTitle}」` : `会话 ${p.sessionId}`,
      body: approvalNotificationBody(p.req),
    };
  }

  private escalate(approvalId: string): void {
    const pending = this.approvals.get(approvalId);
    if (!pending || pending.escalated) return;
    pending.escalated = true;
    pending.timer = null;
    if (!this.canNotify('P0')) return;
    pending.escalationHandle = this.showWithClick('P0', this.approvalPayload(pending, true), () => this.activateApproval(pending));
  }

  private activateApproval(p: PendingApprovalNotify): void {
    this.deps.focusWindow();
    this.deps.emit({
      type: 'notify-activate',
      target: { kind: 'approval', sessionId: p.sessionId, approvalId: p.req.id },
    });
  }

  /** 审批被任何路径解决：清升级计时、关掉已发通知、删去重状态（FR-505）。 */
  onApprovalResolved(_sessionId: string, approvalId: string): void {
    const pending = this.approvals.get(approvalId);
    if (!pending) return;
    this.clearApproval(pending);
    this.approvals.delete(approvalId);
  }

  /** 会话出错（主进程可见的回合级 error）。同一会话出错持续期间只发一条（FR-509 口径）。 */
  onSessionError(sessionId: string, message: string, sessionTitle?: string): void {
    if (this.sessionErrors.has(sessionId)) return;
    let handle: NotificationHandle | null = null;
    if (this.canNotify('P1')) {
      handle = this.showWithClick('P1', {
        title: '会话出错',
        subtitle: sessionTitle ? `会话「${sessionTitle}」` : `会话 ${sessionId}`,
        body: firstLine(message) || '会话运行出错，请打开应用查看。',
      }, () => {
        this.deps.focusWindow();
        this.deps.emit({ type: 'notify-activate', target: { kind: 'session', sessionId } });
      });
    }
    // 即使这次因聚焦 / 偏好没发出去，也记下去重状态：出错持续期间不反复尝试轰炸。
    this.sessionErrors.set(sessionId, handle);
  }

  /** 会话恢复（新回合开始）后允许下一次出错再发一条。 */
  onSessionRecovered(sessionId: string): void {
    const handle = this.sessionErrors.get(sessionId);
    if (handle) handle.close();
    this.sessionErrors.delete(sessionId);
  }

  /** 会话被删除：其全部待批通知状态与出错通知一并清理，防悬挂定时器与点到已删会话。 */
  onSessionDeleted(sessionId: string): void {
    for (const [id, pending] of this.approvals) {
      if (pending.sessionId !== sessionId) continue;
      this.clearApproval(pending);
      this.approvals.delete(id);
    }
    this.onSessionRecovered(sessionId);
  }

  private clearApproval(p: PendingApprovalNotify): void {
    if (p.timer !== null) {
      this.clock.clearTimeout(p.timer);
      p.timer = null;
    }
    p.handle?.close();
    p.escalationHandle?.close();
    p.handle = null;
    p.escalationHandle = null;
  }

  /** 进程退出时调用：清掉全部定时器与通知。 */
  dispose(): void {
    for (const pending of this.approvals.values()) this.clearApproval(pending);
    this.approvals.clear();
    for (const handle of this.sessionErrors.values()) handle?.close();
    this.sessionErrors.clear();
  }
}

/** settings 缺省兜底：调用方（main.ts）可直接传 () => DEFAULT_NOTIFY_SETTINGS 组合 store 读数。 */
export function defaultNotifySettings(): NotifySettings {
  return DEFAULT_NOTIFY_SETTINGS;
}
