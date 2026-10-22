# Implementation Plan: 会话消息交互改进

**Branch**: `006-chat-interactions` | **Date**: `2026-10-22` | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `spec.md`

## Summary

在前端修复待办对用户消息的定位/高亮，扩展右键收藏到用户消息，并在模型入口左侧增加 API/CLI Agent 选择。沿用现有收藏、设置和会话 IPC；不改 IPC 契约、持久化结构或后端。

## Technical Context

**Language/Version**: TypeScript, Node.js ≥22.18  
**Primary Dependencies**: Electron、原生 DOM/CSS、现有 preload IPC；不新增依赖  
**Storage**: 现有 session todos、favorites 本地存储和主进程 settings；不新增字段  
**Testing**: `npm run test`；相关更改另跑 `npx eslint .`、`npx tsc --noEmit`、`npm run build`  
**Target Platform**: Windows Electron 桌面应用  
**Project Type**: 前后端分层桌面应用；本任务仅前端代码与测试  
**Performance Goals**: 不增加周期轮询或全聊天重绘；定位按消息 ID 查询；高亮约 1.4 秒后自动清除  
**Constraints**: 仅修改 frontend 泳道；文本高亮不得注入 HTML；Agent 选择器沿用输入区控件样式且不与模型/权限控件重叠；运行中禁止切换 Agent；共享权限不变  
**Scale/Scope**: 三项聊天交互；排除项目级待办模型和全项目清理/性能审计

## Constitution Check

- **泳道**：实现限定于 `src/frontend/` 与 `tests/unit/frontend/`；test-matrix 更新另拆 docs 卡。通过。
- **契约先行**：复用现有 `settings:set`、`sessions:setAgent` 与 favorites；不新增契约字段或跨泳道接口。通过。
- **测试**：涉及 DOM 定位、收藏状态和 Agent 状态更新，必须新增确定性前端单测。通过。
- **安全**：消息文本用安全文本节点处理；不触及命令、写文件、Key 或沙箱权限。通过。
- **变更纪律**：保留既有动画与助手消息收藏行为，避免无关重构。通过。

## Design Decisions

1. 用户消息回合绑定现有消息 ID；`focusMessage` 按 ID 支持用户与助手回合，并在用户气泡内安全标注匹配文本。
2. 右键菜单从用户回合读取消息 ID；应用入口通过当前会话消息表构造完整收藏快照，沿用现有去重与来源编码。
3. Agent 选项复用 `agentOptions` 的引用与 CLI 配置数据；内置选项明确显示为“API”，CLI 选项使用各自配置名称。只更新 `defaultAgent` 与空闲会话 Agent，不发送权限字段。任一步写入失败时尝试补偿已成功的一侧；若补偿也失败，选择器反映实际持久化状态并提示错误，不显示为同步成功。
4. 运行状态同时控制选择器可用性，并尊重后端现有 `sessions:setAgent` 守卫。

## Project Structure

```text
src/frontend/views/chat.ts             # 消息定位、高亮、Agent 选择器
src/frontend/views/context-menu.ts     # 用户消息右键动作
src/frontend/main.ts                   # 收藏回调与 Agent 更新协调
src/frontend/styles.css                # 保留既有焦点效果并突出用户气泡/命中片段
tests/unit/frontend/                   # 三个用户故事的确定性单测
docs/testing/test-matrix.md            # 由后续 docs 泳道任务更新
```

**Structure Decision**: 沿用仓库既有 Electron 前后端目录与 DOM 渲染层；不创建新子项目或共享类型。

## Complexity Tracking

无宪法例外。
