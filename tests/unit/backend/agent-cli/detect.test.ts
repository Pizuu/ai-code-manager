import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectInstalledClis, POPULAR_CLIS, type DetectDeps } from '../../../../src/backend/agent-cli/detect.ts';
import type { ResolveDeps } from '../../../../src/backend/agent-cli/resolve.ts';

/** 假依赖：PATH 固定 /usr/bin，installed 是存在的命令名集合；versions 按命令名给版本，throwFor 让指定命令的版本探测抛错。 */
function fakeDeps(installed: string[], versions: Record<string, string | null> = {}, throwFor?: string): DetectDeps {
  const files = new Set(installed.map((c) => `/usr/bin/${c}`));
  const resolveDeps: ResolveDeps = {
    platform: 'linux',
    pathEnv: '/usr/bin',
    pathExt: '.COM;.EXE;.BAT;.CMD',
    isFile: async (p) => files.has(p),
    readText: async () => null,
  };
  return {
    resolveDeps,
    probeVersion: async (file) => {
      const cmd = file.split('/').at(-1) ?? '';
      if (cmd === throwFor) throw new Error('probe boom');
      return versions[cmd] ?? null;
    },
  };
}

test('候选清单为 20 个且命令名不重复', () => {
  assert.equal(POPULAR_CLIS.length, 20);
  assert.equal(new Set(POPULAR_CLIS.map((c) => c.command)).size, 20);
});

test('只返回解析成功的候选，且顺序与候选清单一致', async () => {
  // 故意乱序给 installed：结果必须按 POPULAR_CLIS 顺序（claude < codex < aider）
  const found = await detectInstalledClis(fakeDeps(['aider', 'codex', 'claude'], { claude: '1.2.3', codex: '0.9.0', aider: '0.80.0' }));
  assert.deepEqual(found, [
    { name: 'Claude Code', command: 'claude', resolvedPath: '/usr/bin/claude', version: '1.2.3' },
    { name: 'OpenAI Codex', command: 'codex', resolvedPath: '/usr/bin/codex', version: '0.9.0' },
    { name: 'Aider', command: 'aider', resolvedPath: '/usr/bin/aider', version: '0.80.0' },
  ]);
});

test('版本探测抛错时该条 version 为 null 且不中断后续候选', async () => {
  const found = await detectInstalledClis(fakeDeps(['claude', 'gemini', 'qwen'], { gemini: '2.0.0', qwen: '3.1.0' }, 'claude'));
  assert.equal(found.length, 3);
  assert.deepEqual(found[0], { name: 'Claude Code', command: 'claude', resolvedPath: '/usr/bin/claude', version: null });
  assert.equal(found[1]?.version, '2.0.0');
  assert.equal(found[2]?.version, '3.1.0');
});

test('版本探测返回 null 时 version 为 null', async () => {
  const found = await detectInstalledClis(fakeDeps(['goose'], {}));
  assert.deepEqual(found, [{ name: 'Goose', command: 'goose', resolvedPath: '/usr/bin/goose', version: null }]);
});

test('一个都没装时返回空数组', async () => {
  assert.deepEqual(await detectInstalledClis(fakeDeps([])), []);
});
