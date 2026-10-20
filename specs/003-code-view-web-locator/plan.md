# Implementation Plan: 代码查看、发送到任务会话、Web 预览 UI 定位与空白 agent 配置

**Branch**: `003-code-view-web-locator` | **Date**: 2026-10-20 | **Spec**: [spec.md](spec.md)

## Summary

一个只读 IPC（`fs:read`）+ 渲染层标签页代码查看器；渲染层自定义全局右键菜单（`contracts/ui.ts` 声明 DOM 标记与来源模型）；`scripts/web-dev.ts` 以 Node 类型擦除原样提供渲染层源码，浏览器内 `window.api` 适配器只读通道走服务器、其余内存模拟，UI 定位从 `createElement` 调用栈取源位置；设置默认值清空并新增 `E_NOT_CONFIGURED`。设计取舍见 ADR 0008，测试规则见 ADR 0007。

## Technical Context

**Language/Version**: TypeScript 6（`erasableSyntaxOnly`），Node ≥ 22.18（`module.stripTypeScriptTypes`）  
**Primary Dependencies**: 无新增依赖  
**Testing**: `node --test`；视图 DOM 按宪法 五（1.2.0）简单 UI 改动跳过测试，由仓库外无头截图冒烟核对  
**Target Platform**: Windows Electron；Web 预览为任意桌面浏览器（仅开发）  
**Constraints**: CSP 不变（`script-src 'self'`）；Web 预览不写盘、不执行命令、不进打包

## Constitution Check

| 原则 | 结论 |
|---|---|
| 一 硬泳道 | ✅ 按 contracts / @shared / backend / frontend / infra / docs 拆卡（T-023…T-030） |
| 二 契约先行 | ✅ `ipc.ts` v1.2 纯增量；新增 `ui.ts` v1、`web-dev.ts` v1 |
| 三 先规格后代码 | ✅ 本目录 spec → plan → tasks |
| 五 测试分层（1.2.0） | ✅ 沙箱、右键内容组装、配置为空、契约通道写单测；视图 DOM 跳过 |
| 九 写入与执行审批 | ✅ 不涉及；Web 预览无写入 / 执行通道 |
| 十 密钥不进渲染进程 | ✅ 不变；Web 预览设置为内存模拟且无 Key |
| 十一 项目根沙箱 | ✅ `fs:read` 与 Web 服务器读取均经 `resolveSafe` |
| 十二 渲染进程最小权限 | ✅ 新增一个只读通道；高亮用 textContent；CSP 不变 |
| 十四 中文优先 | ✅ |

## Project Structure

```text
contracts/ipc.ts (v1.2) · contracts/ui.ts · contracts/web-dev.ts
src/backend/fs/file-view.ts            # fs:read 实现（新）
src/backend/ipc/{handlers,validate}.ts · src/backend/preload.cts
src/backend/settings/settings-store.ts · src/backend/agent-cli/presets.ts
src/frontend/lib/{context-send,highlight,agent-config}.ts      # 纯函数（新）
src/frontend/views/{code-view,context-menu}.ts                 # 视图（新）
src/frontend/views/{shell,session-view,chat,board-view,git-view,settings-dialog,agent-cli-settings}.ts
src/frontend/web/{boot,mock-api,locator}.ts                    # Web 预览（新，不进打包）
scripts/web-dev.ts                                             # Web 预览服务器（新）
```

## Complexity Tracking

| 偏差 | 原因 |
|---|---|
| 契约 v1.2 合入到 backend 合入之间 hark-dev typecheck 不通过 | preload / handlers 的编译期穷举检查（同 002，有意的防漏机制），两者连续合入 |
| `stripTypeScriptTypes` 为 Node 22 实验特性 | 仅开发用 Web 预览；换来行号与源码一致（ADR 0008） |
