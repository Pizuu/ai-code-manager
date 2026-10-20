import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { PermissionMode, TodoItem } from '../../../../contracts/ipc.ts';
import { executeTool, type ApprovalInput, type ExecutorContext } from '../../../../src/backend/tools/executor.ts';
import { tempProject } from '../helpers/temp-project.ts';

function ctx(root: string | null, mode: PermissionMode, answer: boolean) {
  const approvals: ApprovalInput[] = [];
  const todos: TodoItem[][] = [];
  const terminal: string[] = [];
  const c: ExecutorContext = {
    projectRoot: root,
    mode,
    signal: new AbortController().signal,
    requestApproval: async (req) => { approvals.push(req); return answer; },
    onTerminal: (_id, _s, data) => terminal.push(data),
    onTodos: (t) => todos.push(t),
  };
  return { c, approvals, todos, terminal };
}

const edit = { id: 'c1', name: 'edit_file', input: { path: 'README.md', old_string: '# demo', new_string: '# Demo' } };

test('ask mode: rejected edits leave the file untouched (SC-002)', async (t) => {
  const root = await tempProject(t, { 'README.md': '# demo\n' });
  const { c, approvals } = ctx(root, 'ask', false);
  const r = await executeTool(edit, c);
  assert.equal(r.status, 'rejected');
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0]?.kind, 'edit');
  assert.match(approvals[0]?.diff ?? '', /-# demo\n\+# Demo/);
  assert.equal(await fs.readFile(path.join(root, 'README.md'), 'utf8'), '# demo\n');
});

test('ask mode: approved edits are written', async (t) => {
  const root = await tempProject(t, { 'README.md': '# demo\n' });
  const r = await executeTool(edit, ctx(root, 'ask', true).c);
  assert.equal(r.status, 'done');
  assert.match(r.output, /已修改 README\.md（\+1 -1）/);
  assert.equal(await fs.readFile(path.join(root, 'README.md'), 'utf8'), '# Demo\n');
});

test('auto-edits mode writes without asking but commands still ask', async (t) => {
  const root = await tempProject(t, { 'README.md': '# demo\n' });
  const { c, approvals } = ctx(root, 'auto-edits', false);
  assert.equal((await executeTool(edit, c)).status, 'done');
  assert.equal(approvals.length, 0);
  const cmd = await executeTool({ id: 'c2', name: 'run_command', input: { command: 'echo should-not-run > ran.txt' } }, c);
  assert.equal(cmd.status, 'rejected');
  assert.equal(approvals.length, 1);
  await assert.rejects(fs.access(path.join(root, 'ran.txt')));
});

test('plan mode denies writes and commands without asking', async (t) => {
  const root = await tempProject(t, { 'README.md': '# demo\n' });
  const { c, approvals } = ctx(root, 'plan', true);
  assert.equal((await executeTool(edit, c)).status, 'rejected');
  assert.equal((await executeTool({ id: 'c3', name: 'run_command', input: { command: 'echo hi' } }, c)).status, 'rejected');
  assert.equal(approvals.length, 0);
  assert.equal(await fs.readFile(path.join(root, 'README.md'), 'utf8'), '# demo\n');
});

test('approved commands run in the project root and stream output', async (t) => {
  const root = await tempProject(t);
  const { c, terminal } = ctx(root, 'ask', true);
  const r = await executeTool({ id: 'c4', name: 'run_command', input: { command: 'node -e "console.log(process.cwd())"' } }, c);
  assert.equal(r.status, 'done');
  assert.match(r.output, /退出码：0/);
  assert.ok(terminal.join('').includes(await fs.realpath(root)));
});

test('read tools work in plan mode; path escapes become tool errors', async (t) => {
  const root = await tempProject(t, { 'a.txt': 'hello\n' });
  const { c } = ctx(root, 'plan', false);
  assert.equal((await executeTool({ id: 'r1', name: 'read_file', input: { path: 'a.txt' } }, c)).status, 'done');
  const esc = await executeTool({ id: 'r2', name: 'read_file', input: { path: '../x' } }, c);
  assert.equal(esc.status, 'error');
  assert.match(esc.output, /E_PATH_ESCAPE/);
});

test('todo_write validates and publishes todos; unknown tools and bad input are errors', async (t) => {
  const root = await tempProject(t);
  const { c, todos } = ctx(root, 'ask', true);
  const ok = await executeTool({ id: 't', name: 'todo_write', input: { todos: [{ content: 'a', status: 'in_progress' }, { content: 'b', status: 'pending' }] } }, c);
  assert.equal(ok.status, 'done');
  assert.deepEqual(todos[0]?.map((x) => x.id), ['1', '2']);
  const two = await executeTool({ id: 't2', name: 'todo_write', input: { todos: [{ content: 'a', status: 'in_progress' }, { content: 'b', status: 'in_progress' }] } }, c);
  assert.equal(two.status, 'error');
  assert.equal((await executeTool({ id: 'u', name: 'rm_rf', input: {} }, c)).status, 'error');
  assert.equal((await executeTool({ id: 'b', name: 'read_file', input: {}, inputError: 'bad json' }, c)).output, 'bad json');
});

test('file tools report a missing project', async () => {
  const r = await executeTool({ id: 'x', name: 'list_dir', input: {} }, ctx(null, 'ask', true).c);
  assert.match(r.output, /E_NO_PROJECT/);
});
