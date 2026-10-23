# Implementation Plan: 三板块工作台与 Agent CLI（opencode）

**Branch**: `002-workspace-boards` | **Date**: 2026-10-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-workspace-boards/spec.md`

## Summary

把渲染进程从「三栏对话」改为与 HTML 原型 1:1 一致的工作台外框（图标栏 + 项目栏 + 页头 + 状态栏），内含三个板块：泳道看板、任务会话、Git 分支与集成。看板与 Git 数据由主进程新模块 `src/backend/workspace/` 读取项目文件并调用 git CLI（参数数组、只读）生成快照，经新 IPC 通道 `board:get`、`git:get` 提供。新增外部 Agent CLI：配置存于设置（敏感环境变量 safeStorage 加密），`src/backend/agent-cli/` 负责解析可执行文件、按模板构造参数数组、映射权限、`spawn` 并把 `opencode run --format json` 的 JSONL 事件转成既有 `AgentEvent`（文本、工具卡片、终端、待办），多轮以 `--session` 续接。契约 `contracts/ipc.ts` 以 v1.1 纯增量扩展。

## Technical Context

**Language/Version**: TypeScript 6.0（ESM、`erasableSyntaxOnly`），Node ≥ 22.18 / Electron 44

**Primary Dependencies**: 运行时仍零第三方依赖；外部程序：git（用户本机）、opencode（可选，用户安装）

**Storage**: `<userData>/settings.json` 增加 `agentClis`、`defaultAgent`（敏感 env 为密文）；会话 JSON 增加可选 `agent`、`cliSessions`

**Testing**: node:test；单元（lanes glob、任务卡解析、参数构造、可执行文件解析、opencode 事件解析、git 图布局、看板格式化）；集成（临时 git 仓库上的看板/Git 快照、假 opencode 可执行文件的完整对话路径、handlers 通道、设置不外泄）；UI 截图冒烟在仓库外（无头 Chromium + 模拟 `window.api`）

**Target Platform**: Windows 10/11 x64 为主（PowerShell / `opencode.exe`），macOS/Linux 可运行

**Project Type**: desktop-app（Electron 双进程）

**Performance Goals**: `board:get` / `git:get` 在 ~100 分支、数千提交的仓库内 < 2 s（提交图上限 200 条；git 命令并发受限）

**Constraints**: 宪法 九–十四；CSP 禁内联脚本 / 内联 style 属性；git 只读；CLI 参数不经 shell；敏感值不进渲染进程

**Scale/Scope**: 单窗口；三个板块 + 设置页一个新分区

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原则 | 结论 | 说明 |
|---|---|---|
| 一 硬泳道 | ✅ | 卡片：T-013 contracts、T-014 @shared、T-015 backend、T-016/T-017 frontend、T-018 docs、T-019 @shared；每张卡只改本泳道文件，`check-lane.sh` 校验。 |
| 二 契约先行并冻结 | ✅ | v1.1 只新增通道/类型/可选字段，未改动 v1 字段；先于实现合入。 |
| 三 先规格后代码 | ✅ | spec 无实现细节、无 `[NEEDS CLARIFICATION]`（Clarifications 7 问已裁决）。 |
| 四 任务必须标泳道 | ✅ | tasks.md 每项 `[lane:x]`。 |
| 五 测试分层 | ✅ | 逻辑全部单测 / 集成测试；纯 UI 由截图冒烟覆盖并在任务卡注明。 |
| 六 做完 = 提交 + 推送 | ⚠️ | 远端推送由负责人执行；本地 `--no-ff` 合入 `hark-dev`（同 001）。 |
| 七 协调人裁决 | ✅ | 外部 CLI 与审批粒度的冲突由 coordinator 裁决为 ADR 0006。 |
| 八 变更纪律 | ✅ | 新模块独立目录；001 代码只在接线处改动。 |
| 九 写入与执行须批准 | ⚠️→✅ | 内置 agent 不变。CLI agent：无法逐条拦截，改为按权限模式映射 CLI 自身权限 + 「每次询问」下每轮先批准完整命令行（ADR 0006），保持「仅规划禁止一切写入与执行」「auto-edits 不放行命令」。 |
| 十 密钥不进渲染进程 | ✅ | 敏感 env 只存密文，`PublicSettings.agentClis[].env[].value` 对敏感项缺省；测试断言。 |
| 十一 项目根沙箱 | ✅ | CLI 的 cwd 固定为项目根（不可配置），并以 `--dir {cwd}` 传给 opencode；未打开项目拒绝启动 CLI。CLI 自身的文件访问由其实现负责（ADR 0006 已接受风险）。 |
| 十二 渲染进程最小权限 | ✅ | 新通道加入 preload 白名单（编译期穷举）；视图仍只用 `h()` / textContent；SVG 用 createElementNS。 |
| 十三 可追溯 | ✅ | CLI 的工具调用（名称、参数、状态、结果、diff）写入会话 JSON。 |
| 十四 中文、跟随系统 | ✅ | 全中文；暗色变量。 |

Phase 1 设计后复查：结论不变。

## Project Structure

### Documentation (this feature)

```text
specs/002-workspace-boards/
├── spec.md  plan.md  research.md  data-model.md  quickstart.md
├── checklists/requirements.md  checklists/security.md
├── contracts/README.md        # 只链接根 contracts/
├── tasks.md  analysis.md
```

### Source Code (repository root)

```text
contracts/ipc.ts                      # v1.1 增量
contracts/fixtures/{board,git}.sample.json, opencode-*.jsonl
src/backend/workspace/git.ts          # git CLI 运行器（execFile 数组参数、超时）
src/backend/workspace/lanes.ts        # lanes.conf / config.sh 解析 + bash glob 泳道判定
src/backend/workspace/cards.ts        # 任务卡 / BOARD.md / tasks.md / spec.md 解析（纯函数）
src/backend/workspace/git-overview.ts # GitSnapshot
src/backend/workspace/board.ts        # BoardSnapshot（git 推导状态）
src/backend/agent-cli/presets.ts      # opencode 预设与默认值
src/backend/agent-cli/invocation.ts   # 参数模板展开 + 权限映射（纯函数）
src/backend/agent-cli/resolve.ts      # 可执行文件解析（PATH/PATHEXT、npm .cmd 包装）
src/backend/agent-cli/opencode-events.ts # JSONL → 归一事件（纯函数）
src/backend/agent-cli/cli-runner.ts   # spawn、流式映射、停止、持久化
src/backend/settings/settings-store.ts  # + agentClis、defaultAgent
src/backend/ipc/{handlers,validate}.ts, preload.cts  # 接线
src/frontend/styles.css               # 原型 CSS（整体移植）+ 对话/设置补充
src/frontend/lib/icons.ts             # 原型 SVG 图标
src/frontend/lib/board-format.ts      # 卡片文案（纯函数）
src/frontend/lib/git-graph.ts         # 分支图布局（纯函数）
src/frontend/views/shell.ts           # 图标栏/项目栏/页头/状态栏 + 板块路由
src/frontend/views/board-view.ts  git-view.ts  session-view.ts  context-panel.ts
src/frontend/views/chat.ts  tool-card.ts  settings-dialog.ts  agent-cli-settings.ts
tests/unit/backend/workspace/*  tests/unit/backend/agent-cli/*  tests/unit/frontend/lib/*
tests/integration/backend/workspace/*  tests/integration/backend/agent-cli/*
```

**Structure Decision**: 沿用分层布局；新增两个主进程子目录，渲染进程新增视图文件，旧的 `sidebar.ts`、`right-panel.ts` 由 `shell.ts`、`session-view.ts`、`context-panel.ts` 取代（会话列表、文件树、Diff/终端/任务面板能力迁入）。

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| 宪法 九 对外部 CLI 只能按轮批准 | `opencode run` 非交互模式下 `ask` 权限被自动拒绝，应用无法逐条拦截 CLI 内部工具 | 逐条审批需改用 `opencode serve` 并实现权限事件桥（常驻服务器、端口、认证、易变的事件 schema），列为后续增强（ADR 0006） |
| 契约合入与后端接线之间 `hark-dev` 有一个提交 typecheck 不通过 | preload 白名单与 handler 映射的编译期穷举检查要求新通道必须被实现——这是有意的防漏机制 | 在 contracts 分支里改 preload/handlers 会越出泳道；T-013 合入后立即合入 T-015，`verify.sh` 在 T-015 合入后为绿，并在 BOARD 注明 |
| 无 Git 远端 | 推送由负责人执行 | 同 001 |
