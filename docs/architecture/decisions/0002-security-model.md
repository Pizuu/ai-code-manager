# ADR 0002：安全模型——Key 只在主进程、渲染进程沙箱化、写入与命令必须审批

- **状态**：已采纳
- **日期**：2026-10-20
- **决策人**：coordinator + security-reviewer

## 背景

Agent 会把不可信的模型输出变成文件写入与 shell 命令；渲染进程显示模型输出，存在 XSS → 调用特权 IPC 的风险；API Key 价值高。

## 决策

1. Key 由 `safeStorage` 加密存于 `<userData>/settings.json`，只在发请求时于主进程解密；`PublicSettings` 只含 `hasApiKey`；`safeStorage` 不可用则拒绝保存。
2. 渲染进程 `contextIsolation + sandbox + nodeIntegration:false`，严格 CSP（`script-src 'self'`），preload 只暴露契约中的白名单通道；Markdown 渲染先整体 HTML 转义再格式化；拦截 `will-navigate` 与 `window.open`，外链只允许 http(s) 交给系统浏览器。
3. 工具执行器统一经过 `permissions.decide(mode, effect)`：write 在 ask 模式需审批、在 auto-edits 模式放行、在 plan 模式拒绝；execute 除 plan 模式拒绝外**永远**需审批。
4. 所有路径经 `sandbox.ts` 解析：词法上不得越出根（含跨盘符/UNC），且目标或其最近存在的祖先的 realpath 也必须在根内。

## 考虑过的备选

1. 渲染进程直接持有 Key 调模型——实现简单，但任何 XSS 都能窃取 Key。
2. 命令在 auto-edits 下也自动执行——效率高，但不可逆副作用风险过大（Clarify Q2 已否决）。
3. 只做词法路径检查——符号链接可绕过。

## 后果

- 好：Key 泄露面限于主进程；未经批准的副作用为 0（集成测试断言）。
- 坏：每条命令都要点批准，长任务交互多。
- 接受的风险：用户批准的命令本身可能有害（例如 `rm -rf`）——以展示命令原文 + shell 名称缓解，责任在批准者。
