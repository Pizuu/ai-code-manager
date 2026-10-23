# ADR 0008：只读代码查看、全局「发送到任务会话」与 Web 预览 UI 定位

- **状态**：已采纳
- **日期**：2026-10-20
- **决策人**：coordinator（宪法 七裁决）

## 背景

功能 003 需要：文件树单击在应用内只读查看代码；应用任意位置右键把内容发送到任务会话输入框；一个浏览器里运行同一套渲染层的 Web 版，带「UI 定位」模式，方便把要改的界面位置告诉 AI。约束：宪法 十一（项目根沙箱）、十二（渲染进程最小权限、严格 CSP）、ADR 0001（不用打包器与 UI 框架）。

## 决策

1. **代码查看**：新增只读 IPC `fs:read`（契约 v1.2），主进程用 `resolveSafe` 解析路径（含 realpath），只读普通文件；> 2 MB 返回 `too-large`、512 KB–2 MB 截断到最后完整行、前 8000 字节含 NUL 视为 `binary`，均不返回内容。渲染层在任务会话中列以**标签页**显示（「对话」+ 已打开文件），行号 + 轻量正则分词高亮（`textContent` 构建 span，不用 innerHTML），超过 5000 行不高亮。
2. **右键菜单**：渲染层自定义菜单（不用 Electron 原生 `Menu`）——Web 预览可原样复用、无需新增 IPC。可发送元素用 `contracts/ui.ts` 的 `data-send-*` 属性声明；全局 `contextmenu` 处理器组装 `SendSource`，纯函数格式化为带来源标注的文本（`path:L10-L20`、任务 ID、提交 SHA），插入任务会话输入框并切到任务会话，**不自动发送**。
3. **Web 预览**：`npm run web` 启动 `scripts/web-dev.ts`（仅 127.0.0.1、仅 GET/HEAD）。服务器用 Node `module.stripTypeScriptTypes` 把 `src/frontend/**/*.ts` 与 `contracts/*.ts` 原地擦除类型后发给浏览器——**行列号与源文件完全一致**，无需打包器或 source map；`index.html` 原样提供，只把入口脚本换成 `src/frontend/web/boot.ts`。`window.api` 由 `src/frontend/web/mock-api.ts` 提供：`contracts/web-dev.ts` 白名单内的只读通道（`fs:tree`、`fs:read`、`board:get`、`git:get` 等）经服务器调用主进程同一批只读函数（git 带 `--no-optional-locks`），其余通道（发送、设置、会话）在浏览器内存中模拟，绝不写盘、不执行命令。
4. **UI 定位**：Web 预览启动时包装 `document.createElement`，从调用栈取第一个 `src/frontend/`（排除 `lib/dom.ts` 与 `web/`）帧，写入元素的 `data-src="src/frontend/views/x.ts:行"`。开关后悬停高亮、点击（捕获阶段拦截）显示源文件:行、CSS 选择器与祖先链，一键复制「文件:行 + 选择器」。
5. **不进打包**：`src/frontend/web/` 编译产物由 `package.json` `build.files` 的 `!dist/src/frontend/web/**/*` 排除；Electron 入口不引用它。

## 考虑过的备选

1. Electron 原生 `Menu.popup` + 新 IPC `contextMenu:show`——需要把选区 / 来源跨进程传递，Web 预览无法复用。
2. Web 预览直接用 `tsc` 产物 + source map 反查行号——要在浏览器解析 source map，复杂；类型擦除保持行号更简单准确。
3. Monaco / CodeMirror / highlight.js——依赖体积与审查成本高（ADR 0001），且只需只读查看。
4. 让 Web 预览复用 `createHandlers`——会带上设置 / 会话写盘与 agent 执行，违背「Web 版不得写盘」。

## 后果

- 好：Web 预览与 Electron 渲染层是同一份源码；UI 定位给出精确到行的源位置；新增 IPC 只有一个只读通道。
- 坏：`stripTypeScriptTypes` 在 Node 22 仍为实验特性（启动时有 ExperimentalWarning）；Web 预览的会话 / 设置为内存模拟，刷新即丢。
- 接受的风险：Web 预览服务器能读取项目内文件（与 `fs:read` 同一沙箱），仅监听本机回环地址、仅开发使用。

## 修订注记（2026-10-20，负责人决定）

负责人决定：Web 预览除 Agent CLI 外改用真实数据，本 ADR 第 3 条与备选 4 的结论相应修订（契约 `contracts/web-dev.ts` 升 v2）：

- `scripts/web-dev.ts` 在进程内实例化与桌面端相同的 `createHandlers` + `SettingsStore` + `SessionStore` + `AppState`：全部 invoke 通道经 `POST /__api/<通道>` 走真实逻辑、真实落盘；`agent:event` 经 `GET /__events`（SSE）推送。数据目录与桌面端 `userData` 等价，可用环境变量 `AICM_DATA_DIR` 覆盖。静态文件仍仅 GET / HEAD；服务器仍只监听 127.0.0.1 并校验 Host，写 / 事件端点另校验 Origin。
- 例外仅 Agent CLI：`agentCli:check` 恒返回模拟结果；`agent:send` 到外部 CLI 会话在分发层被拒绝（E_CLI + error 事件），绝不启动真实 CLI 进程；`agentCli:save` / `delete` 随 settings 真实落盘。
- 默认无项目（不回退到应用根）；`project:pick` 恒返回 null（项目只能由 `--project` 在启动时手动指定），`project:openRoot` 为 no-op。
- Web 预览无 Electron safeStorage：API Key 与 CLI 敏感 env 不能在 Web 侧保存或解密使用（真实存储以 E_ENCRYPTION 拒绝），其余设置与会话数据真实落盘、与桌面端互通。
- 原「Web 版不得写盘」的约束自此解除；Web 预览仍仅供开发、不进打包（第 5 条不变）。
