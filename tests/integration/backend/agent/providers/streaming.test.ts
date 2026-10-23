import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { createAnthropicProvider } from '../../../../../src/backend/agent/providers/anthropic.ts';
import { createOpenAIProvider } from '../../../../../src/backend/agent/providers/openai.ts';
import { TOOL_DEFINITIONS } from '../../../../../contracts/tools.ts';

const FIXTURES = path.resolve(import.meta.dirname, '../../../../../contracts/fixtures');

interface Seen { url?: string; headers?: http.IncomingHttpHeaders; body?: Record<string, unknown> }

/** 本地 SSE 服务器：按 6 字节一块慢速回放样例，模拟真实分块。 */
async function serve(t: { after: (fn: () => Promise<void>) => void }, status: number, payload: string) {
  const seen: Seen = {};
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => { raw += c.toString('utf8'); });
    req.on('end', async () => {
      seen.url = req.url ?? '';
      seen.headers = req.headers;
      seen.body = JSON.parse(raw) as Record<string, unknown>;
      res.writeHead(status, { 'content-type': status === 200 ? 'text/event-stream' : 'application/json' });
      const buf = Buffer.from(payload, 'utf8');
      for (let i = 0; i < buf.length; i += 6) res.write(buf.subarray(i, i + 6));
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

const req = (signal: AbortSignal) => ({
  model: 'm',
  system: 'S',
  messages: [{ id: '1', role: 'user' as const, content: 'hi', createdAt: '' }],
  tools: TOOL_DEFINITIONS,
  signal,
});

test('OpenAI provider streams from /chat/completions with a bearer token', async (t) => {
  const { base, seen } = await serve(t, 200, fs.readFileSync(path.join(FIXTURES, 'openai-stream.sample.txt'), 'utf8'));
  const p = createOpenAIProvider({ baseUrl: `${base}/v1`, apiKey: 'sk-test' });
  const deltas: string[] = [];
  const r = await p.stream(req(new AbortController().signal), (d) => deltas.push(d));
  assert.equal(seen.url, '/v1/chat/completions');
  assert.equal(seen.headers?.authorization, 'Bearer sk-test');
  assert.equal(seen.body?.stream, true);
  assert.equal(deltas.join(''), '你好，我看看');
  assert.equal(r.toolCalls[0]?.name, 'list_dir');
});

test('Anthropic provider streams from /v1/messages with x-api-key and version header', async (t) => {
  const { base, seen } = await serve(t, 200, fs.readFileSync(path.join(FIXTURES, 'anthropic-stream.sample.txt'), 'utf8'));
  const p = createAnthropicProvider({ baseUrl: base, apiKey: 'ak-test' });
  const r = await p.stream(req(new AbortController().signal), () => {});
  assert.equal(seen.url, '/v1/messages');
  assert.equal(seen.headers?.['x-api-key'], 'ak-test');
  assert.equal(seen.headers?.['anthropic-version'], '2023-06-01');
  assert.equal(seen.body?.system, 'S');
  assert.deepEqual(r.toolCalls[0]?.input, { path: 'README.md' });
});

test('HTTP errors become E_PROVIDER and never echo the api key', async (t) => {
  const { base } = await serve(t, 401, '{"error":{"message":"invalid key sk-LEAK"}}');
  const p = createOpenAIProvider({ baseUrl: base, apiKey: 'sk-LEAK' });
  await assert.rejects(p.stream(req(new AbortController().signal), () => {}), (err: Error) => {
    assert.match(err.message, /^E_PROVIDER: 模型服务返回 HTTP 401/);
    assert.equal(err.message.includes('sk-LEAK'), false);
    return true;
  });
});
