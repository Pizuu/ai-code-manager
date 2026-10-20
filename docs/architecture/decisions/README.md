# 架构决策记录

编号化的 ADR 放在这里。复制 `0000-template.md` 为 `NNNN-短标题.md`。

| ADR | 标题 | 状态 |
|---|---|---|
| [0001](0001-electron-typescript-no-bundler.md) | Electron + TypeScript + tsc，不用打包器与 UI 框架 | 已采纳 |
| [0002](0002-security-model.md) | 安全模型：Key 只在主进程、渲染进程沙箱化、写入与命令必须审批 | 已采纳 |
| [0003](0003-esm-type-stripping.md) | 全 ESM + Node 原生类型擦除运行测试；preload 用 .cts | 已采纳 |
| [0004](0004-generator-conventions-vs-electron.md) | 生成器默认约定与 Electron 应用的冲突及处理 | 已采纳 |
