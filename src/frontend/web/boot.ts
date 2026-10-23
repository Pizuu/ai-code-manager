/**
 * Web 预览入口（FR-305，ADR 0008）：先装 window.api 适配器与源位置钩子，再加载与桌面版相同的渲染层入口 main.ts。
 * 由 scripts/web-dev.ts 注入到 index.html；Electron 不引用本目录，打包时排除 dist/src/frontend/web/**。
 */
import './mock-api.ts';
import { installSourceHook, mountLocator } from './locator.ts';

installSourceHook();
const css = document.createElement('link');
css.rel = 'stylesheet';
css.href = new URL('./locator.css', import.meta.url).href;
document.head.append(css);
document.title = 'AI Code Manager · Web 预览';
await import('../main.ts');
mountLocator();
