# 安全检查清单

> 最近一次核对：2026-10-20（v0.1.0）。证据见各条括注。

- [x] 代码、配置与历史中无密钥、令牌与凭据（`scripts/security-check.sh` 的模式扫描命中均为类型名与测试假值）
- [x] 所有外部输入在信任边界处校验（IPC：`src/backend/ipc/validate.ts`；模型工具参数：`validateToolInput`；路径：`sandbox.ts`）
- [x] 依赖已审计（`scripts/security-check.sh` 为绿；moderate 级开发依赖告警已记入威胁模型「已接受风险」）
- [x] 每个特权操作都有鉴权检查（写入/命令经权限决策与用户审批；IPC 校验调用来源）
- [x] 错误信息不泄漏内部细节（不含 Key；模型服务错误回显截断并抹去 Key）

## 桌面应用补充项（宪法 九–十四）

- [x] `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`（`src/backend/main.ts`）
- [x] 严格 CSP，无内联脚本（`src/frontend/index.html`）
- [x] preload 只暴露契约白名单通道（`src/backend/preload.cts`，编译期穷举检查）
- [x] Key 仅以 safeStorage 密文落盘，不可用时拒绝保存
- [ ] 导航/新窗口拦截有自动化测试（T040）
- [x] 外部 Agent CLI 以参数数组启动、不经 shell，工作目录固定为项目根（`src/backend/agent-cli/cli-runner.ts`，功能 002）
- [x] CLI 敏感环境变量只以 safeStorage 密文落盘，不进入 IPC / 事件（`settings-store.ts`，测试 `handlers-v11.test.ts`）
- [x] CLI 权限按模式映射，「每次询问」每轮批准命令行，不使用 `--auto`（ADR 0006）
- [x] git 只读、`--no-optional-locks`（`src/backend/workspace/git.ts`）
- [x] 新 IPC 通道参数校验 + preload 白名单（`validate.ts`、`preload.cts`）
- [x] `fs:read` 只读、经项目根沙箱（含 realpath），大文件 / 二进制保护（`src/backend/fs/file-view.ts`，测试 `file-view.test.ts`，功能 003）
- [x] 代码查看与右键菜单用 `textContent` 渲染，不自动发送（`views/code-view.ts`、`views/context-menu.ts`）
- [x] Web 预览只监听 127.0.0.1、仅 GET / HEAD、Host 校验、只读通道白名单（`scripts/web-dev.ts`，`contracts/web-dev.ts`）
- [x] 内置 agent 配置默认空白，不预填第三方服务地址 / 模型（`settings-store.ts`）
