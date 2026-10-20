# Data Model: 桌面 AI 编程 Agent（MVP）

权威类型定义在 `contracts/ipc.ts` 与 `contracts/tools.ts`；本文件描述字段语义、约束与状态机。

## Settings（主进程私有形态）

| 字段 | 类型 | 约束 |
|---|---|---|
| provider | `'openai' \| 'anthropic'` | 默认 `openai` |
| baseUrl | string | 必须是 http(s) URL；默认 openai `https://api.openai.com/v1`，anthropic `https://api.anthropic.com` |
| model | string | 非空，≤ 200 字符 |
| permissionMode | `'ask' \| 'auto-edits' \| 'plan'` | 默认 `ask` |
| encryptedKeys | `Partial<Record<ProviderId, string>>` | safeStorage 密文的 base64；**永不出主进程** |
| lastProjectPath | string \| null | 绝对路径 |

对外形态 `PublicSettings` 用 `hasApiKey: Record<ProviderId, boolean>` 替代 `encryptedKeys`。切换 provider 时若 baseUrl 仍为另一方默认值，则自动换成新 provider 的默认值。

## Session

| 字段 | 约束 |
|---|---|
| schemaVersion | 固定 1 |
| id | `s-` + 时间戳 + 随机串；仅 `[A-Za-z0-9-]`（防止路径注入） |
| title | 首条用户消息前 40 字符；默认「新会话」 |
| projectPath | 发送首条消息时的项目根 |
| messages | 按时间顺序 |
| todos | 最近一次 todo_write 的结果 |

存储：`<userData>/sessions/<id>.json`，每轮工具循环结束与 agent 结束时整体写入（先写临时文件再 rename，避免半写）。

## ChatMessage / ToolCallRecord

- `assistant` 消息可带 `toolCalls`；每个调用后紧跟一条 `role: 'tool'` 消息（`toolCallId` 对应）。
- ToolCallRecord 状态机：

```text
pending ──(allow)──────────────▶ running ──▶ done | error
   │                                ▲
   ├──(ask)──▶ awaiting-approval ──(批准)┘
   │                 └──(拒绝/停止)──▶ rejected
   └──(deny：Plan 模式)──────────────▶ rejected
```

## ApprovalRequest

- `kind = edit`：`path` + `diff`（相对路径，统一 diff）。
- `kind = command`：`command` + `shell`。
- 生命周期：创建 → 推送 `approval-request` → 渲染进程 `agent:approve` → 推送 `approval-resolved`；会话停止时全部以 `approved: false` 解析。

## SpecTask（tasks.md 语法）

一行匹配：`- [ ]|[x]|[X] T\d{3,} [P]? [USn]? [lane:x]|[x]? 描述`。标签顺序不限；`[lane:x]` 与 `[x]`（x 为 contracts/frontend/backend/docs/infra/@shared 之一）都识别为泳道。`## ` 二级标题作为 phase。

## TodoItem

`id`（缺省时按序号生成）、`content`（非空）、`status`；同一时刻最多一个 `in_progress`（违反时执行器返回错误，不更新）。
