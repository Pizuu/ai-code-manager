import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiVendor } from '../../../../src/frontend/lib/api-vendor.ts';

test('apiVendor maps known base URLs to the providing company', () => {
  assert.equal(apiVendor('openai', 'https://api.openai.com/v1'), 'OpenAI');
  assert.equal(apiVendor('openai', 'https://api.deepseek.com'), 'DeepSeek');
  assert.equal(apiVendor('openai', 'https://openrouter.ai/api/v1'), 'OpenRouter');
  assert.equal(apiVendor('openai', 'https://dashscope.aliyuncs.com/compatible-mode/v1'), '阿里云百炼');
  assert.equal(apiVendor('openai', 'open.bigmodel.cn/api/paas/v4'), '智谱 AI');
  assert.equal(apiVendor('anthropic', 'https://api.anthropic.com'), 'Anthropic');
  assert.equal(apiVendor('openai', 'http://localhost:11434/v1'), '本机服务');
});

test('apiVendor falls back to hostname, then to the provider protocol', () => {
  assert.equal(apiVendor('openai', 'https://llm.example.org/v1'), 'llm.example.org');
  assert.equal(apiVendor('openai', ''), 'OpenAI 兼容服务');
  assert.equal(apiVendor('anthropic', '  '), 'Anthropic');
});
