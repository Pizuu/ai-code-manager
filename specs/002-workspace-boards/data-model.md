# Data Model: 三板块工作台与 Agent CLI

权威类型定义在根 `contracts/ipc.ts`（v1.1 增量部分）。本文只说明来源、校验与状态迁移。

## AgentCliConfig（主进程存储形状 `StoredAgentCli`）

| 字段 | 类型 | 校验 | 说明 |
|---|---|---|---|
| id | string | `^[a-z0-9-]{1,40}$`，新增时由主进程生成 | 也是 `AgentRef` 的 `cli:<id>` |
| name | string | 1–60 字符 | 显示名 |
| preset | `'opencode' \| 'custom'` | 枚举 | |
| command | string | 1–1000 字符，不含换行与 NUL | 名称或绝对路径 |
| args / resumeArgs / modelArgs | string[] | 每项 ≤ 2000 字符，≤ 40 项 | 占位符 `{prompt}` `{model}` `{session}` `{cwd}` |
| model | string | ≤ 200 | 空 = CLI 默认 |
| outputFormat | `'opencode-json' \| 'text'` | 枚举 | |
| env | `{name, secret, value? \| encrypted?}[]` | name `^[A-Za-z_][A-Za-z0-9_]{0,100}$`，≤ 30 项，值 ≤ 4000 | 敏感值以 safeStorage 密文存 `encrypted`；对外只给 `hasValue` |

**opencode 预设**：`command: "opencode"`，`args: ["run","--format","json","--dir","{cwd}"]`，`resumeArgs: ["--session","{session}"]`，`modelArgs: ["--model","{model}"]`，`outputFormat: "opencode-json"`。

## AgentRef 与会话

- `Session.agent?: AgentRef`（缺省 'builtin'）；`Session.cliSessions?: Record<cliId, opencodeSessionId>`。
- 发送时 agent 解析：`session.agent ?? settings.defaultAgent ?? 'builtin'`；`cli:<id>` 不存在 → `E_CLI`。
- `sessions:setAgent`：运行中 → `E_BUSY`；未知 CLI → `E_VALIDATION`。
- assistant 消息写 `agent` 字段，界面据此显示名称。

## CLI 一轮的消息映射

```text
user 消息 ──▶ (ask 模式) approval-request{kind:command, command: 完整命令行, shell: "直接执行（无 shell）"}
   └ 拒绝 → assistant 消息说明「已拒绝启动」，结束
spawn ─▶ 每行 JSON：
  step_start / step_finish  → 忽略（step_finish.tokens 记入终端信息行）
  text                      → assistant.content 追加（part 间空行分隔）+ text-delta
  tool_use                  → toolCalls upsert（callID）：status completed→done、error→error（含 "rejected permission"→rejected）
                              diff：state.metadata.diff；write 且 exists=false → 由内容生成「新文件」diff
                              bash：output → terminal 事件；todowrite：input.todos → todos 事件
  error                     → error 事件（error.data.message）
  其他 / 非 JSON            → terminal 事件（stream info / stderr）
首个带 sessionID 的事件 → session.cliSessions[cliId] = sessionID
进程退出：码 ≠ 0 且无 error 事件 → error（退出码 + stderr 末尾）；被停止 → 无错误、保留已收输出
```

## BoardSnapshot 推导

| 步骤 | 来源 |
|---|---|
| 集成 / 主分支、前缀、并行上限 | `.agents/config.sh`（`INTEGRATION_BRANCH`、`MAIN_BRANCH`、`BRANCH_PREFIX`、`MAX_PARALLEL`），缺省 dev / main / feat / null |
| 泳道 | `.agents/lanes.conf`；负责角色取 `docs/development/multi-agent.md` 泳道表 |
| 任务卡 | `docs/tasks/T-*.md` 字段表（泳道、对应需求、包含任务号、分支、PR 目标、前置任务、状态、执行者）+「目标」「验收标准」节 |
| 声明状态补充 | `docs/tasks/BOARD.md` 表格行 |
| 功能 | 编号最大的 `specs/NNN-*/`：spec 标题与 Status、阶段（宪法/规格/澄清/计划/Checklist/任务/Analyze）、tasks.md 勾选数 |
| 状态 | 见 research R2 |

## GitSnapshot

见 `contracts/ipc.ts`。合并记录：`git log --first-parent --merges <集成分支>`，分支名从说明 `merge: <分支>` / `Merge branch '<分支>'` 解析；`commitCount = rev-list --count <p1>..<p2>`。
