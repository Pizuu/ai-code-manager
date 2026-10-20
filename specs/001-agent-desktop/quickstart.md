# Quickstart: 桌面 AI 编程 Agent（MVP）

## 前置

- Windows 10/11 x64（打包）或任意平台（开发运行）
- Node.js ≥ 22.18（测试使用 Node 原生 TypeScript 类型擦除）
- 一个 OpenAI 兼容或 Anthropic 的 API Key

## 运行

```powershell
npm install
npm start          # = npm run build && electron .
```

## 验证（与 scripts/verify.sh 相同顺序）

```bash
npx eslint .
npx tsc --noEmit
npm run test
npm run build
```

## 打包（在 Windows 上）

```powershell
npm run dist       # release/ 下生成 NSIS 安装包与便携版 exe（x64）
```

## 手工验收脚本（对应 spec 的用户故事）

1. US1：打开文件夹 → 设置里选提供方、填 Key → 问「这个项目是做什么的」→ 看到流式回答与 list_dir/read_file 卡片。
2. US2：权限模式「每次询问」→ 让它改 README 标题 → Diff 面板出现 → 拒绝（文件不变）→ 再来一次并批准（文件变化）；切到「仅规划」再试 → 被拒绝。
3. US3：让它运行 `node -v` → 批准 → 终端面板显示版本号。
4. US4：新建第二个会话 → 重启应用 → 两个会话都在；`/clear` 清空当前会话。
5. US5：打开含 `specs/*/tasks.md` 的项目 → Tasks 标签显示任务；`/model <名称>` 后设置里的模型改变；`/init` 提议写入 AGENTS.md。
