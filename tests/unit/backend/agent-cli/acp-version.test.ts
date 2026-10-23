/**
 * ACP 版本门禁纯函数（照 orca 的门禁）：1.x 线稳定版 ≥ 1.18.31、2.x 线稳定版 ≥ 2.0.14；
 * 预发布版 / 其它主线 / 探不到一律不通过。确定性纯函数，无进程、无时间依赖。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acpVersionSupported, parseAcpVersion } from '../../../../src/backend/agent-cli/acp-runner.ts';

test('acpVersionSupported: 1.x 线以 1.18.31 为界', () => {
  assert.equal(acpVersionSupported('1.18.30'), false);
  assert.equal(acpVersionSupported('1.18.31'), true);
  assert.equal(acpVersionSupported('1.18.32'), true);
  assert.equal(acpVersionSupported('1.19.0'), true);
  assert.equal(acpVersionSupported('1.19.3'), true);
  assert.equal(acpVersionSupported('1.17.99'), false);
  assert.equal(acpVersionSupported('1.0.0'), false);
});

test('acpVersionSupported: 2.x 线以 2.0.14 为界', () => {
  assert.equal(acpVersionSupported('2.0.13'), false);
  assert.equal(acpVersionSupported('2.0.14'), true);
  assert.equal(acpVersionSupported('2.0.15'), true);
  assert.equal(acpVersionSupported('2.1.0'), true);
});

test('acpVersionSupported: 预发布版一律拒绝（即使数字达标）', () => {
  assert.equal(acpVersionSupported('1.19.0-beta.1'), false);
  assert.equal(acpVersionSupported('1.18.31-rc.1'), false);
  assert.equal(acpVersionSupported('2.0.14-alpha'), false);
});

test('acpVersionSupported: 其它主线 / 解析失败 / 探不到一律拒绝', () => {
  assert.equal(acpVersionSupported('3.0.0'), false);
  assert.equal(acpVersionSupported('0.9.9'), false);
  assert.equal(acpVersionSupported(''), false);
  assert.equal(acpVersionSupported('not-a-version'), false);
  assert.equal(acpVersionSupported(null), false);
  assert.equal(acpVersionSupported(undefined), false);
});

test('parseAcpVersion: 从 --version 输出首行提取三元组与预发布标记', () => {
  assert.deepEqual(parseAcpVersion('1.19.3'), { major: 1, minor: 19, patch: 3, prerelease: false, text: '1.19.3' });
  assert.deepEqual(parseAcpVersion('opencode 2.0.14'), { major: 2, minor: 0, patch: 14, prerelease: false, text: '2.0.14' });
  assert.equal(parseAcpVersion('1.19.0-beta.1')?.prerelease, true);
  assert.equal(parseAcpVersion('garbage'), null);
  assert.equal(parseAcpVersion(null), null);
  // 带前缀文案的真实输出同样可解析并通过门禁
  assert.equal(acpVersionSupported('opencode 1.19.3'), true);
});
