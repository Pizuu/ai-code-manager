/**
 * 审批卡片文案（T128，契约 contracts/ipc.ts v1.3 `ApprovalKind`）：纯函数，便于单元测试。
 * - edit / command：与 v1.2 文案逐字一致。
 * - webfetch / loop / subagent / external-dir：各自读契约规定的字段。
 * - other 与任何不认识的种类：回退为「权限名 + 匹配模式」，语气为 warn——渲染层永不自动批准。
 */
import type { ApprovalRequest } from '../../../contracts/ipc.ts';

export type ApprovalTone = 'warn' | 'danger';

export interface ApprovalPrompt {
  /** 一句话问题（以「？」结尾）。 */
  title: string;
  /** 待批准的对象原文（命令、URL、路径、模式…），逐行显示；可为空。 */
  lines: string[];
  /** 补充说明 / 风险提示；可为空。 */
  note: string;
  tone: ApprovalTone;
}

/** 卡片上展示的完整文本：title、lines、note 依次换行连接（edit / command 与旧版完全一致）。 */
export function approvalText(p: ApprovalPrompt): string {
  return [p.title, ...p.lines, ...(p.note ? [p.note] : [])].join('\n');
}

const patternsOf = (req: ApprovalRequest): string[] => (Array.isArray(req.patterns) ? req.patterns.filter((x) => typeof x === 'string' && x !== '') : []);

/**
 * @param req 审批请求（kind 可能是契约之外的未知字符串）
 * @param callName 对应工具调用名（agent_cli 的 command 文案不同）
 */
export function approvalPrompt(req: ApprovalRequest, callName = ''): ApprovalPrompt {
  const desc = req.description?.trim() ?? '';
  const kind = req.kind as string;
  switch (kind) {
    case 'command':
      return {
        title: `${callName === 'agent_cli' ? 'OpenCLI 请求启动，需要你的审批' : `在 ${req.shell ?? 'shell'} 中执行此命令`}？`,
        lines: [req.command ?? ''],
        note: callName === 'agent_cli' ? '批准后才会继续本次 OpenCLI 回答；拒绝将结束本次启动。' : '',
        tone: 'warn',
      };
    case 'edit':
      return { title: `应用对 ${req.path ?? ''} 的修改？`, lines: [], note: '', tone: 'warn' };
    case 'webfetch':
      return { title: '允许抓取此网页？', lines: [req.url ?? '（未提供 URL）'], note: desc, tone: 'warn' };
    case 'loop':
      return {
        title: `${req.tool ? `工具 ${req.tool}` : '同一工具'} 正被重复调用，仍要继续？`,
        lines: [],
        note: `⚠ ${desc || '检测到可能的死循环：同一工具以相同参数被连续调用。'}`,
        tone: 'warn',
      };
    case 'subagent': {
      const types = patternsOf(req);
      return {
        title: `启动子 agent${types.length ? `（${types.join('、')}）` : ''}？`,
        lines: [desc || '（未提供子任务说明）'], note: '', tone: 'warn',
      };
    }
    case 'external-dir':
      return {
        title: '允许访问项目根以外的目录？',
        lines: [req.path ?? (patternsOf(req).join('\n') || '（未提供路径）')],
        note: '⚠ 该路径位于项目根之外，超出项目沙箱范围；除非确认必要，请拒绝。',
        tone: 'danger',
      };
    default: {
      const pats = patternsOf(req);
      const isQuestion = req.permission === 'question';
      return {
        title: isQuestion ? 'OpenCLI 正在等待你的回答选择？' : `授予权限「${req.permission || kind || '未知'}」？`,
        lines: pats.length ? [`匹配：${pats.join('、')}`] : [],
        note: isQuestion ? `${desc || '请选择是否允许 OpenCLI 继续本次回答。'} 未作选择前流程不会继续。` : desc,
        tone: 'warn',
      };
    }
  }
}
