# Quickstart / 验证记录：003-code-view-web-locator

## 使用

| 功能 | 操作 |
|---|---|
| 只读代码查看 | 左侧项目结构单击文件 → 任务会话中列出现文件标签（「对话」+ 文件，可关闭，最多 8 个）；「刷新」重新读取；「发送到任务会话」插入 `@路径` |
| 右键发送 | 任意位置右键：选中文本 / 代码选区（`路径:L起-L止` + 代码块）/ 代码某行（`路径:L行`）/ 文件树节点（`@路径`）/ 看板卡（`任务 T-xxx「标题」（泳道 · 状态）`）/ Git 分支图节点与合入记录（`提交 <完整 SHA>「说明」`）/ 分支行（`分支 名 @ 短 SHA「说明」`）→「发送到任务会话」；输入框、下拉框内保留默认菜单 |
| Web 预览 | `npm run web`（可加 `-- --port 5180 --project <目录>`）→ 浏览器打开 `http://127.0.0.1:5173/` |
| UI 定位 | Web 预览右下角「UI 定位」→ 悬停高亮（显示 `文件:行`）→ 点击弹出面板（源文件:行、选择器、祖先链）→「复制「文件:行 + 选择器」」；Esc 退出 |
| 配置空白 | 全新安装：设置中 Base URL / 模型为空（灰字示例）；未填时会话显示并在发送时提示「请先在设置中配置 agent」 |

## 验证（2026-10-20，沙箱 linux-arm64，Node 22.23，Chromium headless shell 1248）

- `scripts/verify.sh`：lint + typecheck + 186 个测试 + build 全绿（新增 26 个：`fs:read` 越界 / 绝对路径 / 符号链接 / 目录 / 二进制 / 截断 / 超大、handlers `fs:read` 接线、默认空白与切换不回填、`E_NOT_CONFIGURED` / `E_NO_API_KEY` 文案、opencode 预设为空、右键内容组装 7 例、高亮 4 例、配置提示 2 例、UI 定位纯函数 3 例）。
- Web 预览服务器手动 curl：`/` → 302；`index.html` 入口替换为 `./web/boot.ts`；POST → 405；`/__api/agent:send` → 404；`fs:read ../../etc/passwd` → 403 `E_PATH_ESCAPE`；`fs:read package.json` → 200；`/package.json`（不在白名单前缀）→ 404；`/src/frontend/%2e%2e/%2e%2e/package.json` → 404；`Host: evil.com` → 403。
- 打包排除：以 electron-builder 依赖的 minimatch 按 `build.files` 顺序模拟，`dist/` 下 140 个文件被纳入，其中无 `web/` 与 `scripts/`（Windows 实测见 T214）。
- 无头 Chromium 冒烟（仓库外脚本 `/workspace/work/codepilot/smoke/shot-003.py`，对真实 `npm run web` 服务器）：
  - 打开 `contracts/ipc.ts` → 539 行、TypeScript 高亮；选中第 10–14 行右键 → 菜单「发送到任务会话 · contracts/ipc.ts:L10-L14」「复制」；点击后输入框为 `` `contracts/ipc.ts:L10-L14` `` + ```` ```ts ```` 代码块，未发送。截图 `/workspace/work/codepilot/smoke-003-context-menu.png`。
  - 看板中开启 UI 定位点击任务卡编号 → `src/frontend/views/board-view.ts:29`（即创建 `span.id` 的源码行）、选择器 `div.matrix > … > span.id:nth-of-type(1)`，复制到剪贴板内容一致；点击被拦截（未跳转会话）。截图 `/workspace/work/codepilot/smoke-003-ui-locator.png`。
  - 看板卡、Git 分支行右键分别得到 `任务 T-001「…」`、`分支 feat/docs/T-018-docs-002 @ f0b1508「…」`；控制台无错误。

## 未验证

- Electron 实机中的右键菜单与代码查看（与 Web 预览同一份渲染层源码；Electron E2E 由 T040 / T-020 跟踪）。
- Windows 打包产物（T214）。
