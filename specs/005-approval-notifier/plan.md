# Implementation Plan: 审批通知提醒器

**Branch**: `005-approval-notifier` | **Date**: 2026-10-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-approval-notifier/spec.md`

## Summary

负责人派发任务后不再盯屏：需要他处理的事项按四级（P0 审批 / P1 受阻出错 / P2 待审查 / P3 新 ready）主动找人。技术路线是不新增数据通道、只在既有事件与快照之上加一层「提醒」：契约 v1.13（T-046）冻结提醒事项形状、激活事件与提醒偏好；主进程通知服务（T-047）复用既有 agent:event 的审批请求 / 解决与会话状态发系统通知并回传点击激活；渲染进程（T-048 / T-049）以弹窗栈 + 待办收件箱呈现全四级事项，看板侧事项由快照差分推导；设置页（T-050）读写提醒偏好。系统通知只负责「叫人 + 跳转」，不承载审批动作。

## Technical Context

**Language/Version**: TypeScript（Electron 主进程 + 渲染进程，Node ≥ 22.18；与现行代码一致）

**Primary Dependencies**: Electron（主进程 Notification、窗口聚焦）、既有契约 `contracts/ipc.ts`（v1.13，本功能增量）、既有 agent:event 事件流与看板 / 会话订阅；不新增第三方依赖

**Storage**: 不新增持久化权威数据。提醒事项由实时来源推导重建（待批准集合、会话状态、看板快照）；「稍后 / 已读」等本地标记随既有应用状态口径保存（FR-514，SHOULD 级）

**Testing**: Node 内置测试（unit / integration，`npm run test`）；通知服务以可注入替身替换 Electron Notification、假时钟驱动 3 分钟升级计时；前端分级 / 去重 / 快照差分为纯函数单测，弹窗与跳转走 E2E / 仓库外截图冒烟（见 tasks.md 各卡验收）

**Target Platform**: Windows 桌面（Electron）优先；Web 预览仅降级可用（FR-513）

**Project Type**: desktop-app（Electron + TypeScript，前后端分层、contracts 共享类型）

**Performance Goals**: 审批请求产生后系统通知 2 秒内发出（SC-001）；提醒推导不得阻塞既有事件流与看板刷新

**Constraints**: 纯增量契约（v1.12 → v1.13 只加可选字段 / 类型 / 事件变体，宪法 二）；系统通知不承载批准 / 拒绝动作（FR-508）；提醒内容沿用既有事件口径，不回传任何密钥或敏感环境变量值（宪法 十）；同一事项去重与「只弹该弹的」是硬口径（FR-501 / FR-504）

**Scale/Scope**: 单负责人单机场景；同时等待的审批可多条（弹窗成栈排队），看板任务卡量级 ≤ 数百

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- 一、硬泳道：本功能按 contracts（T-046）/ backend（T-047）/ frontend（T-048、T-049、T-050）/ docs（T-051）拆卡，一卡一泳道一分支，`check-lane.sh` 把关 —— 通过
- 二、契约先行并冻结：v1.13 先于任何实现合入（T-046 前置于其余各卡），增量只加可选字段、冻结后只增不改 —— 通过
- 三、先规格后代码：spec.md + checklists/requirements.md 已定稿（无待澄清项）后才进入本 plan 与拆卡 —— 通过
- 四、任务必须标泳道：tasks.md 全部任务带 `[lane:x]`，拆卡与之一一映射 —— 通过
- 五、测试分层：本功能触及审批相邻逻辑，不适用「简单 UI 跳过测试」；通知服务的去重 / 升级 / 门控与前端差分均为纯逻辑，必须有单测，边界（点击激活、解决撤下）走集成测试 —— 通过
- 九、写入与执行必须经用户批准：本功能不新增任何绕过审批的路径；弹窗内直批复用既有 `agent:approve` 通道且以完整展示待批内容为前提，系统通知不带审批动作 —— 通过
- 十、密钥永不进入渲染进程：提醒事项与通知只复用既有发往渲染进程的事件内容（本就不含密钥明文），`NotifySettings` 不含任何敏感值 —— 通过
- 十一、项目根沙箱：不涉及文件路径新入口；激活跳转只带 id（sessionId / approvalId / cardId），不带路径原文 —— 通过
- 十二、渲染进程最小权限：系统通知在主进程发出，渲染进程不新增 Node 能力；能力差异以契约标记 `notifyNativeAvailable` 显式表达 —— 通过
- 十四、中文优先：提醒文案、级别说明与设置文案均为中文 —— 通过

结论：无违反项，Complexity Tracking 不适用。

## Project Structure

### Documentation (this feature)

```text
specs/005-approval-notifier/
├── spec.md              # 已定稿（FR-501…FR-514、SC-001…SC-006）
├── plan.md              # 本文件
├── checklists/
│   └── requirements.md  # 规格质量清单（全过）
└── tasks.md             # T501…T509（带 [lane:x]），拆卡映射见其 Notes
```

### Source Code (repository root)

```text
contracts/
├── ipc.ts                       # v1.13 增量（T-046）：Reminder* / NotifyTarget / NotifySettings / DEFAULT_NOTIFY_SETTINGS / notify-activate / PublicSettings.notify 与 notifyNativeAvailable
├── README.md                    # v1.13 登记行（T-046）
└── fixtures/notify.sample.json  # 激活事件 + 提醒偏好 + 事项样例（T-046）

src/backend/
└── notify/                      # 主进程通知服务（T-047）：订阅审批/会话状态 → 系统通知、去重、3 分钟升级、点击回传激活事件；Notification 可注入替身

src/frontend/
├── lib/                         # 分级 / 去重 / 看板快照差分纯函数（T-048 / T-049）
├── views/                       # 弹窗栈 + 待办收件箱（T-048）、P1–P3 事项接入（T-049）、设置页提醒分区（T-050）

tests/
├── unit/backend/                # 通知服务纯逻辑（去重 / 升级 / 门控）
├── integration/backend/         # 点击激活事件载荷、解决后撤下
└── unit/frontend/               # 分级映射、差分变迁

docs/
├── tasks/T-046.md … T-051.md    # 任务卡（已随立项合入）
└── testing/test-matrix.md       # 005 覆盖行（T-051）
```

**Structure Decision**: 沿用既有分层——契约只放形状与常量，通知「发送」归主进程（backend 泳道，因系统通知是主进程能力），提醒「呈现与推导」归渲染进程（frontend 泳道，数据源是它已订阅的事件与快照），不新增进程间通道：唯一新增的跨界流量是 v1.13 的 `notify-activate` 事件与 Settings 提醒偏好字段。

## Complexity Tracking

无宪法违反项，本节不适用。
