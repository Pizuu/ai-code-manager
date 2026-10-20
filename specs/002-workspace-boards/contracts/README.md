# 契约（链接）

本功能的契约唯一权威来源是仓库根目录（宪法 II），此处只做引用：

- [`contracts/ipc.ts`](../../../contracts/ipc.ts) —— v1.1 增量：`agentCli:save|delete|check`、`sessions:setAgent`、`board:get`、`git:get`；类型 `AgentRef`、`AgentCliConfig`、`AgentCliInput`、`AgentCliCheck`、`BoardSnapshot`、`BoardCard`、`GitSnapshot` 等；可选字段 `Session.agent`、`Session.cliSessions`、`ChatMessage.agent`、`SessionSummary.agent`、`PublicSettings.agentClis`、`PublicSettings.defaultAgent`、`SettingsUpdate.defaultAgent`；错误码 `E_CLI`。
- 样例：[`board.sample.json`](../../../contracts/fixtures/board.sample.json)、[`git.sample.json`](../../../contracts/fixtures/git.sample.json)、[`opencode-run.sample.jsonl`](../../../contracts/fixtures/opencode-run.sample.jsonl)、[`opencode-run-rejected.sample.jsonl`](../../../contracts/fixtures/opencode-run-rejected.sample.jsonl)、[`opencode-error.sample.jsonl`](../../../contracts/fixtures/opencode-error.sample.jsonl)。
