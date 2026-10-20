---

description: "Task list for 002-workspace-boards"
---

# Tasks: 三板块工作台与 Agent CLI（opencode）

**Input**: Design documents from `/specs/002-workspace-boards/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: SC-102/SC-103/SC-105 要求自动化验证；宪法 五要求逻辑改动必须有测试。纯视图（shell/board/git/session 视图 DOM）由仓库外的无头截图冒烟覆盖，在任务卡注明。

## Format: `[ID] [P?] [Story] [lane:x] Description`

- 任务号使用 T1xx，避免与 001 的 T0xx 混淆；泳道标签同 001 约定（`[lane:@shared]` = coordinator 文件）。

## Phase 1: Setup（契约与拆卡）

- [x] T101 [lane:contracts] Spec Kit 制品 specs/002-workspace-boards/（spec、plan、research、data-model、quickstart、checklists、tasks、analysis、contracts/README.md）
- [x] T102 [lane:contracts] 契约 v1.1 增量 contracts/ipc.ts、fixtures（board/git 样例、opencode 1.19.3 真实 JSONL）、contracts/README.md、docs/SPEC.md 登记
- [x] T103 [lane:contracts] ADR 0005（HTML 原型 1:1 移植）、ADR 0006（opencode 集成与权限映射）于 docs/architecture/decisions/，更新 docs/architecture/overview.md
- [x] T104 [lane:@shared] 任务卡 docs/tasks/T-013.md … T-019.md 与 docs/tasks/BOARD.md

## Phase 2: Foundational（主进程读取基础）

- [x] T105 [lane:backend] git CLI 运行器 src/backend/workspace/git.ts（execFile 数组参数、--no-optional-locks、超时、maxBuffer）
- [x] T106 [lane:backend] lanes.conf / config.sh 解析与 check-lane 同语义的 bash glob 判定 src/backend/workspace/lanes.ts，单测 tests/unit/backend/workspace/lanes.test.ts

## Phase 3: User Story 2 — 泳道看板（P1）

- [x] T107 [US2] [lane:backend] 任务卡 / BOARD.md / spec.md / tasks.md 解析（纯函数）src/backend/workspace/cards.ts，单测 tests/unit/backend/workspace/cards.test.ts
- [x] T108 [US2] [lane:backend] 看板快照（git 推导状态、声明冲突）src/backend/workspace/board.ts，集成测试 tests/integration/backend/workspace/board.test.ts（临时仓库：合入后删除分支、阻塞、声明冲突、无 lanes.conf）

## Phase 4: User Story 3 — Git 分支与集成（P2）

- [x] T109 [US3] [lane:backend] Git 快照 src/backend/workspace/git-overview.ts，集成测试 tests/integration/backend/workspace/git-overview.test.ts（ahead/behind、已删除分支的合并记录、worktree、非仓库）

## Phase 5: User Story 4/5 — Agent CLI（P1）

- [x] T110 [US4] [lane:backend] 设置存储 agentClis / defaultAgent 与敏感 env 加密 src/backend/settings/settings-store.ts、预设 src/backend/agent-cli/presets.ts，集成测试 tests/integration/backend/settings/agent-cli-settings.test.ts
- [x] T111 [P] [US4] [lane:backend] 参数模板展开与权限映射 src/backend/agent-cli/invocation.ts，单测 tests/unit/backend/agent-cli/invocation.test.ts
- [x] T112 [P] [US4] [lane:backend] 可执行文件解析（PATH/PATHEXT、npm opencode.cmd → opencode.exe）src/backend/agent-cli/resolve.ts，单测 tests/unit/backend/agent-cli/resolve.test.ts
- [x] T113 [P] [US4] [lane:backend] opencode JSONL 事件解析 src/backend/agent-cli/opencode-events.ts，单测（对照 contracts/fixtures/opencode-*.jsonl）tests/unit/backend/agent-cli/opencode-events.test.ts
- [x] T114 [US4] [lane:backend] CLI 一轮运行器（spawn、流式映射、续接、停止、错误与安装指引、持久化）src/backend/agent-cli/cli-runner.ts，集成测试（假 opencode 可执行文件）tests/integration/backend/agent-cli/cli-runner.test.ts
- [x] T115 [US4] [US5] [lane:backend] 接线：src/backend/ipc/handlers.ts、src/backend/ipc/validate.ts、src/backend/preload.cts、src/backend/sessions/session-store.ts（agent 字段），集成测试 tests/integration/backend/ipc/handlers-v11.test.ts（新通道、setAgent、Key/敏感值不外泄 SC-105）

## Phase 6: User Story 1 — 外框与三板块视图（P1）

- [x] T116 [US1] [lane:frontend] 原型 CSS 整体移植 src/frontend/styles.css、SVG 图标 src/frontend/lib/icons.ts、外框与路由 src/frontend/views/shell.ts、src/frontend/index.html、src/frontend/main.ts、src/frontend/store.ts
- [x] T117 [US2] [lane:frontend] 看板视图 src/frontend/views/board-view.ts 与卡片文案 src/frontend/lib/board-format.ts，单测 tests/unit/frontend/lib/board-format.test.ts
- [x] T118 [US3] [lane:frontend] Git 视图 src/frontend/views/git-view.ts 与分支图布局 src/frontend/lib/git-graph.ts，单测 tests/unit/frontend/lib/git-graph.test.ts
- [x] T119 [US4] [US5] [lane:frontend] 任务会话视图（会话列表 / 对话 / 上下文）src/frontend/views/session-view.ts、src/frontend/views/chat.ts、src/frontend/views/tool-card.ts、src/frontend/views/context-panel.ts，agent 选择器
- [x] T120 [US4] [lane:frontend] 设置「Agent CLI」分区 src/frontend/views/settings-dialog.ts、src/frontend/views/agent-cli-settings.ts 与表单转换 src/frontend/lib/agent-cli-form.ts，单测 tests/unit/frontend/lib/agent-cli-form.test.ts

## Phase 7: Polish

- [x] T121 [lane:docs] README（三板块、Agent CLI/opencode 使用与安装）、CHANGELOG 0.2.0、docs/testing/test-matrix.md、docs/security/threat-model.md 与 security-checklist.md
- [x] T122 [lane:@shared] 收尾：ROADMAP.md、docs/tasks/BOARD.md 与卡片 flow-back

## Phase 8: Convergence

> `$speckit-converge`（2026-10-20，hark-dev @ T-018 合入后）：对照 spec FR/SC 与实际实现，以下缺口无法在本轮沙箱内闭合，转为新任务（需显式派工，不「顺手」修）。

- [ ] T123 [lane:frontend] 在 T040 的 Electron E2E 中覆盖三板块导航、看板卡片 → 任务会话、Git 图渲染与 opencode（假可执行文件）对话路径，置于 tests/e2e/frontend/ per FR-101, FR-109, FR-112 (partial：现仅仓库外截图冒烟)
- [ ] T124 [lane:infra] 在 Windows x64 runner 上用真实 `npm install -g opencode-ai` 验证 `opencode.cmd` → `opencode.exe` 解析、PowerShell 路径含空格/中文、`taskkill /T /F` 停止，加入 windows-latest CI 作业 per FR-112, FR-113, SC-103 (partial：Windows 分支仅以模拟文件系统单测)
- [x] T125 [lane:backend] 评估以 `opencode serve` + 权限事件实现逐条工具审批，替代「每轮批准」，落 ADR 修订 per FR-116、宪法 九 (missing：ADR 0006 已接受风险，目标 v0.3.0)

> 增量（2026-10-20，T-022 评估结论 → ADR 0006 修订）：接入 `opencode serve` 逐条审批，契约先行。

- [x] T126 [lane:contracts] 契约 v1.3：`ApprovalKind` 新增 `webfetch` / `loop` / `subagent` / `external-dir` / `other`，`ApprovalRequest` 新增可选 `url`、`tool`、`permission`、`patterns`、`description`，样例 contracts/fixtures/agent-events.sample.json（`ap-2`…`ap-6`）per FR-116、宪法 九（任务卡 T-033）
- [x] T127 [lane:backend] 以实验设置 `agentCli.opencodeMode = 'run' | 'serve'`（默认 `run`）接入 src/backend/agent-cli/opencode-serve.ts：`permission.asked` 映射 `edit`→edit、`bash`→command、`webfetch`→webfetch（`url`）、`doom_loop`→loop（`tool`）、`task`→subagent（`description`）、`external_directory`→external-dir（规则集默认 deny）、其余→other（`permission` + `patterns`），均附原始 `permission`；接线 src/backend/ipc/handlers.ts / validate.ts / settings-store.ts，集成测试覆盖两种模式与停止即拒绝 per FR-116、宪法 九、宪法 十一（依赖 T126；设置字段若需进 `PublicSettings` 须另开 contracts 增量）
- [x] T128 [lane:frontend] 任务会话视图为新审批种类渲染审批卡片 src/frontend/views/tool-card.ts（webfetch 显示 URL、loop 显示工具与说明、subagent 显示子任务说明、external-dir 醒目警示路径、other 及未知种类显示 `permission` + `patterns`，绝不默认批准），单测 tests/unit/frontend/ per 宪法 九（依赖 T126，可与 T127 并行，对照 agent-events 样例开发）

## Dependencies & Execution Order

- T101–T103 → T104 → backend（T105→T106→T107→T108→T109→T110→T111/T112/T113→T114→T115）与 frontend（T116→T117→T118→T119→T120）→ T121 → T122
- 合入顺序：contracts → @shared → backend → frontend → docs → @shared 收尾
- 契约合入后 `hark-dev` 在后端接线（T115）合入前 typecheck 不通过（编译期穷举检查，见 plan.md Complexity Tracking），因此 T-013 与 T-015 连续合入

## Parallel Example

```text
worker A (backend):  T105 … T115（卡 T-015）
worker B (frontend): T116 T117 T118（卡 T-016，对照 contracts/fixtures/{board,git}.sample.json 开发）
```
