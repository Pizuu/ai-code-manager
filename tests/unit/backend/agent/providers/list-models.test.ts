import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listProviderModels } from '../../../../../src/backend/agent/providers/list-models.ts';

const fakeFetch = (body: unknown, status = 200, seen: { url?: string; headers?: Record<string, string> } = {}) =>
  (async (url: string | URL | Request, init?: RequestInit) => {
    seen.url = String(url);
    seen.headers = init?.headers as Record<string, string>;
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;

test('openai-compatible: GET {baseUrl}/models with Bearer, dedup + sort ids', async () => {
  const seen: { url?: string; headers?: Record<string, string> } = {};
  const models = await listProviderModels({ provider: 'openai', baseUrl: 'https://api.deepseek.com/v1/', apiKey: 'k', fetchImpl: fakeFetch({ data: [{ id: 'deepseek-reasoner' }, { id: 'deepseek-chat' }, { id: 'deepseek-chat' }] }, 200, seen) });
  assert.deepEqual(models, ['deepseek-chat', 'deepseek-reasoner']);
  assert.equal(seen.url, 'https://api.deepseek.com/v1/models');
  assert.equal(seen.headers?.authorization, 'Bearer k');
});

test('anthropic: GET /v1/models with x-api-key, no duplicate /v1', async () => {
  const seen: { url?: string; headers?: Record<string, string> } = {};
  await listProviderModels({ provider: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'k', fetchImpl: fakeFetch({ data: [{ id: 'claude-sonnet-4-5' }] }, 200, seen) });
  assert.equal(seen.url, 'https://api.anthropic.com/v1/models?limit=1000');
  assert.equal(seen.headers?.['x-api-key'], 'k');
  await listProviderModels({ provider: 'anthropic', baseUrl: 'https://proxy.example/v1', apiKey: 'k', fetchImpl: fakeFetch({ data: [] }, 200, seen) });
  assert.equal(seen.url, 'https://proxy.example/v1/models?limit=1000');
});

test('non-2xx and unknown shapes throw without leaking the key', async () => {
  await assert.rejects(() => listProviderModels({ provider: 'openai', baseUrl: 'https://x', apiKey: 'secret', fetchImpl: fakeFetch({}, 401) }), (e: Error) => /HTTP 401/.test(e.message) && !e.message.includes('secret'));
  await assert.rejects(() => listProviderModels({ provider: 'openai', baseUrl: 'https://x', apiKey: 'k', fetchImpl: fakeFetch({ foo: 1 }) }), /格式/);
});
