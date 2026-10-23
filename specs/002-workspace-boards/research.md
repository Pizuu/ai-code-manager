# Research: 三板块工作台与 Agent CLI

**Feature**: `002-workspace-boards` | **Date**: 2026-10-20

## R1. 设计稿来源与复刻方式

> **2026-10-20 负责人补充（优先级最高）**：视觉基准改为三份 HTML 原型 `/workspace/work/figma/out/{board,session,git}.html`（由 `template.html` + 仓库快照渲染，其 CSS 本身取自下列 Figma 度量）。实现 1:1 沿用原型的 DOM 类名结构、CSS 与 SVG 图标，只把快照数据换成 IPC 实时数据；截图对比以原型截图为基准。Figma 数据只用于原型缺失的细节。

- **数据来源**：Figma REST API（`GET /v1/files/zoKZUtZnIFpZXA6vpmf9s4/nodes?ids=2004:30564,2004:31047,2004:31674` 与 `GET /v1/images/...?format=png&scale=1`）。三个 frame 均为 1680×1200。节点树（位置、尺寸、填充色、描边、圆角、自动布局间距、字体）导出为文本清单，作为像素对照依据；PNG 作为视觉对照基准。
- **关键度量（取自节点数据）**：
  - 外框：图标栏 `Workspace rail` 52×1200，底色 `#F9F9F7`，右描边；项目栏 `Project explorer` 220 宽，底色 `#FAF9F5`，描边 `#E8E6DF`；页头 `Workspace header` 高 80，左右内边距 28；状态栏 `Workspace status` 高 32，左右内边距 24，文字 11px `#73726C`。
  - 项目选择器高 80（内边距 18，徽标 32×32 圆角 8 底 `#F5E9E2`）；「当前 · xxx」12px `#C6613F`；导航项 44 高、左右内边距 24、图标 24、图标与文字间距 16，选中底 `#F5E9E2`、文字 `#C6613F`。
  - 项目结构标题行内边距 28/18/10/18；目录项 28 高、等宽 11px，子项缩进 15；所有权说明区内边距 18、顶部分隔线。
  - 看板工作区内边距 24、纵向间距 16：功能概览 43 高；进度条 48 高底 `#FAF9F5` 圆角 8；容量行 44 高；控件行 44 高（搜索框 224×44 圆角 10）；泳道矩阵描边 `#E8E6DF` 圆角 10，首列 152，五个状态列等分，卡片圆角 8、进行中卡片描边 `#C6613F`。
  - 会话：会话列表 232 宽；中列顶部 56 高（两个 44 圆形按钮 + 模型名 17px 600）；右侧上下文 312 宽；输入框圆角 14、发送按钮 32×32 圆角 8 底 `#C6613F`。
  - Git：主栏 + 右栏 364 宽、间距 20；分支图面板圆角 10；PR 行圆角 8；worktree 三列卡片。
  - 色板：墨色 `#141413`、次墨 `#3D3D3A`、弱化 `#73726C`、强调 `#C6613F` / `#D97757`、强调浅底 `#F5E9E2`、标签底 `#F5F4ED`、成功 `#265B19` / `#E9F1DC`、警示 `#5A4815` / `#F6EFD8`、信息 `#1B67B2`。
- **字体**：设计稿用 Anthropic Sans / JetBrains Mono（未授权分发）→ 以 Segoe UI / 微软雅黑 / PingFang 与 Cascadia Code / Consolas 替代，保持字号与行高（12/17、11/16、14/20、15）。
- **复刻方式**：原型（`template.html`）是字符串拼接 + 内联脚本 + 少量内联 `style=` 属性，不满足应用 CSP（`script-src 'self'`、`style-src 'self'` 禁止内联脚本与内联 style 属性）与 `h()` 安全 DOM 约定 → 原型 `<style>` 整体移入 `src/frontend/styles.css`（类名不改），内联 `style=` 改为等价的工具类；DOM 用 `h()` 按原型同样的元素与类名构建，SVG 图标以相同 path 用 `createElementNS` 生成；字体栈原样沿用（原型未加载任何外链字体，无需本地化）。
- **Decision**：以节点数据为准写 CSS 变量与尺寸；浅色严格一致，暗色只换变量。
- **Alternatives**：① 直接嵌入原型 HTML（iframe）——违反 CSP 与 IPC 白名单，数据也无法实时；② 引入 UI 框架——违反 ADR 0001（无框架）。

## R2. 看板状态推导

- **Decision**：状态以 git 为准，声明为辅：
  1. 集成分支 first-parent 上存在说明为 `merge: <分支>` 的合并提交 → `merged`（分支删除后仍成立）；
  2. 否则分支存在：领先集成分支 > 0 → `review`，= 0 → `active`；
  3. 否则看前置：全部 `merged` → `ready`，否则 `blocked`。
  4. 声明 `done` 而推导非 `merged` → `declaredMismatch`。
- **Rationale**：用户偏好合入后删除任务分支，所以「分支存在」不能作为唯一依据；合并提交说明由 coordinator 统一写成 `merge: <分支>`（001 已遵守）。
- **Alternatives**：只信 BOARD.md——会出现原型里「BOARD 标 done 但 git 未合入」的不一致；只看 `git branch --merged`——分支删除后丢失信息。
- **泳道检查**：与 `scripts/check-lane.sh` 同语义（bash `[[ == ]]` 模式，`*` 跨目录、`!` 排除、`@shared` 优先）；用自写的 bash-glob → RegExp 转换，单测对照脚本行为。

## R3. Git 采集

- **Decision**：主进程 `execFile('git', ['--no-optional-locks', '-C', root, ...])`，参数数组、不经 shell、只读命令（`for-each-ref`、`log --topo-order`、`rev-list --count`、`merge-base --is-ancestor`、`worktree list --porcelain`、`status --porcelain`、`tag`、`remote`）；提交图上限 200；单条命令超时 15 秒；`maxBuffer` 16 MB。
- **Rationale**：零第三方依赖（ADR 0001）；`--no-optional-locks` 避免刷新索引与正在工作的 agent 冲突。
- **Alternatives**：isomorphic-git / nodegit——新增依赖与原生模块，打包复杂。

## R4. opencode 集成方式

阅读官方文档 <https://opencode.ai/docs/cli/>（2026-10-19 更新）与 <https://opencode.ai/docs/>，并在沙箱中安装 `opencode-ai@1.19.3`（npm）实测：

| 方式 | 结论 |
|---|---|
| `opencode run [message..] --format json` | **采用**。文档化的非交互模式；stdout 为 JSONL 事件（实测类型：`step_start`、`text`、`tool_use`、`step_finish`、`error`），每行带 `sessionID`；`--session <id>` 续接、`--model provider/model`、`--agent`、`--dir`。进程结束即一轮结束，停止 = 结束进程树，最简单可靠。 |
| `opencode serve` + HTTP/SSE | 落选（暂）。可逐条转发权限请求、可得 token 级增量，但需管理常驻服务器、端口与认证、事件 schema 更易随版本变化（官网同时在推 v2）；作为后续增强（可逐条审批）记录在 ADR 0006。 |
| `opencode acp`（stdio nd-JSON，ACP 协议） | 落选（暂）。协议更通用，但需要实现 ACP 客户端会话管理，超出本次范围。 |
| 默认格式（彩色文本） | 落选：无结构，无法区分工具调用与文本。 |

实测要点（opencode 1.19.3，见 `contracts/fixtures/opencode-*.jsonl`）：

- 文本以 `type:"text"` 的完整 part 出现（每步一个），不是逐 token；因此界面按事件到达逐条流式追加。
- 工具以 `type:"tool_use"` 出现，`part.tool`（write / edit / bash / read / todowrite …）、`part.callID`、`part.state.status`（completed / error）、`state.input`、`state.output` / `state.error`、`state.metadata`（edit 类有 diff，write 有 `exists`）。
- 权限：环境变量 `OPENCODE_PERMISSION`（内联 JSON）可设 `{"edit":"deny|ask|allow","bash":...}`。`run` 模式下 `ask` 会被**自动拒绝**（stderr：`permission requested: edit (hello.txt); auto-rejecting`，事件中 `state.status:"error"`、`error:"The user rejected permission to use this specific tool call."`）。`--auto` 会自动批准所有未明确拒绝的权限（文档标注 dangerous）——本应用不使用。
- 失败时输出 `type:"error"` 事件（例如免费模型 403、模型 404），进程退出码 1。
- 续接：第二轮 `--session <首轮 sessionID>` 后 sessionID 不变，模型收到完整历史（假模型服务器日志确认）。
- 提示词：放在 `--` 之后，避免以 `-` 开头的提示词被当作选项。
- Windows：官方安装途径 `npm install -g opencode-ai`、`scoop install opencode`、`choco install opencode`（官网同时推荐 WSL）。npm 包的 `bin` 为 `bin/opencode.exe`，全局安装生成 `opencode.cmd` 包装脚本；Node 不能不经 shell 直接 spawn `.cmd`，因此解析器在找到 `.cmd` 时定位同目录 `node_modules/opencode-ai/bin/opencode.exe`，找不到则要求填写 exe 完整路径。
- **权限映射（Decision）**：仅规划 → `{"edit":"deny","bash":"deny"}` + `--agent plan`；自动批准编辑 → `{"edit":"allow","bash":"deny"}`；每次询问 → 每轮先发 `kind:'command'` 审批（命令行原文 + 权限说明），批准后 `{"edit":"allow","bash":"allow"}`。
- **真实冒烟**：沙箱无模型 Key，免费模型被 opencode 服务端 403 拒绝（验证了错误路径）；另用本地假 OpenAI 兼容服务器（`OPENCODE_CONFIG_CONTENT` 配置自定义 provider）跑通真实 opencode 二进制的「文本 → write 工具 → 续接」全流程，fixtures 即为此输出。

## R5. Agent CLI 配置存储

- **Decision**：并入现有 `settings.json`（`agentClis` 数组）；敏感环境变量值用同一 `KeyCipher`（safeStorage）加密，`safeStorage` 不可用时拒绝保存敏感值；`PublicSettings.agentClis` 只给 `hasValue`。
- **Alternatives**：单独文件——多一处原子写与迁移逻辑，无收益。

## R6. 进程管理

- **Decision**：`spawn(file, args, { cwd: projectRoot, env, shell: false, windowsHide: true })`，POSIX 下 `detached: true` 以便 `kill(-pid)` 结束进程组；Windows 用 `taskkill /pid <pid> /T /F`（参数数组）。stdout 按行切分、UTF-8 解码；stderr 保留末尾 2000 字符用于报错。
- **Rationale**：复用 001 `run-command.ts` 的结束进程树做法；满足「参数不经 shell 拼接」。
