# Implementation Plan: 斜杠命令菜单键盘选择

**Branch**: `manus`（协调者直提） | **Date**: 2026-10-21 | **Spec**: [spec.md](./spec.md)

**Input**: spec.md（FR-001…FR-009，FR-009 已澄清为 C：两段式确认）+ 质量清单全过

## Summary

现状：`suggestCommands` 按输入前缀给出候选，`renderSlashMenu` 只把候选渲染成纯展示行——不可点、↑↓ 无响应、Enter 走普通发送把半截 `/` 文本误发出去。本计划给菜单补齐「选中态 + 键盘/鼠标选择 + 两段式预置执行」：选择只把命令填入输入框并进入预置状态，再按 Enter 才执行。

## Technical Context

- 语言/运行时：TypeScript，渲染进程纯 DOM（无框架），代码在 `src/frontend/`
- 既有面：`lib/slash-commands.ts`（命令表 + `suggestCommands` 前缀过滤：输入含空白即无候选——菜单只活在命令名输入阶段）、`views/chat.ts` 的 `renderSlashMenu` 与 textarea keydown（Enter 发送）
- 测试：纯逻辑单测（node:test）；视图接线属交互逻辑，以单测覆盖状态谓词 + 全量验证 + 冒烟口径验收
- 约束：不改命令清单、不改菜单触发规则、不动 contracts 与发送通道

## Constitution Check

- 契约先行：本功能不涉及 IPC/契约变更，`contracts/` 零改动 ✓
- 简单 UI 跳过测试仅限纯样式/文案；本功能含交互状态逻辑，纯函数部分必须有单测 ✓
- 变更最小化：只动 `lib/slash-menu.ts`（新）、`views/chat.ts`、`styles.css` ✓

## Key Decisions

1. **确认键只用 Enter，不用 Tab**（spec 留给 plan 决定）：Tab 保留焦点移动语义，避免破坏键盘可达性；Enter 是唯一确认键，规格 SC-001 的按键预算按 Enter 口径成立。
2. **状态拆分**：菜单状态（候选签名、选中序号）留在 chat 闭包；可测的纯逻辑抽到 `lib/slash-menu.ts`：
   - `wrapIndex(index, delta, count)`：首尾循环（FR-002）；count 为 0 时返回 -1。
   - `commandHasArgs(cmd)`：`usage !== name` 即带参数位（现有命令表口径，如 `/model [模型名]`）。
   - `filledTextFor(cmd)`：填入文本 = 命令名 +（带参时一个尾随空格，光标落在参数位）。
   - `isPrimedText(primedName, current)`：预置有效性谓词——current 的首个 token 恒等于预置命令名（其后是结尾或空格分隔的参数区）才算预置未取消；命令名本身被改动、文本被清空或不再以该命令开头 → 预置取消（FR-009 的「修改即取消」落点：改的是命令本身；在参数区补字属「继续补参数」，不取消）。
3. **过滤重置**：候选集合以命令名拼接为签名；签名变化（继续输入/删除导致集合变窄或恢复）时选中序号重置为 0（FR-004/SC-004）。
4. **预置可见性**（FR-009「明确可见」）：输入框上方出现一条预置条（复用 composer 区）：「已预置 /xxx —— 再按 Enter 执行；修改命令或清空将取消」+ 取消按钮（点 × 只取消预置、保留文本）。预置期间 Enter 走既有发送路径执行命令；Esc 先取消预置（菜单已关时）。
5. **Esc 两段**：菜单开着时 Esc 只关菜单并置抑制标记（文本不变则菜单不自动重开，下一次输入变化才解除）；菜单关着且有预置时 Esc 取消预置（FR-005）。
6. **误发送防护**（FR-003/SC-002）：keydown 处理顺序——菜单可见时 Enter/↑/↓/Esc 一律被菜单逻辑接管并 preventDefault，绝不落入发送分支；输入法组字中（`isComposing`）全部按键不参与菜单交互（US3-4）。
7. **鼠标一致**（FR-006/SC-003）：候选项 mouseenter 即设为选中项；click 与 Enter 确认共用同一个 pick 函数，填入文本必然一致。
8. **残留清理**：切换会话、发送完成、点击会话外区域导致菜单关闭的既有路径上，同步清菜单状态；预置在切换会话时取消（预置属于输入框状态，不跨会话）。

## Risks

- keydown 与既有发送/重提（pendingReask）逻辑的顺序：菜单接管必须在发送判断之前、且不影响普通 Enter 发送（菜单不可见时零干预，US1-5）。
- suggestCommands 在输入含空格时返回空——填入带参命令后菜单自然关闭，与预置条接棒呈现，无冲突。

## Verification

- 单测：`slash-menu` 三个纯函数全覆盖（循环、单条、空集、带参/无参填入、预置有效/取消的各形态）
- 全量：eslint / tsc / build / npm run test 全绿
- 人工冒烟（web 预览）：`/` 弹菜单首条选中 → ↓↑ 循环 → Enter 填入且不发送、预置条出现 → 补参数 → Enter 执行；Esc 关菜单；鼠标悬停/点击一致；中文组字不触发
