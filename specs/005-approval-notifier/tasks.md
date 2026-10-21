---
description: "Task list for 005-approval-notifier"
---

# Tasks: 审批通知提醒器

**Input**: Design documents from `/specs/005-approval-notifier/`

**Prerequisites**: spec.md（本目录）、checklists/requirements.md

**Tests**: SC-001…SC-006 要求自动化验证；宪法 五要求逻辑改动必须有测试。本功能含审批相邻逻辑，不适用「简单 UI 跳过测试」。

## Format: `[ID] [P?] [Story] [lane:x] Description`

- 任务号使用 T5xx，与规格号 005 对齐（历史规格用 T0xx / T1xx / T2xx 偏移约定，本规格起对齐，理由见 spec.md FR 节首注）。
- 契约版本：现行 v1.12（files:pick），本功能升 v1.13。

## Phase 1: Setup（规格与契约）

- [x] T501 [lane:contracts] Spec Kit 制品 specs/005-approval-notifier/（spec、checklists、tasks；随立项提交完成，plan 阶段补 plan.md）
- [x] T502 [lane:contracts] 契约 v1.13 增量 contracts/ipc.ts：提醒事项形状（级别 / 来源 / 状态 / 跳转目标）、主进程→渲染进程的提醒激活事件（携带 sessionId + approvalId 或 cardId）、Settings 提醒偏好字段（按级别系统通知开关、声音开关、稍后时长）；contracts/README.md 登记与 fixtures 样例

## Phase 2: Foundational（主进程通知能力）

- [ ] T503 [US1] [lane:backend] 主进程通知服务 src/backend/notify/：订阅审批请求产生 / 解决与会话状态，P0 / P1 发系统通知（Electron Notification 可注入替身以便测试），以 approvalId 去重，P0 等待 3 分钟升级一次，点击通知聚焦窗口并回传激活事件；按 Settings 提醒偏好门控；单元 + 集成测试（假通知器 + 假时钟）

## Phase 3: User Story 1 — 审批请求不漏看（P1）

- [x] T504 [US1] [lane:frontend] 提醒弹窗栈与待办收件箱（落地为 views/notify-view.ts + lib/notify.ts）：消费 agent:event 审批请求 / 解决与激活事件，P0 弹窗栈（完整内容、命令不截断）、查看跳转（切会话 + 定位高亮审批卡，复用既有 focus 机制）、弹窗内直批 / 直拒（复用既有审批通道）、正在看该审批时不弹窗、已解决自动撤下；收件箱入口定版（FR-511）：shell rail 底部组、主题按钮上方的收件箱按钮 + 未消解角标，点击开弹层含「待处理 / 历史」两页签，历史页签按 FR-515 记录已决审批（结果 / 时间 / 会话 / 摘要，来自解决事件；重启恢复以 localStorage 落盘等价实现）；纯逻辑（分级 / 去重 / 排队）抽 lib 并单测
- [x] T505 [US1] [lane:frontend] Web 预览降级：无系统通知能力时仅应用内弹窗与收件箱，通知服务状态在前端可判读、不报错（与 T503 的能力标记对齐；本卡无预览专用分支，Web 冒烟通过）

## Phase 4: User Story 2 — 受阻与出错主动报信（P2）

- [ ] T506 [US2] [lane:frontend] P1 事项生成：会话出错状态与看板卡片受阻变迁 → 各一条 P1 事项，持续期间不重复、恢复自动消解、「稍后」挪入收件箱保留计数；变迁差分纯函数单测

## Phase 5: User Story 3 — 待审查与新 ready 只攒不扰（P3）

- [ ] T507 [US3] [lane:frontend] P2 / P3 事项生成：看板快照差分识别待审查（P2，轻提示一次）与新 ready（P3，仅收件箱）；收件箱按级别 / 时间呈现等待时长、点击跳转来源、P2 / P3 标记已读、未消解计数常驻状态栏；与 T506 共用差分 lib

## Phase 6: Polish（设置与文档）

- [ ] T508 [lane:frontend] 设置页提醒分区：按级别开关系统通知与声音、稍后时长，读写 Settings 提醒偏好（T502 字段）；P0 计数不可关的口径在文案中明示
- [ ] T509 [lane:docs] 用户与测试文档：提醒分级说明、设置口径、Web 预览降级写入用户文档；docs/testing/test-matrix.md 补 005 覆盖行（SC-001…SC-006 的验证落点）

## Dependencies

- T502 阻塞 T503、T504、T508（契约先行；其余泳道可先用 fixtures mock 开发）
- T503 与 T504 经 T502 的激活事件对接，互不阻塞代码本体，联调在 T504 验收中完成
- T506、T507 依赖 T504 的收件箱容器
- T509 依赖 T503、T504 合入

## Notes

- 拆卡映射（docs/tasks/）：T-046 ← T501（余量）+ T502；T-047 ← T503 + T505 的主进程侧能力标记；T-048 ← T504 + T505 的前端侧降级；T-049 ← T506 + T507；T-050 ← T508；T-051 ← T509。设置分区（T508）单拆一卡：与弹窗栈同泳道但不同文件面（设置对话框 vs shell / 会话视图），串行不撞车。
