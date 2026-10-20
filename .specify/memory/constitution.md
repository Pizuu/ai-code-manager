<!--
Sync Impact Report
- 版本：1.0.0 → 1.1.0（MINOR：新增产品原则 九–十四，不改动既有原则）
- 新增章节：「产品原则（ai-code-manager 专属）」
- 模板同步：.specify/templates/plan-template.md 的 Constitution Check 由各 plan.md 逐条列出本宪法原则 ✅（无需改模板）
- 后续 TODO：无
-->
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

## 产品原则（ai-code-manager 专属）

### 九、写入与执行必须经用户批准
任何修改文件（`write_file` / `edit_file`）的操作在执行前必须向用户展示统一 diff；任何 shell 命令（`run_command`）执行前必须展示命令原文与所用 shell。「每次询问」模式下两者都需批准；「自动批准编辑」只豁免文件编辑，**命令永远需要批准**；「仅规划」模式拒绝一切写入与执行。停止 agent 时所有待批准请求视为拒绝。不可协商。

### 十、密钥永不进入渲染进程
API Key 只存在于主进程：通过 Electron `safeStorage` 加密落盘，`safeStorage` 不可用时拒绝保存而不是明文保存。任何 IPC 返回值、事件、日志、错误信息都不得包含 Key；渲染进程只能得知「是否已配置」。契约（`contracts/ipc.ts`）中发往渲染进程的类型不得出现 Key 字段。

### 十一、项目根沙箱
所有文件工具的路径必须解析到当前项目根之内（含符号链接解析后的真实路径）；`..`、绝对路径、跨盘符、UNC 路径越界一律拒绝并返回 `E_PATH_ESCAPE`。命令以项目根为工作目录。

### 十二、渲染进程最小权限
`contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`；仅通过 preload 暴露白名单 IPC 通道；页面启用严格 CSP（禁止内联脚本与远程脚本）；模型输出渲染为 HTML 前必须先转义；禁止页面内导航与新窗口，外链只允许 http(s) 并交给系统浏览器打开。

### 十三、可追溯
每次工具调用（名称、参数、状态、结果、diff）都随会话持久化在本机，便于事后审查谁在何时改了什么。

### 十四、中文优先、跟随系统
界面文案使用简体中文；主题跟随系统明暗设置。

## 流程约束

- 分支：长期单一集成分支 `dev`；worker 用 `feat/<泳道>/<任务号>-<简述>`，每个 agent 一个 git worktree，最多 4 个并行。
- 规格持久化模型：**Flow-back（回流）**——任何制品都可先改，由 coordinator 在每批合入前把 `spec.md` / `plan.md` / `tasks.md` 对齐。
- 并行 agent 在各自 worktree 中设置 `SPECIFY_FEATURE_DIRECTORY` 与 `SPECIFY_FEATURE_NO_PERSIST=1`，避免互相覆盖活跃 feature。
- worker 不修改 `specs/`；合入后由 coordinator 在 `tasks.md` 勾选完成项，并在 `dev` 上运行 `/speckit.converge`。

## 治理

本宪法优先于其他实践文档。修订：在 `contracts` 泳道提 PR，负责人批准，按语义化版本号升级。

**版本**：1.1.0 | **批准日期**：2026-10-20 | **最后修订**：2026-10-20
