# specs/

Spec Kit 生成的功能目录。不要手工创建——运行 `$speckit-specify`。

```text
specs/001-<功能>/
├── spec.md          # /speckit.specify + /speckit.clarify（做什么/为什么，FR-xxx、SC-xxx）
├── plan.md          # /speckit.plan（技术栈、架构、宪法检查）
├── research.md · data-model.md · quickstart.md
├── contracts/       # 只链接根目录 contracts/（唯一权威）
├── checklists/      # requirements.md（内置）+ 审查者负责的清单
└── tasks.md         # /speckit.tasks 生成并带泳道标签；/speckit.converge 追加
```

- 归 `contracts` 泳道（coordinator）所有；worker 只读不写。
- 持久化模型：Flow-back（见宪法）。
- 活跃 feature 记录在 `.specify/feature.json`（机器本地）。在 worktree 中：`export SPECIFY_FEATURE_DIRECTORY=specs/001-<功能> SPECIFY_FEATURE_NO_PERSIST=1`。
