# ADR 0003：全 ESM + Node 原生类型擦除运行测试；preload 用 `.cts`

- **状态**：已采纳
- **日期**：2026-10-20
- **决策人**：coordinator

## 背景

生成器给出 `"type": "module"` 与 `node --test tests/unit/ tests/integration/ tests/e2e/`。Electron 的沙箱 preload 只能是 CommonJS；渲染进程需要浏览器可直接加载的 ESM；测试规范要求测试镜像源码且确定、快速。Node 22 的 `--test` 不接受目录参数（会当作模块路径报 MODULE_NOT_FOUND）。

## 决策

- 保留 `"type": "module"`：主进程与渲染进程都编译为 ESM；preload 写成 `preload.cts` 编译为 `preload.cjs`。
- TypeScript：`module/moduleResolution: nodenext`、`erasableSyntaxOnly`、`verbatimModuleSyntax`、`allowImportingTsExtensions + rewriteRelativeImportExtensions`——源码 import 写 `.ts`，`tsc` 产物自动改写为 `.js`。
- 测试直接由 Node ≥ 22.18 的原生类型擦除运行：`node --test "tests/**/*.test.ts"`（用 glob 替代目录参数）。
- preload 不能 `require` 本地文件，通道白名单内联在 preload 中，并用 `satisfies readonly IpcInvokeChannel[]` 让 tsc 校验与契约一致。

## 考虑过的备选

1. 全 CommonJS——渲染进程仍需 ESM，要维护两套 tsconfig。
2. 先 `tsc` 编译测试再运行——多一步、产物污染 dist。
3. 引入 tsx / ts-node——多依赖，且与类型擦除重复。

## 后果

- 好：一个 tsconfig、零测试依赖；`npm run test` 无需构建。
- 坏：要求 Node ≥ 22.18（写入 `engines`，CI 改为 Node 22）；禁止 enum / namespace / 参数属性（`erasableSyntaxOnly` 强制）。
