# Tasks: 会话消息交互改进

**Input**: Design documents from `/specs/006-chat-interactions/`  
**Prerequisites**: spec.md, plan.md, research.md, data-model.md, quickstart.md  
**Tests**: 三项用户故事都涉及交互逻辑，须新增确定性前端单测。

## Format: `[ID] [P?] [Story] [lane:x] Description`

- 本规格任务号使用 T6xx，与规格号 006 对齐。
- 不新增 IPC 契约字段；只复用现有消息、收藏、设置和会话 Agent 能力。

## Phase 1: Setup

无需新增依赖、项目脚手架或配置。

## Phase 2: Foundational

无需新增共享契约或后端基础设施；沿用现有持久化与 IPC。

## Phase 3: User Story 1 — 从待办准确跳回对话（P1）

- [ ] T601 [US1] [lane:frontend] 在 `tests/unit/frontend/chat-interactions.test.ts` 覆盖待办文本匹配、无匹配与多条匹配的确定性选择、用户消息 ID 定位，以及约 1.4 秒高亮的需求逻辑。
- [ ] T602 [US1] [lane:frontend] 在 `src/frontend/views/chat.ts` 为用户消息暴露稳定 ID 并扩展定位；在 `src/frontend/styles.css` 保留焦点效果并突出整条用户气泡及首个精确文本匹配。无匹配时不误跳转、不修改消息正文。

## Phase 4: User Story 2 — 右键收藏用户消息（P1）

- [ ] T603 [US2] [lane:frontend] 扩展 `tests/unit/frontend/chat-interactions.test.ts`，覆盖用户消息无选中文字时的收藏入口、完整快照/来源和重复收藏处理。
- [ ] T604 [US2] [lane:frontend] 在 `src/frontend/views/context-menu.ts` 与 `src/frontend/main.ts` 为用户消息接入收藏动作，保存整条消息及来源；复用现有收藏存储并保持助手消息收藏不变。

## Phase 5: User Story 3 — 在输入区切换 Agent 来源（P1）

- [ ] T605 [US3] [lane:frontend] 扩展 `tests/unit/frontend/chat-interactions.test.ts`，覆盖 API/CLI 选项、当前会话与默认值同步、运行中禁用、权限不变、补偿回退成功及补偿失败后的实际状态呈现。
- [ ] T606 [US3] [lane:frontend] 在 `src/frontend/views/chat.ts` 与 `src/frontend/main.ts` 增加 API/CLI 选择器，放在模型入口左侧并与现有控件对齐；更新空闲会话及新会话默认值、刷新模型标签，运行中禁用；写入失败时尝试补偿，补偿失败则反映实际状态并提示错误。
- [ ] T607 [US3] [lane:frontend] 在仓库根目录运行 `npm run test`、`npx eslint .`、`npx tsc --noEmit`、`npm run build`、`scripts/verify.sh` 和 `scripts/check-lane.sh`；只修复本泳道引入的问题。

## Phase 6: 测试矩阵文档（docs）

- [ ] T608 [lane:docs] 在 `docs/testing/test-matrix.md` 增加会话消息交互单测覆盖行，并注明本功能不新增 IPC/后端测试。

## Dependencies

- T601 → T602 → T603 → T604 → T605 → T606 → T607 → T608。
- 对应拆卡：T601–T602 → T-054；T603–T604 → T-055；T605–T607 → T-056；T608 → T-057。

## Notes

- 用户消息来源仍按现有待办文本匹配规则解析；不新增 `sourceMessageId` 或项目级待办存储。
- `docs/tasks/BOARD.md` 与 `docs/SPEC.md` 由 coordinator 同步；不属于 worker 的允许修改路径。
