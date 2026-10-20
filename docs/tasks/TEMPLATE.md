# T-000 <简短标题>

| 字段 | 值 |
|---|---|
| 泳道 | contracts | frontend | backend | docs | infra |
| 对应需求 | FR-xxx / US<n>（specs/<NNN-功能>/spec.md） |
| 包含任务号 | T0xx, T0yy（来自 specs/<NNN-功能>/tasks.md，同一泳道） |
| 分支 | `feat/<泳道>/T-000-<简述>` |
| PR 目标 | `dev` |
| 前置任务 | T-xxx（必须已合入）/ 无 |
| 状态 | ready / in-progress / review / blocked / done |
| 执行者 | codex / claude / 人类 |

## 目标

一两句话：本任务完成后，多了什么之前没有的东西。

## 允许修改的路径

严格等于 `.agents/lanes.conf` 中本泳道的 glob，之外一律越界。

## 依赖契约

- `contracts/...`（版本）

## 验收标准

- [ ] 测试：`...` 通过
- [ ] `scripts/verify.sh` 全绿
- [ ] `scripts/check-lane.sh` 全绿

## 不做什么

- 

## 给 agent 的提示

坑点、可参考的现有代码、要用的 fixtures。
