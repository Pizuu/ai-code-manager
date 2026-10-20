# Implementation Plan: 桌面 AI 编程 Agent（MVP）

**Branch**: `001-agent-desktop` | **Date**: 2026-10-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-agent-desktop/spec.md`

**Note**: This template is filled in by the `$speckit-plan` command; its definition describes the execution workflow.

## Summary

用 Electron 构建 Windows 桌面应用：主进程（`src/backend/`）承载 Agent 核心——模型客户端（OpenAI 兼容 + Anthropic，SSE 流式）、工具执行器（项目根沙箱、diff、审批闸门、PowerShell 命令）、会话与设置存储（`safeStorage` 加密 Key）；渲染进程（`src/frontend/`）是纯 DOM + CSS 的三栏界面，只通过 preload 暴露的白名单 IPC 与主进程通信。两侧共享的类型全部来自根目录 `contracts/`（`ipc.ts`、`tools.ts`）。TypeScript 由 `tsc` 直接编译，不引入打包器和 UI 框架。

## Technical Context

**Language/Version**: TypeScript 6.0（`erasableSyntaxOnly`，ESM，`module: nodenext`）；运行时 Node.js ≥ 22.18（开发与测试）/ Electron 44 内置 Node（应用）

**Primary Dependencies**: 运行时零第三方依赖（只用 Electron 与 Node 标准库）；开发依赖：electron、electron-builder、typescript、eslint + typescript-eslint、@types/node

**Storage**: 本机文件：`<userData>/settings.json`（Key 为 safeStorage 密文的 base64）、`<userData>/sessions/<id>.json`（每会话一个）

**Testing**: `node:test` + `node:assert`，测试直接以 Node 原生 TypeScript 类型擦除运行（无需预编译）；单元 `tests/unit/`、集成 `tests/integration/`（真实临时目录、本地 SSE 测试服务器）、E2E `tests/e2e/`（Electron GUI，见 Complexity Tracking）

**Target Platform**: Windows 10/11 x64（NSIS 安装包 + 便携版）；macOS / Linux 可 `npm start` 运行

**Project Type**: desktop-app（Electron 双进程）

**Performance Goals**: 流式增量按 requestAnimationFrame 合帧渲染（≤ 1 帧，SC-006）；搜索跳过 > 1 MB 文件与忽略目录

**Constraints**: 渲染进程沙箱化、严格 CSP；Key 不出主进程；所有写入/命令经审批；工具输出 ≤ 30000 字符；单次用户消息最多 25 轮工具循环

**Scale/Scope**: 单用户单窗口；项目规模数万文件（文件树懒加载、搜索有结果上限）

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原则 | 结论 | 说明 |
|---|---|---|
| 一 硬泳道 | ✅ | 每个任务只在一个泳道：`contracts`（specs/、contracts/、docs/architecture/）、`backend`（src/backend/、tests/*/backend/）、`frontend`（src/frontend/、tests/*/frontend/）、`docs`、`infra`；共享热点文件（package.json、tsconfig.json、eslint.config.mjs、AGENTS.md）只由 coordinator 在 `int/*` 分支修改，任务标 `[lane:@shared]`。 |
| 二 契约先行并冻结 | ✅ | `contracts/ipc.ts`、`contracts/tools.ts` v1 在任何实现之前合入；代码只 `import type`（tools 的 JSON Schema 为运行时常量，从契约导入）；`specs/001-agent-desktop/contracts/` 只放链接。 |
| 三 先规格后代码 | ✅ | spec.md 无实现细节、无 `[NEEDS CLARIFICATION]`；技术选择只在本文件。 |
| 四 任务必须标泳道 | ✅ | tasks.md 每项带 `[lane:x]`；[P] 只标在不同文件上。 |
| 五 测试分层 | ✅ | 纯逻辑单测、文件系统/进程/HTTP 集成测试；`npm run test` 一次跑三级。 |
| 六 做完 = 提交 + 推送 | ⚠️ | 本地 git 中按分支 → `--no-ff` 合入 `dev` 模拟 PR；无远端可推送，见 Complexity Tracking。 |
| 七 协调人裁决 | ✅ | 约定冲突（Electron 与生成器默认值）记为 ADR 0003 / 0004。 |
| 八 变更纪律 | ✅ | 每个文件一个概念、≤ 约 400 行。 |
| 九 写入与执行须批准 | ✅ | `permissions.ts` 纯函数决策 + 执行器审批闸门；集成测试断言拒绝时文件不变、命令未执行。 |
| 十 密钥不进渲染进程 | ✅ | `PublicSettings` 只有 `hasApiKey`；Key 只在 `settings-store.ts` 解密并直接交给 provider。 |
| 十一 项目根沙箱 | ✅ | `sandbox.ts`：词法检查 + realpath 检查；单测覆盖 posix 与 win32 路径。 |
| 十二 渲染进程最小权限 | ✅ | contextIsolation + sandbox + CSP + 先转义的 Markdown；preload 白名单与契约用 `satisfies` 绑定。 |
| 十三 可追溯 | ✅ | ToolCallRecord（含 diff、结果）随会话持久化。 |
| 十四 中文、跟随系统 | ✅ | 全中文文案；`prefers-color-scheme` + `nativeTheme.themeSource = 'system'`。 |

Phase 1 设计后复查：结论不变。

## Project Structure

### Documentation (this feature)

```text
specs/001-agent-desktop/
├── plan.md              # 本文件
├── research.md          # Phase 0：技术决策与备选
├── data-model.md        # Phase 1：实体与状态机
├── quickstart.md        # Phase 1：如何运行与验收
├── contracts/           # 只链接根目录 contracts/
├── checklists/          # requirements.md（内置）+ security.md（审查者）
├── analysis.md          # $speckit-analyze 报告存档（只读分析的输出）
└── tasks.md             # $speckit-tasks 输出
```

### Source Code (repository root)

```text
contracts/
├── ipc.ts                     # IPC 通道/事件/模型类型（v1）
├── tools.ts                   # 工具 Schema、输入类型、上限（v1）
└── fixtures/                  # 会话、事件、SSE 流、tasks.md 样例

src/backend/                   # Electron 主进程 = Agent 核心
├── main.ts                    # 应用入口：窗口、安全选项、主题
├── preload.cts                # contextBridge（CommonJS，沙箱 preload 要求）
├── ipc/handlers.ts            # invoke 通道注册 + 参数校验
├── ipc/validate.ts            # 运行时参数校验工具
├── app-state.ts               # 当前项目、运行中会话、待批准请求
├── settings/settings-store.ts # 设置 + safeStorage 加密 Key
├── sessions/session-store.ts  # 会话 JSON 持久化
├── agent/agent-loop.ts        # 对话 ↔ 工具循环
├── agent/system-prompt.ts     # 系统提示
├── agent/providers/types.ts   # 提供方统一接口
├── agent/providers/sse.ts     # SSE 解析
├── agent/providers/openai.ts  # /chat/completions 流式 + 消息转换
├── agent/providers/anthropic.ts # /v1/messages 流式 + 消息转换
├── tools/sandbox.ts           # 项目根路径沙箱
├── tools/diff.ts              # 统一 diff（Myers/LCS）
├── tools/edit.ts              # edit_file 的纯替换逻辑
├── tools/glob.ts              # glob → RegExp
├── tools/search.ts            # 文本搜索
├── tools/fs-tools.ts          # list_dir / read_file / write_file / edit_file
├── tools/run-command.ts       # PowerShell / bash 执行
├── tools/permissions.ts       # 权限模式决策
├── tools/executor.ts          # 工具分发 + 审批闸门
├── fs/file-tree.ts            # 文件树一层列举
└── specs/tasks-parser.ts      # tasks.md 解析

src/frontend/                  # 渲染进程（纯 DOM + CSS，ESM）
├── index.html                 # CSP、三栏骨架
├── styles.css                 # 明暗主题变量
├── main.ts                    # 启动、事件分发
├── api.ts                     # window.api 类型化访问
├── store.ts                   # 前端状态
├── lib/dom.ts                 # h() 元素工厂
├── lib/markdown.ts            # 安全 Markdown 渲染
├── lib/slash-commands.ts      # 斜杠命令解析与模板
├── lib/diff-lines.ts          # diff 行分类
└── views/                     # sidebar / chat / tool-card / right-panel / diff-view / terminal-view / tasks-view / settings-dialog

tests/
├── unit/backend/…             # 镜像 src/backend/…
├── unit/frontend/lib/…        # 镜像 src/frontend/lib/…
├── integration/backend/…      # 文件系统、子进程、本地 HTTP
└── e2e/                       # 见 Complexity Tracking
```

**Structure Decision**: 沿用生成器的「前后端分层」布局：`src/frontend` = 渲染进程，`src/backend` = 主进程/Agent 核心，二者是 npm workspaces 子包（只声明 `type: module`，依赖集中在根 package.json，便于 electron-builder 打包）。测试按 `docs/testing/strategy.md` 镜像源码路径：`src/backend/tools/diff.ts` → `tests/unit/backend/tools/diff.test.ts`，恰好落在 lanes.conf 的 `tests/*/backend/*` 中。

## 架构要点

```text
渲染进程 (sandbox)                   preload.cts                 主进程
 输入/斜杠命令 ──invoke('agent:send')──▶ 白名单 ──▶ handlers.ts ──校验──▶ agent-loop
                                                                      │  provider.stream(SSE)
 卡片/Diff/终端 ◀──onEvent(agent:event)◀────────── webContents.send ◀──┤  executor
 批准按钮 ──invoke('agent:approve')────▶          ──▶ app-state 解析 Promise ──▶ 写文件/执行命令
                                                                      └▶ session-store（每轮落盘）
```

- **提供方抽象**：`Provider.stream({system, messages, tools, signal}, onText)` → `{text, toolCalls, stopReason}`；内部消息格式中立（`ChatMessage`），各提供方负责转换（OpenAI 的 `tool_calls`/`tool` 消息；Anthropic 的 `tool_use`/`tool_result` 内容块，连续工具结果合并为一条 user 消息）。
- **审批闸门**：`decide(mode, effect)` → allow / ask / deny；ask 时执行器先计算 diff（或命令原文），经 `requestApproval` 回调挂起，直到渲染进程回 `agent:approve` 或会话被停止。
- **Key 流向**：`settings:set` 收到 Key → `safeStorage.encryptString` → 落盘；发请求时 `settings-store.getApiKey()` 解密，直接作为 HTTP 头交给 fetch；不进入任何事件或返回值。

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| 宪法 六：无法「推送并开 PR」 | 交付环境没有 Git 远端；以本地分支 + `--no-ff` 合入 `dev` 保留同等的审查/泳道检查痕迹 | 伪造 PR 链接违反「没有证据不得声称完成」 |
| E2E 暂缺（测试矩阵 ❌） | Electron GUI E2E 需要图形环境与 Electron 二进制，当前构建环境无法运行 | 用单元/集成测试覆盖核心路径；E2E 由 converge 追加为 T040 跟踪 |
| 共享热点文件任务无泳道 | package.json / tsconfig.json / eslint.config.mjs 按 lanes.conf 属 `@shared`，宪法 四要求每个任务带泳道 | 标 `[lane:@shared]` 并由 coordinator 在 `int/*` 分支执行；拆进某个 worker 泳道会违反 lanes.conf |
