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
