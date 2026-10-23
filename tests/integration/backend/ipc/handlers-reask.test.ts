import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AgentEvent } from '../../../../contracts/ipc.ts';
import type { Provider, ProviderRequest } from '../../../../src/backend/agent/providers/types.ts';
import { AppState } from '../../../../src/backend/app-state.ts';
import { createHandlers } from '../../../../src/backend/ipc/handlers.ts';
import { SessionStore } from '../../../../src/backend/sessions/session-store.ts';
import { SettingsStore, type KeyCipher } from '../../../../src/backend/settings/settings-store.ts';
import { tempProject } from '../helpers/temp-project.ts';

/** 会话最近一条 status 为 idle 才算回合结束：agent:send 返回前已发 running:true，上一回合残留的 idle 事件不会让本回合提前判定结束。 */
function turnIdle(events: readonly AgentEvent[], sessionId: string): boolean {
  let last: AgentEvent | undefined;
  for (const e of events) if (e.type === 'status' && e.sessionId === sessionId) last = e;
  return last?.type === 'status' && !last.running;
}


const cipher: KeyCipher = {
  isAvailable: () => true,
  encrypt: (p) => Buffer.from(p).toString('base64'),
  decrypt: (e) => Buffer.from(e, 'base64').toString(),
};

/** 与 handlers.test.ts 同款脚手架：假 provider 按 steps 逐回合返回，idle 等回合结束事件。 */
async function setup(t: { after: (fn: () => Promise<void>) => void }, steps: Array<Awaited<ReturnType<Provider['stream']>>>) {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'acm-userdata-'));
  t.after(() => fs.rm(userData, { recursive: true, force: true }));
  const root = await tempProject(t, { 'README.md': '# demo\n' });
  const settings = new SettingsStore(path.join(userData, 'settings.json'), cipher);
  const sessions = new SessionStore(path.join(userData, 'sessions'));
  const state = new AppState();
  const events: AgentEvent[] = [];
  const requests: ProviderRequest[] = [];
  const handlers = createHandlers({
    settings, sessions, state, platform: process.platform,
    emit: (e) => events.push(e),
    pickDirectory: async () => root,
    providerFactory: (_id, config) => {
      void config;
      // 文本经 onText 回调进助手消息（agent-loop 只累加 delta，返回值 text 不直接落盘）
      return { id: 'openai', async stream(req, onText) { requests.push(req); const s = steps.shift(); if (!s) throw new Error('no step'); if (s.text) onText(s.text); return s; } };
    },
  });
  const idle = (sessionId: string) => new Promise<void>((resolve) => {
    const check = setInterval(() => {
      if (turnIdle(events, sessionId)) { clearInterval(check); resolve(); }
    }, 5);
  });
  await handlers['project:pick']();
  const session = await handlers['sessions:create']();
  await handlers['settings:set']({ baseUrl: 'https://llm.example.test/v1', model: 'test-model' });
  await handlers['settings:set']({ apiKey: { provider: 'openai', value: 'sk-1' } });
  return { handlers, requests, idle, sessionId: session.id };
}

test('reaskLatest: re-sending the latest question keeps exactly one Q&A with the newest answer', async (t) => {
  const { handlers, requests, idle, sessionId } = await setup(t, [
    { text: '答案一', toolCalls: [], stopReason: 'stop' },
    { text: '答案二', toolCalls: [], stopReason: 'stop' },
  ]);
  await handlers['agent:send']({ sessionId, text: '问题' });
  await idle(sessionId);
  await handlers['agent:send']({ sessionId, text: '问题', reaskLatest: true });
  await idle(sessionId);

  const saved = await handlers['sessions:get'](sessionId);
  assert.deepEqual(saved.messages.map((x) => x.role), ['user', 'assistant']);
  assert.equal(saved.messages[0]?.content, '问题');
  assert.equal(saved.messages[1]?.content, '答案二');
  // 第二回合发给 provider 的历史里也只有一条 user（旧问答已被截断，不是仅界面去重）
  const secondReqUsers = (requests[1]?.messages ?? []).filter((x) => x.role === 'user');
  assert.equal(secondReqUsers.length, 1);
  assert.equal(secondReqUsers[0]?.content, '问题');
});

test('control: re-sending without reaskLatest appends a duplicate Q&A as before', async (t) => {
  const { handlers, idle, sessionId } = await setup(t, [
    { text: '答案一', toolCalls: [], stopReason: 'stop' },
    { text: '答案二', toolCalls: [], stopReason: 'stop' },
  ]);
  await handlers['agent:send']({ sessionId, text: '问题' });
  await idle(sessionId);
  await handlers['agent:send']({ sessionId, text: '问题' });
  await idle(sessionId);

  const saved = await handlers['sessions:get'](sessionId);
  assert.deepEqual(saved.messages.map((x) => x.role), ['user', 'assistant', 'user', 'assistant']);
});

test('reaskLatest with different text truncates nothing (guard requires exact match)', async (t) => {
  const { handlers, idle, sessionId } = await setup(t, [
    { text: '答案一', toolCalls: [], stopReason: 'stop' },
    { text: '答案二', toolCalls: [], stopReason: 'stop' },
  ]);
  await handlers['agent:send']({ sessionId, text: '问题甲' });
  await idle(sessionId);
  await handlers['agent:send']({ sessionId, text: '问题乙', reaskLatest: true });
  await idle(sessionId);

  const saved = await handlers['sessions:get'](sessionId);
  assert.deepEqual(saved.messages.map((x) => x.role), ['user', 'assistant', 'user', 'assistant']);
  assert.equal(saved.messages[2]?.content, '问题乙');
});
