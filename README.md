# ai-code-manager

类 Claude Code 的 Windows 桌面 AI 编程助手（Electron + TypeScript）

## 快速开始

```bash
npm install
npm run test
```

## 项目结构

```text
ai-code-manager/
├── src/frontend/
├── src/backend/
├── tests/
├── docs/
├── skills/
└── scripts/
```

## Spec Kit 工作流

```bash
scripts/speckit-init.sh   # uv tool install specify-cli && specify init --here --force --integration codex
```

然后在 agent 中依次运行：`$speckit-constitution` → `$speckit-specify` → `$speckit-clarify` → `$speckit-plan` → `$speckit-checklist` → `$speckit-tasks` → `$speckit-analyze` → `$speckit-implement` → `$speckit-converge`

多 agent 并行：见 `docs/development/multi-agent.md`（在 Spec Kit 之上加泳道 + worktree）。

## 文档导航

- AI 协作规则：`AGENTS.md`
- 架构：`docs/architecture/overview.md`
- 开发：`docs/development/`
- 测试：`docs/testing/`
- 安全：`docs/security/`
