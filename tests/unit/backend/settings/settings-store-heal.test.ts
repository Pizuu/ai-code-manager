import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cliIdSlug, cliNameSlug, findCliRebindCandidate, newAgentCliId } from '../../../../src/backend/settings/settings-store.ts';

test('cliIdSlug 去掉结尾 6 位 hex 随机后缀', () => {
  assert.equal(cliIdSlug('opencode-dead00'), 'opencode');
  assert.equal(cliIdSlug('my-cli-a1b2c3'), 'my-cli');
  assert.equal(cliIdSlug('a-b1b2c3'), 'a');
});

test('cliIdSlug 无随机后缀时原样返回', () => {
  assert.equal(cliIdSlug('opencode'), 'opencode');
  // 7 位数字结尾不是「- + 恰 6 位 hex」的后缀形态，不剥
  assert.equal(cliIdSlug('cli-1234567'), 'cli-1234567');
  // 后缀含非 hex 字符，不剥
  assert.equal(cliIdSlug('opencode-zzzzzz'), 'opencode-zzzzzz');
});

test('cliNameSlug 与 newAgentCliId 的 slug 化口径一致', () => {
  assert.equal(cliNameSlug('opencode'), 'opencode');
  assert.equal(cliNameSlug('Open Code'), 'open-code');
  assert.equal(cliNameSlug('  Aider!! '), 'aider');
  assert.equal(cliNameSlug(''), 'cli');
  assert.equal(cliNameSlug('a'.repeat(30)), 'a'.repeat(24));
  assert.match(newAgentCliId('Open Code'), /^open-code-[0-9a-f]{6}$/);
  // newAgentCliId 生成的 id 经 cliIdSlug 应还原为 cliNameSlug
  assert.equal(cliIdSlug(newAgentCliId('My CLI')), cliNameSlug('My CLI'));
});

test('findCliRebindCandidate：同 slug 条目恰好一条时命中（按 id slug）', () => {
  const clis = [{ id: 'opencode-beef00', name: '别的名字' }];
  assert.equal(findCliRebindCandidate('opencode-dead00', clis), 'opencode-beef00');
});

test('findCliRebindCandidate：id slug 不同但条目名 slug 相同也命中', () => {
  const clis = [{ id: 'custom-tool-123abc', name: 'opencode' }];
  assert.equal(findCliRebindCandidate('opencode-dead00', clis), 'custom-tool-123abc');
});

test('findCliRebindCandidate：缺失 id 无随机后缀时按整体 slug 匹配', () => {
  const clis = [{ id: 'opencode-beef00', name: 'opencode' }];
  assert.equal(findCliRebindCandidate('opencode', clis), 'opencode-beef00');
});

test('findCliRebindCandidate：两条同名候选返回 null（不乱绑）', () => {
  const clis = [
    { id: 'opencode-beef00', name: 'opencode' },
    { id: 'opencode-cafe42', name: 'opencode' },
  ];
  assert.equal(findCliRebindCandidate('opencode-dead00', clis), null);
});

test('findCliRebindCandidate：无同名候选返回 null', () => {
  assert.equal(findCliRebindCandidate('opencode-dead00', [{ id: 'aider-aabbcc', name: 'aider' }]), null);
  assert.equal(findCliRebindCandidate('opencode-dead00', []), null);
});
