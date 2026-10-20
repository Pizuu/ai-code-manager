# Feature Specification: 代码查看、发送到任务会话、Web 预览 UI 定位与空白 agent 配置

**Feature Branch**: `003-code-view-web-locator`（多 Agent 模式下按泳道拆为 `feat/<泳道>/T-0xx-*`）

**Created**: 2026-10-20

**Status**: Implemented（converge 追加 2 项待办 T213–T214，见 tasks.md Phase 6）

**Input**: 负责人原话（摘要）：①左侧文件树单击文件即在应用内打开只读代码查看（行号、轻量高亮，大文件 / 二进制保护，路径在项目根沙箱内），按原型风格放在会话板块中间或标签页；②应用任意位置右键出现「发送到任务会话」，把内容（带来源标注：文件路径 + 行号、任务 ID、提交 SHA）插入任务会话输入框并切到任务会话，不自动发送，需经 contracts；③多构建一个 Web 版用来定位 UI 修改：`npm run web` 在浏览器跑同一套渲染层，主进程 API 用模拟 / 只读适配器，「UI 定位」模式悬停高亮、点击显示组件 / 源文件与大致行号、CSS 选择器，一键复制「文件:行 + 选择器」；Web 版不得写真实文件系统 / 执行命令，只在开发用，不进 Electron 打包；④内置 agent 的 API 与 CLI 配置默认保持空白，不预填 ChatGPT / OpenAI 的 base URL、模型名，预设只保留类型与字段说明，未配置时会话提示「请先在设置中配置 agent」，清理代码 / 测试 / 文档中的 gpt 默认值；⑤用户规则：简单 UI 修改跳过测试，写进 AGENTS.md / 宪法并记 ADR。

## Clarifications

### Session 2026-10-20

> 负责人授权 coordinator 按原话自行作答，下列答案即为裁决记录。

- Q: 代码查看器放哪里？ → A: 任务会话板块中列顶部加标签页条：「对话」+ 已打开的文件（可关闭）；单击文件树文件即切到任务会话并打开 / 激活该文件标签。不新增导航板块，保持原型三板块。
- Q: 大文件 / 二进制阈值？ → A: > 2 MB 不显示（提示大小）；512 KB–2 MB 只显示前 512 KB 并提示已截断；前 8000 字节含 NUL 视为二进制不显示；超过 5000 行关闭高亮。
- Q: 右键菜单用原生还是自定义？ → A: 渲染层自定义菜单（Web 预览可复用，不需要新 IPC）；来源模型与 DOM 标记写入 `contracts/ui.ts`。菜单另含「复制」（有选中文本时）。
- Q: 发送的文本格式？ → A: 一段带来源标注的 Markdown：选区 = 引用块 + 来源板块；代码 = `` `path:L10-L20` `` + 代码块；文件 = `@path`；任务卡 = 任务 ID + 标题 + 泳道 / 状态；提交 = 完整 SHA + 说明；分支 = 分支名 @ 短 SHA。插入到光标处，前后补换行，不自动发送。
- Q: Web 版的数据从哪来？ → A: 只读通道（项目、文件树、文件内容、tasks、看板、Git）由本地开发服务器调用主进程同一批只读函数读取当前仓库（或 `--project` 指定目录）；发送、设置、会话等在浏览器内存中模拟，不写盘、不执行命令。
- Q: 「预设只保留类型和字段说明」是否包括 opencode 预设的参数？ → A: 是。「添加 opencode 预设」只设定类型（preset = opencode、输出格式 = opencode JSON）与字段说明，所有值为空，placeholder 显示示例；提供「按示例填写」按钮由用户显式填入。提供方类型（OpenAI 兼容 / Anthropic）保留选择，默认类型「OpenAI 兼容」只是协议类型，不含任何地址或模型。
- Q: 已有用户的设置文件里保存过旧默认值怎么办？ → A: 不改写用户已保存的值（可能是用户自己填的）；只改变新安装 / 未保存时的默认值。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 单击文件查看代码 (Priority: P1)

开发者在左侧项目结构中单击文件，任务会话中列打开该文件的只读标签页，带行号与高亮；可在多个文件标签与「对话」间切换。

**Independent Test**: 单击 `src/frontend/main.ts` → 出现标签页、行号与高亮；单击一张 PNG → 显示「二进制文件，未显示」；`fs:read('../x')` → `E_PATH_ESCAPE`。

### User Story 2 - 右键发送到任务会话 (Priority: P1)

在任意位置右键（选中文本、代码查看器选区 / 行、文件树节点、看板任务卡、Git 提交 / 分支行），选择「发送到任务会话」，内容带来源标注插入输入框并切到任务会话，用户补充后自行发送。

**Independent Test**: 代码查看器选中 3 行右键发送 → 输入框出现 `` `path:L3-L5` `` 与代码块，未发送。

### User Story 3 - Web 预览与 UI 定位 (Priority: P2)

开发者运行 `npm run web`，浏览器打开同一套界面；打开「UI 定位」后悬停高亮元素，点击看到 `src/frontend/views/chat.ts:57` 与 CSS 选择器，一键复制后发给 AI。

**Independent Test**: 定位模式点击对话输入框 → 面板显示 `src/frontend/views/chat.ts:<行>` 与选择器；服务器对 POST 返回 405。

### User Story 4 - agent 配置默认空白 (Priority: P1)

全新安装时设置中 Base URL、模型为空，只有 placeholder 示例；未配置时发送消息得到「请先在设置中配置 agent」。

**Independent Test**: 全新 SettingsStore → `baseUrl === ''`、`model === ''`；未配置时 `agent:send` → `E_NOT_CONFIGURED`。

### Edge Cases

- 符号链接指向项目外 → `E_PATH_ESCAPE`；目录 → `E_VALIDATION`。
- 截断文本最后一行不完整 → 截到最后一个换行。
- 右键位置没有可发送内容且无选区 → 不显示自定义菜单（保留默认行为）。
- 输入框已有内容 → 插入到光标处并补换行。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-301**: 文件树单击文件 MUST 在任务会话中列以只读标签页打开，显示行号与轻量语法高亮。
- **FR-302**: 代码查看 MUST 保护大文件与二进制：> 2 MB 不显示，512 KB–2 MB 截断显示，含 NUL 视为二进制不显示，> 5000 行不高亮。
- **FR-303**: `fs:read` MUST 经项目根沙箱（含 realpath）解析，越界返回 `E_PATH_ESCAPE`，只读普通文件。
- **FR-304**: 应用任意位置右键 MUST 提供「发送到任务会话」，覆盖选中文本、代码查看器选区 / 行 / 文件、文件树节点、看板任务卡、Git 提交 / 分支行；文本带来源标注，插入输入框并切到任务会话，MUST NOT 自动发送。
- **FR-305**: MUST 提供 `npm run web`，在浏览器运行同一套渲染层源码；只读通道走只读适配器，其余通道内存模拟；MUST NOT 写文件或执行命令；只监听 127.0.0.1；不进入 Electron 打包。
- **FR-306**: Web 预览 MUST 提供「UI 定位」开关：悬停高亮，点击显示源文件:行（`data-src`）、CSS 选择器，一键复制「文件:行 + 选择器」。
- **FR-307**: 内置 agent 的 Base URL 与模型默认 MUST 为空；切换提供方 MUST NOT 自动填入地址或模型；opencode 预设值为空、只给 placeholder 示例；代码、测试、文档 MUST NOT 含 ChatGPT / gpt 默认值。
- **FR-308**: 内置 agent 未配置（Base URL 或模型为空）时发送 MUST 返回 `E_NOT_CONFIGURED`，界面提示「请先在设置中配置 agent」。
- **FR-309**: 宪法与 AGENTS.md MUST 记录「简单 UI 修改跳过测试」规则及其边界（ADR 0007）。

### Key Entities

- **FileContent**（`contracts/ipc.ts` v1.2）：relPath、size、kind（text / binary / too-large）、content、truncated。
- **SendSource**（`contracts/ui.ts` v1）：selection / code / file / card / commit / branch。
- **Web 预览只读通道**（`contracts/web-dev.ts` v1）。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-301**: `fs:read` 的越界、符号链接逃逸、目录、二进制、截断、超大 6 种情况有自动化测试。
- **SC-302**: 6 种 SendSource 的格式化与截断有单元测试。
- **SC-303**: Web 预览服务器对非 GET / HEAD 返回 405、白名单外通道返回 404、越界路径返回 `E_PATH_ESCAPE`（手动 curl 验证并记入 quickstart）。
- **SC-304**: 全新设置的 baseUrl / model 为空、切换提供方不回填、未配置发送返回 `E_NOT_CONFIGURED` 有自动化测试；`git grep -i "gpt\|openai\.com"` 在源码 / 测试 / 文档中无默认值或示例命中（package-lock 哈希与描述本规则的文字除外）。
- **SC-305**: 无头 Chromium 截图：Web 版 UI 定位模式与右键菜单各一张（仓库外）。
