/**
 * git 引用变化监听（P1-8）：轮询项目仓库的 refs 摘要，变化时通知渲染进程重拉看板 / Git 快照。
 *
 * 为什么轮询而不是 fs.watch：
 * - git 的 refs 可能落在 packed-refs 里，也可能被 worktree 分散存放，watch 目录不可靠；
 * - 轮询只跑一条只读 git 命令（`for-each-ref` + `symbolic-ref HEAD`），代价可控。
 *
 * 只读；不修改仓库任何内容。
 */
import { gitOut, type GitRunner } from '../workspace/git.ts';

/** 轮询间隔（毫秒）。 */
export const REFS_POLL_INTERVAL_MS = 4000;

/** refs 摘要：分支名 + 提交 + 当前 HEAD。 */
export async function refsDigest(git: GitRunner): Promise<string> {
  const refs = await gitOut(git, ['for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/heads', 'refs/remotes']);
  const head = (await gitOut(git, ['symbolic-ref', '-q', 'HEAD'])).trim();
  return `${head}\n${refs}`;
}

/**
 * 启动监听。返回停止函数（进程退出 / 项目切换时调用）。
 * @param getRoot 当前项目根；返回 null 表示没有项目，暂停轮询。
 * @param onChanged 引用变化时回调（仅在摘要真正变化时触发一次）。
 */
export function watchRefs(
  gitFor: (root: string) => GitRunner,
  getRoot: () => string | null,
  onChanged: () => void,
  intervalMs = REFS_POLL_INTERVAL_MS,
): () => void {
  let last: string | null = null;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const tick = async () => {
    if (stopped) return;
    const root = getRoot();
    if (root) {
      const digest = await refsDigest(gitFor(root));
      // 首次只记录基线，不把「刚打开项目」当成一次变化
      if (last !== null && digest !== last) onChanged();
      last = digest;
    } else {
      last = null;
    }
    if (!stopped) timer = setTimeout(() => void tick(), intervalMs);
  };

  timer = setTimeout(() => void tick(), intervalMs);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
  };
}
