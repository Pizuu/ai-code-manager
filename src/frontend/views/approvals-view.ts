/**
 * 审批中心（任务会话下的子页）：当前项目的全流程监控——
 *   1. 概况：待审批 / 回答中 / 出错 / 已批准 / 已拒绝 / 发送 / 接收 计数；
 *   2. 待审批：跨会话集中处理（批准 / 拒绝 / 打开会话），文案与对话内审批卡同源（approvalPrompt）；
 *   3. 会话状态：每个会话的回答中 / 待批准 / 出错 / 空闲，可打开或停止；
 *   4. 全流程记录：审批、消息收发、运行状态、错误的时间线，可按类别 / 会话 / 关键字筛选，可清空。
 * 只用既有 IPC（agent:approve / agent:stop），不改契约；记录由 main.ts 从 agent:event 折算（lib/activity-log.ts）。
 */
import type { ApprovalRequest, SessionSummary } from '../../../contracts/ipc.ts';
import { ACTIVITY_META, GROUP_LABEL, approvalKindLabel, activityStats, filterEntries, type ActivityGroup } from '../lib/activity-log.ts';
import { agentName } from '../lib/agent-label.ts';
import { approvalPrompt, approvalText } from '../lib/approval-prompt.ts';
import { clear, h } from '../lib/dom.ts';
import { sessionsOfProject } from '../lib/project-sessions.ts';
import { store } from '../store.ts';

export interface ApprovalsHooks {
  openSession(id: string): void;
  decide(approvalId: string, approved: boolean): void;
  stop(sessionId: string): void;
  openProject(): void;
}

type SessionState = 'running' | 'pending' | 'error' | 'idle';
const STATE_META: Readonly<Record<SessionState, { label: string; tone: string }>> = {
  pending: { label: '待批准', tone: 'amb' },
  running: { label: '回答中', tone: 'blu' },
  error: { label: '出错', tone: 'red' },
  idle: { label: '空闲', tone: '' },
};

const ymdhm = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

export function mountApprovals(container: HTMLElement, hooks: ApprovalsHooks): void {
  const f: { group: ActivityGroup | ''; sessionId: string; q: string } = { group: '', sessionId: '', q: '' };

  const stateOf = (id: string, pendingIds: ReadonlySet<string>): SessionState =>
    pendingIds.has(id) ? 'pending' : store.state.running.has(id) ? 'running' : store.errorsOf(id).length ? 'error' : 'idle';

  const titleOf = (sessions: readonly SessionSummary[], id: string) => sessions.find((s) => s.id === id)?.title ?? id.slice(0, 8);

  const approvalCard = (a: ApprovalRequest, sessions: readonly SessionSummary[]) => {
    const p = approvalPrompt(a);
    const diff = a.diff ? h('details', { class: 'ap-diff' }, h('summary', {}, 'Diff'), h('pre', { class: 'mono' }, a.diff)) : null;
    return h('div', { class: `ap-card${p.tone === 'danger' ? ' danger' : ''}`, attrs: { 'data-approval': a.id } },
      h('div', { class: 'ap-card-h' },
        h('span', { class: 'chip amb' }, approvalKindLabel(a.kind)),
        h('a', { class: 'ap-sess', title: '打开会话', on: { click: () => hooks.openSession(a.sessionId) } }, titleOf(sessions, a.sessionId))),
      h('div', { class: 'ap-q' }, approvalText(p)),
      diff,
      h('div', { class: 'ap-act' },
        h('button', { class: 'btn sm', on: { click: () => hooks.openSession(a.sessionId) } }, '打开会话'),
        h('span', { class: 'sp' }),
        h('button', { class: 'btn sm danger', on: { click: () => hooks.decide(a.id, false) } }, '拒绝'),
        h('button', { class: 'btn sm pri', on: { click: () => hooks.decide(a.id, true) } }, '批准')));
  };

  const render = () => {
    const keepScroll = container.scrollTop;
    clear(container);
    if (!store.state.project) {
      container.append(h('div', { class: 'empty-state' }, h('b', {}, '请先打开项目'), '审批中心只看当前项目的会话：审批、消息收发与运行状态。',
        h('div', {}, h('button', { class: 'btn', on: { click: hooks.openProject } }, '打开项目文件夹'))));
      return;
    }
    const sessions = sessionsOfProject(store.state.sessions, store.state.project.root);
    const ids = new Set(sessions.map((s) => s.id));
    const pending = [...store.state.approvals.values()].filter((a) => ids.has(a.sessionId));
    const pendingIds = new Set(pending.map((a) => a.sessionId));
    const states = new Map(sessions.map((s) => [s.id, stateOf(s.id, pendingIds)] as const));
    const nRun = [...states.values()].filter((v) => v === 'running' || v === 'pending').length;
    const nErr = [...states.values()].filter((v) => v === 'error').length;
    const st = activityStats(store.state.activity, ids);

    const pad = h('div', { class: 'pad ap' });
    const stat = (label: string, n: number, tone = '') => h('div', { class: `ap-stat${tone ? ` ${tone}` : ''}` }, h('b', {}, String(n)), h('span', {}, label));
    pad.append(h('div', { class: 'ap-head' },
      h('div', {}, h('div', { class: 't' }, '审批中心'), h('div', { class: 'mute' }, `${store.state.project.name} · ${sessions.length} 个会话 · 审批、消息收发与运行状态全流程`))));
    pad.append(h('div', { class: 'ap-stats' },
      stat('待审批', pending.length, pending.length ? 'amb' : ''),
      stat('回答中', nRun, nRun ? 'blu' : ''),
      stat('出错', nErr, nErr ? 'red' : ''),
      stat('已批准', st.approved, 'grn'),
      stat('已拒绝', st.rejected),
      stat('发送', st.sent),
      stat('接收', st.received)));

    // ── 待审批 ──
    pad.append(h('div', { class: 'sec' }, h('span', {}, '待审批'), h('span', { class: 'mute' }, pending.length ? `${pending.length} 项等待处理 · 批准 / 拒绝立即生效` : '暂无')));
    pad.append(pending.length
      ? h('div', { class: 'ap-cards' }, ...pending.map((a) => approvalCard(a, sessions)))
      : h('div', { class: 'ap-none mute' }, 'Agent 需要修改文件、执行命令或访问网络时，审批会出现在这里。'));

    // ── 会话状态 ──
    pad.append(h('div', { class: 'sec' }, h('span', {}, '会话状态'), h('span', { class: 'mute' }, `回答中 ${nRun} · 出错 ${nErr} · 空闲 ${sessions.length - nRun - nErr}`)));
    const order: SessionState[] = ['pending', 'running', 'error', 'idle'];
    const sorted = [...sessions].sort((a, b) => order.indexOf(states.get(a.id) ?? 'idle') - order.indexOf(states.get(b.id) ?? 'idle') || b.updatedAt.localeCompare(a.updatedAt));
    const rows = sorted.map((s) => {
      const state = states.get(s.id) ?? 'idle';
      const meta = STATE_META[state];
      const nPend = pending.filter((a) => a.sessionId === s.id).length;
      const busy = state === 'running' || state === 'pending';
      return h('div', { class: 'ap-row' },
        h('span', { class: `chip ${meta.tone}` }, nPend ? `${meta.label} ${nPend}` : meta.label),
        h('a', { class: 'ap-ttl', title: s.title, on: { click: () => hooks.openSession(s.id) } }, s.title),
        h('span', { class: 'mute' }, agentName(s.agent, store.state.settings)),
        h('span', { class: 'mute mono' }, ymdhm(s.updatedAt)),
        h('span', { class: 'ap-row-act' },
          busy ? h('button', { class: 'btn sm danger', title: '停止本会话的回答', on: { click: () => hooks.stop(s.id) } }, '停止') : null,
          h('button', { class: 'btn sm', on: { click: () => hooks.openSession(s.id) } }, '打开')));
    });
    pad.append(rows.length ? h('div', { class: 'ap-table' }, ...rows) : h('div', { class: 'ap-none mute' }, '当前项目还没有会话。'));

    // ── 全流程记录 ──
    const list = filterEntries(store.state.activity, { sessionIds: ids, group: f.group, sessionId: f.sessionId, q: f.q });
    const groupBtn = (g: ActivityGroup | '', label: string) => h('button', { class: `chip${f.group === g ? ' acc' : ''}`, attrs: { type: 'button' }, on: { click: () => { f.group = g; render(); } } }, label);
    const sessSel = h('select', { class: 'chip', attrs: { 'aria-label': '按会话筛选' } },
      h('option', { attrs: { value: '' } }, '全部会话'), ...sessions.map((s) => h('option', { attrs: { value: s.id } }, s.title)));
    sessSel.value = f.sessionId;
    sessSel.addEventListener('change', () => { f.sessionId = sessSel.value; render(); });
    const q = h('input', { class: 'inp ap-q-inp', attrs: { placeholder: '搜索记录', value: f.q } });
    q.addEventListener('change', () => { f.q = q.value; render(); });
    const clearBtn = h('button', { class: 'btn sm', title: '清空当前项目的全流程记录（不影响会话本身）', on: { click: () => {
      if (window.confirm('清空当前项目的全流程记录？会话与消息不受影响。')) store.clearActivity(ids);
    } } }, '清空记录');
    pad.append(h('div', { class: 'sec' }, h('span', {}, '全流程记录'), h('span', { class: 'mute' }, `${list.length} 条 · 本机保存最近 500 条`)));
    pad.append(h('div', { class: 'ap-ctl' },
      groupBtn('', '全部'), ...(Object.keys(GROUP_LABEL) as ActivityGroup[]).map((g) => groupBtn(g, GROUP_LABEL[g])),
      h('span', { class: 'sp' }), sessSel, q, clearBtn));
    pad.append(list.length
      ? h('div', { class: 'ap-log' }, ...list.slice(0, 300).map((e) => {
        const m = ACTIVITY_META[e.kind];
        return h('a', { class: 'ap-log-row', title: '打开会话', on: { click: () => hooks.openSession(e.sessionId) } },
          h('span', { class: 'mute mono' }, ymdhm(e.at)),
          h('span', { class: `chip ${m.tone === 'warn' ? 'amb' : m.tone === 'mute' ? '' : m.tone}` }, m.label),
          h('span', { class: 'ap-log-s' }, titleOf(sessions, e.sessionId)),
          h('span', { class: 'ap-log-t' }, e.text));
      }))
      : h('div', { class: 'ap-none mute' }, '还没有记录：发送消息、收到回答、审批与出错都会记在这里。'));
    container.append(pad);
    container.scrollTop = keepScroll;
  };

  let frame = 0;
  const schedule = () => {
    if (frame || container.hidden) return;
    frame = requestAnimationFrame(() => { frame = 0; render(); });
  };
  for (const t of ['approvals', 'running', 'sessions', 'errors', 'activity', 'project', 'settings'] as const) store.on(t, schedule);
  store.on('view', () => { if (store.state.view === 'approvals') render(); });
  render();
}
