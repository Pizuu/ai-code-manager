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

### 对比结论（2026-10-20，Chromium headless shell 156，视口 1680×1200，时区 Asia/Shanghai）

| 板块 | 外框边线位置（x / y，原型 → 应用） | 像素差异（灰度差 > 40 的像素占比） | 结论 |
|---|---|---|---|
| 泳道看板 | 51、271、296 / 79 → 完全相同 | 2.7 % | 结构、配色、字号、圆角一致；差异来自真实数据（19 张卡、功能 002、矩阵行高随卡片数变化）。 |
| 任务会话 | 51、271、503、1367 / 79、199 → 完全相同 | 5.1 % | 三列宽度一致；中列内容由「任务卡提交活动」换成真实对话（用户气泡取自 Figma、工具卡片沿用 .verify），右列在任务上下文下追加会话上下文。 |
| Git 分支与集成 | 51、271、296、1271 / 79、165 → 完全相同 | 4.9 % | 主栏 + 364px 右栏、分支图、PR 行、worktree 卡片一致；分支图行由「仍存在的分支」改为「合并提交还原的已删除分支」（任务分支合入后已删除）。 |

截图：`smoke-002-{board,session,git,settings}.png`、`smoke-002-*-dark.png`、并排对比 `smoke-002-compare-{board,session,git}.png`（均在仓库外 `/workspace/work/codepilot/`）。

已知偏差（均有意为之）：图标栏增加「设置」齿轮（原型无设置入口）；项目选择器第二行显示项目根路径（IPC 未提供 package.json 描述）；「导出快照 JSON」改为「复制快照 JSON」（沙箱渲染进程不做下载）；状态栏内容改为真实的分支 / worktree / 未提交文件数；原型页面级 `min-width:1280px` 沿用。

### 真实 opencode 冒烟（2026-10-20）

沙箱 linux-arm64 安装 `opencode-ai@1.19.3`，用本地假 OpenAI 兼容服务器（`OPENCODE_CONFIG_CONTENT` 自定义 provider，非敏感 env）经应用主进程 handlers 运行：

- auto-edits：首轮提示词以 `-` 开头、项目路径含空格与中文 → 文本 + `write` 工具（文件实际写入）+ 续接第二轮同一 sessionID；无错误，敏感 env 未出现在事件中。
- plan：`--agent plan` + 编辑/命令 deny → 模型的写入请求被 opencode 判为无效工具，文件未写入。
- 无 Key 时 opencode 免费模型返回 403（服务端拒绝本沙箱 IP），以 `type:"error"` 事件呈现 → 应用显示中文错误（`opencode-error.sample.jsonl`）。

未验证：Windows 真机（`opencode.exe` 解析、PowerShell、`taskkill`）与真实付费模型（沙箱无 Key）。
