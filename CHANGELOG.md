# Changelog

本文件记录项目的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Changed

- 标签页精简为「看板」「任务会话」两个：原「泳道看板」「Git」「Agents」合并为「看板」一页，按信息重要性自上而下分四节——任务进度 → Agent 执行 → 集成与 Git（按序集成在左、提交图与 PR 在右）→ Worktree 与配置；顶部分节跳转条。
- 「项目待办」从右侧上下文栏移到左侧「任务会话」列表底部。
- 会话历史与项目绑定：会话列表 / 项目待办 / 收藏 / 活动徽标只看当前项目；未打开项目时全部为空，发送会提示先打开项目。默认对话为空：启动、切换项目、删除当前会话、新建会话都停在空对话，首条消息发出时才建会话。

### Added

- 任务会话「对话 / 终端」双视图（ADR 0010，照 Orca 形态）：中列顶部「对话 / 终端」分段切换，模式按会话记忆（存本机 localStorage）；终端模式显示项目根下的交互式终端（Windows PowerShell / POSIX bash），可执行命令、看彩色输出，终端进程在切回对话模式后继续运行。
- 终端通道（契约 v1.6，纯增量）：`terminal:open` / `terminal:input` / `terminal:close`，事件 `terminal-data` / `terminal-exit`；工作目录恒为项目根，渲染进程不能指定路径或命令原文。
- 「全部允许（免审批）」权限模式（第 4 种权限模式）：写入与命令不再逐条询问，内置 agent / ACP / serve / run 四条通道一致生效；项目根沙箱不豁免。默认仍为「每次询问」。
- 终端模式以可读输出方式运行本会话的外部 Agent CLI（自动去掉 JSON 输出参数）。
- 图标栏活动徽标 + 状态栏「n 运行中 · n 待批准 · n 错误」（点击直接跳转到对应会话）。
- 错误可追溯：会话列表新增「出错」状态；对话底部新增「错误与日志」分区，集中列出 Agent 报错与工具失败（含工具输出原文）；切换会话时按持久化消息重建，重启后仍可追溯。
- 自动刷新：窗口获得焦点时重拉看板 / Git 快照；主进程只读轮询项目 git 引用，变化时推送 `git-changed` 事件（契约 v1.7）触发重拉。
- 合入冲突预警：看板按任务分支用 `git merge-tree` 只读预演合入集成分支是否冲突，冲突卡显示「合入会冲突」并列出冲突文件（契约 v1.7）。
- 文档：ADR 0010、宪法 1.3.0（原则 九 增加显式豁免、原则 十一 补终端工作目录）、任务卡 T-037 / T-038 / T-039。
- 测试：新增 32 个（ANSI 解析 8、终端进程池 4、终端 IPC 集成 7、终端运行态 3、权限模式 4、对话回合与思考区摘要 6）。

- 会话 token 用量（契约 v1.8）：opencode 三条通道统一采集到会话 `usage` 并落盘——run / serve 取 `step_finish.part.tokens`（total / input / output / reasoning / 缓存读写）逐字段累加（共用 beginCliTurn 的 sink），ACP 取 `usage_update` 的 used（上下文已用总量，整值覆盖）；聊天上下文行在「上下文：…」左侧显示当前会话累计 `Tokens <总数>`，悬停看分解明细。内置 agent 会话暂不采集。
- 会话摘要最后回答耗时（契约 v1.9）：`SessionSummary` 新增可选字段 `lastTurnMs`——后端按最后一个 user 消息 → 最后一个 assistant 消息的墙钟时间计算（含中间工具执行），无完整问答时不带该字段；会话列表改显最后回答耗时（前端展示同批接入）。

### Removed

- Spec Kit 专页与向导、收件箱 / 审批通知提醒器（功能 005，契约 v1.13 整节撤回）及设置「提醒」分区（e05b70c）；旧设置文件里的 `notify` 键读取时丢弃、不报错。
- 斜杠命令 `/specify`、`/plan`、`/tasks`、`/implement`（及 Spec Kit 评估类命令）；现保留 `/init`、`/clear`、`/model`、`/help`。

### Fixed

- opencode 的 question 工具在本客户端必然失败（无承接界面）：此前仅 ACP 通道禁用，现 acp / serve / run 三条对话通道与会话终端模式（管道、非 PTY）统一以 `OPENCODE_ENABLE_QUESTION_TOOL=false` 禁用，serve 另在会话规则集里对 question 显式 deny；win32 的 shell 适配（Git Bash 探测 / PowerShell 回退）同样覆盖终端模式。
- opencode 的命令工具在无 Git Bash 的 Windows 上不可用：启动前按平台适配——探测 Git Bash（安装目录 / PATH）并以 `OPENCODE_GIT_BASH_PATH` 指给 opencode，探测不到时经 `OPENCODE_CONFIG_CONTENT` 指定 `shell=powershell.exe`（用户既有配置优先，不覆盖）；非 Windows 不受影响。
- 集成分支本地缺失时回退 `origin/<分支>`（契约 v1.7 纯增量：`GitSnapshot.integrationRef` / `integrationRefRemote`、`BoardSnapshot.integrationRef` / `integrationRefRemote` / `integrationMissing`）：此前 git 不会把 `manus` 解析成 `origin/manus`，合并记录与 ahead / behind 全部落空，导致看板把 34 张已合入的卡误报为「未合入」；现按实际引用比对，并把这些同因冲突合并为一条，顶部给出根因提示。
- 集成分支名漂移致泳道守卫静默失效：`lane-guard.yml` 的触发分支原为 `dev`（该分支在本地与 origin 均不存在），合入集成分支的 PR 从不触发泳道检查；现改为与 `.agents/config.sh` 的 `INTEGRATION_BRANCH` 一致（当前 `manus`），并新增 `scripts/check-branch-config.sh` 在 CI 与 `verify.sh` 中校验工作流与文档是否漂移。
- 工具调用卡片的文字输出：工具名改用中文标签（原始名以等宽小字并列），头部显示目标路径 / 命令而非重复摘要，参数由裸 JSON 块改为中文标签的键值网格，合法 JSON 结果自动美化并标注行数。

### Changed

- 任务会话对话改为主流对话样式（回合制）：用户消息为右侧气泡 + 时间戳，助手消息为「头部（头像 / agent 短名 / 时间 / 复制 / 重新提问）+ 正文」的回合，正文限宽居中、Markdown 排版（段落 / 列表 / 代码块行高与描边）重做。
- 工具调用收进可折叠的「思考」区：默认折叠为一行摘要（「思考过程 · N 个工具调用 · 状态明细 · 最近一次操作」），点标题展开；有待批准的工具调用时强制展开（批准按钮不会被折叠藏起来），批准后保持展开直到用户手动收起；开合状态在重渲染与切换会话后保持。
- 「正在思考」时自动展开思考区：流式输出中的助手回合（用户未显式收起过）自动展开思考区，让思考 / 工具调用过程可见；展开判定收敛为 `src/frontend/lib/chat-turn.ts` 的 `thinkShouldOpen` 单一口径（待批准强制展开 → 正在思考自动展开 → 用户显式选择 → sticky → 折叠）。
- 集成分支名在文档与任务卡中统一为 `manus`（历史名依次为 `dev` → `hark-dev` → `manus`）；`BOARD.md` 的历史记录保留原样，另加当前分支说明。

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
