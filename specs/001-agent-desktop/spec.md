# Feature Specification: 桌面 AI 编程 Agent（MVP）

**Feature Branch**: `001-agent-desktop`（多 Agent 模式下按泳道拆为 `feat/<泳道>/T-xxx-*`）

**Created**: 2026-10-20

**Status**: Implemented（converge 追加 1 项待办，见 tasks.md Phase 9）

**Input**: User description: "做一个类似 Claude Code 的 Windows 桌面应用：左侧会话列表 + 项目文件夹 + 文件树，中间流式对话与工具调用卡片，右侧 Diff / 终端 / Spec Kit 任务；支持 OpenAI 兼容与 Anthropic 接口；工具包括列目录、读文件、搜索、写/改文件（需批准）、执行命令（需批准）与待办；三种权限模式；斜杠命令 /init /clear /model /specify /plan /tasks /implement；会话本地持久化；中文界面，跟随系统主题；可打包为 Windows 安装包与便携版。"

## Clarifications

### Session 2026-10-20

- Q: 「OpenAI 兼容」具体指什么？ → A: 指 `POST {baseUrl}/chat/completions` + `tools`（function calling）+ `stream: true` 的接口；Base URL 可改，从而支持各类兼容端点（含本地推理服务）。
- Q: 「自动批准编辑」模式下命令是否也自动执行？ → A: 否。命令在任何模式下都需要逐条批准；「仅规划」模式直接拒绝命令与写入。
- Q: 会话存在哪里、什么格式？ → A: 每个会话一个 JSON 文件，存于应用的本机用户数据目录；会话不含密钥，不额外加密。
- Q: 命令的超时与输出上限？ → A: 默认 120 秒，模型可请求最长 600 秒；回传给模型的输出最多 30000 字符，超出截断并注明。
- Q: Tasks 面板是否允许在界面上勾选任务？ → A: MVP 只读展示；勾选由 agent（经批准的 edit_file）或人工修改文件完成。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 打开项目并与 Agent 对话理解代码 (Priority: P1)

开发者打开应用，选择本地项目文件夹，在设置里填好模型服务（提供方、Base URL、模型、API Key），然后用中文提问。Agent 流式回复，过程中自动调用只读工具（列目录、读文件、搜索），每次调用以卡片形式展示参数与结果；复杂任务时 Agent 维护一份待办清单。

**Why this priority**: 没有对话与只读理解，其他能力都无从谈起；这是最小可用的价值闭环。

**Independent Test**: 只实现本故事即可验证：选目录 → 配置 Key → 提问「这个项目是做什么的」→ 看到流式回答和 list_dir / read_file 卡片。

**Acceptance Scenarios**:

1. **Given** 未打开项目，**When** 点击「打开文件夹」并选择目录，**Then** 左侧显示该目录名与可展开的文件树（不显示 .git、node_modules）。
2. **Given** 已配置 Key 并打开项目，**When** 发送问题，**Then** 回答逐字流式出现，Markdown（标题、列表、代码块）正确渲染。
3. **Given** Agent 决定调用 read_file，**When** 调用发生，**Then** 对话中出现工具卡片，显示工具名、参数、状态（运行中/完成/失败）与可折叠的结果。
4. **Given** Agent 请求读取 `../secret.txt` 或绝对路径，**When** 工具执行，**Then** 调用失败并返回「路径越界」，不读取任何项目外文件。
5. **Given** Agent 调用 todo_write，**When** 调用完成，**Then** 界面显示最新待办及状态。

---

### User Story 2 - 审批式修改代码 (Priority: P1)

Agent 提出修改文件时，右侧 Diff 面板与对话卡片同时显示统一 diff，用户点「批准」才写入、点「拒绝」则不写入并告知 Agent。用户可切换权限模式：每次询问 / 自动批准编辑 / 仅规划（只读）。

**Why this priority**: 「改代码」是编程 Agent 的核心价值；审批是安全前提（宪法 九）。

**Independent Test**: 让 Agent「把 README 标题改为 X」：Ask 模式出现 diff 与批准按钮；批准后文件变化；拒绝后文件不变；Plan 模式下直接被拒绝。

**Acceptance Scenarios**:

1. **Given** 模式为「每次询问」，**When** Agent 调用 edit_file，**Then** 显示 diff 与「批准 / 拒绝」，批准前文件不变。
2. **Given** 用户点击「拒绝」，**When** 工具返回，**Then** 文件不变，Agent 收到「用户拒绝」结果并继续对话。
3. **Given** 模式为「自动批准编辑」，**When** Agent 调用 write_file，**Then** 直接写入，Diff 面板仍记录该 diff。
4. **Given** 模式为「仅规划」，**When** Agent 调用 write_file / edit_file，**Then** 调用被拒绝并提示当前为只读模式。
5. **Given** edit_file 的 old_string 在文件中不存在或不唯一，**When** 执行，**Then** 返回明确错误且不写入。

---

### User Story 3 - 审批式执行命令 (Priority: P2)

Agent 需要运行测试或构建时，提出 run_command；用户看到命令原文和 shell（Windows 为 PowerShell）后批准，输出实时显示在右侧终端面板，结束后退出码与输出回传给 Agent。

**Why this priority**: 跑测试/构建让 Agent 能自我验证，但可以在只读与改代码之后交付。

**Independent Test**: 让 Agent 运行 `node -v`：出现批准请求；批准后终端面板显示版本号与退出码。

**Acceptance Scenarios**:

1. **Given** 任意非 Plan 模式（包括自动批准编辑），**When** Agent 调用 run_command，**Then** 必须先批准。
2. **Given** 命令已批准，**When** 运行中产生输出，**Then** 终端面板实时追加 stdout/stderr。
3. **Given** 命令超过超时时间，**When** 超时触发，**Then** 进程被终止并返回「超时」。
4. **Given** 用户点击「停止」，**When** Agent 正在等待批准或运行命令，**Then** 待批准请求视为拒绝、进程被终止。

---

### User Story 4 - 会话管理与持久化 (Priority: P2)

左侧列出历史会话，可新建、切换、删除；关闭应用重新打开后会话（消息、工具调用记录、待办）全部恢复。`/clear` 清空当前会话。

**Why this priority**: 多任务切换与可追溯（宪法 十三）是日常使用必需，但不阻塞单次对话。

**Independent Test**: 新建两个会话各发一条消息 → 重启应用 → 两个会话及内容都在；删除其一后不再出现。

**Acceptance Scenarios**:

1. **Given** 有多个会话，**When** 点击其中一个，**Then** 中间区域显示其完整历史（含工具卡片）。
2. **Given** 应用重启，**When** 打开会话列表，**Then** 所有会话按最近更新排序出现。
3. **Given** 输入 `/clear`，**When** 回车，**Then** 当前会话消息与待办清空，会话本身保留。

---

### User Story 5 - Spec Kit 工作流支持 (Priority: P3)

对于使用 Spec Kit 的项目，右侧 Tasks 面板解析 `specs/*/tasks.md` 显示任务、完成状态、泳道与并行标记；输入 `/specify <需求>`、`/plan`、`/tasks`、`/implement` 会发送对应的模板化提示；`/init` 让 Agent 分析项目并（经批准）写入 AGENTS.md；`/model <名称>` 切换模型。

**Why this priority**: 面向 Spec Kit 用户的增值能力，依赖前四个故事。

**Independent Test**: 打开含 specs/001-x/tasks.md 的项目，Tasks 面板列出任务；输入 `/model gpt-4o-mini` 后设置中的模型变化。

**Acceptance Scenarios**:

1. **Given** 项目含 `specs/001-x/tasks.md`，**When** 打开 Tasks 标签，**Then** 按功能与 Phase 分组显示任务及 [x]/[ ]、[P]、泳道。
2. **Given** 输入 `/specify 增加登录`，**When** 回车，**Then** 发送包含 Spec Kit specify 指令与需求文本的提示。
3. **Given** 输入 `/init`，**When** Agent 完成分析，**Then** 以 write_file 提议 AGENTS.md，并走审批。
4. **Given** 输入未知命令 `/foo`，**When** 回车，**Then** 提示未知命令并列出可用命令，不发送给模型。

---

### Edge Cases

- 未配置 API Key 时发送消息 → 提示先在设置中填写 Key，不发起请求。
- 未打开项目时发送消息 → 允许纯对话，但文件/命令工具返回「未打开项目」。
- 模型服务返回 4xx/5xx 或网络中断 → 显示错误（不含 Key），会话保留已收到的内容。
- 模型返回的工具参数不是合法 JSON → 工具返回参数错误，循环继续。
- 模型在单轮中连续调用工具超过上限（25 轮）→ 停止并提示。
- 读取二进制或超大文件 → 返回说明而不是乱码。
- 符号链接指向项目外 → 视为越界。
- Windows 路径大小写、`C:\` 与 `/` 混用 → 统一规范化后判定。
- safeStorage 不可用（例如 Linux 无钥匙串）→ 拒绝保存 Key 并提示。
- 同一会话已在运行时再次发送 → 拒绝（E_BUSY）。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 用户 MUST 能选择本地文件夹作为项目，系统显示懒加载文件树（忽略 .git、node_modules、dist）。
- **FR-002**: 用户 MUST 能配置提供方（OpenAI 兼容 / Anthropic）、Base URL、模型与 API Key。
- **FR-003**: 系统 MUST 加密保存 API Key，且永不把 Key 发送到界面层（只告知是否已配置）。
- **FR-004**: 系统 MUST 流式显示助手回复，并以安全方式渲染 Markdown（先转义，再格式化）。
- **FR-005**: Agent MUST 能调用只读工具 list_dir、read_file、search，调用以卡片展示名称、参数、状态与结果。
- **FR-006**: 所有文件类工具 MUST 把路径限制在项目根内，越界（含符号链接）一律拒绝。
- **FR-007**: write_file / edit_file MUST 先生成统一 diff 并在 Diff 面板与卡片中展示，按权限模式请求批准后才写入。
- **FR-008**: run_command MUST 在执行前请求批准；Windows 使用 PowerShell，其他平台使用 bash；输出实时显示；支持超时（默认 120 秒，最长 600 秒）。
- **FR-009**: 系统 MUST 提供三种权限模式：每次询问、自动批准编辑（命令仍需批准）、仅规划（拒绝写入与命令）。
- **FR-010**: 用户 MUST 能随时停止 Agent；停止时待批准请求视为拒绝、运行中的命令被终止。
- **FR-011**: Agent MUST 能通过 todo_write 维护待办，界面显示最新待办。
- **FR-012**: 系统 MUST 把会话（消息、工具调用记录、待办）持久化到本机用户数据目录，支持新建、切换、删除，重启后恢复。
- **FR-013**: 输入框 MUST 支持斜杠命令 /init、/clear、/model、/specify、/plan、/tasks、/implement、/help；未知命令本地提示。
- **FR-014**: 系统 MUST 解析项目 `specs/*/tasks.md` 并在 Tasks 面板只读展示任务、完成状态、[P] 与泳道。
- **FR-015**: 界面 MUST 使用简体中文并跟随系统明暗主题。
- **FR-016**: 项目 MUST 能打包为 Windows x64 安装包（NSIS）与便携版。

### Key Entities *(include if feature involves data)*

- **设置（Settings）**: 提供方、Base URL、模型、权限模式、各提供方是否已配置 Key、最近项目；Key 本身只以密文存在主进程侧。
- **项目（Project）**: 一个本地根目录；所有文件工具与命令的边界。
- **会话（Session）**: 标题、所属项目、时间戳、消息列表、待办列表。
- **消息（Message）**: 角色（用户/助手/工具）、文本、助手提出的工具调用。
- **工具调用（Tool Call）**: 名称、参数、状态、结果、diff。
- **审批请求（Approval）**: 类型（编辑/命令）、diff 或命令原文、所属工具调用。
- **规格任务（Spec Task）**: 任务号、完成状态、并行标记、用户故事、泳道、描述、所在阶段。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 新用户从首次打开到收到第一条流式回复不超过 2 分钟（含选目录与填写 Key）。
- **SC-002**: 「每次询问」模式下，未经批准发生的文件写入与命令执行次数为 0（由自动化测试验证）。
- **SC-003**: 越界路径用例（`..`、绝对路径、其他盘符、UNC、指向外部的符号链接）100% 被拒绝（由自动化测试验证）。
- **SC-004**: 界面层可访问的任何数据中都不包含 API Key 明文（由契约类型与代码审查验证）。
- **SC-005**: 重启应用后 100% 的会话及其工具调用记录被恢复（由自动化测试验证存取一致）。
- **SC-006**: 流式文本在收到后一帧内（约 16 ms）渲染到界面，长回复过程中界面不卡顿。

## Assumptions

- 目标用户是熟悉命令行与 Git 的开发者，主要在 Windows 10/11 x64 上使用；macOS/Linux 可运行但不是 MVP 打包目标。
- 用户自备模型服务的 API Key；应用不提供账号体系与计费。
- 单用户、单机使用；不做多窗口与多人协作。
- 不做 Git 操作 UI、代码补全、内嵌编辑器；需要时由 Agent 经批准运行 git 命令。
- 应用自动更新与代码签名不在 MVP 范围。
