# 项目 AI 协作规则

> AI 协作规则的唯一入口。细节在 `docs/` 中，本文件保持简洁。

## 项目事实

- **项目名称**：`ai-code-manager`
- **项目简介**：类 Claude Code 的 Windows 桌面 AI 编程助手（Electron + TypeScript）
- **技术栈**：TypeScript / Node.js
- **目录布局**：前后端分层
- **默认分支**：`main`
- **应用形态**：Electron 桌面应用；`src/backend/` = 主进程（Agent 核心），`src/frontend/` = 渲染进程（纯 DOM + CSS）；两侧共享类型只来自 `contracts/`

## 目录职责

- `src/frontend/、src/backend/` —— 产品源码。
- `tests/unit/、tests/integration/、tests/e2e/` —— 自动化测试，与源码结构对应。
- `docs/` —— 长期文档：架构、开发、测试、安全。
- `skills/` —— Agent Skills 标准目录（agent 按需自动发现加载）。
- `docs/agents/` —— 协作角色提示词（architect / reviewer / tester / security-reviewer）。
- `docs/commands/` —— 常用命令模板（review / verify / security-audit）。
- `scripts/` —— 本地验证与安全检查脚本。

## 语言边界

- `src/frontend`：TypeScript / Node.js（包管理：npm）
- `src/backend`：TypeScript / Node.js（包管理：npm）
- 跨子项目通信只走 contracts/ 定义的接口，不许私下约定；如某子项目技术栈与上表不同，请在此处补充并同步更新其 AGENTS.md。

## 开发与验证要求

- 测试命令：`npm run test`（Node ≥ 22.18，直接运行 `tests/**/*.test.ts`）
- Lint：`npx eslint .`
- 类型检查：`npx tsc --noEmit`
- 构建：`npm run build`（tsc → `dist/`）
- 运行：`npm start`；打包（Windows）：`npm run dist`
- 以上命令已确认（ADR 0004），无「待确认」项。
- 本地一键检查优先使用 `scripts/verify.sh`。

## 变更纪律（平衡）

- 变更保持最小化、聚焦；避免无关重构。
- 完成前至少运行相关单元测试。
- 触及安全敏感代码时，同步执行安全检查清单。

## 测试要求

- 新行为必须有测试：逻辑用单元测试，边界用集成测试。
- 测试必须确定：单元测试不依赖网络与真实时间。
- 覆盖范围变化时，同步更新 `docs/testing/test-matrix.md`。

## 安全基线

> 桌面应用特有的安全原则见宪法 九–十四（写入/命令审批、密钥不进渲染进程、项目根沙箱、渲染进程最小权限），与下列通用基线冲突时以宪法为准；SQL、cookie、限流等 Web 条目对本项目不适用（ADR 0004）。

### 注入
- SQL 一律参数化查询，禁止字符串拼接；系统命令禁止拼接用户输入。
### 认证与会话
- 密码哈希存储，不许明文、不许打日志；登录失败返回统一错误。
- token 只存 httpOnly + Secure cookie，不许 localStorage；密钥放环境变量。
### 越权
- 按 ID 访问资源的接口必须校验当前用户权限；管理接口单独鉴权。
### 敏感信息
- 错误信息与日志不许泄露堆栈、SQL、密码、token；`.env` 不许提交。
### 输入与输出
- 外部输入先校验类型、长度、范围再使用；输出到 HTML 一律转义。
- 文件上传校验 MIME + 大小上限，存随机文件名。
### 网络与请求
- 服务端请求用户提供的 URL 时做 SSRF 防护；登录、注册、短信类接口必须限流。
### 依赖
- 依赖变更必须经过安全审查（`/security-audit`）。

## 多 Agent 并行规则

- 完整流程：`docs/development/multi-agent.md`；角色：`docs/agents/coordinator.md`、`docs/agents/worker.md`。
- 泳道：`contracts`、`frontend`、`backend`、`docs`、`infra`（`.agents/lanes.conf`）。一张任务卡 = 一个泳道 = 一个分支 `feat/<泳道>/<任务>` = 一个指向 `hark-dev` 的 PR。
- Spec Kit：宪法 `.specify/memory/constitution.md`，规格在 `specs/<NNN-功能>/`（spec / plan / tasks）；命令用 `$speckit-specify` 等 `speckit` 技能。
- 契约先行：写代码前先读宪法、spec.md 与 `contracts/`；worker 分支不得修改 `specs/`、`contracts/`。
- 不得修改泳道外文件或共享热点文件；CI 中由 `scripts/check-lane.sh` 强制检查。
- 最多 4 个 agent 并行，每个泳道一个。同一错误出现两次就停下并报告。

## 规则与文档导航

- 架构：`docs/architecture/overview.md`，决策记录在 `docs/architecture/decisions/`
- 编码规范与 Git 工作流：`docs/development/`
- 测试策略与测试矩阵：`docs/testing/`
- 威胁模型与检查清单：`docs/security/`
- Skills：`skills/`（Agent Skills 标准目录；AGENTS.md 中提及 skill 只是提示，加载靠目录扫描 + 描述匹配，无需在此声明）

## 完成标准

- 代码符合 `docs/development/coding-standards.md`。
- 新增/更新了测试且全部通过；验证脚本为绿。
- 影响用户或架构的变更已同步文档。
- 无密钥、无破坏性默认行为、无未经验证的结论。
