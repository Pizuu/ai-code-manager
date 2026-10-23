/**
 * agentCli:models 的输出解析（纯函数）：逐行 provider/model 形态、去重保序、上限 200。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseModelsOutput, MAX_MODELS, listOpencodeModels, clearModelsCache, MODELS_CACHE_MS } from '../../../../src/backend/agent-cli/models.ts';

test('parseModelsOutput keeps provider/model lines in order', () => {
  const out = parseModelsOutput('opencode/big-pickle\nanthropic/claude-sonnet-4-5\nopenai/gpt-5.2\n');
  assert.deepEqual(out, ['opencode/big-pickle', 'anthropic/claude-sonnet-4-5', 'openai/gpt-5.2']);
});

test('parseModelsOutput trims, skips blanks and non-model lines, dedupes', () => {
  const text = [
    '',
    '  anthropic/claude-sonnet-4-5  ',
    'not-a-model-line',
    'two / slashes / here',
    'white space/model',
    'anthropic/claude-sonnet-4-5',
    '/leading-slash',
    'trailing-slash/',
    'opencode/big-pickle',
  ].join('\n');
  assert.deepEqual(parseModelsOutput(text), ['anthropic/claude-sonnet-4-5', 'opencode/big-pickle']);
});

test('parseModelsOutput handles CRLF and caps at MAX_MODELS', () => {
  const lines = Array.from({ length: MAX_MODELS + 50 }, (_, i) => `prov/model-${i}`).join('\r\n');
  const out = parseModelsOutput(lines);
  assert.equal(out.length, MAX_MODELS);
  assert.equal(out[0], 'prov/model-0');
  assert.equal(out.at(-1), `prov/model-${MAX_MODELS - 1}`);
});

test('parseModelsOutput of empty / garbage input is []', () => {
  assert.deepEqual(parseModelsOutput(''), []);
  assert.deepEqual(parseModelsOutput('\n\n  \n'), []);
});

test('parseModelsOutput accepts multi-segment ids such as openrouter/anthropic/x', () => {
  assert.deepEqual(parseModelsOutput('openrouter/anthropic/claude-sonnet-4.5\nopenai/gpt-5'), ['openrouter/anthropic/claude-sonnet-4.5', 'openai/gpt-5']);
});

const fakeResolve = { env: {}, platform: 'linux', isFile: async () => true } as never;

test('listOpencodeModels retries once, caches success and dedupes concurrent calls', async () => {
  clearModelsCache();
  let calls = 0;
  let t = 0;
  const run = async () => { calls++; return calls === 1 ? null : 'a/b\nc/d'; };
  const opts = { command: '/bin/opencode', resolveDeps: fakeResolve, env: {}, run, now: () => t };
  const [x, y] = await Promise.all([listOpencodeModels(opts), listOpencodeModels(opts)]);
  assert.deepEqual(x, ['a/b', 'c/d']);
  assert.deepEqual(y, x);
  assert.equal(calls, 2);
  assert.deepEqual(await listOpencodeModels(opts), x);
  assert.equal(calls, 2);
  t = MODELS_CACHE_MS + 1;
  await listOpencodeModels(opts);
  assert.equal(calls, 3);
});

test('listOpencodeModels falls back to the stale cache when a refresh fails', async () => {
  clearModelsCache();
  let t = 0;
  let ok = true;
  const run = async () => (ok ? 'a/b' : null);
  const opts = { command: '/bin/opencode', resolveDeps: fakeResolve, env: {}, run, now: () => t };
  assert.deepEqual(await listOpencodeModels(opts), ['a/b']);
  ok = false; t = MODELS_CACHE_MS + 1;
  assert.deepEqual(await listOpencodeModels(opts), ['a/b']);
});
