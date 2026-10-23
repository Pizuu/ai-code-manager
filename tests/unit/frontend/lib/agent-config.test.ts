import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PublicSettings } from '../../../../contracts/ipc.ts';
import { agentSetupHint, builtinMissing } from '../../../../src/frontend/lib/agent-config.ts';
import { builtinLabel } from '../../../../src/frontend/lib/agent-label.ts';

const blank = { provider: 'openai', baseUrl: '', model: '', hasApiKey: { openai: false, anthropic: false } } as unknown as PublicSettings;

test('blank settings report every missing field and the configure-first hint', () => {
  assert.deepEqual(builtinMissing(blank), ['Base URL', '模型', 'API Key']);
  assert.match(agentSetupHint('builtin', blank) ?? '', /^请先在设置中配置 agent：内置 agent 尚未填写 Base URL、模型、API Key/);
  assert.equal(builtinLabel(blank), '未配置模型');
});

test('fully configured builtin and CLI agents need no hint', () => {
  const ok = { ...blank, baseUrl: 'https://llm.example.test/v1', model: 'm', hasApiKey: { openai: true, anthropic: false } } as PublicSettings;
  assert.deepEqual(builtinMissing(ok), []);
  assert.equal(agentSetupHint('builtin', ok), null);
  assert.equal(agentSetupHint('cli:oc-1', blank), null);
});
