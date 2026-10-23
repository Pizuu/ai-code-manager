# Tasks: 会话消息交互改进

**Input**: Design documents from `/specs/006-chat-interactions/`  
**Prerequisites**: spec.md, plan.md, research.md, data-model.md, quickstart.md  
**Tests**: 状态、定位、文件聚合与 Token 估算等逻辑必须新增确定性前端单测；仅 DOM/CSS 的工具标题、待办头部与 Web 浮条简化按宪法五记录并手动验收。

## Format: `[ID] [P?] [Story] [lane:x] Description`

- 本规格任务号使用 T6xx，与规格号 006 对齐。
- 不新增 IPC 契约字段；只复用现有消息、收藏、设置、会话 Agent、Diff 与文件标签能力。
- 全部产品改动在 frontend 泳道；由于多个任务共享视图与样式文件，按依赖串行，不并行派发。

## Phase 1: Setup

无需新增依赖、项目脚手架或配置。

## Phase 2: Foundational

无需新增共享契约或后端基础设施；沿用现有持久化与 IPC。

## Phase 3: User Story 1 — 从待办准确跳回对话（P1）

**Independent Test**: 创建含待办文本的用户消息，点击待办后确认立即定位且消息与命中词短暂高亮；无匹配时不误跳转。

- [ ] T601 [US1] [lane:frontend] 在 `tests/unit/frontend/chat-interactions.test.ts` 覆盖待办文本匹配、无匹配与多条匹配的确定性选择、用户消息 ID 定位，以及约 1.4 秒高亮逻辑。
- [x] T602 [US1] [lane:frontend] 在 `src/frontend/views/chat.ts` 为用户消息暴露稳定 ID 并扩展定位；在 `src/frontend/styles.css` 突出整条用户气泡及首个精确文本匹配。目标会话内容就绪后立即滚动，不加人为等待；无匹配时不误跳转、不修改消息正文。（对账回填 2026-10-23：代码已实现，未经本卡流程勾选）

## Phase 4: User Story 2 — 右键收藏用户消息（P1）

**Independent Test**: 右键未选中文字的用户消息并收藏，从收藏入口回到原会话/消息，确认完整快照与原消息不变。

- [ ] T603 [US2] [lane:frontend] 扩展 `tests/unit/frontend/chat-interactions.test.ts`，覆盖用户消息无选中文字时的收藏入口、完整快照/来源和重复收藏处理。
- [x] T604 [US2] [lane:frontend] 在 `src/frontend/views/context-menu.ts` 与 `src/frontend/main.ts` 为用户消息接入收藏动作，保存整条消息及来源；复用现有收藏存储并保持助手消息收藏不变。（对账回填 2026-10-23：代码已实现，未经本卡流程勾选）

## Phase 5: User Story 3 — 在输入区切换 Agent 来源（P1）

**Independent Test**: 配置 API 与两个 CLI，分别通过左侧选择器和 CLI 菜单入口切换，核实当前会话/新会话默认同步、模型跟随、权限不变、运行时禁用，且助手消息头显示正确 Agent 名称。

- [ ] T605 [US3] [lane:frontend] 扩展 `tests/unit/frontend/chat-interactions.test.ts`，覆盖 API/CLI 选项、模型菜单来源入口、保留模型选项、当前会话与默认值同步、运行中禁用、权限不变、补偿回退成功及补偿失败后的实际状态呈现，并断言助手消息头显示对应 Agent 名称。
- [x] T606 [US3] [lane:frontend] 在 `src/frontend/views/chat.ts` 与 `src/frontend/main.ts` 增加位于模型入口左侧的 API/CLI 选择器，并在 CLI 模型菜单新增独立“切换 API/CLI…”入口；两处复用同一来源列表和切换流程，保留 CLI 默认/配置/候选/自定义模型选项，更新空闲会话及新会话默认值、刷新模型标签，运行中禁用。（对账回填 2026-10-23：代码已实现，未经本卡流程勾选）
- [ ] T607 [US3] [lane:frontend] 在仓库根目录运行 `npm run test`、`npx eslint .`、`npx tsc --noEmit`、`npm run build`、`scripts/verify.sh` 和 `scripts/check-lane.sh`；只修复本泳道引入的问题。

## Phase 6: User Story 4 — 精简浏览工具调用结果（P1）

**Independent Test**: 展开含长参数/结果的工具调用，检查标题精简、内容滚动、外层折叠及状态、Diff、批准/拒绝操作仍可用。

- [ ] T608 [US4] [lane:frontend] 在 `src/frontend/views/tool-card.ts`、`src/frontend/views/chat.ts` 与 `src/frontend/styles.css` 隐藏冗余的参数/结果小标题，并将长内容放入可折叠、固定高度且可滚动的区域；保留内容、状态、Diff 与审批操作。此项仅 DOM/CSS 布局，按宪法五跳过新增测试并在卡片记录，须手动验收。

## Phase 7: User Story 5 — 从会话上下文打开相关文件（P1）

**Independent Test**: 从三种来源构成含重复路径的会话文件清单，确认仅显示唯一项；打开文件后按 Escape 关闭，并验证未保存确认取消时状态不变。

- [ ] T609 [US5] [lane:frontend] 在 `tests/unit/frontend/lib/session-files.test.ts` 覆盖消息提及、修改记录、已打开标签三来源合并、路径去重、空清单与来源顺序；覆盖 Escape 关闭判定的边界。
- [x] T610 [US5] [lane:frontend] 在 `src/frontend/lib/session-files.ts` 与 `src/frontend/views/session-view.ts` 实现去重文件视图；相关文件条目点击后打开文件；Escape 关闭激活标签并复用未保存修改确认/取消流程。（对账回填 2026-10-23：代码已实现，未经本卡流程勾选）

## Phase 8: User Story 6 — 识别当前配置并查看对话 Token 估算（P2）

**Independent Test**: 分别使用 API 和 CLI 新建空会话及含文本会话，确认默认配置标记正确、估算显示为约值并随消息更新。

- [ ] T611 [US6] [lane:frontend] 在 `tests/unit/frontend/lib/token-estimate.test.ts` 覆盖空内容、ASCII 文本、中文/Unicode、消息集合与工具调用文本的确定性估算。
- [x] T612 [US6] [lane:frontend] 在 `src/frontend/lib/token-estimate.ts` 实现轻量近似估算；在 `src/frontend/views/chat.ts` 对 API/CLI 会话（含空会话）显示带 `≈` 的当前对话 Token 数，在 `src/frontend/views/settings-dialog.ts` 按 `defaultAgent` 标出正在使用的 API/CLI 配置且不泄露密钥；用提示说明估算范围。（对账回填 2026-10-23：代码已实现，未经本卡流程勾选）

## Phase 9: User Story 7 — 简化项目待办卡片操作（P2）

**Independent Test**: 打开项目待办卡片，确认头部无固定/关闭按钮，标题仍能反复展开和收起且内容保留。

- [ ] T613 [US7] [lane:frontend] 在 `src/frontend/views/session-view.ts` 移除待办卡片头部固定和关闭按钮及失效置顶状态；保留标题按钮展开/收起。此项仅 DOM 与局部状态清理，按宪法五记录并手动验收。

## Phase 10: User Story 8 — 移除 Web 预览浮动定位栏（P2）

**Independent Test**: 打开 Web 预览确认 `body > div.loc-bar` 不存在；按 Alt+Q 后定位开关、操作条与修改记录仍可用。

- [x] T614 [US8] [lane:frontend] 在 `src/frontend/web/locator.ts` 与 `src/frontend/web/locator.css` 移除 `.loc-bar` DOM 和专属样式；保留 Alt+Q 状态切换、悬停高亮、定位操作条与修改记录面板，并在 `npm run web` 中手动确认。（对账回填 2026-10-23：代码已实现，未经本卡流程勾选）

## Phase 11: User Story 9 — 简化会话上下文与侧栏入口（P2）

**Independent Test**: 确认助手消息头显示 Agent 名称而右侧上下文不重复；指定上下文条目不出现；快速教程入口位于设置入口之后且仍可打开。

- [ ] T615 [US9] [lane:frontend] 在 `src/frontend/views/session-view.ts` 移除重复 Agent 字段与用户指定的 `div.k:nth-of-type(9)` 上下文条目；在 `src/frontend/views/shell.ts` 将 `a.ri:nth-of-type(8)` 快速教程入口移到设置按钮之后的 rail 底部。此项仅 DOM 布局，按宪法五记录并手动验收。

## Phase 12: 最终验证

- [ ] T616 [lane:frontend] 在所有前端改动完成后运行 `npm run test`、`npx eslint .`、`npx tsc --noEmit`、`npm run build`、`scripts/verify.sh` 和 `scripts/check-lane.sh`；只修复本泳道引入的问题，并完成 quickstart 全部手动验收。

## Phase 13: 测试矩阵文档（docs）

- [ ] T617 [lane:docs] 在 `docs/testing/test-matrix.md` 登记本功能实际新增的确定性前端单测（待办定位、收藏、Agent 菜单/选择、文件合并、Token 估算），不声称新增未实施的 IPC/E2E 覆盖，也注明按宪法五跳过测试的纯 UI 改动。

## Dependencies

- T601 → T602 → T603 → T604 → T605 → T606 → T607 → T608 → T609 → T610 → T611 → T612 → T613 → T614 → T615 → T616 → T617。
- 对应拆卡：T601–T602 → T-054；T603–T604 → T-055；T605–T607 → T-056；T608 → T-058；T609–T610、T613 → T-059；T611–T612 → T-060；T614–T616 → T-061；T617 → T-057。

## Implementation Strategy

MVP 为 US1–US3，按待办定位、用户消息收藏、Agent 来源切换顺序完成；随后按 US4–US9 逐卡推进。全部实现任务都属于 frontend 泳道且共享视图/样式，因此不标 `[P]`、不并发派发；T-057 docs 卡在所有 frontend 卡合入后执行。T-054 在独立 reviewer 审核 UX 清单并由 coordinator 合入规格前保持 blocked。

## Notes

- 用户消息来源仍按现有待办文本匹配规则解析；不新增 `sourceMessageId` 或项目级待办存储。
- `docs/tasks/BOARD.md` 与 `docs/SPEC.md` 由 coordinator 同步；不属于 worker 的允许修改路径。
- 逻辑测试任务保留在未来实现卡中；本轮按负责人要求不执行测试命令。
