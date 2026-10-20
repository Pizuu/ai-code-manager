# ADR 0009：界面重新设计，对齐 Claude MCP Apps 设计规范

- **状态**：已采纳（取代 ADR 0005 中「浅色严格 1:1 对齐原型」的视觉约束；类名、DOM 层级与 CSP 约定仍沿用 ADR 0005）
- **日期**：2026-10-20
- **决策人**：负责人 + coordinator

## 背景

负责人要求界面「层次分明、注重高效、简洁展示」，并指定 Anthropic 的 Figma UI kit「MCP Apps for Claude」及其设计规范（claude.com/docs/connectors/building/mcp-apps/design-guidelines）为改造依据。原型 1:1 移植的界面存在：页头 80px 两行、控件高度 36–44px 不统一、字号 10–17px 多达 8 级、强调色与暖色底块堆叠导致层次不清、看板「声明与 git 不一致」大段明细占满首屏。

## 决策

1. `src/frontend/styles.css` 新增第四部分覆盖层：引入规范的宿主 token（`--color-background-*`、`--color-text-*`、`--color-border-*`、`--color-ring-*`、字号 / 字重 / 圆角 / 阴影、`--border-width-regular: 0.5px`），旧变量映射到新 token；暗色只替换 token（宪法 十四）。
2. 层次：画布（background-tertiary：图标栏、项目栏）< 内容面（background-primary，圆角 12、发丝线、hairline 阴影）< 浮层（对话框、右键菜单，shadow-lg）。
3. 字体：三级字号 heading 16 / 14、body 14、caption 12，两种字重 400 / 600；控件统一 32px；页头 52px 单行（板块名 + 面包屑 + 快照 + 操作）。
4. 颜色：结构元素一律用 token；品牌橙只用于当前项、发送与品牌标记；主按钮用 background-inverse；状态用语义色。
5. 渐进披露：看板不一致项折叠为一行摘要（`<details>`），展开看明细。
6. 属于「简单 UI 修改」（ADR 0007）：不改 IPC、安全与数据逻辑，不新增测试；lint / typecheck / build 通过，并以 `npm run web` 截图对比验收。

## 考虑过的备选

1. 继续以原型为准只调间距——无法解决字号与色彩层级问题。
2. 引入 CSS 框架或组件库——违反 ADR 0001。
3. 删除第一至三部分重写——改动面大、回归风险高；覆盖层可逐步收敛。

## 后果

- 好：视觉与 Claude 生态一致；首屏信息密度更高；暗色对比度提升。
- 坏：样式表多一层覆盖，后续应逐步把第一至三部分的旧值并入 token。
- 接受的风险：Anthropic Sans 未随应用分发，回退到系统字体栈。
