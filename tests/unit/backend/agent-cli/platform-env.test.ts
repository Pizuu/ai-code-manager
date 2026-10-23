/**
 * opencode 启动环境适配（platform-env.ts）：question 统一禁用 + Windows shell 系统判断。
 * 全部用注入的 exists 假探测，不读真实文件系统、不依赖宿主平台。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findGitBash, gitBashCandidates, opencodeLaunchEnv, opencodePlatformEnv } from '../../../../src/backend/agent-cli/platform-env.ts';

const none = () => false;
const only = (...hits: string[]) => (p: string) => hits.includes(p);

const WIN_ENV: NodeJS.ProcessEnv = {
  ProgramFiles: 'C:\\Program Files',
  'ProgramFiles(x86)': 'C:\\Program Files (x86)',
  LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
  PATH: 'C:\\Windows\\System32;C:\\Tools',
};
const GIT_BASH_PF = 'C:\\Program Files\\Git\\bin\\bash.exe';

test('non-win32: no shell adaptation; launch env only disables question', () => {
  assert.deepEqual(opencodePlatformEnv('linux', WIN_ENV, none), {});
  assert.deepEqual(opencodePlatformEnv('darwin', {}, none), {});
  assert.deepEqual(opencodeLaunchEnv('linux', {}, none), { OPENCODE_ENABLE_QUESTION_TOOL: 'false' });
});

test('win32: user-provided OPENCODE_GIT_BASH_PATH is respected, nothing injected', () => {
  const env = { ...WIN_ENV, OPENCODE_GIT_BASH_PATH: 'D:\\git\\bash.exe' };
  assert.deepEqual(opencodePlatformEnv('win32', env, none), {});
});

test('win32: Git Bash found in Program Files → OPENCODE_GIT_BASH_PATH injected', () => {
  assert.deepEqual(opencodePlatformEnv('win32', WIN_ENV, only(GIT_BASH_PF)), { OPENCODE_GIT_BASH_PATH: GIT_BASH_PF });
  assert.equal(findGitBash(WIN_ENV, only(GIT_BASH_PF)), GIT_BASH_PF);
});

test('win32: Git Bash found on PATH → injected', () => {
  const onPath = 'C:\\Tools\\bash.exe';
  assert.deepEqual(opencodePlatformEnv('win32', WIN_ENV, only(onPath)), { OPENCODE_GIT_BASH_PATH: onPath });
});

test('win32: no Git Bash → fall back to PowerShell via OPENCODE_CONFIG_CONTENT shell', () => {
  const out = opencodePlatformEnv('win32', WIN_ENV, none);
  assert.deepEqual(JSON.parse(out.OPENCODE_CONFIG_CONTENT ?? '{}'), { shell: 'powershell.exe' });
  // launch env carries both fixes
  const launch = opencodeLaunchEnv('win32', WIN_ENV, none);
  assert.equal(launch.OPENCODE_ENABLE_QUESTION_TOOL, 'false');
  assert.deepEqual(JSON.parse(launch.OPENCODE_CONFIG_CONTENT ?? '{}'), { shell: 'powershell.exe' });
});

test('win32: existing OPENCODE_CONFIG_CONTENT is merged, not clobbered; existing shell wins', () => {
  const merged = opencodePlatformEnv('win32', { ...WIN_ENV, OPENCODE_CONFIG_CONTENT: '{"model":"x/y"}' }, none);
  assert.deepEqual(JSON.parse(merged.OPENCODE_CONFIG_CONTENT ?? '{}'), { model: 'x/y', shell: 'powershell.exe' });
  assert.deepEqual(opencodePlatformEnv('win32', { ...WIN_ENV, OPENCODE_CONFIG_CONTENT: '{"shell":"pwsh"}' }, none), {});
  assert.deepEqual(opencodePlatformEnv('win32', { ...WIN_ENV, OPENCODE_CONFIG_CONTENT: 'not json' }, none), {});
});

test('candidates cover install dirs before PATH', () => {
  const c = gitBashCandidates(WIN_ENV);
  assert.equal(c[0], GIT_BASH_PF);
  assert.ok(c.includes('C:\\Users\\me\\AppData\\Local\\Programs\\Git\\bin\\bash.exe'));
  assert.ok(c.includes('C:\\Tools\\bash.exe'));
});
