---
description: "Task list for 004-slash-keyboard-select"
---

# Tasks: 斜杠命令菜单键盘选择

**Input**: spec.md（FR-001…FR-009）、plan.md（Key Decisions 1–8）

**Tests**: 纯逻辑（wrapIndex / commandHasArgs / filledTextFor / isPrimedText）写单测；视图接线为交互逻辑，全量验证 + web 预览冒烟。

## Format: `[ID] [P?] [Story] [lane:x] Description`

- 任务号使用 T4xx（与 001 的 T0xx、002 的 T1xx、003 的 T2xx、005 的 T5xx 区分）。

## Phase 1: 纯逻辑（US1/US3 的状态基础）

- [x] T401 [lane:frontend] 新建 `src/frontend/lib/slash-menu.ts`：`wrapIndex`（首尾循环、空集 -1、单条不变）、`commandHasArgs`（usage 与 name 比对）、`filledTextFor`（命令名 + 带参尾随空格）、`isPrimedText`（首 token 恒等判定，参数区补字不取消、命令被改/清空取消）；单测 `tests/unit/frontend/lib/slash-menu.test.ts` 覆盖 plan 的 Verification 清单（对账回填 2026-10-23：代码已实现，未经本卡流程勾选）

## Phase 2: 菜单选择接线（US1/US2/US3）

- [x] T402 [US1/US2/US3] [lane:frontend] `views/chat.ts` 菜单状态接线：候选签名变化重置选中序号；渲染加选中态 `.on`（FR-008，与 hover 同视觉）；keydown 在发送判断之前接管菜单可见期的 Enter（pick 填入 + 预置 + 关菜单、绝不发送）/ ↑ / ↓（循环移动）/ Esc（关菜单 + 抑制重开），`isComposing` 全豁免；候选项 mouseenter 设选中、click 走同一 pick；无候选时菜单不可见且零拦截（FR-007）；切换会话/发送后清状态（对账回填 2026-10-23：代码已实现，未经本卡流程勾选）
- [x] T403 [US1] [lane:frontend] 预置条（FR-009 可见性）：composer 区加预置条 DOM（命令名 + 「再按 Enter 执行」提示 + × 取消预置保留文本）；pick 后进入预置，Enter 在预置有效时放行既有发送路径执行、执行后清预置；输入变化时用 `isPrimedText` 复核、失效即撤条；菜单关闭状态下 Esc 取消预置；`styles.css` 定点加 `.slash-menu .on` 与预置条规则（对账回填 2026-10-23：代码已实现，未经本卡流程勾选）

## Phase 3: 收尾

- [x] T404 [lane:docs] 全量验证（eslint/tsc/build/全量测试）+ web 预览冒烟按 plan 的 Verification 清单逐项核对；spec.md 状态 Draft → Done、本文件勾选回写；CHANGELOG 与测试矩阵如有对应条目同步（无则注明）（应负责人要求统一勾选 2026-10-23；单测/验收未单独补）
