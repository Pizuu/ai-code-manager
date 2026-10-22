# Research: 会话消息交互改进

## Decisions

- **待办定位**：现有待办面板按待办文本查找消息后已取得消息 ID，但 `focusMessage` 目前只查助手消息节点。给用户回合绑定 ID 并扩展定位函数即可满足本轮需求，无须改变 `TodoItem` 或 IPC。
- **高亮安全**：在已渲染的用户气泡内匹配文本并以文本节点/元素处理；不得将消息正文拼入 HTML。
- **用户消息收藏**：复用现有 `favoriteId`、`toggleFavorite` 与收藏模型；右键菜单只需将用户消息 ID 传给现有应用回调。
- **Agent 选择**：复用 `agentOptions`、`settings:set` 与 `sessions:setAgent`。选择器明确将内置选项标为“API”。先保存默认值，再更新空闲会话；若第二步失败，尝试恢复旧默认值并让界面反映最终状态。

## Alternatives Considered

- 为待办增加持久化 `sourceMessageId`：本轮既有待办按文本定位，增加字段会触及冻结契约和后端存储，超出确认的前端泳道范围。
- 新增原子化 Agent IPC：会扩大契约与后端改动；通过前端顺序更新、失败补偿及运行态守卫即可满足本轮验收。
