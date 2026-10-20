# 任务看板

> 由 coordinator 维护。前置任务全部合入的卡即为 **ready**；来自不同泳道的 ready 卡可以同时派发。
> 功能：`specs/001-agent-desktop/`（T-001…T-012）、`specs/002-workspace-boards/`（T-013…T-022）、`specs/003-code-view-web-locator/`（T-023…T-031）。当前 ready：T-011（frontend）、T-012 / T-021 / T-031（infra，同泳道不同时派发）、T-022（backend）。T-012 同时承担 003 的 T214（打包核对）。
> 003 记录：T-023（契约 v1.2）合入提交 `cc62487` 到 T-025 合入提交 `7f900e1` 之间，`hark-dev` 因 preload / handler 编译期穷举检查而 typecheck 不通过（同 002，plan.md Complexity Tracking）；三者连续合入，其余每次合入后 lint / typecheck / 测试为绿。
> 002 记录：T-013（契约 v1.1）合入提交 `1ec10b8` 到 T-015 合入提交 `ce20063` 之间，`hark-dev` 因 preload / handler 编译期穷举检查而 typecheck 不通过（有意的防漏机制，plan.md Complexity Tracking）；二者已连续合入，其余每次合入后 `scripts/verify.sh` 为绿。集成分支已更名 `hark-dev`；任务分支合入后删除，状态以合并提交追溯。
> 说明：T015（应用入口/preload/handlers）因依赖后续模块，从 T-004 移到 T-006 执行（flow-back 已同步卡片）。无 Git 远端，「PR」列为本地合入 `dev` 的分支名（见 plan.md Complexity Tracking）。

| 编号 | 标题 | 泳道 | 前置 | 状态 | 执行者 | PR |
|---|---|---|---|---|---|---|
| T-001 | 冻结 v1 契约与规格 | contracts | 无 | done | coordinator | `feat/contracts/T-001-spec-contracts`（本地 --no-ff 合入） |
| T-002 | 工具链与拆卡 | @shared | T-001 | done | coordinator | `int/T-002-toolchain`（本地 --no-ff 合入） |
| T-003 | lanes.conf 与 CI | infra | T-002 | done | coordinator | `feat/infra/T-003-ci-node22`（本地 --no-ff 合入） |
| T-004 | 主进程安全基座 | backend | T-002 | done | claude | `feat/backend/T-004-foundation`（本地 --no-ff 合入） |
| T-005 | Agent 核心与工具 | backend | T-004 | done | codex | `feat/backend/T-005-agent-tools`（本地 --no-ff 合入） |
| T-006 | 会话存储与 tasks 解析 | backend | T-004 | done | claude | `feat/backend/T-006-sessions-specs`（本地 --no-ff 合入） |
| T-007 | 渲染进程骨架与对话 | frontend | T-002 | done | codex | `feat/frontend/T-007-shell-chat`（本地 --no-ff 合入） |
| T-008 | Diff/终端/Tasks/会话/斜杠命令 | frontend | T-007 | done | claude | `feat/frontend/T-008-panels-commands`（本地 --no-ff 合入） |
| T-009 | 用户与测试/安全文档 | docs | T-005, T-008 | done | codex | `feat/docs/T-009-user-docs`（本地 --no-ff 合入） |
| T-011 | Electron E2E 核心路径 | frontend | T-010 | ready | （待派发） | — |
| T-012 | Windows 打包验证与 CI | infra | T-010 | ready | （待派发） | — |
| T-010 | 收尾：路线图与看板 | @shared | T-009 | done | coordinator | `int/T-010-closeout`（本地 --no-ff 合入） |
| T-013 | 功能 002 规格、契约 v1.1 与 ADR | contracts | 无 | done | coordinator | `feat/contracts/T-013-spec-002`（本地 --no-ff 合入） |
| T-014 | 002 拆卡与看板 | @shared | T-013 | done | coordinator | `int/T-014-split`（本地 --no-ff 合入） |
| T-015 | 主进程：看板 / Git 读取与 Agent CLI | backend | T-014 | done | coordinator | `feat/backend/T-015-workspace-agent-cli`（本地 --no-ff 合入） |
| T-016 | 渲染进程：原型外框、泳道看板、Git 视图 | frontend | T-014 | done | coordinator | `feat/frontend/T-016-shell-boards`（本地 --no-ff 合入） |
| T-017 | 渲染进程：任务会话板块与 Agent CLI 设置 | frontend | T-015, T-016 | done | coordinator | `feat/frontend/T-017-session-cli`（本地 --no-ff 合入） |
| T-018 | 002 用户与测试/安全文档 | docs | T-015, T-017 | done | coordinator | `feat/docs/T-018-docs-002`（本地 --no-ff 合入） |
| T-019 | 002 收尾：路线图与看板 | @shared | T-018 | done | coordinator | `feat/contracts/T-019-converge` + `int/T-019-closeout`（本地 --no-ff 合入） |
| T-020 | 三板块 Electron E2E | frontend | T-011 | blocked | （待派发） | — |
| T-021 | Windows 实机验证 opencode 集成 | infra | T-019 | ready | （待派发） | — |
| T-022 | 评估 opencode serve 逐条工具审批 | backend | T-019 | ready | （待派发） | — |
| T-023 | 功能 003 规格、契约 v1.2 与 ADR | contracts | 无 | done | coordinator | `feat/contracts/T-023-spec-003`（本地 --no-ff 合入） |
| T-024 | 003 拆卡、测试规则与 Web 预览脚本入口 | @shared | T-023 | done | coordinator | `int/T-024-split`（本地 --no-ff 合入） |
| T-025 | 主进程：只读 fs:read 与 agent 配置默认空白 | backend | T-024 | done | coordinator | `feat/backend/T-025-file-read-config`（本地 --no-ff 合入） |
| T-026 | 渲染进程：代码查看器、全局右键发送与配置空白提示 | frontend | T-024 | done | coordinator | `feat/frontend/T-026-code-view-context-send`（本地 --no-ff 合入） |
| T-027 | Web 预览渲染层：只读适配器与 UI 定位 | frontend | T-026 | done | coordinator | `feat/frontend/T-027-web-preview`（本地 --no-ff 合入） |
| T-028 | Web 预览开发服务器 | infra | T-025 | done | coordinator | `feat/infra/T-028-web-dev-server`（本地 --no-ff 合入） |
| T-029 | 003 用户与测试 / 安全文档 | docs | T-026, T-027, T-028 | done | coordinator | `feat/docs/T-029-docs-003`（本地 --no-ff 合入） |
| T-030 | 003 收尾：路线图、看板与版本号 | @shared | T-029 | done | coordinator | `feat/contracts/T-030-converge` + `int/T-030-closeout`（本地 --no-ff 合入） |
| T-031 | Web 预览服务器自动化冒烟 | infra | T-030 | ready | （待派发） | — |

## 依赖图

```mermaid
graph LR
  T001[T-001 contracts] --> T002[T-002 @shared 工具链]
  T002 --> T003[T-003 infra]
  T002 --> T004[T-004 backend 基座]
  T004 --> T005[T-005 backend agent/工具]
  T004 --> T006[T-006 backend 会话/解析]
  T002 --> T007[T-007 frontend 骨架/对话]
  T007 --> T008[T-008 frontend 面板/命令]
  T005 --> T009[T-009 docs]
  T008 --> T009
  T009 --> T010[T-010 收尾/converge]
  T010 --> T011[T-011 frontend E2E]
  T010 --> T012[T-012 infra Windows 打包]
  T013[T-013 contracts 002] --> T014[T-014 @shared 拆卡]
  T014 --> T015[T-015 backend 看板/Git/CLI]
  T014 --> T016[T-016 frontend 外框/看板/Git]
  T015 --> T017[T-017 frontend 会话/CLI 设置]
  T016 --> T017
  T015 --> T018[T-018 docs]
  T017 --> T018
  T018 --> T019[T-019 @shared 收尾]
  T011 --> T020[T-020 frontend 三板块 E2E]
  T019 --> T021[T-021 infra Windows opencode]
  T019 --> T022[T-022 backend serve 逐条审批]
  T023[T-023 contracts 003] --> T024[T-024 @shared 拆卡/规则]
  T024 --> T025[T-025 backend fs:read/配置空白]
  T024 --> T026[T-026 frontend 代码查看/右键]
  T026 --> T027[T-027 frontend Web 预览]
  T025 --> T028[T-028 infra Web 服务器]
  T026 --> T029[T-029 docs]
  T027 --> T029
  T028 --> T029
  T029 --> T030[T-030 @shared 收尾]
  T030 --> T031[T-031 infra Web 预览冒烟]
  T030 -.T214.-> T012
```
