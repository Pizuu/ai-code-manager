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
| 执行器与审批闸门 `tools/executor.ts`（SC-002） | ✅ | ✅ | ❌（T040） | backend |
| 命令执行 `tools/run-command.ts`（bash 路径；PowerShell 仅参数构造） | ✅ | ✅（非 Windows） | ❌（T040） | backend |
| SSE 解析与 OpenAI / Anthropic 提供方 | ✅ | ✅（本地 SSE 服务器） | — | backend |
| Agent 循环 `agent/agent-loop.ts` | — | ✅（假 provider） | ❌（T040） | backend |
| IPC 校验 `ipc/validate.ts` 与 handlers `ipc/handlers.ts` | ✅ | ✅ | — | backend |
| 设置存储 / Key 不外泄（SC-004） | — | ✅ | — | backend |
| 会话存储（SC-005） | — | ✅ | — | backend |
| tasks.md 解析 | ✅ | ✅ | — | backend |
| 审批登记表 `app-state.ts`（FR-010） | ✅ | ✅ | — | backend |
| 安全 Markdown `src/frontend/lib/markdown.ts`（XSS） | ✅ | — | — | frontend |
| 斜杠命令 `lib/slash-commands.ts` | ✅ | — | — | frontend |
| diff 行分类 `lib/diff-lines.ts` | ✅ | — | — | frontend |
| 泳道配置与 check-lane 同语义判定 `src/backend/workspace/lanes.ts` | ✅ | — | — | backend |
| 任务卡 / BOARD / spec 解析 `workspace/cards.ts`，状态推导 `board.ts` | ✅ | ✅（临时 git 仓库：合入后删除分支、阻塞、声明冲突、越界） | — | backend |
| Git 快照 `workspace/git-overview.ts`、git 运行器 `workspace/git.ts` | ✅ | ✅（ahead/behind、已删除分支的合并记录、worktree、非仓库） | — | backend |
| Agent CLI 参数模板与权限映射 `agent-cli/invocation.ts` | ✅ | — | — | backend |
| 可执行文件解析 `agent-cli/resolve.ts`（PATH/PATHEXT、npm .cmd 包装） | ✅（win32 以注入的文件系统模拟） | — | ❌（Windows 真机，T041 一并验证） | backend |
| opencode JSONL 解析 `agent-cli/opencode-events.ts` | ✅（opencode 1.19.3 真实输出样例） | — | — | backend |
| CLI 运行器 `agent-cli/cli-runner.ts` 与 handlers 接线（首轮 / 续接 / 停止 / ask 拒绝 / plan / 错误 / 不可用 / 敏感值不外泄） | — | ✅（假 opencode 可执行文件，POSIX） | — | backend |
| Agent CLI 设置存储（敏感 env 加密、safeStorage 不可用拒绝） | — | ✅ | — | backend |
| 看板文案 `src/frontend/lib/board-format.ts`、分支图布局 `lib/git-graph.ts`、CLI 表单 `lib/agent-cli-form.ts` / agent 名称 `lib/agent-label.ts` | ✅ | — | — | frontend |
| 只读代码查看 `src/backend/fs/file-view.ts`（越界 / 绝对路径 / 符号链接逃逸 / 目录 / 二进制 / 截断 / 超大）与 `fs:read` 接线 | — | ✅ | — | backend |
| 配置默认空白与未配置（`settings-store.ts` `builtinConfigProblem`、`E_NOT_CONFIGURED`、opencode 预设为空） | ✅ | ✅ | — | backend |
| 右键发送内容组装 `lib/context-send.ts`、轻量高亮 `lib/highlight.ts`、配置提示 `lib/agent-config.ts` | ✅ | — | — | frontend |
| Web 预览 UI 定位纯函数 `web/locator-core.ts`（栈解析、选择器） | ✅ | — | — | frontend |
| Web 预览服务器 `scripts/web-dev.ts`（405 / 404 / E_PATH_ESCAPE / Host 校验） | — | — | ❌（手动 curl 验证，见 specs/003 quickstart；未纳入 CI） | infra |
| 界面视图 `src/frontend/views/*`、`main.ts`、`web/locator.ts`、`web/mock-api.ts` | — | — | ❌（T040；002 三板块、003 右键菜单与 UI 定位另有仓库外无头截图冒烟；纯 UI 按宪法 五跳过） | frontend |
| Electron 入口 `main.ts` / `preload.cts`（窗口安全选项、app:// 协议） | — | — | ❌（T040） | backend |
| Windows 打包（FR-016） | — | — | ❌（T041，需 Windows 机器） | coordinator |

> ❌ 行由 `specs/001-agent-desktop/tasks.md` 的 Convergence 任务 **T040 / T041** 跟踪（本仓库无远端 issue 系统，以任务号代替 issue）。
> 界面视图已用无头 Chromium + 模拟 `window.api` 做过手工冒烟（001：亮/暗主题、待批准 diff、任务面板、斜杠提示；002：三板块 1680×1200 截图并与 HTML 原型并排对比，数据为本仓库真实 `board:get` / `git:get` 快照），但脚本未纳入仓库，故不计为 ✅。
> 真实 opencode 1.19.3 二进制已在沙箱中经应用主进程 handlers 跑通首轮、write 工具、续接与 plan 模式（模型为本地假 OpenAI 兼容服务器），记录于 specs/002-workspace-boards/quickstart.md；未纳入 CI（需要 opencode 二进制）。

> 宪法 1.2.0 原则 五（ADR 0007）：简单 UI 修改（仅 CSS / 文案 / DOM 布局，不涉及 IPC、安全、数据逻辑）不要求新增测试，仍需 lint + typecheck + build 通过；矩阵中视图行保持 ❌ 并由截图冒烟兜底。

## 如何保持真实

- 新行为必须在同一 PR 内新增一行（或扩展已有行）——没更新矩阵就不合入。
- ❌ 的行必须关联 issue；没有负责人的缺口就是谎言。
- E2E 可以薄，但必须覆盖那一条核心用户路径。
