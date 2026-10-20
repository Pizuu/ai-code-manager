# Security Checklist: 三板块工作台与 Agent CLI

**Purpose**: 对照宪法 九–十四 审查本功能的安全需求是否写清、可验证
**Created**: 2026-10-20
**Feature**: [spec.md](../spec.md)

- [x] SEC001 外部 CLI 启动只用参数数组、`shell: false`，提示词以 `--` 分隔（FR-112，Edge Cases）
- [x] SEC002 CLI 工作目录固定为项目根，不可配置；未打开项目拒绝启动（FR-112，宪法 十一）
- [x] SEC003 敏感环境变量加密落盘、safeStorage 不可用时拒绝保存、不进入渲染进程/事件/日志（FR-115，SC-105）
- [x] SEC004 权限模式映射：仅规划禁止编辑与命令；auto-edits 禁止命令；ask 每轮先批准完整命令行（FR-116，ADR 0006）
- [x] SEC005 不使用 opencode `--auto`（自动批准一切）
- [x] SEC006 git 只读命令、`--no-optional-locks`、数组参数（FR-107）
- [x] SEC007 新 IPC 通道全部做参数校验并加入 preload 白名单（宪法 十二）
- [x] SEC008 看板/Git/CLI 输出中的文本一律 textContent 渲染；CLI 文本走先转义的 Markdown（宪法 十二）
- [x] SEC009 CLI stderr 报错截断（≤ 2000 字符）；不回显环境变量
- [x] SEC010 停止 = 结束进程树（Windows taskkill /T /F，POSIX 进程组）（FR-113）
- [x] SEC011 已接受风险写入 ADR 0006：CLI 在批准的一轮内可自行编辑/执行；CLI 自身的路径越界防护由其实现负责
