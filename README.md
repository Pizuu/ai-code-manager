# ai-code-manager

类 Claude Code 的 Windows 桌面 AI 编程助手（Electron + TypeScript）。在本地项目里与大模型（内置 API agent）或外部 Agent CLI（如 opencode）对话，模型通过受控工具读代码、提出修改（diff + 审批）、执行命令（审批），并支持 Spec Kit 工作流与多 Agent 泳道协作视图。

## 功能

- **三板块工作台**（v0.2.0）：左侧导航「泳道看板 / 任务会话 / Git 分支与集成」，布局与视觉 1:1 沿用设计原型（ADR 0005）。
  - **泳道看板**：读取项目 `.agents/lanes.conf`、`docs/tasks/T-*.md`、`docs/tasks/BOARD.md`、最新 `specs/*/tasks.md`，以 git 合并记录推导每张任务卡的真实状态（可派工 / 进行中 / 待审查 / 已阻塞 / 已合入），并标出「看板声明 done 但 git 未合入」等冲突；支持搜索与筛选。
  - **任务会话**：会话列表 + 流式对话（Markdown、工具调用卡片、diff 审批、待办）+ 上下文（agent、权限、文件修改、终端输出、Spec 任务；会话标题含任务号时显示该任务卡上下文）。
  - **Git 分支与集成**：分支拓扑图、未合入分支与已合入记录（分支删除后仍可追溯）、相对集成分支的领先 / 落后、按序集成队列、worktree、「发布到 main」门禁；PR / CI / 审查者在本地仓库显示「暂无」。
- **Agent CLI**（v0.2.0）：设置 › Agent CLI 可添加多个外部 CLI agent（名称、可执行文件、参数模板、续接参数、模型、环境变量），内置 **opencode** 预设（只设定类型，字段需自行填写，可「按示例填写」）；会话顶部可在内置 agent 与 CLI 之间切换。详见下文「使用 opencode」。
- **只读代码查看**（v0.3.0）：单击左侧项目结构中的文件，在任务会话中列以标签页打开（行号、轻量语法高亮）；> 2 MB 不显示、512 KB 以上只显示前 512 KB、二进制不显示；路径限制在项目根内。
- **右键「发送到任务会话」**（v0.3.0）：在应用任意位置右键——选中的文字、代码查看器里的选区 / 某一行 / 文件、文件树节点、看板任务卡、Git 提交节点 / 分支行 / 合入记录——把内容连同来源（`路径:L10-L20`、任务 ID、提交 SHA）插入任务会话输入框，**不会自动发送**。
- **Web 预览与 UI 定位**（v0.3.0，仅开发）：`npm run web` 在浏览器里运行同一套界面；右下角「UI 定位」开启后悬停高亮元素，点击显示它的源文件:行（如 `src/frontend/views/chat.ts:57`）与 CSS 选择器，可一键复制给 AI。
- **两种模型接口**：OpenAI 兼容 `/chat/completions` 与 Anthropic Messages API，均为流式。**Base URL 与模型默认空白**，不预填任何服务商地址或模型名，由你按所用服务填写；未配置时会话里提示「请先在设置中配置 agent」。
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
- 一个 OpenAI 兼容或 Anthropic Messages API 服务的地址、模型 ID 与 API Key（或改用已安装的外部 Agent CLI）

## 快速开始（Windows PowerShell）

```powershell
npm install        # 安装依赖（会下载 Electron 二进制）
npm start          # 编译 TypeScript 并启动应用
```

首次启动会弹出「设置」：选择提供方类型，填写 Base URL / 模型 / API Key（三项默认均为空，输入框里的灰字只是示例）后保存；再点左侧「打开文件夹」选择项目即可开始对话。

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
npm run web             # Web 预览（仅开发）：http://127.0.0.1:5173/，可加 -- --port 5180 --project <目录>
```

**测试规则**：简单 UI 修改（只改 CSS / 文案 / DOM 布局，不涉及 IPC、安全、数据逻辑）不要求新增或修改测试，但仍需 lint + typecheck + build 通过（宪法 五、ADR 0007）。

### Web 预览与 UI 定位

- `npm run web` 启动本地服务器（只监听 `127.0.0.1`，只接受 GET / HEAD），浏览器打开后即是与桌面版相同的渲染层源码（服务器对 `.ts` 做原地类型擦除，行号与源文件一致）。
- 项目、文件树、文件内容、tasks、看板、Git 为**只读**真实数据（默认当前仓库，`--project` 可换目录）；会话、设置、发送消息只在浏览器内存里模拟——**不写文件、不执行命令、不调用模型**，刷新即重置。
- 右下角点「UI 定位」：鼠标悬停的元素高亮并显示 `文件:行`；点击后弹出面板，含源文件:行、CSS 选择器与祖先链，「复制」得到 `src/frontend/views/board-view.ts:29  div.matrix > … > span.id` 这样的一行，直接发给 AI 说明要改哪里。Esc 退出。
- Web 预览只用于开发，`src/frontend/web/` 不被 Electron 入口引用，打包时排除。

## 使用提示

- 单击文件树中的文件打开只读代码标签；要在消息里指代文件，右键文件 →「发送到任务会话」插入 `@路径`。
- 在代码标签里选中几行后右键 →「发送到任务会话」，输入框得到 `` `路径:L起-L止` `` 加代码块；补充说明后再按 Enter 发送。
- 权限模式与模型的切换在**下一条消息**生效；运行中可点「停止」，待批准的请求会被视为拒绝。
- `/specify`、`/plan`、`/tasks`、`/implement` 会让 Agent 优先读取项目中的 Spec Kit 模板与技能文件（`.specify/`、`.agents/skills/`），按其步骤执行。

## 使用 opencode（Agent CLI）

1. 安装 opencode（见 <https://opencode.ai/docs/>）：`npm install -g opencode-ai`，或 `scoop install opencode` / `choco install opencode`；然后执行一次 `opencode auth login` 配置模型提供方（也可以在应用里为该 CLI 添加「敏感」环境变量，如 `ANTHROPIC_API_KEY`，加密保存、只注入 opencode 子进程）。
2. 设置 › Agent CLI › 「添加 opencode 预设」→ 预设只设定类型（opencode JSON 输出），各字段为空、灰字为示例；点「按示例填写」（或手动填写可执行文件 `opencode`、参数 `run` `--format` `json` `--dir` `{cwd}` 等）→ 可选填写模型（`<provider>/<model>`）→ 保存 →「检查」应显示版本号。Windows 上若提示找不到，填写 `opencode.exe` 的完整路径（npm 全局安装位于 `%APPDATA%\npm\node_modules\opencode-ai\bin\opencode.exe`；应用不会经 shell 运行 `opencode.cmd`）。
3. 在「任务会话」顶部的 agent 选择器切换到 opencode，发送消息即可：应用以项目根为工作目录执行 `opencode run --format json --dir <项目根> -- <消息>`（参数数组、不经 shell），逐条显示文本、工具调用与文件改动；之后的消息自动追加 `--session <ID>` 续接同一个 opencode 会话；「停止」会结束 opencode 进程树。
4. 权限映射（ADR 0006）：**仅规划** = 禁止编辑与命令（opencode plan agent）；**自动批准编辑** = 允许编辑、禁止命令；**每次询问** = 每轮启动前先展示完整命令行与将授予的权限，批准后本轮允许编辑与命令。opencode 内部的工具调用无法逐条拦截，但每次调用都会显示并随会话保存。

## 项目结构

```text
ai-code-manager/
├── contracts/            # IPC 与工具契约（唯一权威来源）+ fixtures
├── src/backend/          # Electron 主进程：Agent 循环、模型客户端、工具、存储、workspace/（看板与 Git 快照）、agent-cli/（外部 CLI）
├── src/frontend/         # 渲染进程：纯 DOM + CSS 界面；web/ = Web 预览适配器与 UI 定位（仅开发，不打包）
├── tests/                # unit / integration / e2e，镜像 src 结构
├── specs/001-agent-desktop/  # Spec Kit：桌面 Agent MVP
├── specs/002-workspace-boards/  # Spec Kit：三板块工作台 + Agent CLI
├── specs/003-code-view-web-locator/  # Spec Kit：代码查看、右键发送、Web 预览、配置空白
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
