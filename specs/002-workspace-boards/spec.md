# Feature Specification: 三板块工作台与 Agent CLI（opencode）

**Feature Branch**: `002-workspace-boards`（多 Agent 模式下按泳道拆为 `feat/<泳道>/T-0xx-*`）

**Created**: 2026-10-20

**Status**: Implemented（converge 追加 3 项待办 T123–T125，见 tasks.md Phase 8）

**Input**: User description: "做进应用；增加 agent cli 配置，以 opencode 为例，能够完整在对话框中使用；再次对比设计文件，复刻复制 UI，三个 title 对应三个板块。"（设计稿：Figma 文件 `zoKZUtZnIFpZXA6vpmf9s4` 节点 `2002:4070` 下三个 frame——`2004:30564`「栖岸 · 泳道看板」、`2004:31047`「栖岸 · 任务会话」、`2004:31674`「栖岸 · Git 分支与集成」。）

## Clarifications

### Session 2026-10-20

> 负责人授权 coordinator 按设计稿与原话自行作答，下列答案即为裁决记录。

- Q: 视觉基准是什么？ → A: 负责人补充（优先级最高）：以 `/workspace/work/figma/out/board.html`、`session.html`、`git.html` 三份 HTML 原型为 1:1 视觉基准——沿用其 DOM 结构、CSS（颜色、字体栈、间距、圆角、阴影）、图标与布局，移植为应用三个板块，把原型中的静态快照数据换成主进程提供的真实数据；Figma 只在原型缺细节时参考（例如用户消息气泡）。样式可抽成共享 CSS，但视觉结果须与原型一致；CSP 下不用内联脚本、不加载外链字体。
- Q: 「三个 title」放在哪里？ → A: 按设计稿：左侧导航栏（项目选择器下方）三个导航项，文案取三个 frame 的标题「泳道看板」「任务会话」「Git 分支与集成」；页头副标题与「当前 · xxx」同步显示当前板块。设计稿中导航项的占位文案「Title」不照抄。
- Q: 板块数据从哪里来？ → A: 全部来自当前打开项目的真实文件与 git：看板读 `.agents/lanes.conf`、`.agents/config.sh`、`docs/tasks/T-*.md`、`docs/tasks/BOARD.md`、`specs/*/tasks.md` 并以 git 合并记录推导真实状态；Git 板块由主进程调用 git CLI 只读采集。设计稿中的示例数据（栖岸、003 预约改期、PR #31 等）一律不出现。
- Q: 本地读不到的数据（PR、CI、审查者、Owner 姓名）怎么显示？ → A: 明确显示「暂无」并说明原因（例如「本地仓库无远端」），不得伪造。
- Q: 「任务会话」板块与原来的对话界面是什么关系？ → A: 就是原对话界面按设计稿重排：左列 = 项目会话列表，中列 = 对话（含工具卡片、diff 审批、斜杠命令、停止），右列 = 会话上下文（agent、权限、待办、文件修改、终端输出、Spec 任务）。原有能力一项不减。
- Q: 设计稿只有浅色稿，暗色主题怎么办？ → A: 浅色严格按设计稿；暗色沿用同一布局，仅替换为同色系的暗色变量（宪法 十四 跟随系统）。
- Q: Agent CLI 需要支持哪些 CLI？ → A: 通用「外部 CLI agent」配置（名称、可执行文件、参数模板、环境变量、模型），输出解析支持「opencode JSON 事件流」与「纯文本」两种；内置 opencode 预设。工作目录固定为当前项目根，不可配置。
- Q: 外部 CLI 的文件写入与命令如何满足宪法 九（写入与执行须批准）？ → A: 外部 CLI 用它自己的工具执行，应用无法逐条拦截；因此按权限模式映射 CLI 自身权限：「仅规划」= 禁止编辑与命令；「自动批准编辑」= 允许编辑、禁止命令；「每次询问」= 每一轮调用前先向用户展示完整命令行与将授予的权限，用户批准后该轮允许编辑与命令。每个工具调用（含参数、结果、可得的 diff）照常显示并随会话持久化。此偏差记入 ADR 0006。
- Q: opencode 不可用时怎么办？ → A: 发送前解析可执行文件；找不到或启动失败时在对话中给出中文错误与安装指引（`npm install -g opencode-ai`、`scoop install opencode`、`choco install opencode`，或在设置中填写 `opencode.exe` 完整路径），设置页提供「检查」按钮。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 三个板块导航与设计稿一致 (Priority: P1)

开发者打开应用，左侧导航有「泳道看板」「任务会话」「Git 分支与集成」三项，点击切换右侧整块工作区；整体布局（图标栏、项目栏、页头、状态栏）、颜色、字号、间距、圆角与设计稿一致。

**Why this priority**: 用户明确要求「复刻 UI，三个 title 对应三个板块」，是其他故事的承载框架。

**Independent Test**: 打开任一项目，依次点三项导航，每次页头副标题与「当前 · xxx」随之变化，截图与设计稿并排比较布局一致。

**Acceptance Scenarios**:

1. **Given** 已打开项目，**When** 点击「泳道看板」，**Then** 工作区显示看板，导航项高亮（浅橙底、橙色字），页头副标题为「泳道看板」。
2. **Given** 任一板块，**When** 点击「任务会话」或「Git 分支与集成」，**Then** 切换到对应板块且不丢失对话状态与运行中的 agent。
3. **Given** 未打开项目，**When** 进入看板或 Git 板块，**Then** 显示「请先打开项目」的空状态与打开按钮。

---

### User Story 2 - 泳道看板显示真实任务状态 (Priority: P1)

协调人在看板上看到当前功能、Spec Kit 阶段、Worker 容量，以及「泳道 × 状态」矩阵中的任务卡；状态由 git 推导，若 BOARD.md / 任务卡声明与 git 不一致，卡片上明确提示。

**Why this priority**: 看板是多 Agent 协作的总览，数据必须真实可信。

**Independent Test**: 对一个含 `.agents/lanes.conf` 与 `docs/tasks/` 的仓库调用看板，卡片列与 git 合并记录一致；人为把一张未合入卡写成 done，看板出现冲突提示。

**Acceptance Scenarios**:

1. **Given** 任务卡分支已 `--no-ff` 合入集成分支（之后分支已删除），**When** 打开看板，**Then** 该卡在「已合入」列，显示合并提交短 sha。
2. **Given** 任务卡前置未全部合入，**When** 打开看板，**Then** 卡在「已阻塞」列，并写出等待哪些卡。
3. **Given** BOARD.md 写 done 但 git 未合入，**When** 打开看板，**Then** 卡片显示「看板声明 done · git 未合入」，冲突列表中有该卡。
4. **Given** 搜索框输入任务号、按泳道 / Agent 筛选或关闭「显示已完成」，**When** 输入，**Then** 矩阵即时过滤。
5. **Given** 项目没有 `.agents/lanes.conf`，**When** 打开看板，**Then** 显示「此项目未配置泳道」的空状态，不报错。

---

### User Story 3 - Git 分支与集成 (Priority: P2)

开发者看到分支拓扑图（main、集成分支、各任务分支）、每条分支相对集成分支的领先 / 落后、已合入记录、按序集成队列、worktree 列表与「发布到 main」门禁；PR / CI / 审查者显示「暂无」。

**Why this priority**: 集成状态是协调的第二视角；依赖看板的任务卡数据。

**Independent Test**: 在临时仓库中造出 main / 集成分支 / 一条已合入并删除的任务分支 / 一条未合入分支，Git 板块列出正确的 ahead/behind、合并记录与 worktree。

**Acceptance Scenarios**:

1. **Given** 一条未合入分支领先集成分支 2 个提交，**When** 打开 Git 板块，**Then** 其行显示「领先 2 / 落后 0」。
2. **Given** 集成分支上有 `merge: feat/x/T-1-a` 合并提交且分支已删除，**When** 打开，**Then** 合并记录仍列出 `feat/x/T-1-a` 及其短 sha。
3. **Given** 本地仓库没有远端，**When** 打开，**Then** PR、CI、审查者处显示「暂无」及原因。
4. **Given** 打开的目录不是 git 仓库，**When** 打开，**Then** 显示「不是 Git 仓库」的空状态。

---

### User Story 4 - 配置 Agent CLI 并在对话中完整使用 opencode (Priority: P1)

开发者在设置的「Agent CLI」页添加 opencode（内置预设一键填好参数），在任务会话里把会话的 agent 切换为 opencode，发送消息后看到 opencode 的输出（文本、工具调用、文件改动）逐条出现；再次发送时续接同一个 opencode 会话；可随时停止；重启后会话仍在。

**Why this priority**: 用户明确要求「以 opencode 为例，能够完整在对话框中使用」。

**Independent Test**: 用一个输出与真实 opencode 相同 JSON 事件流的假可执行文件，跑完「首轮 → 续接 → 停止 → 不可用报错」四条路径。

**Acceptance Scenarios**:

1. **Given** 设置中已添加 opencode 预设，**When** 会话 agent 选为 opencode 并发送消息，**Then** 主进程以项目根为工作目录、以参数数组（不经 shell）启动 opencode，文本与工具卡片逐条显示。
2. **Given** 首轮返回了 opencode 会话 ID，**When** 发送第二条消息，**Then** 命令行带上 `--session <该 ID>`，opencode 续接同一会话。
3. **Given** opencode 运行中，**When** 点击停止，**Then** 进程（含子进程）被结束，界面恢复可发送状态，已收到的输出保留。
4. **Given** 可执行文件不存在，**When** 发送消息，**Then** 对话中显示中文错误与安装指引，不崩溃。
5. **Given** 权限模式为「每次询问」，**When** 发送消息，**Then** 先出现批准卡片，展示完整命令行与将授予的权限；拒绝则不启动进程。
6. **Given** 某环境变量标为敏感（如 API Key），**When** 保存后重新打开设置，**Then** 只显示「已保存」，渲染进程拿不到值；变量只注入子进程环境。

---

### User Story 5 - 内置 API agent 保留并可选择 (Priority: P2)

原有 OpenAI 兼容 / Anthropic 内置 agent 保持可用；任务会话顶部的 agent 选择器可在内置 agent 与已配置的 CLI agent 之间切换，新会话使用设置中的默认 agent。

**Why this priority**: 不能因新增 CLI 而丢失既有能力。

**Independent Test**: 内置 agent 的既有测试全部通过；切换会话 agent 后发送走对应路径。

**Acceptance Scenarios**:

1. **Given** 会话 agent 为内置，**When** 发送，**Then** 行为与 001 完全一致（工具审批、diff、终端）。
2. **Given** 会话运行中，**When** 尝试切换 agent，**Then** 被拒绝并提示先停止。

### Edge Cases

- CLI 输出非 JSON 行（例如警告）：作为终端输出显示，不中断解析。
- CLI 以非零码退出：显示退出码与 stderr 末尾（截断，最多 2000 字符）。
- 项目路径或提示词含空格、中文、引号、以 `-` 开头：参数数组传递，提示词前加 `--`，不被当作选项。
- Windows 上 `opencode` 由 npm 安装为 `opencode.cmd` 包装脚本：自动定位同目录 `node_modules/opencode-ai/bin/opencode.exe`；无法定位时提示填写 exe 完整路径（不经 shell 执行 .cmd）。
- 仓库很大：提交图只取最近 200 个提交；看板只解析 `docs/tasks/T-*.md`。
- 任务分支合入后已删除：状态从集成分支的合并提交说明推导。
- 打开的项目不是本仓库风格（无 lanes.conf / 无 docs/tasks）：看板空状态，Git 板块仍可用。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-101**: 应用 MUST 提供三个板块导航「泳道看板」「任务会话」「Git 分支与集成」，切换时保留对话与运行状态。
- **FR-102**: 外框（52px 图标栏、220px 项目栏、80px 页头、32px 状态栏）及三个板块的 DOM 结构、布局、颜色、字体栈、字号、圆角、阴影与图标 MUST 1:1 沿用三份 HTML 原型（原型缺的细节参考 Figma 节点数据）；浅色严格一致，暗色同布局。
- **FR-103**: 项目栏 MUST 显示项目名与描述（package.json）、项目结构树（真实目录，标出契约目录）与共享热点文件说明（lanes.conf `@shared`）。
- **FR-104**: 看板 MUST 解析 `.agents/lanes.conf`、`.agents/config.sh`、`docs/tasks/T-*.md`、`docs/tasks/BOARD.md`、最新 `specs/*/tasks.md`，并以集成分支的合并记录、分支存在性与前置任务推导每张卡的状态（可派工 / 进行中 / 待审查 / 已阻塞 / 已合入）。
- **FR-105**: 看板 MUST 标出声明状态与 git 不一致的卡，并汇总冲突。
- **FR-106**: 看板 MUST 显示功能标题、Spec Kit 阶段完成情况、tasks.md 勾选数、Worker 容量（执行中 / MAX_PARALLEL），并支持搜索、按泳道 / Agent 筛选、隐藏已完成。
- **FR-107**: Git 板块 MUST 由主进程以 git CLI（参数数组、只读、`--no-optional-locks`）采集分支、提交图、相对集成分支的 ahead/behind、合并记录、worktree、标签、远端与未提交文件数。
- **FR-108**: Git 板块 MUST 绘制分支拓扑图，列出未合入分支与已合入记录、按序集成队列、worktree 卡片与「发布到 main」门禁；PR / CI / 审查者显示「暂无」。
- **FR-109**: 任务会话板块 MUST 以设计稿三列布局承载原对话的全部能力（流式消息、工具卡片、diff 审批、终端、待办、Spec 任务、斜杠命令、停止、会话列表）。
- **FR-110**: 设置 MUST 新增「Agent CLI」配置：可增删改多个外部 CLI agent（名称、可执行文件、参数模板、续接参数、模型参数、模型、输出格式、环境变量），内置 opencode 预设，并可检查可用性。
- **FR-111**: 会话 MUST 可选择使用内置 API agent 或任一 CLI agent；新会话使用默认 agent；运行中不可切换。
- **FR-112**: CLI agent MUST 以当前项目根为工作目录、以参数数组启动（不经 shell 拼接），流式显示文本、工具调用与文件改动，并在多轮中续接同一 CLI 会话。
- **FR-113**: CLI agent MUST 可停止（结束进程树），停止后保留已收到的输出；会话（含 CLI 会话 ID 与工具调用）持久化。
- **FR-114**: CLI 不可用或异常退出时 MUST 给出中文错误与安装指引。
- **FR-115**: CLI 的敏感环境变量 MUST 加密保存在主进程，只注入子进程，不进入渲染进程、事件、日志。
- **FR-116**: CLI agent MUST 按权限模式映射 CLI 自身权限（仅规划 = 禁止编辑与命令；自动批准编辑 = 允许编辑、禁止命令；每次询问 = 每轮先批准命令行），批准请求展示完整命令行。

### Key Entities

- **AgentCliConfig**：外部 CLI agent 的配置（含敏感环境变量的加密值，只存主进程）。
- **AgentRef**：会话所用 agent 的引用（内置 / 某个 CLI）。
- **BoardSnapshot / BoardCard**：看板快照与任务卡（声明状态 + git 推导状态）。
- **GitSnapshot**：分支、提交图、合并记录、worktree 的只读快照。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-101**: 三个板块在 1680×1200 视口下的无头截图与对应 HTML 原型截图并排对比，外框尺寸（图标栏、项目栏、页头、状态栏）误差 ≤ 2px，主要区块位置、配色与字号一致（对比结论记录于 quickstart）。
- **SC-102**: 看板与 Git 板块在本仓库上显示的已合入卡数、合并记录与 `git log --first-parent --merges hark-dev` 完全一致（集成测试断言临时仓库）。
- **SC-103**: 使用假 opencode 可执行文件的集成测试覆盖首轮、续接（断言 `--session`）、停止（进程被结束）、不可用报错、敏感变量不外泄五条路径，全部通过。
- **SC-104**: 001 的全部既有测试继续通过；`scripts/verify.sh` 与 `scripts/security-check.sh` 通过。
- **SC-105**: 渲染进程收到的任何 IPC 返回与事件中不含敏感环境变量值（测试断言）。

## Assumptions

- 用户本机已安装 git（Git 板块与看板状态推导依赖）；未安装时两板块显示空状态。
- opencode 版本以 1.19.x 的 `run --format json` 事件格式为准；格式变化时未知事件作为终端输出显示，不崩溃。
- 设计稿使用的 Anthropic Sans 字体不随应用分发，以系统中文字体替代（Segoe UI / 微软雅黑），字号与行高按设计稿。
