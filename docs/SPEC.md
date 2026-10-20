# ai-code-manager 规格索引

> 归 `contracts` 泳道（coordinator）所有。本项目使用 Spec Kit：详细规格在 `specs/<NNN-功能>/`，本文件只做索引与契约登记，避免两处维护同一内容。

## 1. 产品一句话

类 Claude Code 的 Windows 桌面 AI 编程助手：在本地项目里与大模型对话，模型通过受控工具读代码、提出修改（diff + 审批）、执行命令（审批），并跟随 Spec Kit 流程推进。

## 2. 宪法

`.specify/memory/constitution.md`（v1.1.0）。

## 3. 功能规格

| 编号 | 功能 | 目录 | 状态 |
|---|---|---|---|
| 001 | 桌面 Agent MVP | `specs/001-agent-desktop/` | 已实现，converge 追加 2 项（T040 Electron E2E、T041 Windows 打包验证） |
| 002 | 三板块工作台（泳道看板 / 任务会话 / Git 分支与集成）+ Agent CLI（opencode） | `specs/002-workspace-boards/` | 已实现，converge 追加 3 项（T123 E2E、T124 Windows 实机 opencode、T125 逐条审批评估） |

## 4. 需求编号

功能需求 `FR-xxx`、成功标准 `SC-xxx` 定义在各功能的 `spec.md`，本文件不重复。

## 5. 架构

`docs/architecture/overview.md` 与 `docs/architecture/decisions/`。

## 6. 契约登记

| 契约 | 版本 | 说明 |
|---|---|---|
| `contracts/ipc.ts` | v1（修订 v1.1，功能 002 纯增量） | 主进程 ↔ 渲染进程 IPC；v1.1 增加 Agent CLI、泳道看板、Git 分支与集成 |
| `contracts/tools.ts` | v1 | Agent ↔ 模型工具 Schema 与上限 |

详见 `contracts/README.md`。
