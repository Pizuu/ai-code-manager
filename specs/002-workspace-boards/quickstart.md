# Quickstart / 验证指南：三板块工作台与 Agent CLI

## 1. 运行

```powershell
npm install
npm start            # 构建并启动 Electron
```

打开一个项目文件夹（例如本仓库），左侧导航依次点击「泳道看板」「任务会话」「Git 分支与集成」。

## 2. 配置 opencode

1. 安装（任选其一，见 <https://opencode.ai/docs/>）：`npm install -g opencode-ai`、`scoop install opencode`、`choco install opencode`。
2. 在终端执行一次 `opencode auth login` 配置模型提供方（或在应用的 Agent CLI 环境变量中填写提供方 Key，勾选「敏感」）。
3. 应用 › 设置 › Agent CLI › 「添加 opencode 预设」→「检查」应显示版本号；Windows 上若提示找不到，可填写 `opencode.exe` 完整路径（npm 全局安装位于 `%APPDATA%\npm\node_modules\opencode-ai\bin\opencode.exe`）。
4. 任务会话顶部的 agent 选择器切换为 opencode，发送消息。

## 3. 验证场景

| 场景 | 期望 | 自动化 |
|---|---|---|
| 首轮对话 | 文本与工具卡片逐条出现，会话保存 opencode 会话 ID | `tests/integration/backend/agent-cli/cli-runner.test.ts` |
| 续接 | 第二轮命令行含 `--session <ID>` | 同上 |
| 停止 | 进程树被结束，界面恢复可发送 | 同上 |
| 不可用 | 中文错误 + 安装指引 | 同上 |
| 「每次询问」 | 先出现命令行批准卡片；拒绝不启动进程 | 同上 |
| 敏感变量 | 设置页只显示「已保存」，IPC 返回无值 | `tests/integration/backend/ipc/handlers-v11.test.ts` |
| 看板状态 | 已合入 / 阻塞 / 声明冲突与 git 一致 | `tests/integration/backend/workspace/board.test.ts` |
| Git 快照 | ahead/behind、已删除分支的合并记录、worktree | `tests/integration/backend/workspace/git-overview.test.ts` |

## 4. 视觉对比（SC-101）

仓库外脚本用无头 Chromium 加载 `src/frontend/index.html`，以模拟 `window.api`（数据来自本仓库真实 `board:get` / `git:get` 结果与示例会话）在 1680×1200 视口截图，与三份 HTML 原型截图并排对比。截图存放在仓库外 `/workspace/work/codepilot/smoke-002-*.png`。结论见下节（收尾时填写）。

### 对比结论

（收尾时填写）
