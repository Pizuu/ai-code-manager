# 测试矩阵

每个模块一行。✅=已覆盖，—=不适用，❌=缺口（必须建 issue，不能默认接受）。

`npm run test` 一次跑完三级（单元 + 集成 + E2E）。

| 模块 | 单元 | 集成 | E2E | 负责人 |
|---|---|---|---|---|
| 路径沙箱 `src/backend/tools/sandbox.ts`（posix / win32 / 符号链接） | ✅ | ✅ | — | backend |
| 统一 diff `tools/diff.ts` | ✅ | — | — | backend |
| 权限决策 `tools/permissions.ts` | ✅ | — | — | backend |
| edit_file 替换 `tools/edit.ts`（唯一性、CRLF） | ✅ | — | — | backend |
| glob / 搜索 `tools/glob.ts`、`tools/search.ts` | ✅ | ✅ | — | backend |
| 文件工具 `tools/fs-tools.ts`、文件树 `fs/file-tree.ts` | — | ✅ | — | backend |
| 执行器与审批闸门 `tools/executor.ts`（SC-002） | ✅ | ✅ | ✅（T040 core-path） | backend |
| 命令执行 `tools/run-command.ts`（bash 路径；PowerShell 仅参数构造） | ✅ | ✅（非 Windows） | ✅（T040 core-path） | backend |
| SSE 解析与 OpenAI / Anthropic 提供方 | ✅ | ✅（本地 SSE 服务器） | — | backend |
| Agent 循环 `agent/agent-loop.ts` | — | ✅（假 provider） | ✅（T040 core-path） | backend |
| IPC 校验 `ipc/validate.ts` 与 handlers `ipc/handlers.ts` | ✅ | ✅ | — | backend |
| 设置存储 / Key 不外泄（SC-004） | — | ✅ | — | backend |
| 会话存储（SC-005） | — | ✅ | — | backend |
| 会话摘要最后回答耗时（契约 v1.9：`summarizeSession` 计算 `SessionSummary.lastTurnMs`，最后一个 user → 最后一个 assistant 的墙钟时间） | ✅ | — | — | backend |
| tasks.md 解析 | ✅ | ✅ | — | backend |
| 审批登记表 `app-state.ts`（FR-010） | ✅ | ✅ | — | backend |
| 安全 Markdown `src/frontend/lib/markdown.ts`（XSS） | ✅ | — | — | frontend |
| 斜杠命令 `lib/slash-commands.ts` | ✅ | — | — | frontend |
| diff 行分类 `lib/diff-lines.ts` | ✅ | — | — | frontend |
| 泳道配置与 check-lane 同语义判定 `src/backend/workspace/lanes.ts` | ✅ | — | — | backend |
| 任务卡 / BOARD / spec 解析 `workspace/cards.ts`，状态推导 `board.ts` | ✅ | ✅（临时 git 仓库：合入后删除分支、阻塞、声明冲突、越界） | — | backend |
| Git 快照 `workspace/git-overview.ts`、git 运行器 `workspace/git.ts` | ✅ | ✅（ahead/behind、已删除分支的合并记录、worktree、非仓库） | — | backend |
| Agent CLI 参数模板与权限映射 `agent-cli/invocation.ts` | ✅ | — | — | backend |
| opencode 启动环境适配 `agent-cli/platform-env.ts`（question 禁用、win32 Git Bash 探测 / PowerShell 回退） | ✅（注入假探测，不依赖宿主平台） | — | ✅（CI `windows-opencode` 作业第 4 / 5 项真机实测通过，run 39608075767，T-021） | backend |
| opencode 会话 token 用量采集（契约 v1.8：step_finish tokens 解析/合成 + `accumulateUsage` 累加落盘 `Session.usage`）与实时推送（契约 v1.10：`SessionSummary.usage` 随 session-updated 在回合结束前到达，sink 单测 + summarizeSession 单测） | ✅ | ✅（handlers-v11 假 opencode 回合后断言 usage 落盘 + 带 usage 的摘要先于 status(false)） | — | backend |
| 可执行文件解析 `agent-cli/resolve.ts`（PATH/PATHEXT、npm .cmd 包装） | ✅（win32 以注入的文件系统模拟） | — | ✅（同 `windows-opencode` 作业第 1 / 2 / 3 / 6 项真机实测通过，run 39608075767，T-021） | backend |
| Windows opencode 实机验证 `scripts/verify-opencode-windows.ts`（T-021） | — | — | ✅（`ci.yml` 的 `windows-opencode` 作业，windows-latest + 真实 `opencode-ai@1.19.3`；三跑定案 6/6 全绿，run 39608075767） | infra |
| opencode JSONL 解析 `agent-cli/opencode-events.ts` | ✅（opencode 1.19.3 真实输出样例） | — | — | backend |
| CLI 运行器 `agent-cli/cli-runner.ts` 与 handlers 接线（首轮 / 续接 / 停止 / ask 拒绝 / plan / 错误 / 不可用 / 敏感值不外泄） | — | ✅（假 opencode 可执行文件，POSIX） | — | backend |
| Agent CLI 设置存储（敏感 env 加密、safeStorage 不可用拒绝） | — | ✅ | — | backend |
| 看板文案 `src/frontend/lib/board-format.ts`、分支图布局 `lib/git-graph.ts`、CLI 表单 `lib/agent-cli-form.ts` / agent 名称 `lib/agent-label.ts` | ✅ | — | — | frontend |
| 只读代码查看 `src/backend/fs/file-view.ts`（越界 / 绝对路径 / 符号链接逃逸 / 目录 / 二进制 / 截断 / 超大）与 `fs:read` 接线 | — | ✅ | — | backend |
| 配置默认空白与未配置（`settings-store.ts` `builtinConfigProblem`、`E_NOT_CONFIGURED`、opencode 预设为空） | ✅ | ✅ | — | backend |
| E_CLI 自动改绑（`settings-store.ts` `findCliRebindCandidate` 按名称 slug 唯一匹配、handlers `agent:send` 改绑落盘；同名多条不改绑仍报 E_CLI） | ✅ | ✅ | — | backend |
| 右键发送内容组装 `lib/context-send.ts`、轻量高亮 `lib/highlight.ts`、配置提示 `lib/agent-config.ts` | ✅ | — | — | frontend |
| Web 预览 UI 定位纯函数 `web/locator-core.ts`（栈解析、选择器） | ✅ | — | — | frontend |
| Web 预览服务器 `scripts/web-dev.ts`（405 / 404 / E_PATH_ESCAPE / Host 校验） | — | — | ❌（手动 curl 验证，见 specs/003 quickstart；未纳入 CI） | infra |
| 界面视图 `src/frontend/views/*`、`main.ts`、`web/locator.ts`、`web/mock-api.ts` | — | — | ✅ 001 核心路径（T040）；🟡 002 三板块待 T-020（、003 右键菜单与 UI 定位另有仓库外无头截图冒烟；纯 UI 按宪法 五跳过） | frontend |
| Electron 入口 `main.ts` / `preload.cts`（窗口安全选项、app:// 协议） | — | — | ✅（T040 core-path） | backend |
| Windows 打包（FR-016） | — | — | ✅（`windows-dist.yml`，windows-latest 打包 + 启动冒烟；T041） | infra |
| asar 内容核对（T214） | ✅ `check-asar.ts --self-test` | ✅ 真实 electron-builder 产物 | ✅ CI 打包后复核 | infra |
| opencode serve 逐条审批原型（T125） | ✅ 17 条（假 HTTP/SSE 服务器） | ✅ 1.19.3 真实服务器手测 | — | backend |
| opencode serve 模式接入 `serve-runner.ts`（T127） | ✅ | ✅ 9 条（`opencode-serve-mode.test.ts`，假 serve 进程） | ❌（真实 opencode 联调待做） | backend |
| 审批卡片文案 `lib/approval-prompt.ts`（T128） | ✅ 6 条 | — | — | frontend |
| 工具卡片文字整理 `lib/tool-card-text.ts`（工具名标签、目标抽取、参数键值与截断、结果 JSON 美化） | ✅ 6 条 | — | — | frontend |
| 会话活动计数 `lib/session-activity.ts`（运行中 / 待批准 / 错误计数与跳转目标） | ✅ 7 条 | — | — | frontend |
| 错误 / 日志分区 `lib/error-log.ts`（工具失败与 Agent 报错归集、去重排序、分区标题） | ✅ 6 条 | — | — | frontend |
| 收藏保存 `lib/favorites.ts`（合并落盘、300 条上限裁剪、加载逐条校验、落盘失败保留待写重试） | ✅ 9 条 | — | — | frontend |
| 会话保存合并 `sessions/session-store.ts`（调用时快照、按会话串行合并突发写 ≤2 次落盘、失败不卡队列） | — | ✅（含突发合并/快照语义/双会话并发/失败口径 4 条） | — | backend |
| 重提最近提问截断 `sessions/reask.ts` + handlers（契约 v1.11 `reaskLatest`：命中最后一条 user 且文本一致才截断旧问答、确认可启动后才落笔） | ✅ 7 条 | ✅ 3 条（真截断/对照追加/异文本不截断） | — | backend |
| 系统文件选择 `files:pick`（契约 v1.12：main 注入原生对话框多选、未注入返回空数组、Web mock 短路取消） | — | ✅ 2 条（注入原样返回/未注入空数组） | — | backend |
| 文件导入项目 `files:import`（契约 v1.14：复制到 uploads/、重名 -1/-2 后缀、整批先校验后复制、Web mock 明确拒绝） | — | ✅ 9 条（file-import 7：复制/重名/回滚/原样返回等；handlers 2：无项目 E_NO_PROJECT/真复制+非法入参） | — | backend |
| git 引用变化监听 `src/backend/workspace/refs-watcher.ts`（refs 摘要与变更触发） | ✅ 2 条 | — | — | backend |
| 合并冲突预演 `src/backend/workspace/merge-preview.ts`（merge-tree 只读预演与冲突文件提取） | ✅ 1 条 | ✅ 3 条（临时仓库：干净 / 冲突 / 引用缺失） | — | backend |
| 集成分支引用回退 `src/backend/workspace/git-overview.ts`（本地缺失 → `origin/<分支>`；看板据此合并冲突、给根因） | ✅ 3 条 | ✅ 3 条（临时仓库：本地缺失 / 仅远端 / 两处皆无） | — | backend |
| 集成分支名一致性 `scripts/check-branch-config.sh`（工作流与文档须与 `.agents/config.sh` 一致） | — | ✅ 负向自测 4 例（CI 中运行） | — | infra |
| 终端模式 · ANSI 解析 `src/frontend/lib/ansi.ts`（SGR 颜色 / 256 色 / 真彩 / 控制序列丢弃 / 换行归一） | ✅ 8 条 | — | — | frontend |
| 终端进程池 `src/backend/terminal/terminal-manager.ts`（shell 命令行、CLI 参数去 JSON、复用 / 重启 / 退出回调） | ✅ 4 条 | — | — | backend |
| 终端模式 IPC（`terminal:open` / `input` / `close`：工作目录恒为项目根、会话不存在 E_NOT_FOUND、无项目 E_NO_PROJECT、CLI 模式 E_CLI） | — | ✅ 7 条 | — | backend |
| 终端运行态 `src/frontend/store.ts`（按会话记录输出、重启时旧 terminalId 残事件忽略、清屏） | ✅ 3 条 | — | — | frontend |
| 「全部允许（免审批）」权限模式（`decide` / `acpAutoDecision` / `serveRules` / `opencodePermission` 四条通道一致生效） | ✅ 4 条 | — | — | backend |
| 对话回合与思考区摘要 `src/frontend/lib/chat-turn.ts`（工具调用状态计数、摘要文案、待批准判定、正在思考展开判定、头像文字） | ✅ 7 条 | ✅ E2E 1 条（`core-path`：思考区默认折叠 → 点击展开 → 重启恢复后仍可展开） | — | frontend |
| 主进程通知服务 `src/backend/notify/notify-service.ts`（功能 005：审批 P0 / 会话出错 P1 系统通知、approvalId 去重、3 分钟升级恰一次、偏好门控、聚焦不发但升级计时兜底、点击只聚焦 + 回传 `notify-activate`；通知器与时钟可注入替身） | ✅ 15 条（`tests/unit/backend/notify/notify-service.test.ts`，假通知器 + 假时钟） | — | ❌（Windows 真机系统通知待验） | backend |
| 提醒偏好清洗与落盘 `src/backend/settings/settings-store.ts`（`sanitizeNotifySettings` 缺省回落 DEFAULT、snooze 夹取 1–120）与 `ipc/validate.ts` 的 notify 校验透传、`getPublic` 投影（偏好 + `notifyNativeAvailable`） | ✅ 5 条（`tests/unit/backend/settings/notify-settings.test.ts`） | — | — | backend |
| 审批提醒纯逻辑 `src/frontend/lib/notify.ts`（功能 005：P0 事项构建 / 按 approvalId 去重 / 排队、弹窗选择 ≤3 + overflow 折叠与抑制、已决历史合并封顶 100 与 localStorage 落盘校验） | ✅ 9 条（`tests/unit/frontend/lib/notify.test.ts`） | — | — | frontend |
| 看板 / 会话差分 `src/frontend/lib/notify-diff.ts`（功能 005：首次快照只建基线、进入 / 持续 / 离开 / 再入的 P1 / P2 / P3 产生与消解、呈现集合 P3 弹窗恒 0、FR-516 进度段映射与时间戳三口径、角标计数口径） | ✅ 14 条（`tests/unit/frontend/lib/notify-diff.test.ts`） | — | — | frontend |
| 提醒设置纯逻辑 `src/frontend/lib/notify-settings.ts`（功能 005：缺省合并回 FR-512 默认值、稍后时长校验 1–120、原生通知能力判定） | ✅ 7 条（`tests/unit/frontend/lib/notify-settings.test.ts`） | — | — | frontend |
| 提醒呈现视图 `src/frontend/views/notify-view.ts` / `notify-feed.ts`（弹窗栈、收件箱三页签、P2 轻提示）与设置「提醒」分区 `views/settings-dialog.ts` | — | — | 🟡 仓库外无头截图冒烟（同界面视图行口径；逻辑由上三行纯函数单测覆盖，纯 UI 部分按宪法 五） | frontend |
| 三板块 E2E `tests/e2e/frontend/boards-paths.test.ts`（T-020） | — | — | ✅ 3 条（FR-101 三板块导航与草稿保持 + Git 分支图结构断言「节点 / 连线 / 合并环 / 分支标注」；FR-109 看板卡片 → 任务会话「预填 / 标题关联 / `.sysb` 摘要 / 重进打开已有会话」；FR-112 假 opencode 对话路径「自动检测注册 → run 通道两轮 → argv 参数数组 → `--session` 续接」；本机 xvfb 实跑含 T040 共 4/4） | frontend |

### 功能 005（审批通知提醒器）SC 追溯

| SC | 口径 | 验证落点（卡 / 测试） |
|---|---|---|
| SC-001 | 窗口不在前台时产生的审批请求，系统通知在事件后 2 秒内出现（样本内 100%） | T-047：`tests/unit/backend/notify/notify-service.test.ts`「P0：窗口不在前台时发一条系统通知…」——通知在审批事件处理内同步发出，无延时路径；真机时延待 Windows 真机复核（见上表通知服务行 E2E ❌） |
| SC-002 | 重复投递同一审批事件产生的重复弹窗数为 0 | T-047：同文件「去重：同一 approvalId 重复投递只发一次（FR-504）」；T-048：`tests/unit/frontend/lib/notify.test.ts`「buildApprovalReminderItems：审批恒为 P0，按 approvalId 去重」 |
| SC-003 | 点击通知 / 弹窗「查看」后落到正确会话与审批卡（样本内 100%） | T-047：同文件「点击审批通知：聚焦窗口 + notify-activate 载荷为 approval 目标（FR-503 / FR-508）」及 P1 点击回传 session 目标用例（载荷层断言）；T-048：前端 `notify-activate` 处理与审批卡定位（`src/frontend/main.ts` / `views/notify-view.ts` / `views/chat.ts`），呈现层走仓库外截图冒烟 |
| SC-004 | P3 事项产生的弹窗与系统通知数为 0 | T-049：`tests/unit/frontend/lib/notify-diff.test.ts`「呈现集合：弹窗只有 P1；P2 只轻提示；P3 两边都不进（弹窗数恒 0）」；系统通知侧由契约默认值 P3 关（`DEFAULT_NOTIFY_SETTINGS`）+ T-047 偏好门控用例覆盖 |
| SC-005 | 审批在别处被处理后，其弹窗残留超过 1 秒的次数为 0 | T-048：`tests/unit/frontend/lib/notify.test.ts`「已解决撤下：从待批集合移除后重建结果中不再出现，计数同步下降（FR-505/514）」；T-047：通知服务「解决后不再升级，且已发通知被关掉、定时器清净」 |
| SC-006 | 从看到 P0 弹窗到完成批 / 拒 ≤2 次点击（弹窗内直批）或 ≤3 次（跳转后批） | T-048：弹窗内「批准 / 拒绝」按钮 1 次点击直达既有 `agent:approve` 通道（`views/notify-view.ts`），跳转路径为「查看 → 审批卡上批 / 拒」2 次操作后完成；呈现层走仓库外截图冒烟，审批通道本身由上表「执行器与审批闸门」行覆盖 |

> 已知问题（与 005 无关，登记在案）：`tests/integration/backend/ipc/handlers-reask.test.ts` 的 `reaskLatest` 用例为计时型 flaky——2026-10-21 T-047 验收时在 pristine HEAD 上复跑 4 次失败 2 次；同日 CI run 39608075767 的 build-test 作业亦命中本 flake（同跑次其余作业全绿）。本节登记备查，待单独治理，不计入 005 覆盖缺口。

> ❌ 行由 `specs/001-agent-desktop/tasks.md` 的 Convergence 任务 **T040 / T041** 跟踪（本仓库无远端 issue 系统，以任务号代替 issue）。
> 界面视图已用无头 Chromium + 模拟 `window.api` 做过手工冒烟（001：亮/暗主题、待批准 diff、任务面板、斜杠提示；002：三板块 1680×1200 截图并与 HTML 原型并排对比，数据为本仓库真实 `board:get` / `git:get` 快照），但脚本未纳入仓库，故不计为 ✅。
> 真实 opencode 1.19.3 二进制已在沙箱中经应用主进程 handlers 跑通首轮、write 工具、续接与 plan 模式（模型为本地假 OpenAI 兼容服务器），记录于 specs/002-workspace-boards/quickstart.md；未纳入 CI（需要 opencode 二进制）。

> 宪法 1.2.0 原则 五（ADR 0007）：简单 UI 修改（仅 CSS / 文案 / DOM 布局，不涉及 IPC、安全、数据逻辑）不要求新增测试，仍需 lint + typecheck + build 通过；矩阵中视图行保持 ❌ 并由截图冒烟兜底。

## 如何保持真实

- 新行为必须在同一 PR 内新增一行（或扩展已有行）——没更新矩阵就不合入。
- ❌ 的行必须关联 issue；没有负责人的缺口就是谎言。
- E2E 可以薄，但必须覆盖那一条核心用户路径。
