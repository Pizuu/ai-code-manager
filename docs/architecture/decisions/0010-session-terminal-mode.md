# ADR 0010：任务会话的「对话 / 终端」双视图，与「全部允许（免审批）」权限模式

- **状态**：已采纳
- **日期**：2026-10-21
- **决策人**：负责人（明确要求「参考 orca-cli 实现」「完全复制复刻集成到任务会话」「自动授权是允许」）
- **关联**：ADR 0001（不用打包器与第三方运行时依赖）、ADR 0006（外部 Agent CLI 接入）、ADR 0009（设计 token）、宪法 1.3.0（原则 九、十一）

## 背景

负责人要求以 [stablyai/orca](https://github.com/stablyai/orca) 为参照，在本应用的**任务会话**里做出与 Orca 相同形态的两种会话视图——**聊天模式**与**终端模式**——并允许**自动授权**（免逐条审批）。

Orca 的实际做法（已核对其 `src/` 源码）：

| 方面 | Orca 的实现 | 本项目可复制的部分 |
|---|---|---|
| 视图切换 | 统一标签页的 `viewMode: 'terminal' \| 'chat'`，**按标签记忆**并持久化；切换器 = 标签右键菜单 + 面板头图标按钮 + `Ctrl+Shift+J` 快捷键 | 按**会话**记忆 `chat / terminal` 模式（每个会话各自记住），切换器做成显眼的分段控件 |
| 终端 | 真 PTY（`node-pty`）+ `xterm.js`（含 WebGL 插件），Ghostty 只做主题/配置导入 | **不引入真 PTY**：改用管道式子进程 + 自研轻量 ANSI 渲染（见「决策」2） |
| agent 与终端的关系 | TUI agent 跑在 PTY 里；聊天视图是覆盖在终端之上的**覆盖层**，底层进程继续跑；结构化聊天则是主进程里另一个独立进程 | 终端进程由主进程托管，**切到对话模式时终端继续运行**（同 Orca 的覆盖层语义）；对话仍走既有 ACP / serve / run 通道 |
| 自动授权 | 终端侧 = 给 agent CLI 注入其自身的免审批开关（claude `--dangerously-skip-permissions`、codex `--approve-for-me`…，Orca 只负责拼参数，决定权在 CLI）；聊天侧 = 每个会话 4 档 `ask / accept-edits / auto / full-access`，主进程翻译成各 agent 的策略 | 聊天侧新增第 4 种权限模式「全部允许（免审批）」，由**本应用**统一裁决（内置 agent / ACP / serve / run 四条通道一致生效） |

## 决策

1. **双视图形态**：任务会话中列顶部加「对话 / 终端」分段切换（`.modebar` + `.seg`），中列布局由 `.mid`（列）改为 `.mid` → `.modebar` + `.midbody`（行）→ 对话 / 终端 / 文件窗格三块。切换只换**显示**，终端进程不受影响（Orca 同款语义）。当前模式按会话 ID 记在 `localStorage`（`acm.sessionModes`），与 Orca 的 per-tab `viewMode` 同构。
2. **终端实现**：新增 `src/backend/terminal/terminal-manager.ts`——主进程以 `child_process.spawn`（`shell: false`，参数数组）启动终端进程，管道收发：
   - `kind: 'shell'`：Windows 用 `powershell.exe -NoLogo -NoProfile -Command -`（实测可从 stdin 逐行执行），POSIX 用 `/bin/bash --noprofile --norc -s`；
   - `kind: 'cli'`：本会话选定的外部 Agent CLI，参数去掉 JSON 输出参数（`--format json`），使人可读输出直接落在终端里。
   - 工作目录**恒为项目根**（宪法 十一）；渲染进程不能指定路径或命令原文（`terminal:open` 只收 `sessionId` / `kind` / `restart`）。
   - 输出经 `agent:event` 的新变体 `terminal-data` / `terminal-exit`（契约 v1.6）回流；渲染进程用 `src/frontend/lib/ansi.ts` 解析 SGR 颜色、丢弃光标控制序列（无屏幕缓冲，无法回放）。
   - 停止：结束进程树（Windows `taskkill /T /F`；POSIX 进程组 SIGKILL），与既有 CLI 通道同口径。
3. **契约 v1.6**（纯增量）：新增 `terminal:open` / `terminal:input` / `terminal:close` 三个通道、`TerminalKind` / `TerminalInfo` / `TerminalOpenRequest` 等类型、`AgentEvent` 的 `terminal-data` / `terminal-exit` 两个变体；`PermissionMode` 新增枚举值 `'allow-all'`。既有字段一个未改，修订号 v1.5 → v1.6。
4. **「全部允许（免审批）」权限模式**：`PermissionMode` 增加 `'allow-all'`，四条通道统一生效——内置 agent（`decide()` 直接放行 write / execute）、ACP（`acpAutoDecision` 一律 allow）、serve（`serveRules` 的 edit / bash 均 allow）、run（`OPENCODE_PERMISSION` 全 allow，且不再需要整轮命令行批准）。**项目根沙箱不豁免**：越界路径、外部目录访问照旧拒绝（宪法 十一）。默认仍是「每次询问」。宪法 相应升到 1.3.0（原则 九 增加该显式豁免，原则 十一 补终端工作目录）。
5. **界面提示**：处于「全部允许」模式时，会话上下文面板与对话头部显示该模式（`MODE_LABELS['allow-all'] = 全部允许（免审批）`），模式选择器始终可见，避免用户误以为仍在逐条审批。

## 考虑过的备选

1. **引入 `node-pty` + `xterm.js` 做真 PTY**（Orca 同款）：Windows 需 `electron-rebuild` 重编译原生模块，打包链与 CI 风险高；xterm.js 还要引入资源拷贝或打包器，**直接违反 ADR 0001**（运行时不引入第三方依赖、不用打包器）。若将来要做全屏 TUI agent，可单独立项修订 ADR 0001。
2. **只做只读终端输出面板**（把既有 `.term` 面板放大）：不满足「终端模式」的要求，也无法让用户在项目根里敲命令。
3. **终端直接跑交互式 TUI agent**（`opencode` / `claude` 无参启动）：无 PTY 时 TUI 依赖方向键画屏，管道模式下不可用。折中为 `kind: 'cli'`——以可读输出方式运行 CLI。
4. **让 Orca 式的免审批开关由各 CLI 自己裁决**（给 CLI 注入 `--dangerously-skip-permissions` 之类）：本应用的 CLI 配置是通用参数模板，注入特定 agent 的私有开关会污染通用配置；统一在本应用裁决更可控，也便于审计（工具调用仍逐条留痕，宪法 十三）。

## 后果

- 好：任务会话具备 Orca 形态的双视图；终端与对话各自独立、互不打断；自动授权一处开关、全链路生效。
- 坏：终端是**行式**而非真 PTY——全屏 TUI 不工作，无光标控制、无彩色重绘语义（只保留 SGR 颜色）；终端不支持 resize。
- 接受的风险：终端里执行的命令**不经过审批卡片**（与 Orca 的终端侧一致：终端是用户直接操作面）；这是负责人明确授权的形态。终端进程以用户身份在本机执行任意命令，故其可用性受项目根工作目录约束（不在路径沙箱内强制命令内容）。
- 影响面：契约 v1.6、preload 白名单、Web 预览通道白名单、权限模式四处分支、系统提示词文案、宪法 1.3.0。

## 修订注记

- 2026-10-21：初版。`kind: 'cli'` 暂只支持本会话选定的外部 CLI；`terminal:resize` 待引入真 PTY 时再加。
