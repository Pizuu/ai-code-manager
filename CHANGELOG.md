# Changelog

本文件记录项目的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [0.3.0] - 2026-10-20

### Added

- 功能 `003-code-view-web-locator` 的精简 Spec Kit 制品（spec、plan、tasks、analysis、checklist）。
- 契约 `contracts/ipc.ts` 修订 v1.2（纯增量）：只读通道 `fs:read`、`FileContent`、`FILE_VIEW_LIMITS`、错误码 `E_NOT_CONFIGURED`；新增 `contracts/ui.ts` v1（右键发送来源与 `data-send-*` 标记）、`contracts/web-dev.ts` v1（Web 预览只读通道）。
- 只读代码查看：文件树单击在任务会话中列以标签页打开，行号 + 轻量高亮；大文件截断 / 超大与二进制不显示；路径经项目根沙箱（含符号链接）。
- 全局右键「发送到任务会话」：选中文本、代码选区 / 行 / 文件、文件树节点、看板任务卡、Git 提交 / 分支 / 合入记录，带来源标注插入输入框，不自动发送。
- Web 预览 `npm run web`（仅开发，不打包）：同一套渲染层、只读适配器 + 内存模拟；「UI 定位」模式显示元素源文件:行与 CSS 选择器并一键复制。
- 测试：新增 26 个（共 186 个），覆盖 `fs:read` 沙箱 / 二进制 / 截断 / 超大、右键内容组装、高亮分词、配置为空与 `E_NOT_CONFIGURED`、UI 定位纯函数。
- 宪法 1.2.0（原则 五：简单 UI 修改跳过测试）、ADR 0007、0008。

### Changed

- **内置 agent 的 Base URL 与模型默认空白**，切换提供方不再自动填入地址或模型；opencode 预设字段值为空（placeholder 示例 +「按示例填写」）；未配置时发送返回「请先在设置中配置 agent」。已保存的设置不受影响。
- 文件树单击由「插入 `@路径`」改为打开只读代码标签（插入引用改用右键发送）。
- 清理代码、测试、文档中的 ChatGPT / gpt 默认值与示例。

## [0.2.0] - 2026-10-20

### Added

- 功能 `002-workspace-boards` 的完整 Spec Kit 制品（spec 含 Clarifications、plan、research、data-model、quickstart、checklists、tasks、analysis）。
- 契约 `contracts/ipc.ts` 修订 v1.1（纯增量）：`agentCli:save|delete|check`、`sessions:setAgent`、`board:get`、`git:get` 通道，Agent CLI / 看板 / Git 类型，会话与设置的可选字段，错误码 `E_CLI`；opencode 1.19.3 真实 JSONL 样例。
- 三板块工作台：泳道看板、任务会话、Git 分支与集成，视觉 1:1 沿用 HTML 原型（ADR 0005）；看板状态由 git 推导并标出声明冲突；Git 板块由主进程只读调用 git CLI。
- 外部 Agent CLI：多 CLI 配置、opencode 预设、可执行文件解析（含 Windows npm `opencode.cmd` → `opencode.exe`）、`opencode run --format json` 事件流解析、`--session` 续接、停止结束进程树、按权限模式映射 `OPENCODE_PERMISSION`、敏感环境变量加密（ADR 0006）。
- 会话可选择 agent（内置 API agent / 任一 CLI），新会话使用默认 agent。
- 测试：新增 45 个单元 / 集成测试（共 160 个），含临时 git 仓库上的看板与 Git 快照、假 opencode 可执行文件的完整对话路径。
- ADR 0005、0006。

### Changed

- 渲染进程由三栏布局改为工作台外框 + 三板块；`sidebar.ts`、`right-panel.ts`、`terminal-view.ts` 移除，会话列表、Diff、终端、Spec 任务能力迁入任务会话板块。
- 设置对话框分为「内置 agent（API）」与「Agent CLI」两个分区；设置入口移到左侧图标栏（齿轮）。

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
