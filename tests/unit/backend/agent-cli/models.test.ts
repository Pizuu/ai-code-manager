/**
 * agentCli:models 的输出解析（纯函数）：逐行 provider/model 形态、去重保序、上限 200。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseModelsOutput, MAX_MODELS } from '../../../../src/backend/agent-cli/models.ts';

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
