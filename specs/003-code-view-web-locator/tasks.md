---
description: "Task list for 003-code-view-web-locator"
---

# Tasks: 代码查看、发送到任务会话、Web 预览 UI 定位与空白 agent 配置

**Input**: spec.md、plan.md、ADR 0007 / 0008、contracts/

**Tests**: 按宪法 五（1.2.0）：逻辑（沙箱、右键内容组装、IPC 契约、配置为空）写少量单测；视图 DOM 为简单 UI 改动，跳过测试，由无头截图冒烟核对。

## Format: `[ID] [P?] [Story] [lane:x] Description`

- 任务号使用 T2xx（与 001 的 T0xx、002 的 T1xx 区分）。

## Phase 1: Setup（契约与规则）

- [ ] T201 [lane:contracts] Spec Kit 制品 specs/003-code-view-web-locator/（spec、plan、tasks、analysis、checklists、contracts/README.md）；宪法 1.2.0（原则 五）；ADR 0007、0008；契约 contracts/ipc.ts v1.2、contracts/ui.ts、contracts/web-dev.ts；docs/SPEC.md 与 contracts/README.md 登记；清理 specs/001 中的 gpt / openai.com 默认值示例
- [ ] T202 [lane:@shared] AGENTS.md「简单 UI 修改跳过测试」；package.json `web` 脚本与 build.files 排除 `dist/src/frontend/web/**`；tsconfig 纳入 scripts/；任务卡 T-023…T-030 与 BOARD

## Phase 2: User Story 1/4 — 主进程（P1）

- [ ] T203 [US1] [lane:backend] `fs:read` 只读实现 src/backend/fs/file-view.ts（resolveSafe、普通文件、截断 / 二进制 / 超大），validate `asRelPath`，handlers 与 preload 接线；测试 tests/integration/backend/fs/file-view.test.ts、handlers 通道用例
- [ ] T204 [US4] [lane:backend] 设置默认值清空（baseUrl / model = ''，切换提供方不回填，validate 允许空 baseUrl），opencode 预设值为空，未配置发送 `E_NOT_CONFIGURED`；更新 tests/integration/backend/settings/*、handlers 用例

## Phase 3: User Story 1/2/4 — 渲染进程（P1）

- [ ] T205 [US2] [lane:frontend] 右键内容组装纯函数 src/frontend/lib/context-send.ts（格式化、截断、DOM 标记解析），单测 tests/unit/frontend/lib/context-send.test.ts
- [ ] T206 [US1] [lane:frontend] 代码查看器 src/frontend/views/code-view.ts + 轻量高亮 src/frontend/lib/highlight.ts（单测 tests/unit/frontend/lib/highlight.test.ts）；任务会话中列标签页；文件树单击打开
- [ ] T207 [US2] [lane:frontend] 全局右键菜单 src/frontend/views/context-menu.ts；文件树 / 看板卡 / Git 提交与分支行 / 代码查看器加 `data-send-*` 标记；插入输入框并切到任务会话
- [ ] T208 [US4] [lane:frontend] 设置空白与提示：placeholder 示例、「按示例填写」、opencode 表单预设值为空；未配置判断纯函数 src/frontend/lib/agent-config.ts（单测）；会话「请先在设置中配置 agent」

## Phase 4: User Story 3 — Web 预览（P2）

- [ ] T209 [US3] [lane:frontend] Web 预览渲染层 src/frontend/web/boot.ts、mock-api.ts（只读通道走服务器，其余内存模拟）、locator.ts（UI 定位）
- [ ] T210 [US3] [lane:infra] Web 预览服务器 scripts/web-dev.ts（127.0.0.1、GET/HEAD、类型擦除、只读通道、路径白名单）

## Phase 5: Polish

- [ ] T211 [lane:docs] README（代码查看、右键发送、Web 预览、配置空白）、CHANGELOG 0.3.0、docs/testing/test-matrix.md、docs/security/threat-model.md、docs/development 测试规则
- [ ] T212 [lane:@shared] 收尾：ROADMAP、BOARD 与卡片 flow-back、版本号 0.3.0；tasks.md 勾选（contracts）
