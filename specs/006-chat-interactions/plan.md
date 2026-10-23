# Implementation Plan: 会话消息交互改进

**Branch**: `006-chat-interactions` | **Date**: `2026-10-22` | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `spec.md`

## Summary

在前端完成九项会话与 Web 预览交互：待办定位/高亮、用户消息收藏、API/CLI Agent 来源切换与消息头名称、工具详情精简、相关文件导航与 Escape、当前配置标记和 Token 估算、待办卡头简化、Web 浮动定位栏移除，以及上下文去重/侧栏入口布局。复用现有 IPC 与持久化；不新增契约字段或后端改动。

## Technical Context

**Language/Version**: TypeScript, Node.js ≥22.18  
**Primary Dependencies**: Electron、原生 DOM/CSS、现有 preload IPC；不新增依赖  
**Storage**: 现有 session todos、favorites 本地存储和主进程 settings；不新增字段  
**Testing**: `npm run test`；新增路径合并与 Token 估算确定性单测；相关更改另跑 lint、typecheck、build 和泳道验证  
**Target Platform**: Windows Electron 桌面应用  
**Project Type**: 前后端分层桌面应用；本任务仅前端代码与测试  
**Performance Goals**: 不增加周期轮询；待办目标会话加载后立即定位；Token 估算在消息变化时更新并避免每帧重复处理整段历史；高亮约 1.4 秒后自动清除  
**Constraints**: 仅修改 frontend 泳道；文本高亮不得注入 HTML；Agent 选择器沿用输入区控件样式且不与模型/权限控件重叠；运行中禁止切换 Agent；共享权限不变；Token 估算必须可见地标为约值  
**Scale/Scope**: 九项会话与 Web 预览交互；不新增 IPC/存储字段；API 保存项目、收藏/项目待办 CRUD 与全项目清理/性能审计另立规格

## Constitution Check

- **泳道**：实现限定于 `src/frontend/` 与 `tests/unit/frontend/`；test-matrix 更新另拆 docs 卡。通过。
- **契约先行**：复用现有 `settings:set`、`sessions:setAgent` 与 favorites；不新增契约字段或跨泳道接口。通过。
- **测试**：待办定位、收藏、Agent 状态、文件合并与 Token 估算涉及逻辑，必须新增确定性前端单测；纯 DOM/CSS 的工具标题、配置标记、待办头部、上下文/侧栏布局与 Web 浮条简化按宪法五记录可跳过测试，并手动确认 Alt+Q 及原定位面板仍有效。通过。
- **安全**：消息文本用安全文本节点处理；不触及命令、写文件、Key 或沙箱权限。通过。
- **变更纪律**：保留既有动画与助手消息收藏行为，避免无关重构。通过。

## Design Decisions

1. 用户消息回合绑定现有消息 ID；`focusMessage` 按 ID 支持用户与助手回合，并在用户气泡内安全标注匹配文本。
2. 右键菜单从用户回合读取消息 ID；应用入口通过当前会话消息表构造完整收藏快照，沿用现有去重与来源编码。
3. Agent 选项复用 `agentOptions` 的引用与 CLI 配置数据；内置选项明确显示为“API”，CLI 选项使用各自配置名称。只更新 `defaultAgent` 与空闲会话 Agent，不发送权限字段。任一步写入失败时尝试补偿已成功的一侧；若补偿也失败，选择器反映实际持久化状态并提示错误，不显示为同步成功。
4. 运行状态同时控制选择器可用性，并尊重后端现有 `sessions:setAgent` 守卫。
5. 相关文件栏只汇总消息提及、会话修改记录与已打开标签；路径规范化后去重，不新增持久化文件索引。
6. Escape 复用现有文件标签关闭流程，以保留未保存修改的确认/取消语义；只在文件标签激活时处理，不越过打开的对话框。
7. 工具详情保持外层折叠、参数和结果内容、状态、Diff 与审批按钮；仅移除冗余标题，内层结果区使用固定高度与滚动。
8. 设置中的“使用中”标记跟随 `defaultAgent`，表示新会话默认配置；标记只显示 API/CLI 名称，不读取或渲染 Key。
9. 页脚 Token 指标使用轻量确定性文本启发式估算当前可见消息与工具调用文本，以 `≈` 标识；不冒充供应商实际用量或完整上下文窗口，并按消息变更刷新。
10. 待办跳转在目标会话数据准备后立即调用定位；跨会话必要的数据加载不计为额外 UI 延迟。
11. CLI 模型菜单新增独立“切换 API/CLI…”入口，复用同一来源选项与切换处理；保留原有 CLI 默认/配置/候选/自定义模型项，来源切换仍遵守运行中禁用规则。
12. Web 预览中只移除 `loc-bar` 浮动开关 DOM 与对应样式；保留 Alt+Q 事件、定位操作条及修改记录面板。

## Project Structure

```text
src/frontend/views/chat.ts             # 消息定位、高亮、Agent 选择器
src/frontend/views/context-menu.ts     # 用户消息右键动作
src/frontend/main.ts                   # 收藏回调与 Agent 更新协调
src/frontend/views/session-view.ts     # 相关文件、Escape 与项目待办头部
src/frontend/views/settings-dialog.ts  # 当前默认配置标记
src/frontend/views/tool-card.ts        # 精简工具结果详情
src/frontend/lib/session-files.ts      # 相关文件合并/去重
src/frontend/lib/token-estimate.ts     # 对话 Token 估算
src/frontend/web/locator.ts            # 移除浮条但保留 Alt+Q 与记录功能
src/frontend/web/locator.css           # 移除 loc-bar 专属样式
src/frontend/styles.css                # 消息高亮、工具滚动区及窄视口适配
tests/unit/frontend/                   # 各逻辑用户故事的确定性单测
docs/testing/test-matrix.md            # 由后续 docs 泳道任务更新
```

**Structure Decision**: 沿用仓库既有 Electron 前后端目录与 DOM 渲染层；不创建新子项目或共享类型。

## Complexity Tracking

无宪法例外。
