---

description: "Task list for 001-agent-desktop"
---

# Tasks: 桌面 AI 编程 Agent（MVP）

**Input**: Design documents from `/specs/001-agent-desktop/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: spec 的 SC-002/SC-003/SC-005 要求自动化验证，且宪法 五要求逻辑改动必须有测试，因此每个逻辑任务都包含测试；测试路径按 `docs/testing/strategy.md` 镜像源码。

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] [lane:x] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- **[lane:x]**: 宪法 四要求的泳道标签，取值来自 `.agents/lanes.conf`：`contracts` / `frontend` / `backend` / `docs` / `infra`；`[lane:@shared]` 表示不属于任何 worker 泳道的文件（lanes.conf 的 `@shared` 共享热点文件，以及未列入任何泳道的 coordinator 文件如 `docs/tasks/`、`ROADMAP.md`），只能由 coordinator 在 `int/*` 分支修改
- Include exact file paths in descriptions

## Path Conventions

- 分层布局：主进程 `src/backend/`，渲染进程 `src/frontend/`，契约 `contracts/`
- 测试镜像：`src/backend/x/y.ts` → `tests/unit/backend/x/y.test.ts`（边界测试放 `tests/integration/backend/x/`）

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 宪法、规格、契约、工具链——任何实现之前合入 `dev`

- [x] T001 [lane:contracts] 宪法增补产品原则 九–十四并升至 v1.1.0 于 .specify/memory/constitution.md
- [x] T002 [lane:contracts] 规格制品 specs/001-agent-desktop/（spec.md + Clarifications、plan.md、research.md、data-model.md、quickstart.md、checklists/、contracts/README.md 链接）与 docs/SPEC.md 索引
- [x] T003 [lane:contracts] IPC 契约 v1（invoke 通道、agent:event 事件、RendererApi、错误码）于 contracts/ipc.ts
- [x] T004 [P] [lane:contracts] 工具契约 v1（7 个工具 JSON Schema、输入类型、TOOL_LIMITS）于 contracts/tools.ts
- [x] T005 [P] [lane:contracts] 契约样例 contracts/fixtures/（session、agent-events、OpenAI/Anthropic SSE 流、tasks.md）并更新 contracts/README.md 登记表
- [x] T006 [lane:contracts] 架构概览 docs/architecture/overview.md 与 ADR 0001–0004 于 docs/architecture/decisions/
- [x] T007 [lane:@shared] 工具链：package.json（scripts build/start/test/dist、devDependencies、electron-builder `build` 字段、engines）、tsconfig.json、eslint.config.mjs、package-lock.json，并在 AGENTS.md 写入真实命令
- [x] T008 [lane:infra] .agents/lanes.conf 把 eslint.config.mjs 纳入 @shared；.github/workflows/ci.yml 改用 Node 22 并增加 build 步骤
- [x] T009 [lane:@shared] 按泳道拆卡：docs/tasks/T-001…T-006.md 与 docs/tasks/BOARD.md（docs/commands/split.md）

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 所有用户故事依赖的安全基座与应用骨架

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T010 [P] [lane:backend] 项目根路径沙箱（词法 + realpath，posix/win32）src/backend/tools/sandbox.ts，测试 tests/unit/backend/tools/sandbox.test.ts
- [x] T011 [P] [lane:backend] 行级 LCS 统一 diff src/backend/tools/diff.ts，测试 tests/unit/backend/tools/diff.test.ts
- [x] T012 [P] [lane:backend] 权限模式决策 src/backend/tools/permissions.ts，测试 tests/unit/backend/tools/permissions.test.ts
- [x] T013 [P] [lane:backend] IPC 运行时参数校验 src/backend/ipc/validate.ts，测试 tests/unit/backend/ipc/validate.test.ts
- [x] T014 [lane:backend] 设置存储 + safeStorage 加密 Key（可注入加密器）src/backend/settings/settings-store.ts，测试 tests/integration/backend/settings/settings-store.test.ts
- [x] T015 [lane:backend] 应用入口与安全窗口 src/backend/main.ts、沙箱 preload src/backend/preload.cts、src/backend/app-state.ts、src/backend/ipc/handlers.ts
- [x] T016 [lane:frontend] 界面骨架：src/frontend/index.html（CSP）、src/frontend/styles.css（明暗主题）、src/frontend/main.ts、src/frontend/api.ts、src/frontend/store.ts、src/frontend/lib/dom.ts、src/frontend/views/settings-dialog.ts

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - 打开项目并与 Agent 对话理解代码 (Priority: P1) 🎯 MVP

**Goal**: 选目录、配置模型、流式对话、只读工具卡片、待办

**Independent Test**: 选目录 → 填 Key → 提问 → 流式回答 + list_dir/read_file 卡片

- [x] T017 [P] [US1] [lane:backend] SSE 增量解析 src/backend/agent/providers/sse.ts，测试 tests/unit/backend/agent/providers/sse.test.ts
- [x] T018 [US1] [lane:backend] 提供方接口与实现 src/backend/agent/providers/types.ts、openai.ts、anthropic.ts（消息转换 + 流式工具调用拼接），测试 tests/unit/backend/agent/providers/openai.test.ts、anthropic.test.ts 与 tests/integration/backend/agent/providers/streaming.test.ts（本地 SSE 服务器回放 contracts/fixtures）
- [x] T019 [US1] [lane:backend] glob 匹配与文本搜索 src/backend/tools/glob.ts、src/backend/tools/search.ts，测试 tests/unit/backend/tools/glob.test.ts、tests/integration/backend/tools/search.test.ts
- [x] T020 [US1] [lane:backend] list_dir / read_file 与文件树 src/backend/tools/fs-tools.ts、src/backend/fs/file-tree.ts，测试 tests/integration/backend/tools/fs-tools.test.ts
- [x] T021 [US1] [lane:backend] 工具执行器（只读 + todo_write）src/backend/tools/executor.ts、Agent 循环 src/backend/agent/agent-loop.ts、src/backend/agent/system-prompt.ts，测试 tests/integration/backend/agent/agent-loop.test.ts（假 provider）
- [x] T022 [P] [US1] [lane:frontend] 安全 Markdown 渲染 src/frontend/lib/markdown.ts，测试 tests/unit/frontend/lib/markdown.test.ts
- [x] T023 [US1] [lane:frontend] 左栏项目/文件树 src/frontend/views/sidebar.ts、对话区 src/frontend/views/chat.ts、工具卡片 src/frontend/views/tool-card.ts（含待办展示）

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - 审批式修改代码 (Priority: P1)

**Goal**: diff 展示 + 批准/拒绝 + 三种权限模式

**Independent Test**: Ask 模式改 README：拒绝不变、批准生效；Plan 模式被拒

- [x] T024 [P] [US2] [lane:backend] edit_file 纯替换逻辑（唯一性、replace_all）src/backend/tools/edit.ts，测试 tests/unit/backend/tools/edit.test.ts
- [x] T025 [US2] [lane:backend] write_file / edit_file 与审批闸门接入 src/backend/tools/fs-tools.ts、src/backend/tools/executor.ts，测试 tests/integration/backend/tools/executor.test.ts（批准/拒绝/Plan/自动批准）
- [x] T026 [P] [US2] [lane:frontend] diff 行分类 src/frontend/lib/diff-lines.ts，测试 tests/unit/frontend/lib/diff-lines.test.ts
- [x] T027 [US2] [lane:frontend] 右栏标签页 src/frontend/views/right-panel.ts、Diff 面板 src/frontend/views/diff-view.ts、批准按钮与权限模式选择器

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - 审批式执行命令 (Priority: P2)

**Goal**: PowerShell/bash 命令、实时输出、超时、停止

**Independent Test**: 让 Agent 运行 `node -v` 并批准，终端面板显示输出

- [x] T028 [US3] [lane:backend] 命令执行（流式输出、超时、终止进程树）src/backend/tools/run-command.ts 并接入执行器，测试 tests/integration/backend/tools/run-command.test.ts
- [x] T029 [US3] [lane:frontend] 终端面板 src/frontend/views/terminal-view.ts 与「停止」按钮

---

## Phase 6: User Story 4 - 会话管理与持久化 (Priority: P2)

**Goal**: 新建/切换/删除/恢复会话，/clear

**Independent Test**: 两个会话 → 重启 → 都在

- [x] T030 [US4] [lane:backend] 会话 JSON 持久化（原子写入、ID 校验）src/backend/sessions/session-store.ts，测试 tests/integration/backend/sessions/session-store.test.ts
- [x] T031 [US4] [lane:frontend] 会话列表（新建、切换、删除）于 src/frontend/views/sidebar.ts

---

## Phase 7: User Story 5 - Spec Kit 工作流支持 (Priority: P3)

**Goal**: Tasks 面板、斜杠命令

**Independent Test**: 含 tasks.md 的项目在 Tasks 面板显示任务；/model 切换模型

- [x] T032 [P] [US5] [lane:backend] tasks.md 解析 src/backend/specs/tasks-parser.ts，测试 tests/unit/backend/specs/tasks-parser.test.ts（使用 contracts/fixtures/tasks.sample.md）
- [x] T033 [P] [US5] [lane:frontend] 斜杠命令解析与提示模板 src/frontend/lib/slash-commands.ts，测试 tests/unit/frontend/lib/slash-commands.test.ts
- [x] T034 [US5] [lane:frontend] Tasks 面板 src/frontend/views/tasks-view.ts 与斜杠命令接入 src/frontend/views/chat.ts

---

## Phase 8: Polish & Cross-Cutting Concerns

- [x] T035 [lane:docs] 中文 README（安装、运行、打包、使用说明）于 README.md
- [x] T036 [P] [lane:docs] 变更记录 CHANGELOG.md
- [x] T037 [P] [lane:docs] 测试矩阵 docs/testing/test-matrix.md
- [x] T038 [P] [lane:docs] 威胁模型 docs/security/threat-model.md 与安全检查清单 docs/security/security-checklist.md
- [x] T039 [lane:@shared] 路线图 ROADMAP.md 与看板 docs/tasks/BOARD.md 收尾

---

## Dependencies & Execution Order

- Phase 1 → Phase 2 → 用户故事（US1 → US2 依赖执行器；US3 依赖执行器；US4、US5 只依赖 Phase 2）→ Phase 8
- 泳道并行：同一阶段内 backend 与 frontend 任务可由不同 worker 同时进行（只依赖已冻结的 contracts/）；同一泳道内按任务号串行
- 合入顺序（multi-agent.md §6）：contracts → @shared/infra → backend → frontend → docs

## Parallel Example

```text
# Phase 2 完成后可同时派发（不同泳道）：
worker A (backend):  T017 T018 T019 T020 T021
worker B (frontend): T022 T023
worker C (docs):     T035 T036（文档可对照 spec 先写）
```
