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

### 阶段 2：加固

- [x] 完成威胁模型评审（docs/security/threat-model.md，2026-10-20）
- [x] 补齐架构决策记录（ADR 0001–0004）
- [ ] 安装包代码签名
- [ ] 上下文压缩（长会话自动摘要）、MCP 工具接入、多窗口
