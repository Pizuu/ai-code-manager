# ADR 0006：外部 Agent CLI 以 `opencode run --format json` 集成，按权限模式映射 CLI 权限

- **状态**：已采纳
- **日期**：2026-10-20
- **决策人**：coordinator（宪法 七裁决）

## 背景

负责人要求增加 Agent CLI 配置，以 opencode 为例「完整在对话框中使用」：流式显示、工具调用与文件改动、多轮续接、可停止、持久化，Windows 兼容，参数不经 shell，API Key 不进渲染进程。opencode 提供三种可编程入口（官方文档 <https://opencode.ai/docs/cli/>，2026-10-19）：`opencode run`（非交互，`--format json` 输出原始 JSON 事件）、`opencode serve`（HTTP/SSE 服务器）、`opencode acp`（stdio nd-JSON）。宪法 九要求写入与命令逐条批准，但外部 CLI 用自己的工具执行。

## 决策

1. **集成方式**：每轮 `spawn(command, [...args, ...modelArgs, ...resumeArgs, '--', prompt], { cwd: 项目根, shell: false })`；opencode 预设 `args = ["run","--format","json","--dir","{cwd}"]`、`resumeArgs = ["--session","{session}"]`、`modelArgs = ["--model","{model}"]`。stdout JSONL（实测 opencode 1.19.3：`step_start`、`text`、`tool_use`、`step_finish`、`error`）映射为既有 `AgentEvent`；首个 `sessionID` 存入 `Session.cliSessions[cliId]` 供下一轮续接。停止 = 结束进程树（Windows `taskkill /T /F`，POSIX 进程组 SIGKILL）。
2. **通用性**：配置为通用「外部 CLI agent」（参数模板 + 输出格式 `opencode-json | text`），opencode 只是预设。
3. **权限映射**（经环境变量 `OPENCODE_PERMISSION`）：
   - 仅规划：`{"edit":"deny","bash":"deny"}` 并加 `--agent plan`，不弹批准；
   - 自动批准编辑：`{"edit":"allow","bash":"deny"}`，不弹批准（命令仍不放行）；
   - 每次询问：每轮启动前发 `approval-request{kind:'command'}`，展示完整命令行与将授予的权限，批准后 `{"edit":"allow","bash":"allow"}`；拒绝不启动进程；停止时待批准视为拒绝。
   - 从不使用 `--auto`。
4. **Windows**：可执行文件按 PATH + PATHEXT 解析；若只找到 npm 生成的 `opencode.cmd`，定位同目录 `node_modules/opencode-ai/bin/opencode.exe`（npm 包 `bin` 字段即此 exe）；否则报错并提示填写 exe 完整路径——绝不经 shell 运行 `.cmd`。
5. **密钥**：CLI 环境变量可标「敏感」，以 safeStorage 加密存于设置，只在 spawn 时注入子进程环境；`PublicSettings` 只给 `hasValue`。

## 考虑过的备选

1. `opencode serve` + SSE 事件 + `POST /session/:id/permissions/:permissionID`——可逐条审批、token 级增量，最贴合宪法 九；但需管理常驻服务器、随机端口与 basic auth、跟进更易变化的服务端事件 schema（官网已在推 v2），稳定性风险更高。列为后续增强。
2. `opencode acp`——协议通用，但需实现 ACP 客户端，超出本次范围。
3. `--auto`——等于放弃审批，违反宪法 九。
4. 经 PowerShell 执行命令字符串——违反「参数不经 shell 拼接」，且有注入风险。

## 后果

- 好：实现简单、可测试（假可执行文件输出真实格式即可覆盖全路径）；真实 opencode 二进制已在沙箱中用本地假模型服务器跑通首轮、工具写文件与续接。
- 坏：「每次询问」模式下审批粒度是「一轮」而非「一次工具调用」；`run` 模式下文本以完整 part（每步）到达，不是逐 token。
- 接受的风险：批准的一轮内 opencode 可自行编辑文件与执行命令；opencode 对项目根以外路径的防护由 opencode 自身负责，应用只保证其工作目录与 `--dir` 为项目根。所有工具调用照常展示并持久化（宪法 十三），用户可事后审查。
