/** 构造一个「多 Agent 泳道」风格的临时仓库：main / hark-dev / 合入后删除的分支 / 未合入分支 / 声明冲突。 */
import { tempProject } from '../helpers/temp-project.ts';
import { gitIn, writeFiles } from '../helpers/temp-repo.ts';

const card = (id: string, lane: string, branch: string, deps: string, status: string) => `# ${id} 任务 ${id}

| 字段 | 值 |
|---|---|
| 泳道 | ${lane} |
| 对应需求 | FR-001 |
| 包含任务号 | T001 |
| 分支 | \`${branch}\` |
| PR 目标 | \`hark-dev\` |
| 前置任务 | ${deps} |
| 状态 | ${status} |
| 执行者 | codex |

## 目标

做 ${id}。

## 验收标准

- [x] 通过
`;

export async function laneRepo(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await tempProject(t, {
    '.agents/lanes.conf': 'contracts contracts/* specs/*\nbackend src/backend/* tests/*/backend/*\nfrontend src/frontend/*\n@shared package.json AGENTS.md\n',
    '.agents/config.sh': 'MAIN_BRANCH="main"\nINTEGRATION_BRANCH="hark-dev"\nMAX_PARALLEL=4\nBRANCH_PREFIX="feat"\n',
    'docs/tasks/T-001.md': card('T-001', 'contracts', 'feat/contracts/T-001-spec', '无', 'done'),
    'docs/tasks/T-002.md': card('T-002', 'backend', 'feat/backend/T-002-core', 'T-001', 'done'),
    'docs/tasks/T-003.md': card('T-003', 'frontend', 'feat/frontend/T-003-ui', 'T-002', 'ready'),
    'docs/tasks/T-004.md': card('T-004', 'frontend', 'feat/frontend/T-004-more', 'T-001', 'ready'),
    'docs/tasks/BOARD.md': '| 编号 | 标题 | 泳道 | 前置 | 状态 | 执行者 | PR |\n|---|---|---|---|---|---|---|\n| T-001 | 任务 | contracts | 无 | done | codex | — |\n| T-002 | 任务 | backend | T-001 | done | codex | — |\n',
    'specs/001-demo/spec.md': '# Feature Specification: 演示功能\n\n**Status**: Draft\n\n- **FR-001**: x\n',
    'specs/001-demo/tasks.md': '## Phase 1: Setup\n\n- [x] T001 [lane:contracts] a\n- [ ] T002 [lane:backend] b\n',
    'README.md': '# demo\n',
  });
  const git = gitIn(root);
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  git('checkout', '-q', '-b', 'hark-dev');
  // T-001：合入后删除分支
  git('checkout', '-q', '-b', 'feat/contracts/T-001-spec');
  await writeFiles(root, { 'contracts/api.ts': 'export {};\n' });
  git('add', '-A');
  git('commit', '-q', '-m', 'contracts');
  git('checkout', '-q', 'hark-dev');
  git('merge', '--no-ff', '-q', '-m', 'merge: feat/contracts/T-001-spec', 'feat/contracts/T-001-spec');
  git('branch', '-d', 'feat/contracts/T-001-spec');
  // T-002：分支存在、领先 2、且有一个越界文件；声明 done（冲突）
  git('checkout', '-q', '-b', 'feat/backend/T-002-core');
  await writeFiles(root, { 'src/backend/a.ts': 'a\n' });
  git('add', '-A');
  git('commit', '-q', '-m', 'backend a');
  await writeFiles(root, { 'src/frontend/oops.ts': 'x\n' });
  git('add', '-A');
  git('commit', '-q', '-m', 'oops');
  git('checkout', '-q', 'hark-dev');
  return { root, git };
}
