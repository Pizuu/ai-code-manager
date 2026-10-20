# ai-code-manager 项目宪法（Constitution）

> `/speckit.plan`、`/speckit.tasks`、`/speckit.analyze` 每次运行都会实时读取本文件。只能在 `contracts` 泳道上通过 `/speckit.constitution` 修改。

## 核心原则

### 一、硬泳道（文件所有权）
每个文件只属于一个泳道（`contracts`, `frontend`, `backend`, `docs`, `infra`），以 `.agents/lanes.conf` 为准。一个任务必须只在一个泳道内。共享热点文件不属于任何泳道，只能由 coordinator 修改。CI 中由 `scripts/check-lane.sh` 强制检查。

### 二、契约先行并冻结
所有跨泳道接口必须在实现前写进根目录 `contracts/`（唯一权威来源）；`specs/<功能>/contracts/` 只做链接引用。冻结后只许加字段、不许改字段；要改或删字段必须升版本，并走 `contract-change` PR，由所有使用方泳道审查。

### 三、先规格后代码
`spec.md` 只写做什么、为什么（带优先级的用户故事、FR-xxx 功能需求、SC-xxx 成功标准），技术栈与架构只写在 `plan.md`。未决项保持 `[NEEDS CLARIFICATION]` 标记，未清除前不得进入 plan。

### 四、任务必须标泳道
`tasks.md` 中每个任务必须带泳道标签，例如 `- [ ] T012 [P] [US1] [lane:backend] … 位于 src/backend/…`。跨两个泳道的任务必须拆开；标 `[P]` 可并行的任务必须属于不同泳道或不同文件。

### 五、测试分层
日常提交只跑受影响范围的测试（`npm run test`）；全量只在合入 `dev` 与发布时跑。逻辑改动不得跳过测试；纯 UI 微调可跳过单测，但须在 PR 中注明。

### 六、做完 = 提交 + 推送
只有提交、推送并向 `dev` 开好 PR、贴上验证输出，任务才算完成。「本地已提交」不算完成。

### 七、协调人裁决
两个泳道互相等待超过一轮时，由 coordinator 在契约范围内直接拍板并记为 ADR。跨泳道问题必须显式派成新任务，不得「顺手」修。

### 八、变更纪律（平衡）
改动最小且聚焦；完成前至少跑相关单测；触及安全敏感代码时执行安全检查清单。

## 流程约束

- 分支：长期单一集成分支 `dev`；worker 用 `feat/<泳道>/<任务号>-<简述>`，每个 agent 一个 git worktree，最多 4 个并行。
- 规格持久化模型：**Flow-back（回流）**——任何制品都可先改，由 coordinator 在每批合入前把 `spec.md` / `plan.md` / `tasks.md` 对齐。
- 并行 agent 在各自 worktree 中设置 `SPECIFY_FEATURE_DIRECTORY` 与 `SPECIFY_FEATURE_NO_PERSIST=1`，避免互相覆盖活跃 feature。
- worker 不修改 `specs/`；合入后由 coordinator 在 `tasks.md` 勾选完成项，并在 `dev` 上运行 `/speckit.converge`。

## 治理

本宪法优先于其他实践文档。修订：在 `contracts` 泳道提 PR，负责人批准，按语义化版本号升级。

**版本**：1.0.0 | **批准日期**：2026-10-20 | **最后修订**：2026-10-20
