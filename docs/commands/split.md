---
description: "把 tasks.md 按泳道拆成任务卡"
---

# /split

把 Spec Kit 的 `tasks.md` 按泳道切成任务卡。角色：coordinator。在 `$speckit-analyze` 干净、契约已合入后运行。

参数：$ARGUMENTS（功能目录，如 specs/001-mvp）。

1. 读 `tasks.md`；每个任务都必须带 `[lane:x]`——缺失或跨两个泳道的，回到 `$speckit-tasks` 从源头修。
2. 把未勾选任务按泳道和阶段（Setup → Foundational → US1… → Polish）分组；一张卡 = 同一泳道、约半天能完成的若干任务。
3. 按 @docs/tasks/TEMPLATE.md 写卡：任务号、FR-xxx、依赖契约、验收测试、前置任务。
4. 确认任意两张卡不改同一个文件；更新 @docs/tasks/BOARD.md 并标出 ready 卡。
5. 输出：当前可派发的 ready 卡（最多 4 张、泳道互不相同），并各附一段填好的 `docs/commands/dispatch.md`。
