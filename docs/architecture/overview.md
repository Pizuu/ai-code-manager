# 架构概览

> 对应功能 `specs/001-agent-desktop/`。决策细节见 `decisions/`。

## 系统上下文

- **用户**：在 Windows 上工作的开发者，用自然语言让 Agent 阅读、修改、验证本地项目。
- **外部系统**：OpenAI 兼容的 `/chat/completions` 端点、Anthropic `/v1/messages`（HTTPS + SSE）；本机文件系统；本机 shell（PowerShell / bash）。
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
| 渲染进程 UI | `src/frontend/` | 三栏界面：会话/项目/文件树；流式对话 + 工具卡片；Diff / 终端 / Tasks |

## 关键决策

| ADR | 决策 |
|---|---|
| 0001 | Electron + TypeScript + tsc，不用打包器与 UI 框架 |
| 0002 | 安全模型：Key 只在主进程、渲染进程沙箱化、写入与命令必须审批 |
| 0003 | 模块系统：全 ESM + Node 原生类型擦除跑测试；preload 用 `.cts` |
| 0004 | 生成器默认约定与 Electron 应用的冲突及处理 |

## 数据流（一次「改文件」请求）

```text
用户输入 ─▶ chat.ts ─invoke('agent:send')─▶ preload 白名单 ─▶ handlers.ts（校验）
   ─▶ agent-loop ─▶ provider.stream (HTTPS SSE) ─▶ text-delta 事件 ─▶ chat.ts 合帧渲染
   ─▶ 模型提出 edit_file ─▶ executor：sandbox 解析路径 → edit.ts 计算新内容 → diff.ts
   ─▶ permissions.decide(mode,'write') = ask ─▶ approval-request 事件 ─▶ Diff 面板 + 卡片按钮
   ─▶ 用户批准 ─invoke('agent:approve')─▶ app-state 解析等待 ─▶ 写文件 ─▶ tool 结果回传模型
   ─▶ session-store 原子写入 <userData>/sessions/<id>.json（工具调用 + diff 可追溯）
```
