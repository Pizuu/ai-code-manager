# ai-code-manager

类 Claude Code 的 Windows 桌面 AI 编程助手（Electron + TypeScript）。在本地项目里与大模型对话，模型通过受控工具读代码、提出修改（diff + 审批）、执行命令（审批），并支持 Spec Kit 工作流。

## 功能

- **三栏界面**：左侧会话列表 + 项目文件夹 + 文件树；中间流式对话（Markdown、工具调用卡片、待办）；右侧 Diff / 终端 / 任务标签页。
- **两种模型接口**：OpenAI 兼容 `/chat/completions`（可改 Base URL，适配各类兼容端点）与 Anthropic Messages API，均为流式。
- **工具**：`list_dir`、`read_file`、`search`（纯 Node 实现的类 ripgrep 搜索）、`write_file` / `edit_file`（先展示 diff，批准后写入）、`run_command`（Windows 用 PowerShell，批准后执行，输出实时显示）、`todo_write`。
- **权限模式**：每次询问 / 自动批准编辑（命令仍需批准）/ 仅规划（只读）。
- **斜杠命令**：`/init`（生成 AGENTS.md）、`/clear`、`/model [名称]`、`/specify <需求>`、`/plan`、`/tasks`、`/implement [任务号]`、`/help`。
- **Spec Kit 任务面板**：解析所开项目的 `specs/<功能>/tasks.md`，显示完成状态、`[P]` 与泳道。
- **安全**：API Key 用系统加密（Windows DPAPI，经 Electron safeStorage）保存在本机，界面层永远拿不到；所有文件工具限制在项目根内（含符号链接检查）；渲染进程沙箱化 + 严格 CSP。
- **会话持久化**：每个会话一个 JSON，存于本机用户数据目录（Windows：`%APPDATA%\ai-code-manager\sessions\`），重启后恢复。
- 中文界面，跟随系统明暗主题。

## 环境要求

- Node.js **≥ 22.18**（测试直接运行 TypeScript 源码，依赖 Node 原生类型擦除）
- Windows 10/11 x64（打包目标）；macOS / Linux 也可 `npm start` 开发运行
- 一个 OpenAI 兼容或 Anthropic 的 API Key

## 快速开始（Windows PowerShell）

```powershell
npm install        # 安装依赖（会下载 Electron 二进制）
npm start          # 编译 TypeScript 并启动应用
```

首次启动会弹出「设置」：选择提供方、填写 Base URL / 模型 / API Key 后保存；再点左侧「打开文件夹」选择项目即可开始对话。

## 打包

```powershell
npm run dist       # 在 Windows 上执行：release/ 下生成 NSIS 安装包与便携版（x64）
```

产物：`release/AI Code Manager-Setup-<版本>-x64.exe`（安装版）与 `release/AI Code Manager-Portable-<版本>-x64.exe`（便携版）。未配置代码签名，首次运行 Windows SmartScreen 可能提示。

## 开发与验证

```bash
npx eslint .            # Lint
npx tsc --noEmit        # 类型检查
npm run test            # 单元 + 集成测试（node:test）
npm run build           # tsc → dist/
bash scripts/verify.sh  # 以上四步一键执行
bash scripts/security-check.sh
```

## 使用提示

- 点击文件树中的文件会把 `@路径` 插入输入框，方便指代文件。
- 权限模式与模型的切换在**下一条消息**生效；运行中可点「停止」，待批准的请求会被视为拒绝。
- `/specify`、`/plan`、`/tasks`、`/implement` 会让 Agent 优先读取项目中的 Spec Kit 模板与技能文件（`.specify/`、`.agents/skills/`），按其步骤执行。

## 项目结构

```text
ai-code-manager/
├── contracts/            # IPC 与工具契约（唯一权威来源）+ fixtures
├── src/backend/          # Electron 主进程：Agent 循环、模型客户端、工具、存储
├── src/frontend/         # 渲染进程：纯 DOM + CSS 界面
├── tests/                # unit / integration / e2e，镜像 src 结构
├── specs/001-agent-desktop/  # Spec Kit：spec / plan / tasks / checklists / analysis
├── docs/                 # 架构（含 ADR）、开发、测试、安全、任务卡
├── .specify/             # Spec Kit 宪法与模板
├── skills/               # Agent Skills
└── scripts/              # verify / security-check / lane 检查 / worktree
```

## Spec Kit 工作流

```bash
scripts/speckit-init.sh   # uv tool install specify-cli && specify init --here --force --integration codex
```

然后在 agent 中依次运行：`$speckit-constitution` → `$speckit-specify` → `$speckit-clarify` → `$speckit-plan` → `$speckit-checklist` → `$speckit-tasks` → `$speckit-analyze` → `$speckit-implement` → `$speckit-converge`

多 agent 并行：见 `docs/development/multi-agent.md`（在 Spec Kit 之上加泳道 + worktree）。

## 文档导航

- AI 协作规则：`AGENTS.md`；宪法：`.specify/memory/constitution.md`
- 功能规格：`specs/001-agent-desktop/`
- 架构：`docs/architecture/overview.md`、ADR：`docs/architecture/decisions/`
- 开发：`docs/development/`
- 测试：`docs/testing/`
- 安全：`docs/security/`
