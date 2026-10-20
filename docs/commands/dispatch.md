---
description: "派发给 worker agent 的提示词"
---

# /dispatch

填好 `<...>` 占位后，把下面整段粘贴给 Codex / Claude Code / Cursor / Copilot / Gemini。一个 agent 一张卡。

```text
你是 ai-code-manager 项目 <泳道> 泳道的 worker agent。

任务卡：docs/tasks/<任务号>.md（或 issue #<编号>）。

按顺序执行：
1. 阅读 AGENTS.md、docs/development/multi-agent.md、.specify/memory/constitution.md、specs/<NNN-功能>/spec.md（FR-<xxx>）与 tasks.md、contracts/<文件>，以及任务卡。
2. 运行：scripts/agent-worktree.sh new <泳道> <任务号>-<简述>（云端 agent：从 dev 创建分支 feat/<泳道>/<任务号>-<简述>）
3. export SPECIFY_FEATURE_DIRECTORY=specs/<NNN-功能> SPECIFY_FEATURE_NO_PERSIST=1，然后 $speckit-implement <任务号…>，只在 .agents/lanes.conf 中 <泳道> 的路径内改动；未合入的依赖用 contracts/fixtures 的 mock；提交前 git checkout -- specs/。
4. 补齐任务卡里的验收测试；反复运行 scripts/verify.sh 与 scripts/check-lane.sh 直到全绿。
5. rebase 到 dev，推送，按 PR 模板向 dev 提 PR 并关联任务卡。
6. 回复：PR 链接、测试输出摘要、需要 coordinator 处理的事项。

规则：不得修改泳道外文件、contracts、.agents 或共享文件。同一错误出现两次就停下，报告你尝试过的方案。
```
