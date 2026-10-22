import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ApprovalKind, ApprovalRequest } from '../../../../contracts/ipc.ts';
import { approvalPrompt, approvalText } from '../../../../src/frontend/lib/approval-prompt.ts';

const base = (kind: ApprovalKind, extra: Partial<ApprovalRequest> = {}): ApprovalRequest => ({ id: 'a1', sessionId: 's1', toolCallId: 'c1', kind, ...extra });

test('edit / command text is identical to the v1.2 wording', () => {
  assert.equal(approvalText(approvalPrompt(base('edit', { path: 'src/a.ts' }), 'edit_file')), '应用对 src/a.ts 的修改？');
  assert.equal(approvalText(approvalPrompt(base('command', { shell: 'bash', command: 'npm test' }), 'run_command')), '在 bash 中执行此命令？\nnpm test');
  assert.equal(approvalText(approvalPrompt(base('command', { command: 'opencode run' }), 'agent_cli')), 'OpenCLI 请求启动，需要你的审批？\nopencode run\n批准后才会继续本次 OpenCLI 回答；拒绝将结束本次启动。');
  assert.equal(approvalText(approvalPrompt(base('command'), 'bash')), '在 shell 中执行此命令？\n');
  assert.equal(approvalPrompt(base('edit')).tone, 'warn');
});

test('webfetch shows the url', () => {
  const p = approvalPrompt(base('webfetch', { url: 'https://opencode.ai/docs/cli/' }));
  assert.deepEqual(p, { title: '允许抓取此网页？', lines: ['https://opencode.ai/docs/cli/'], note: '', tone: 'warn' });
});

test('loop shows the tool and a warning description', () => {
  const p = approvalPrompt(base('loop', { tool: 'read', description: '已连续调用 3 次' }));
  assert.equal(p.title, '工具 read 正被重复调用，仍要继续？');
  assert.equal(p.note, '⚠ 已连续调用 3 次');
  assert.match(approvalPrompt(base('loop')).note, /死循环/);
});

test('subagent shows the description and agent type', () => {
  const p = approvalPrompt(base('subagent', { description: '补齐测试', patterns: ['general'] }));
  assert.equal(approvalText(p), '启动子 agent（general）？\n补齐测试');
});

test('external-dir shows the absolute path with a danger tone', () => {
  const p = approvalPrompt(base('external-dir', { path: '/etc/hosts', patterns: ['/etc/*'] }));
  assert.equal(p.tone, 'danger');
  assert.deepEqual(p.lines, ['/etc/hosts']);
  assert.match(p.note, /项目根之外/);
  assert.deepEqual(approvalPrompt(base('external-dir', { patterns: ['/etc/*'] })).lines, ['/etc/*']);
});

test('other and unknown kinds fall back to permission + patterns', () => {
  const other = approvalPrompt(base('other', { permission: 'skill', patterns: ['deploy', 'lint'], description: '加载 skill' }));
  assert.equal(approvalText(other), '授予权限「skill」？\n匹配：deploy、lint\n加载 skill');
  assert.equal(other.tone, 'warn');
  const unknown = approvalPrompt({ ...base('other'), kind: 'brand_new' as ApprovalKind });
  assert.equal(approvalText(unknown), '授予权限「brand_new」？');
  const withPerm = approvalPrompt({ ...base('other'), kind: 'x' as ApprovalKind, permission: 'mcp', patterns: ['srv/*'] });
  assert.deepEqual(withPerm.lines, ['匹配：srv/*']);
  assert.equal(withPerm.title, '授予权限「mcp」？');
});

test('question permission is presented as an OpenCLI answer choice', () => {
  const p = approvalPrompt(base('other', { permission: 'question', description: '请选择目标环境', patterns: ['dev', 'prod'] }));
  assert.equal(p.title, 'OpenCLI 正在等待你的回答选择？');
  assert.match(p.note, /请选择目标环境/);
  assert.match(p.note, /未作选择前流程不会继续/);
});
