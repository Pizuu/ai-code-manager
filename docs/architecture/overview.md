# 架构概览

> 对应功能 `specs/001-agent-desktop/`、`specs/002-workspace-boards/`。决策细节见 `decisions/`。

## 系统上下文

- **用户**：在 Windows 上工作的开发者，用自然语言让 Agent 阅读、修改、验证本地项目。
- **外部系统**：OpenAI 兼容的 `/chat/completions` 端点、Anthropic `/v1/messages`（HTTPS + SSE）；本机文件系统；本机 shell（PowerShell / bash）；本机 git CLI（只读）；可选的外部 Agent CLI（如 opencode，以子进程运行）。
- **信任边界**：① 模型输出（文本与工具调用参数）不可信；② 渲染进程不可信（可能被模型输出中的内容影响），只能经 preload 白名单调用主进程；③ 项目根以外的文件系统不可触达。详见 `../security/threat-model.md`。

## 组件划分

| 组件 | 位置 | 职责 |
|---|---|---|
| 契约 | `contracts/ipc.ts`、`contracts/tools.ts` | IPC 通道/事件/模型类型与工具 Schema 的唯一权威来源 |
| 应用入口 | `src/backend/main.ts` | 创建安全窗口（contextIsolation + sandbox + CSP）、主题、导航拦截 |
| preload 桥 | `src/backend/preload.cts` | 只暴露白名单 `invoke` 通道与 `agent:event` 订阅 |
| IPC 层 | `src/backend/ipc/` | 注册 handler，对每个参数做运行时校验，错误码化 |
| 设置存储 | `src/backend/settings/` | 设置 JSON + safeStorage 加密 Key（Key 不出主进程） |
| 会话存储 | `src/backend/sessions/` | 每会话一个 JSON，原子写入 |
| Agent 循环 | `src/backend/agent/` | 组织对话 ↔ 工具循环、流式事件、停止 |
| 提供方 | `src/backend/agent/providers/` | SSE 解析，OpenAI / Anthropic 消息转换与流式工具调用拼接 |
| 工具层 | `src/backend/tools/` | 路径沙箱、diff、搜索、文件工具、命令执行、权限决策、审批闸门 |
| Spec 解析 | `src/backend/specs/` | 解析项目 `specs/*/tasks.md` |
| 工作区读取（002） | `src/backend/workspace/` | git CLI 运行器、lanes.conf 泳道判定、任务卡/BOARD 解析、看板快照（git 推导状态）、Git 快照 |
| Agent CLI（002） | `src/backend/agent-cli/` | 预设、可执行文件解析、参数模板与权限映射、opencode JSONL 解析、子进程运行与停止 |
| 渲染进程 UI | `src/frontend/` | 工作台外框（图标栏、项目栏、页头、状态栏）+ 三个板块：泳道看板、任务会话（会话列表 / 对话 / 上下文）、Git 分支与集成；设置含 Agent CLI 分区 |

## 关键决策

| ADR | 决策 |
|---|---|
| 0001 | Electron + TypeScript + tsc，不用打包器与 UI 框架 |
| 0002 | 安全模型：Key 只在主进程、渲染进程沙箱化、写入与命令必须审批 |
| 0003 | 模块系统：全 ESM + Node 原生类型擦除跑测试；preload 用 `.cts` |
| 0004 | 生成器默认约定与 Electron 应用的冲突及处理 |
| 0005 | 三板块 UI 以 HTML 原型 1:1 移植，数据改为 IPC 实时快照 |
| 0006 | 外部 Agent CLI 以 `opencode run --format json` 集成，按权限模式映射 CLI 权限 |

## 数据流（一次「改文件」请求）

```text
用户输入 ─▶ chat.ts ─invoke('agent:send')─▶ preload 白名单 ─▶ handlers.ts（校验）
   ─▶ agent-loop ─▶ provider.stream (HTTPS SSE) ─▶ text-delta 事件 ─▶ chat.ts 合帧渲染
   ─▶ 模型提出 edit_file ─▶ executor：sandbox 解析路径 → edit.ts 计算新内容 → diff.ts
   ─▶ permissions.decide(mode,'write') = ask ─▶ approval-request 事件 ─▶ Diff 面板 + 卡片按钮
   ─▶ 用户批准 ─invoke('agent:approve')─▶ app-state 解析等待 ─▶ 写文件 ─▶ tool 结果回传模型
   ─▶ session-store 原子写入 <userData>/sessions/<id>.json（工具调用 + diff 可追溯）
```

## 数据流（一次 opencode 对话，002）

```text
用户输入 ─▶ chat.ts ─invoke('agent:send')─▶ handlers：session.agent = cli:opencode
   ─▶ (每次询问) approval-request{command: 完整命令行} ─▶ 用户批准
   ─▶ cli-runner：resolve.ts 定位 opencode(.exe) → invocation.ts 展开参数数组 + OPENCODE_PERMISSION
   ─▶ spawn(cwd=项目根, shell:false) ─stdout JSONL─▶ opencode-events.ts
   ─▶ text-delta / tool-call / terminal / todos 事件 ─▶ 任务会话视图
   ─▶ 首个 sessionID 写入 session.cliSessions，下一轮追加 --session <ID>
   ─▶ agent:stop ─▶ 结束进程树；会话 JSON 原子保存
```
