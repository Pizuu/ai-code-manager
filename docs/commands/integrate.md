---
description: "按顺序集成 worker PR"
---

# /integrate

把一批 worker PR 合入 `manus`。角色：coordinator。

```
!`git fetch --all --prune`
!`git log --oneline -10 origin/dev`
```

1. 列出所有指向 `manus` 的 PR；CI 或 lane-guard 为红的先剔除。
2. 逐个对照任务卡验收项；把审查分给非作者的 agent / 人类。
3. 按顺序合入：契约 → shared/backend → frontend/apps → docs。
4. 每合入一个，通知其余 PR 运行 `scripts/agent-worktree.sh sync .`。
5. 冲突由你在 `int/<主题>` 分支上解决；绝不让两个 worker 互改对方分支。
6. 在 `manus` 上跑 `scripts/verify.sh`（及 e2e），更新 `docs/tasks/BOARD.md`，报告新的 ready 卡。
6.5 在 `tasks.md` 勾选已合入的任务号并推送，然后运行 `$speckit-converge`：✅ Converged 才算功能完成；有追加任务 → 运行 `docs/commands/split.md` 显式派工。
7. `manus` 稳定后，请负责人将其合入 `main`。
