# Data Model: 会话消息交互改进

本功能不引入新的持久化实体或 IPC 字段，沿用以下数据：

| 实体 | 现有字段/引用 | 本功能用途 |
|---|---|---|
| `ChatMessage` | `id`, `role`, `content` | 用户消息节点以 `id` 定位；`content` 用于待办文本匹配与完整快照 |
| `TodoItem` | `id`, `content`, `status` | 保持现有会话级待办；点击时仍以现有内容匹配找到消息 |
| 收藏记录 | `id`, `sessionId`, `sessionTitle`, `text`, `at` | 保存整条用户消息快照；`id` 沿用会话/消息来源编码 |
| `AgentRef` | `builtin` 或 `cli:<id>` | 表示 API（内置 Agent）或已配置 CLI |

Agent 状态变化：选择值 → 保存新会话默认 Agent →（若当前会话存在且空闲）更新会话 Agent；任一步失败都恢复选择器到真实状态，权限模式不参与此状态变化。
