import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentEvent, Session } from '../../../../contracts/ipc.ts';
import { diffForTool, runCliTurn } from '../../../../src/backend/agent-cli/cli-runner.ts';
import { parseOpencodeLine } from '../../../../src/backend/agent-cli/opencode-events.ts';
import { tempProject } from '../helpers/temp-project.ts';

function session(): Session {
  return { schemaVersion: 1, id: 's-1', title: '新会话', projectPath: null, createdAt: 'x', updatedAt: 'x', messages: [], todos: [] };
}

test('text output format streams stdout as text; prompt placeholder passed as one argv item', async (t) => {
  const root = await tempProject(t, {});
  const s = session();
  const events: AgentEvent[] = [];
  let n = 0;
  await runCliTurn(s, '你好 "世界" $(rm -rf /)', {
    config: { id: 'echo', name: 'echo', preset: 'custom', args: ['-e', 'process.stdout.write("echo:" + process.argv[1])', '{prompt}'], resumeArgs: [], modelArgs: [], model: '', outputFormat: 'text', env: {} },
    executable: process.execPath, projectRoot: root, mode: 'auto-edits', platform: process.platform, signal: new AbortController().signal,
    emit: (e) => events.push(e), requestApproval: async () => true, persist: async () => undefined, newId: () => `id${n++}`, now: () => 'now',
  });
  const a = s.messages.find((m) => m.role === 'assistant');
  assert.equal(a?.content, 'echo:你好 "世界" $(rm -rf /)');
  assert.equal(a?.agent, 'cli:echo');
  assert.equal(s.title, '你好 "世界" $(rm -rf /)');
  assert.equal(a?.toolCalls?.[0]?.status, 'done');
  assert.equal(events.some((e) => e.type === 'error'), false);
});

test('diffForTool prefers metadata.diff and builds new-file diffs relative to the project root', () => {
  const line = JSON.stringify({ type: 'tool_use', sessionID: 'ses', part: { type: 'tool', tool: 'write', callID: 'c', state: { status: 'completed', input: { filePath: '/p/src/a.ts', content: 'x\n' }, metadata: { exists: false } } } });
  const ev = parseOpencodeLine(line);
  assert.ok(ev.kind === 'tool');
  assert.match(diffForTool('/p', ev) ?? '', /\+\+\+ b\/src\/a\.ts[\s\S]*\+x/);
  const ev2 = parseOpencodeLine(JSON.stringify({ type: 'tool_use', part: { type: 'tool', tool: 'edit', callID: 'd', state: { status: 'completed', input: { filePath: 'a.ts' }, metadata: { diff: '--- a\n+++ b\n' } } } }));
  assert.ok(ev2.kind === 'tool');
  assert.equal(diffForTool('/p', ev2), '--- a\n+++ b\n');
});
