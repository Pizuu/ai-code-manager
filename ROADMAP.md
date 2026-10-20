# 路线图

> 持续维护的文档。完成一项勾选一项，保持诚实。

### 阶段 0：脚手架

- [x] 确认技术栈构建 / 测试命令（Electron + TypeScript，ADR 0001 / 0003 / 0004）
- [x] 补全项目简介与目标用户（specs/001-agent-desktop/spec.md）

### 阶段 1：最小可用（v0.1.0）

- [x] 核心流程跑通并有测试覆盖（115 个单元/集成测试）
- [ ] CI 流水线变绿（本地 `scripts/verify.sh` 全绿；尚无远端仓库运行 GitHub Actions）
- [ ] Electron E2E（T040 / 卡片 T-011）
- [ ] Windows 安装包与便携版实机验证（T041 / 卡片 T-012）

### 阶段 1.5：三板块工作台与 Agent CLI（v0.2.0，功能 002）

- [x] 泳道看板 / 任务会话 / Git 分支与集成三板块，视觉 1:1 沿用 HTML 原型（ADR 0005）
- [x] 外部 Agent CLI 配置与 opencode 集成（run --format json、续接、停止、权限映射，ADR 0006）
- [x] 160 个单元/集成测试全绿（含假 opencode 全路径）；真实 opencode 1.19.3 沙箱冒烟
- [ ] 三板块 Electron E2E（T123 / 卡片 T-020）
- [ ] Windows 实机验证 opencode（T124 / 卡片 T-021）
- [ ] opencode 逐条工具审批评估（T125 / 卡片 T-022）

### 阶段 2：加固

- [x] 完成威胁模型评审（docs/security/threat-model.md，2026-10-20）
- [x] 补齐架构决策记录（ADR 0001–0006）
- [ ] 安装包代码签名
- [ ] 上下文压缩（长会话自动摘要）、MCP 工具接入、多窗口
