# 接口契约

契约是并行开发不打架的根本。**先冻结契约，再让各泳道同时对着它开发。**

## 格式

- TypeScript 类型（`*.ts`）+ 线上格式用 JSON Schema / OpenAPI
- 一个边界一个文件：`contracts/<边界>.<扩展名>`（如 `api.yaml`、`events.schema.json`）。

## 规则

1. 契约必须**先于**依赖它的任何实现任务合入。
2. 提供方与使用方都对着契约写；使用方用契约生成的 mock，绝不等待。
3. 契约变更单独开 PR，走 `contracts` 泳道，打 `contract-change` 标签，所有使用方泳道都要 review。
4. 破坏性变更要升版本（`v1` → `v2`），旧版本保留到所有使用方迁移完。
5. 代码中的类型一律从这里生成或导入，禁止手抄。

## 已登记契约

| 契约 | 版本 | 边界 | 提供方 → 使用方 | 状态 | 样例 |
|---|---|---|---|---|---|
| `ipc.ts` | v1 | Electron 主进程 ↔ 渲染进程（invoke 通道 + `agent:event` 事件 + `window.api` 桥） | backend ↔ frontend | 已冻结 2026-10-20 | `fixtures/session.sample.json`、`fixtures/agent-events.sample.json` |
| `tools.ts` | v1 | Agent 核心 ↔ 大模型（工具 JSON Schema、上限） | backend → 模型 | 已冻结 2026-10-20 | `fixtures/openai-stream.sample.txt`、`fixtures/anthropic-stream.sample.txt` |
| `ipc.ts` v1.1 增量（功能 002） | v1.1 | 同上：新增 `agentCli:*`、`sessions:setAgent`、`board:get`、`git:get` 通道与 Agent CLI / 看板 / Git 类型，及可选字段 `agent`、`cliSessions`、`agentClis`、`defaultAgent`；不改既有字段 | backend ↔ frontend | 已冻结 2026-10-20 | `fixtures/board.sample.json`、`fixtures/git.sample.json` |
| `ipc.ts` v1.2 增量（功能 003） | v1.2 | 同上：新增只读通道 `fs:read`、类型 `FileContent`、常量 `FILE_VIEW_LIMITS`、错误码 `E_NOT_CONFIGURED`；不改既有字段 | backend ↔ frontend | 已冻结 2026-10-20 | `fixtures/file-content.sample.json` |
| `ipc.ts` v1.3 增量（T-033） | v1.3 | 同上：`ApprovalKind` 新增 `webfetch` / `loop` / `subagent` / `external-dir` / `other`，`ApprovalRequest` 新增可选字段 `url`、`tool`、`permission`、`patterns`、`description`，承载 opencode serve 的 webfetch / doom_loop / task / external_directory / 未知权限；不改既有字段，使用方对未知种类回退 `other` 展示 | backend ↔ frontend | 已冻结 2026-10-20 | `fixtures/agent-events.sample.json`（`ap-2`…`ap-6`） |
| `ui.ts` | v1 | 渲染层内部：右键「发送到任务会话」的 `SendSource` 与 `data-send-*` DOM 标记、UI 定位 `data-src` | frontend（视图 ↔ 右键菜单 ↔ Web 预览） | 已冻结 2026-10-20 | 见 `tests/unit/frontend/lib/context-send.test.ts` |
| `web-dev.ts` | v1 | Web 预览：`scripts/web-dev.ts` HTTP（GET 只读）↔ 浏览器 `window.api` 适配器 | infra → frontend | 已冻结 2026-10-20 | 结果形状同 `ipc.ts` |
| opencode JSON 事件流（`opencode run --format json`） | opencode 1.19.x | 外部 CLI stdout → backend 解析器 | opencode → backend | 观测记录（第三方格式，非本项目可冻结） | `fixtures/opencode-run.sample.jsonl`、`fixtures/opencode-run-rejected.sample.jsonl`、`fixtures/opencode-error.sample.jsonl`（均为 opencode 1.19.3 真实输出） |
| `tasks.md` 语法（见 `ipc.ts` 的 `SpecTask`） | v1 | 项目内 `specs/*/tasks.md` → Tasks 面板 | 文件 → backend 解析 → frontend | 已冻结 2026-10-20 | `fixtures/tasks.sample.md` |

> 本项目的「线上格式」是 Electron 结构化克隆的 IPC 消息与模型 API 的 JSON；唯一的 HTTP 接口是仅开发用的 Web 预览只读适配器（`web-dev.ts`，GET + JSON，形状复用 `ipc.ts`），因此不写 OpenAPI；工具参数直接以 JSON Schema 形式写在 `tools.ts` 的 `TOOL_DEFINITIONS` 中（运行时原样发送给模型）。
> 渲染进程运行在沙箱中，preload 不能 `require` 本地模块，因此 preload 内联通道白名单，并用 `satisfies readonly IpcInvokeChannel[]` 让 tsc 校验它与本契约一致。

## 契约冻结检查单

- [x] 每个字段都有类型、必填/可选与示例
- [x] 定义了错误结构与错误码（`IpcErrorCode`，handler 抛出 `Error('E_xxx: 说明')`）
- [x] 写明分页 / 上限 / 超时（`TOOL_LIMITS`；`fs:tree` 按目录懒加载）
- [x] 已加版本号并登记到 `docs/SPEC.md` 第 6 节
- [x] 在 `contracts/fixtures/` 提供 mock 或样例数据
