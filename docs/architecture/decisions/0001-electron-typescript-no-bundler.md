# ADR 0001：Electron + TypeScript + tsc，不用打包器与 UI 框架

- **状态**：已采纳
- **日期**：2026-10-20
- **决策人**：coordinator（负责人默认批准）

## 背景

需要一个 Windows 桌面应用（安装包 + 便携版），能安全地读写本地文件、执行 PowerShell、加密保存密钥；团队栈为 TypeScript/Node；需求明确要求避免打包器复杂度。

## 决策

使用 Electron 44：主进程（`src/backend`）承载 Agent 核心，渲染进程（`src/frontend`）为纯 DOM + CSS；全部 TypeScript 由 `tsc` 直接编译为 ESM，渲染进程用 `<script type="module">` 加载编译产物；运行时不引入任何第三方依赖；用 electron-builder 产出 NSIS 与 portable（x64）。

## 考虑过的备选

1. Tauri——需要 Rust 工具链与 WebView2，偏离 TS 单栈，且主进程逻辑要用 Rust 重写。
2. Electron + React + Vite——UI 开发更快，但多一套构建与依赖；三栏界面规模下收益不足以抵消复杂度。
3. VS Code 扩展——依赖 VS Code，不是独立桌面应用。

## 后果

- 好：构建链只有 tsc；产物可逐文件调试；依赖面极小（安全审计简单）。
- 坏：UI 组件需手写（列表、标签页、对话框）；没有 HMR，改前端需重新 `npm run build`。
- 接受的代价：安装包体积约 100 MB 级（Electron 固有）。
