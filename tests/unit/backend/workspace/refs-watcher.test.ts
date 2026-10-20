import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refsDigest, watchRefs } from '../../../../src/backend/workspace/refs-watcher.ts';
import type { GitRunner } from '../../../../src/backend/workspace/git.ts';

/** 假的 git 运行器：按参数返回预设输出（stdout 可为函数，以便随状态变化）。 */
const fakeGit = (out: Record<string, string | (() => string)>): GitRunner => async (args) => {
  const key = args.join(' ');
  const raw = out[key] ?? '';
  const stdout = typeof raw === 'function' ? raw() : raw;
  return { ok: true, stdout, stderr: '', code: 0 };
};

test('refsDigest includes the current HEAD and every branch ref', async () => {
  const git = fakeGit({
    'symbolic-ref -q HEAD': 'refs/heads/manus\n',
    'for-each-ref --format=%(refname:short) %(objectname) refs/heads refs/remotes': 'manus abc123\norigin/manus abc123\n',
  });
  const d = await refsDigest(git);
  assert.match(d, /refs\/heads\/manus/);
  assert.match(d, /manus abc123/);
});

test('watchRefs reports a change only when the digest actually changes', async () => {
  let current = 'a';
  const git = fakeGit({
    'symbolic-ref -q HEAD': 'refs/heads/main\n',
    'for-each-ref --format=%(refname:short) %(objectname) refs/heads refs/remotes': () => `${current}\n`,
  });
  let changes = 0;
  const stop = watchRefs(() => git, () => '/repo', () => { changes++; }, 5);
  try {
    await new Promise((r) => setTimeout(r, 40));
    const baseline = changes;
    assert.equal(baseline, 0, '首次只建立基线，不应算作一次变化');
    // 摘要不变 → 不再触发
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(changes, 0, '摘要未变时不应重复触发');
    // 摘要变化 → 触发
    current = 'b';
    await new Promise((r) => setTimeout(r, 40));
    assert.ok(changes > 0, '摘要变化时应触发');
  } finally {
    stop();
  }
  const after = changes;
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(changes, after, '停止后不应再触发');
});
