# Changelog

本文件记录项目的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [0.1.0] - 2026-10-20

### Added

- 初始脚手架：项目结构、AI 协作规则、CI 流水线（由 ai_project_generator_speckit 生成）。
- Spec Kit 初始化与功能 `001-agent-desktop` 的完整制品：宪法 v1.1.0（新增产品原则 九–十四）、spec（含 Clarifications）、plan、research、data-model、quickstart、checklists、tasks、analysis。
- 契约 v1：`contracts/ipc.ts`（主进程 ↔ 渲染进程）、`contracts/tools.ts`（工具 JSON Schema 与上限）及 fixtures。
- Electron 桌面应用 MVP：三栏界面、流式对话、工具卡片、Diff / 终端 / 任务面板、会话列表、设置对话框、明暗主题。
- Agent 核心：OpenAI 兼容与 Anthropic 流式客户端、工具循环（最多 25 轮）、7 个工具、三种权限模式与审批闸门、停止。
- 安全：safeStorage 加密 API Key、项目根路径沙箱（词法 + realpath）、沙箱化渲染进程 + 严格 CSP + 先转义的 Markdown、`app://` 协议只提供界面文件、IPC 参数校验与来源校验。
- 斜杠命令 `/init`、`/clear`、`/model`、`/specify`、`/plan`、`/tasks`、`/implement`、`/help`。
- 打包：electron-builder Windows NSIS 安装包 + 便携版（x64）。
- 测试：115 个单元/集成测试（node:test，直接运行 TypeScript）。
- ADR 0001–0004。

### Changed

- `npm run test` 改为 `node --test "tests/**/*.test.ts"`（生成器默认的目录参数在 Node 22 上无法运行，见 ADR 0004）。
- CI 改用 Node 22 并增加构建步骤。
- `.npmrc` 设定 `audit-level=high`；已知 moderate 级开发依赖告警见威胁模型「已接受风险」。
