# ADR 0005：三板块 UI 以 HTML 原型 1:1 移植，数据改为 IPC 实时快照

- **状态**：已采纳（视觉 1:1 约束已被 ADR 0009 取代）
- **日期**：2026-10-20
- **决策人**：负责人（视觉基准）+ coordinator

## 背景

功能 002 要求复刻 Figma 设计稿（文件 `zoKZUtZnIFpZXA6vpmf9s4`，节点 `2004:30564`、`2004:31047`、`2004:31674`），三个标题对应三个板块。负责人随后指定：以已从真实节点与仓库快照生成的三份 HTML 原型（`/workspace/work/figma/out/{board,session,git}.html`）为 1:1 视觉基准。原型是字符串拼接 + 内联 `<script>` + 少量内联 `style=` 属性，而应用的 CSP 为 `script-src 'self'; style-src 'self'`，且渲染进程约定只用 `h()` / textContent 构建 DOM（宪法 十二）。

## 决策

1. 原型 `<style>` 的全部规则原样移入 `src/frontend/styles.css`（类名、变量、尺寸、字体栈不变）；原型中的内联 `style=` 改为等价工具类，必要的动态尺寸用 CSSOM（`el.style.x = …`，CSP 允许）。
2. 视图按原型同样的元素层级与类名用 `h()` 重建；SVG 图标复用原型 path，用 `createElementNS` 生成（`src/frontend/lib/icons.ts`）。
3. 原型中来自 `snapshot.json` 的数据改由主进程 `board:get` / `git:get`（`src/backend/workspace/`）实时提供；推导逻辑（状态、泳道检查、合并记录）从 `snapshot.py` 移植为 TypeScript 并加测试。
4. 任务会话板块沿用原型三列 DOM：左列列出应用会话（`.si` 样式），中列以原型 `.meta/.msg/.ev/.verify/.sysb` 样式渲染真实对话、工具卡片与审批，右列 `.ctxp` 为会话上下文；会话标题含任务号（如 `T-015`）时右列显示该任务卡的上下文（原型「任务上下文」）。原型缺少的用户消息气泡参照 Figma 节点补齐。
5. 浅色严格对齐原型；暗色只替换 CSS 变量（宪法 十四）。原型未加载外链字体，字体栈原样沿用，无需本地化字体文件。

## 考虑过的备选

1. iframe 嵌入原型 HTML——违反 CSP 与 IPC 白名单，数据无法实时、无法交互。
2. 重新从 Figma 节点解读并自行设计 CSS——负责人已指定原型为基准，重复劳动且易偏差。
3. 引入 UI 框架 / 模板引擎——违反 ADR 0001。

## 后果

- 好：视觉与原型一致、可截图对比；数据真实；安全约束不变。
- 坏：`styles.css` 体积增大，001 的旧三栏样式被替换；旧 `sidebar.ts`、`right-panel.ts` 移除，能力迁入新视图。
- 接受的风险：系统字体与原型渲染机器的字体可能不同（Windows 上为微软雅黑 / Segoe UI），截图对比以布局与配色一致为准。
