# ADR 0004：生成器默认约定与 Electron 应用的冲突及处理

- **状态**：已采纳
- **日期**：2026-10-20
- **决策人**：coordinator（负责人默认批准）

## 背景

脚手架由 ai_project_generator_speckit 生成（stack=node、layout=layered、specKit=on、agents=codex+claude）。其中若干默认值面向 Web 服务，与 Electron 桌面应用不完全匹配。按宪法 七，由 coordinator 在契约范围内裁决并记录。

## 决策

| 冲突 | 处理 |
|---|---|
| `npm run test` = `node --test tests/unit/ …` 在 Node 22 上直接失败（目录不被当作测试目录） | 改为 glob：`node --test "tests/**/*.test.ts"`（见 ADR 0003） |
| CI 使用 Node 20，不支持类型擦除 | `ci.yml` 改为 Node 22，并补 `npm run build` 步骤（infra 泳道） |
| `build` = `tsc -p .` 不会启动 Electron，也没有打包脚本 | 增加 `start`（build + electron .）与 `dist`（electron-builder `--win nsis portable --x64`）；electron-builder 配置放 package.json `build` 字段，避免新增未分配泳道的根文件 |
| ESLint 配置文件 `eslint.config.mjs` 不属于任何泳道，check-lane 会判越界 | 在 lanes.conf 的 `@shared` 中登记，由 coordinator 维护 |
| 共享热点文件 / 未分配泳道文件（`ROADMAP.md`、`docs/tasks/`）的任务无法满足「每个任务必须带泳道」 | tasks.md 引入 `[lane:@shared]`，由 coordinator 在 `int/*` 分支执行（int 分支不触发 lane-guard） |
| AGENTS.md 安全基线面向 Web（SQL、cookie、SSRF、限流） | 保留原文；桌面特有基线写入宪法 九–十四，以宪法为准；SQL/cookie 条目不适用（无数据库与 Web 会话） |
| 「token 只存 httpOnly cookie；密钥放环境变量」 | 桌面应用无 cookie；API Key 由用户在 UI 输入，以 safeStorage 加密（ADR 0002），环境变量方案不适合终端用户 |
| `specify init --integration codex` 在无 codex CLI 的环境中报错 | 运行时追加 `--ignore-agent-tools`（未修改 `scripts/speckit-init.sh`） |
| `scripts/security-check.sh` 的 `npm audit` 对任意级别漏洞返回非零 | 保持脚本不变；依赖选择以 `npm audit` 通过为准（见 CHANGELOG / 验证记录） |
| 测试矩阵要求 E2E 覆盖核心路径 | Electron GUI E2E 在无图形环境中不可运行，记 ❌ 并由 converge 追加任务跟踪 |
| 宪法 六「做完 = 推送 + PR」 | 无 Git 远端；本地按 `feat/<泳道>/…` 与 `int/…` 分支开发、`--no-ff` 合入 `dev`，lane 检查对每个 worker 分支实际运行 |

## 考虑过的备选

1. 改生成器模板本身——超出本项目范围；在项目内以 ADR 覆盖更可追溯。
2. 把配置文件塞进某个 worker 泳道——违反「共享文件只能由 coordinator 修改」。

## 后果

- 好：所有偏离生成器默认值之处都有记录，lane-guard 与 verify 仍可原样运行。
- 坏：项目内的约定比生成器默认多一层例外，新成员需读本 ADR。
