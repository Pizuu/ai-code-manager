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

import path from 'node:path';
import { parseJsonc, readOpencodeDefaultModel } from '../../../../src/backend/agent-cli/models.ts';

test('parseJsonc strips comments and trailing commas but keeps strings intact', () => {
  assert.deepEqual(parseJsonc('{\n // c\n "model": "a/b", /* x */ "u": "http://x//y",\n}'), { model: 'a/b', u: 'http://x//y' });
  assert.equal(parseJsonc('{bad'), null);
});

test('readOpencodeDefaultModel follows opencode config precedence', async () => {
  const home = '/h';
  const files: Record<string, string> = {
    [path.join(home, '.config', 'opencode', 'opencode.json')]: '{"model":"global/g"}',
    [path.join('/proj', 'opencode.jsonc')]: '{ // project\n "model": "proj/p", }',
  };
  const read = async (f: string) => { if (f in files) return files[f]!; throw new Error('ENOENT'); };
  assert.equal(await readOpencodeDefaultModel({ env: {}, cwd: '/proj', home, read }), 'proj/p');
  assert.equal(await readOpencodeDefaultModel({ env: {}, home, read }), 'global/g');
  assert.equal(await readOpencodeDefaultModel({ env: { OPENCODE_CONFIG_CONTENT: '{"model":"env/e"}' }, cwd: '/proj', home, read }), 'env/e');
});

test('readOpencodeDefaultModel falls back to the most recent TUI model, else undefined', async () => {
  const home = '/h';
  const state = path.join(home, '.local', 'state', 'opencode', 'model.json');
  const read = async (f: string) => { if (f === state) return '{"recent":[{"providerID":"anthropic","modelID":"claude-sonnet-4-5"}]}'; throw new Error('ENOENT'); };
  assert.equal(await readOpencodeDefaultModel({ env: {}, home, read }), 'anthropic/claude-sonnet-4-5');
  assert.equal(await readOpencodeDefaultModel({ env: {}, home, read: async () => { throw new Error('ENOENT'); } }), undefined);
});
