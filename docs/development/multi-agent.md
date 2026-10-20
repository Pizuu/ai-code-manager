# 多 Agent 并行开发全流程

> 快不快不在 agent 数量，而在开工前把**契约**和**文件所有权**定死，让每个 agent 改不同的文件，同时开工也不会撞车。

**使用的 Agent**：OpenAI Codex、Claude Code · **最大并行 worker 数**：4 · **集成分支**：`manus`

## 0. 角色分工

| 角色 | 由谁担任 | 负责 | 绝不做 |
|---|---|---|---|
| 负责人 Owner | 人类 | 定目标、验收里程碑、把 `manus` 合入 `main` | 写任务级代码 |
| 主控 Coordinator | 一个 agent（`docs/agents/coordinator.md`） | 写规格、定契约、拆任务卡、派发、分配审查、合入 `manus`、解决冲突 | 实现泳道功能 |
| 工人 Worker | 1–4 个 agent（`docs/agents/worker.md`） | 一张任务卡 → 一个分支 → 一个 PR，只在一个泳道内 | 改泳道外文件、改契约 |
| 审查 Reviewer | 另一个 agent / 人类 | 对照任务卡审 diff | 直接改作者代码 |

## Spec Kit 流程映射

本项目用 GitHub Spec Kit 管「想清楚再写」，用泳道管「并行不打架」。主线由 coordinator 在 `manus` 上运行：

| 阶段 | 命令 | 产出 | 谁 | 本项目的额外规则 |
|---|---|---|---|---|
| 0 | `$speckit-constitution` | `.specify/memory/constitution.md` | coordinator | 已预置泳道/契约/完成定义，只做增补 |
| 1 | `$speckit-specify` | `spec.md`（FR-xxx、SC-xxx） | coordinator | 只写 what/why |
| 2 ⛳ | `$speckit-clarify` | 回写 `spec.md` | 负责人回答 | 每次 ≤5 问 |
| 3 | `$speckit-plan` | `plan.md`、data-model、contracts | coordinator | 契约写入根 `contracts/` |
| 4 ⛳ | 冻结契约 | `contracts/` 合入 `manus` | 负责人（可默认批准） | 冻结后只许加字段 |
| 5 ⛳ | `$speckit-checklist` | `checklists/*.md` | 审查者勾选 | 实现不得自我批准 |
| 6 | `$speckit-tasks` | `tasks.md` | coordinator | 每个任务带 `[lane:x]` |
| 7 ⛳ | `$speckit-analyze` | 一致性报告（只读） | coordinator | 不干净就回源头修 |
| 8 | `docs/commands/split.md` | 任务卡 + `BOARD.md` | coordinator | 按泳道拆卡、标 ready |
| 9 | `$speckit-implement` `<任务号>` | 代码 + PR | worker（各自 worktree） | 只跑自己卡上的任务号 |
| 10 | `docs/commands/integrate.md` | 合入 `manus` | coordinator | 按序合入、勾选 tasks.md |
| 11 | `$speckit-converge` | 追加缺口任务 | coordinator | 有追加 → 回到第 8 步显式派工 |

- 一次性初始化：`scripts/speckit-init.sh`（`specify init --here --force` 会保留已有宪法）。
- 修 bug 不走全套：`/speckit.bug-*`（assess → fix → test，产物在 `.specify/bugs/<slug>/`）。

## 1. 开工前：先定「合同」（最重要）

1. 按上表跑 constitution → specify → clarify → plan；规格在 `specs/<NNN-功能>/spec.md`，需求编号 `FR-xxx`。
2. 为每个跨泳道边界写 `contracts/`，并附 mock 用的 fixtures；按 `contracts/README.md` 的冻结检查单逐项过。
3. 规格 + 契约**最先**合入 `manus`。在此之前任何 worker 不许开工。
4. 脚手架 + CI（lint、类型、测试、泳道检查）必须已在 `manus` 上全绿。

## 2. 泳道 = 文件所有权

| 泳道 | 负责角色 | 独占路径 | 说明 |
|---|---|---|---|
| `contracts` | coordinator | `contracts/*` `docs/SPEC.md` `docs/architecture/*` `specs/*` `.specify/memory/*` | 宪法、specs/（spec、plan、tasks）、接口契约、ADR —— 最先合入 |
| `frontend` | worker | `src/frontend/*` `tests/*/frontend/*` | 独占 `src/frontend/` 及其测试 |
| `backend` | worker | `src/backend/*` `tests/*/backend/*` | 独占 `src/backend/` 及其测试 |
| `docs` | worker | `docs/*` `README.md` `CHANGELOG.md`（不含契约 / coordinator 文档） | 用户与开发文档（SPEC、契约除外） |
| `infra` | coordinator | `.github/*` `scripts/*` `.agents/*` `.gitignore` `.editorconfig` `.vscode/*` `.specify/*` `.codex/*` `.claude/*`（不含契约 / coordinator 文档） | CI、脚本、泳道配置、Spec Kit 工具文件（.specify、各 agent 技能目录）——仅 coordinator 修改 |

- 泳道由机器强制：`.agents/lanes.conf` → `scripts/check-lane.sh` → `.github/workflows/lane-guard.yml`，越界的 PR 直接红。
- 共享热点文件（`AGENTS.md`、`LICENSE`、`package.json`、`package-lock.json`、`tsconfig.json`）不属于任何泳道。需要加依赖或改配置？找 coordinator，在 `int/*` 分支上改。
- 两个任务要改同一个文件 → 合并成一个任务，或改为串行。

## 3. 拆任务：一张卡一个 agent

- 一个任务 = 一个泳道 = 一个 PR，半天内能完成，可独立验收。
- 任务卡按泳道从 `tasks.md` 切出（`docs/commands/split.md`）：一张卡 = 同一泳道的一个或多个 `T0xx` 任务号，附 `FR-xxx`、依赖契约、验收测试、前置任务。
- 在 `docs/tasks/BOARD.md` 画依赖图：前置都已合入的卡是 **ready**，可以同时派发。

## 4. 分支策略

```text
main            ← 只有人类合入（随时可发布）
 └─ manus        ← 集成分支，coordinator 合入
     ├─ feat/frontend/<task>
     ├─ feat/backend/<task>
     ├─ feat/docs/<task>
     └─ int/<topic>   ← 仅 coordinator（共享文件、冲突修复）
```

> 集成分支名以 `.agents/config.sh` 的 `INTEGRATION_BRANCH` 为唯一权威（当前 `manus`）。
> `scripts/check-branch-config.sh` 会在 CI 中校验工作流与本文档是否与之一致。

- worker 分支命名：`feat/<泳道>/<任务号>-<简述>`——名字里的泳道就是泳道检查的依据。
- 本地多 agent 用 `git worktree`，每个 agent 一个独立目录：`scripts/agent-worktree.sh new <泳道> <任务号>-<简述>`。
- 云端 agent（Codex 云端、Copilot coding agent、Cursor 后台 agent）从 `manus` 按同样命名开分支并自己提 PR。

## 5. 派发与并行执行

1. coordinator 挑最多 4 张 **ready** 卡，且来自不同泳道（同一泳道同一时间只派一张）。
2. 把填好的 `docs/commands/dispatch.md` 粘贴给每个 agent。
3. worker：建 worktree → `export SPECIFY_FEATURE_DIRECTORY=specs/<NNN-功能> SPECIFY_FEATURE_NO_PERSIST=1` → 用 `$speckit-implement` 只跑卡上的任务号，缺的依赖用 `contracts/fixtures/` 的 mock → `git checkout -- specs/`（不提交 tasks.md 勾选）→ `scripts/verify.sh` 与 `scripts/check-lane.sh` 全绿 → 推送 → 向 `manus` 提 PR。
4. 同一个错误卡住超过两次 → 停下，把尝试过的方案写进 PR/issue，标 `status:blocked`，交给 coordinator。

## 6. 集成与审查

- CI 全绿（lint、类型、测试、安全、**lane-guard**）才开始审。
- 由另一个 agent（不同工具或全新会话，绝不是作者本人）按 `docs/agents/reviewer.md` 交叉审查，coordinator 合入。
- 合入顺序：`contracts` → 底层（shared / backend）→ 上层（frontend / apps）→ docs。每合入一个，其余在途分支 rebase：`scripts/agent-worktree.sh sync <路径>`。
- 冲突由 coordinator 在 `int/*` 分支上解决，绝不让两个 worker 互改对方分支。
- 一批合入后：在 `tasks.md` 勾选已合入的任务号，再运行 `$speckit-converge`；追加出来的任务变成新卡，显式派工，不「顺手」修。
- 一批合入后在 `manus` 上跑全量 / 端到端测试；稳定后由负责人把 `manus` 合入 `main`。

## 7. 节奏（一轮约半天）

1. 负责人提需求 → coordinator 跑 specify / clarify / plan / tasks / analyze，冻结契约，按泳道拆卡（`docs/commands/split.md`）。
2. 并行派发 ready 卡 → 各自提 PR。
3. CI + 审查 → 合入 `manus`（`docs/commands/integrate.md`）→ converge 收敛 → 演示给负责人。
4. 负责人验收、提新需求 → 下一轮。

## 8. 常见坑

- 没定契约就开工 → 合并时大量返工。
- 任务太大 → PR 难审、冲突不断。
- 共享文件多人同改 → 指定唯一负责人（已在 lanes.conf 的 `@shared` 中落实）。
- 没有测试 → agent「写完了」但跑不起来；验收测试是任务卡的一部分。
- agent 比你审得过来的多 → 吞吐反而下降，保持 ≤ 4 个。

## 9. 升级路径

- worker 之间意见不一 → coordinator 在契约范围内裁决。
- 契约争议或范围变化 → 负责人拍板；拍板前冻结受影响的任务卡。
