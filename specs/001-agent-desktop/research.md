# Research: 桌面 AI 编程 Agent（MVP）

Phase 0 输出。每项：决策 / 理由 / 考虑过的备选。

## R1 桌面框架

- **Decision**: Electron 44 + TypeScript，`tsc` 直接编译，无打包器、无 UI 框架。
- **Rationale**: 需求点名 Windows 桌面 + 便携版；Electron 的 `safeStorage`、`dialog`、`child_process` 直接满足 Key 加密、选目录、PowerShell；纯 DOM 足以实现三栏界面，避免 Vite/Webpack 配置复杂度（用户明确要求避免打包器）。
- **Alternatives considered**: Tauri（需要 Rust 工具链，Windows 打包需 WebView2/MSVC，超出「TypeScript 项目」范围）；React/Vue + Vite（增加依赖与构建环节，MVP 无必要）。

## R2 模块系统与测试运行

- **Decision**: 全项目 ESM（保持生成器的 `"type": "module"`）；`module: nodenext` + `rewriteRelativeImportExtensions`，源码 import 写 `.ts` 后缀；测试由 Node ≥ 22.18 原生类型擦除直接运行 `.test.ts`；preload 用 `.cts`（编译为 CommonJS）。
- **Rationale**: Electron ≥ 28 主进程支持 ESM；沙箱 preload 只能是 CommonJS；类型擦除让测试免预编译、也让 `tsc` 产物在浏览器中可直接用 `<script type="module">` 加载。
- **Alternatives considered**: 全 CommonJS（渲染进程仍需 ESM，两套 tsconfig）；ts-node/tsx 跑测试（多一个依赖）。

## R3 流式协议

- **Decision**: 两个提供方都用 `fetch` + `ReadableStream` 自行解析 SSE（`sse.ts`）。OpenAI 兼容：`POST {base}/chat/completions`，按 `tool_calls[].index` 拼接 `function.arguments`；Anthropic：`POST {base}/v1/messages`，`anthropic-version: 2023-06-01`，按 `content_block_*` 事件拼接 `input_json_delta`。
- **Rationale**: 零依赖、两协议共享 SSE 解析；可用本地 HTTP 服务器做集成测试。
- **Alternatives considered**: 官方 SDK（两套依赖、体积大、对兼容端点的 Base URL 行为不一致）。

## R4 Diff 算法

- **Decision**: 基于行的 LCS（动态规划，超大文件退化为整体替换）生成统一 diff，3 行上下文。
- **Rationale**: 结果确定、易测；源码文件规模下性能足够。
- **Alternatives considered**: 引入 `diff` 包（违反运行时零依赖目标）。

## R5 搜索

- **Decision**: Node 递归遍历 + 逐行匹配（字面量或正则），跳过忽略目录、二进制（含 NUL 字节）与 > 1 MB 文件，结果上限 500。
- **Rationale**: 不要求用户安装 ripgrep；行为可测。
- **Alternatives considered**: 调用 `rg`（Windows 上通常未安装）。

## R6 命令执行

- **Decision**: Windows：`powershell.exe -NoLogo -NoProfile -NonInteractive -Command <命令>`；其他：`bash -lc <命令>`；`cwd` = 项目根；超时用 `AbortSignal` + Windows 上 `taskkill /T /F` 结束进程树。
- **Rationale**: 命令原文作为单个参数传递，应用自身不拼接字符串；用户已逐条批准命令原文。
- **Alternatives considered**: `shell: true`（经 cmd.exe 二次解析，转义规则更难预测）。

## R7 Key 存储

- **Decision**: `safeStorage.encryptString`（Windows 上为 DPAPI），密文 base64 存 settings.json；不可用时拒绝保存。
- **Rationale**: 宪法 十；无需额外原生依赖（如 keytar）。
- **Alternatives considered**: keytar（原生模块，打包与 Electron 版本绑定麻烦，已停止维护）；明文 + 文件权限（不满足宪法）。

## R8 打包

- **Decision**: electron-builder，`win.target = [nsis, portable]`，`arch = x64`，配置放在 package.json 的 `build` 字段。
- **Rationale**: 需求点名 NSIS + 便携版；单文件配置。
- **Alternatives considered**: Electron Forge（Squirrel 安装器不符合「NSIS」要求）。
