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
| 界面视图 `src/frontend/views/*`、`main.ts` | — | — | ❌（T040） | frontend |
| Electron 入口 `main.ts` / `preload.cts`（窗口安全选项、app:// 协议） | — | — | ❌（T040） | backend |
| Windows 打包（FR-016） | — | — | ❌（T040，需 Windows 机器） | coordinator |

> ❌ 行由 `specs/001-agent-desktop/tasks.md` 的 Convergence 任务 **T040** 跟踪（本仓库无远端 issue 系统，以任务号代替 issue）。
> 界面视图已用无头 Chromium + 模拟 `window.api` 做过一次手工冒烟（亮/暗主题、待批准 diff、任务面板、斜杠提示），但该脚本未纳入仓库，故不计为 ✅。

## 如何保持真实

- 新行为必须在同一 PR 内新增一行（或扩展已有行）——没更新矩阵就不合入。
- ❌ 的行必须关联 issue；没有负责人的缺口就是谎言。
- E2E 可以薄，但必须覆盖那一条核心用户路径。
