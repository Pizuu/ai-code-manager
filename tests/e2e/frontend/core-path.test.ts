/**
 * Electron E2E 核心路径（T040；SC-001、SC-006、US2/AC1、宪法 十二）。
 *
 * 用 Playwright `_electron` 启动真实应用（dist/ 由本测试先用 tsc 构建），内置 agent 指向本测试启动的
 * 本地假 OpenAI 兼容 SSE 服务（脚本化返回 edit_file / run_command 工具调用，不访问任何真实模型），
 * 覆盖：选目录 → 提问 → 批准 / 拒绝 edit_file → 批准 run_command → 重启后会话恢复；
 * 并断言页面导航（will-navigate）与新窗口（window.open）被拦截。
 *
 * 隔离：userData 指向临时目录（--user-data-dir + XDG_CONFIG_HOME / APPDATA），并在启动后核对；
 * 目录选择框在主进程内替换 dialog.showOpenDialog；shell.openExternal 被替换为记录调用，不会真的打开浏览器。
 *
 * 跳过条件（不得假装通过）：未安装 playwright-core / playwright、Electron 二进制缺失或无法启动、
 * Linux 下无图形环境（无 DISPLAY / WAYLAND_DISPLAY，请用 xvfb-run）。设 AICM_E2E=0 可显式跳过。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import type * as ElectronModule from 'electron';

const APP_ROOT = path.resolve(import.meta.dirname, '../../..');
const ENTRY_URL = 'app://bundle/src/frontend/index.html';
const FAKE_KEY = 'sk-e2e-fake-key';
const COMMAND_MARKER = 'e2e-command-ok';

// ───────────── Playwright 最小类型（不静态 import，避免未安装时 tsc 失败） ─────────────

interface PwLocator {
  click(opts?: { timeout?: number }): Promise<void>;
  fill(value: string, opts?: { timeout?: number }): Promise<void>;
  press(key: string, opts?: { timeout?: number }): Promise<void>;
  textContent(opts?: { timeout?: number }): Promise<string | null>;
  waitFor(opts?: { state?: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number }): Promise<void>;
  count(): Promise<number>;
  first(): PwLocator;
  locator(selector: string): PwLocator;
  filter(opts: { hasText: string | RegExp }): PwLocator;
  evaluate<R, A>(fn: (el: Element, arg: A) => R | Promise<R>, arg: A): Promise<R>;
}
interface PwPage {
  locator(selector: string): PwLocator;
  url(): string;
  evaluate<R, A>(fn: (arg: A) => R | Promise<R>, arg: A): Promise<R>;
  waitForFunction<A>(fn: (arg: A) => unknown, arg: A, opts?: { timeout?: number }): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  on(event: 'console', fn: (msg: { type(): string; text(): string }) => void): void;
}
type ElectronMain = typeof ElectronModule;
interface PwElectronApp {
  firstWindow(opts?: { timeout?: number }): Promise<PwPage>;
  windows(): PwPage[];
  evaluate<R, A>(fn: (electron: ElectronMain, arg: A) => R | Promise<R>, arg: A): Promise<R>;
  close(): Promise<void>;
}
interface PwElectron {
  launch(opts: { executablePath?: string; args: string[]; cwd?: string; env?: Record<string, string>; timeout?: number }): Promise<PwElectronApp>;
}

// ───────────── 环境探测 ─────────────

async function loadPlaywright(): Promise<PwElectron | string> {
  for (const name of ['playwright-core', 'playwright']) {
    try {
      const mod = (await import(name)) as { _electron?: PwElectron; default?: { _electron?: PwElectron } };
      const electron = mod._electron ?? mod.default?._electron;
      if (electron) return electron;
    } catch {
      // 尝试下一个包名
    }
  }
  return '未安装 playwright-core / playwright（需 coordinator 加入 devDependency），跳过 Electron E2E';
}

function electronBinary(): string {
  try {
    const p = createRequire(import.meta.url)('electron') as unknown;
    if (typeof p !== 'string' || !fs.existsSync(p)) return '';
    return p;
  } catch {
    return '';
  }
}

/** 返回跳过原因；可运行时返回 null。 */
function environmentProblem(bin: string): string | null {
  if (process.env.AICM_E2E === '0') return 'AICM_E2E=0，显式跳过 Electron E2E';
  if (!bin) return 'Electron 二进制不存在（node_modules/electron 未下载 dist，可运行 node node_modules/electron/install.js）';
  if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    return '无图形环境（未设置 DISPLAY / WAYLAND_DISPLAY）；请用 xvfb-run -a npm run test 运行';
  }
  const probe = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 30_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
  if (probe.status !== 0) {
    const reason = (probe.stderr || probe.error?.message || `退出码 ${String(probe.status)}`).trim().split('\n').slice(-2).join(' ');
    return `Electron 无法启动（缺少系统库？）：${reason}`;
  }
  return null;
}

// ───────────── 假 OpenAI 兼容 SSE 服务 ─────────────

interface OpenAIReqMessage { role: string; content: string | null; tool_call_id?: string }
interface FakeServer {
  baseUrl: string;
  requests: Array<{ auth: string | undefined; model: string; messages: OpenAIReqMessage[] }>;
  /** 最后一轮流式回复：第一段已发出的时间（ms）。 */
  firstChunkSentAt: Promise<number>;
  /** 放行最后一轮剩余的流式文本。 */
  releaseFinal(): void;
  close(): Promise<void>;
}

const FINAL_PART1 = '已按批准结果处理完毕：';
const FINAL_PART2 = '第一处修改已写入，第二处已被拒绝，命令已执行。全部完成';

function sseChunk(delta: Record<string, unknown>, finish: string | null = null): string {
  return `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
}

function toolCallChunks(id: string, name: string, args: Record<string, unknown>): string[] {
  const json = JSON.stringify(args);
  const mid = Math.floor(json.length / 2);
  return [
    sseChunk({ role: 'assistant', content: `调用 ${name}。` }),
    sseChunk({ tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: '' } }] }),
    sseChunk({ tool_calls: [{ index: 0, function: { arguments: json.slice(0, mid) } }] }),
    sseChunk({ tool_calls: [{ index: 0, function: { arguments: json.slice(mid) } }] }),
    sseChunk({}, 'tool_calls'),
    'data: [DONE]\n\n',
  ];
}

async function startFakeServer(): Promise<FakeServer> {
  const requests: FakeServer['requests'] = [];
  let release: () => void = () => undefined;
  const released = new Promise<void>((r) => { release = r; });
  let markFirst: (t: number) => void = () => undefined;
  const firstChunkSentAt = new Promise<number>((r) => { markFirst = r; });

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => { body += c.toString('utf8'); });
    req.on('end', () => {
      if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
        res.writeHead(404).end();
        return;
      }
      const parsed = JSON.parse(body) as { model: string; messages: OpenAIReqMessage[] };
      requests.push({ auth: req.headers.authorization, model: parsed.model, messages: parsed.messages });
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const last = parsed.messages.at(-1);
      const lastTool = last?.role === 'tool' ? last.tool_call_id : undefined;
      let chunks: string[];
      if (last?.role === 'user') {
        chunks = toolCallChunks('call_edit1', 'edit_file', { path: 'hello.txt', old_string: 'hello', new_string: 'HELLO' });
      } else if (lastTool === 'call_edit1') {
        chunks = toolCallChunks('call_edit2', 'edit_file', { path: 'hello.txt', old_string: 'world', new_string: 'WORLD' });
      } else if (lastTool === 'call_edit2') {
        chunks = toolCallChunks('call_cmd1', 'run_command', { command: `echo ${COMMAND_MARKER}` });
      } else if (lastTool === 'call_cmd1') {
        // SC-006：先发第一段并挂起，测试确认界面已渲染后再放行
        res.write(sseChunk({ role: 'assistant', content: FINAL_PART1 }));
        markFirst(performance.now());
        void released.then(() => {
          res.write(sseChunk({ content: FINAL_PART2 }));
          res.write(sseChunk({}, 'stop'));
          res.end('data: [DONE]\n\n');
        });
        return;
      } else {
        chunks = [sseChunk({ role: 'assistant', content: '（脚本外请求）' }), sseChunk({}, 'stop'), 'data: [DONE]\n\n'];
      }
      for (const c of chunks) res.write(c);
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    firstChunkSentAt,
    releaseFinal: () => release(),
    close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }),
  };
}

// ───────────── 启动应用 ─────────────

function launchArgs(userData: string): string[] {
  const args = [APP_ROOT, `--user-data-dir=${userData}`];
  if (process.platform === 'linux') {
    // CI 容器通常无 setuid chrome-sandbox / 密钥环；渲染进程仍是 webPreferences.sandbox（JS 层隔离不变）
    args.push('--no-sandbox', '--password-store=basic');
  }
  return args;
}

function launchEnv(userData: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  delete env.ELECTRON_RUN_AS_NODE;
  env.XDG_CONFIG_HOME = userData;
  if (process.platform === 'win32') env.APPDATA = userData;
  return env;
}

async function launch(pw: PwElectron, bin: string, userData: string, projectDir: string): Promise<{ app: PwElectronApp; page: PwPage }> {
  const app = await pw.launch({ executablePath: bin, args: launchArgs(userData), cwd: APP_ROOT, env: launchEnv(userData), timeout: 60_000 });
  const actualUserData = await app.evaluate(({ app: a }) => a.getPath('userData'), null);
  assert.ok(path.resolve(actualUserData).startsWith(path.resolve(userData)), `userData 未隔离：${actualUserData}`);
  // 替换系统对话框与外部打开，只在本测试进程的 Electron 主进程中生效
  await app.evaluate(({ dialog, shell }, dir) => {
    const g = globalThis as unknown as { __e2eOpened: string[] };
    g.__e2eOpened = [];
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir] })) as typeof dialog.showOpenDialog;
    shell.openExternal = async (url: string) => { g.__e2eOpened.push(url); };
  }, projectDir);
  if (process.platform === 'linux') {
    // 无密钥环的 Linux CI：允许 safeStorage 用内存密钥（仅本测试进程；Windows 走 DPAPI 不受影响）
    await app.evaluate(({ safeStorage }) => {
      if (!safeStorage.isEncryptionAvailable()) safeStorage.setUsePlainTextEncryption(true);
    }, null);
  }
  const page = await app.firstWindow({ timeout: 60_000 });
  page.on('console', (msg) => { if (msg.type() === 'error') console.error(`[renderer] ${msg.text()}`); });
  await page.locator('.explorer .psel').waitFor({ state: 'visible', timeout: 30_000 });
  return { app, page };
}

function toolCard(page: PwPage, callId: string): PwLocator {
  return page.locator(`.chat .verify.tool[data-call="${callId}"]`);
}

/**
 * 工具卡片收在可折叠的「思考」区里（v1.8 主流对话样式，默认折叠）。
 * 断言卡片内元素的「可见」之前先展开对应的思考区。
 */
async function openThinkOf(page: PwPage, callId: string): Promise<PwLocator> {
  const think = toolCard(page, callId).locator('xpath=ancestor::details[1]');
  if (!(await think.count())) return think;
  const opened = await think.evaluate((el) => (el as HTMLDetailsElement).open, null);
  if (!opened) await think.locator('.think-sum').click();
  return think;
}

async function showSession(page: PwPage): Promise<void> {
  await page.locator('.explorer .nav a').filter({ hasText: '任务会话' }).click();
  await page.locator('#wb-session .comp textarea').waitFor({ state: 'visible' });
}

// ───────────── 测试 ─────────────

const pwOrReason = await loadPlaywright();
const bin = electronBinary();
const skipReason = typeof pwOrReason === 'string' ? pwOrReason : environmentProblem(bin);

test('Electron 核心路径：选目录 → 提问 → 批准/拒绝编辑 → 批准命令 → 重启恢复；导航与新窗口被拦截', {
  skip: skipReason ?? false,
  timeout: 300_000,
}, async () => {
  const pw = pwOrReason as PwElectron;
  // 用当前源码构建 dist/（应用从 dist/src/backend/main.js 启动）
  execFileSync(process.execPath, [path.join(APP_ROOT, 'node_modules/typescript/bin/tsc'), '-p', APP_ROOT], { cwd: APP_ROOT, stdio: 'inherit' });

  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'aicm-e2e-'));
  const userData = path.join(tmp, 'userData');
  const projectDir = path.join(tmp, 'demo-project');
  await fsp.mkdir(userData, { recursive: true });
  await fsp.mkdir(projectDir, { recursive: true });
  const target = path.join(projectDir, 'hello.txt');
  await fsp.writeFile(target, 'hello world\n', 'utf8');
  const fake = await startFakeServer();
  let app: PwElectronApp | null = null;

  try {
    const launchedAt = performance.now();
    let page: PwPage;
    ({ app, page } = await launch(pw, bin, userData, projectDir));

    // ── 首次打开：未配置 → 经 rail 齿轮打开设置（启动自动弹已取消），填写 Base URL / 模型 / Key ──
    const dlg = page.locator('#settings-dialog');
    await page.locator('.rail a[title="设置"]').click();
    await dlg.locator('input[type="url"]').waitFor({ state: 'visible', timeout: 15_000 });
    await dlg.locator('input[type="url"]').fill(fake.baseUrl);
    await dlg.locator('input[type="text"]').fill('fake-model');
    await dlg.locator('input[type="password"]').fill(FAKE_KEY);
    await dlg.locator('button[type="submit"]').click();
    await dlg.waitFor({ state: 'hidden', timeout: 10_000 }).catch(async () => {
      const err = await dlg.locator('.error-text').textContent();
      assert.fail(`保存设置失败：${err ?? '(无错误文本)'}`);
    });

    // ── 选目录 ──
    await page.locator('.explorer .psel').click();
    await page.waitForFunction((name) => document.querySelector('.explorer .psel .pid')?.textContent?.includes(name), 'demo-project', { timeout: 10_000 });

    // ── 提问 ──
    await showSession(page);
    const textarea = page.locator('#wb-session .comp textarea');
    await textarea.fill('把 hello.txt 改成大写并运行检查命令');
    await textarea.press('Enter');

    // ── 批准第一处 edit_file（US2/AC1：对话卡片与右侧文件修改面板同时显示 diff） ──
    const edit1 = toolCard(page, 'call_edit1');
    await edit1.locator('.appr').waitFor({ state: 'visible', timeout: 30_000 });
    const firstReplyMs = performance.now() - launchedAt;
    assert.ok(firstReplyMs < 120_000, `SC-001：首次打开到首条流式回复 ${Math.round(firstReplyMs)} ms，超过 2 分钟`);
    assert.match((await edit1.locator('details').first().textContent()) ?? '', /\+.*HELLO/);
    await page.locator('.ctxp details summary .p').filter({ hasText: 'hello.txt' }).first().waitFor({ state: 'attached', timeout: 10_000 });
    assert.equal(await fsp.readFile(target, 'utf8'), 'hello world\n', '批准前不得写入（SC-002）');
    await edit1.locator('.appr .btn.pri').click();

    // ── 拒绝第二处 edit_file ──
    const edit2 = toolCard(page, 'call_edit2');
    await edit2.locator('.appr').waitFor({ state: 'visible', timeout: 30_000 });
    assert.equal(await fsp.readFile(target, 'utf8'), 'HELLO world\n', '批准后第一处修改已写入');
    await edit2.locator('.appr .btn.danger').click();

    // ── 批准 run_command（Windows 为 PowerShell，其余 bash） ──
    const cmd = toolCard(page, 'call_cmd1');
    await cmd.locator('.appr').waitFor({ state: 'visible', timeout: 30_000 });
    const q = (await cmd.locator('.appr .q').textContent()) ?? '';
    assert.match(q, process.platform === 'win32' ? /powershell/i : /bash/);
    assert.equal(await fsp.readFile(target, 'utf8'), 'HELLO world\n', '拒绝的修改不得写入');
    await cmd.locator('.appr .btn.pri').click();

    // ── SC-006：最后一轮流式第一段在完整回复前即已渲染 ──
    const sentAt = await fake.firstChunkSentAt;
    await page.waitForFunction((t) => [...document.querySelectorAll('.chat .msg .md')].some((el) => el.textContent?.includes(t)), FINAL_PART1, { timeout: 10_000 });
    const renderLagMs = performance.now() - sentAt;
    console.log(`[e2e] 流式首段从服务端发出到界面可见 ≈ ${Math.round(renderLagMs)} ms（含 IPC 与轮询开销）`);
    assert.ok(renderLagMs < 2_000, `流式文本渲染滞后 ${Math.round(renderLagMs)} ms`);
    assert.equal(await page.locator('.chat .msg .md').filter({ hasText: FINAL_PART2 }).count(), 0, '第二段尚未发出时不应出现（证明是增量渲染）');
    fake.releaseFinal();
    await page.locator('.chat .msg .md').filter({ hasText: '全部完成' }).waitFor({ state: 'visible', timeout: 15_000 });
    await page.waitForFunction(() => document.querySelector('.chat .stop')?.hasAttribute('hidden'), null, { timeout: 15_000 });

    assert.equal(await fsp.readFile(target, 'utf8'), 'HELLO world\n');
    await cmd.locator('.chip').filter({ hasText: '完成' }).waitFor({ timeout: 10_000 });
    assert.match((await cmd.textContent()) ?? '', new RegExp(COMMAND_MARKER));
    await edit2.locator('.chip').filter({ hasText: '已拒绝' }).waitFor({ timeout: 10_000 });

    // 模型侧：Key 只出现在 Authorization 头；拒绝结果回传给模型
    assert.equal(fake.requests.length, 4, `应恰好 4 次模型请求，实际 ${fake.requests.length}`);
    for (const r of fake.requests) {
      assert.equal(r.auth, `Bearer ${FAKE_KEY}`);
      assert.equal(r.model, 'fake-model');
    }
    const rejectMsg = fake.requests[2]?.messages.find((m) => m.role === 'tool' && m.tool_call_id === 'call_edit2');
    assert.ok(rejectMsg?.content, '拒绝结果应作为 tool 消息告知 Agent');
    const cmdMsg = fake.requests[3]?.messages.find((m) => m.role === 'tool' && m.tool_call_id === 'call_cmd1');
    assert.match(cmdMsg?.content ?? '', new RegExp(COMMAND_MARKER));

    // ── 宪法 十二：页面导航与新窗口被拦截 ──
    await page.evaluate(() => { window.location.href = 'https://example.invalid/e2e-nav'; }, null);
    await page.waitForTimeout(800);
    assert.equal(page.url(), ENTRY_URL, 'will-navigate 应拦截离开入口页的导航');
    await page.evaluate(() => { window.location.href = 'file:///'; }, null);
    await page.waitForTimeout(500);
    assert.equal(page.url(), ENTRY_URL, 'file:// 导航应被拦截');
    assert.equal(await page.evaluate(() => typeof window.api?.invoke, null), 'function', '拦截后界面与 preload 桥仍在');

    const opened = await page.evaluate(() => [window.open('https://example.invalid/popup') === null, window.open('file:///etc/hosts') === null], null);
    assert.deepEqual(opened, [true, true], 'window.open 应返回 null（deny）');
    await page.waitForTimeout(500);
    assert.equal(app.windows().length, 1, '不得创建新窗口');
    const external = await app.evaluate(() => (globalThis as unknown as { __e2eOpened: string[] }).__e2eOpened, null);
    assert.deepEqual(external, ['https://example.invalid/popup'], '只有 http(s) 链接交给系统浏览器，file:// 直接拒绝');

    // ── 重启后会话恢复 ──
    await app.close();
    app = null;
    ({ app, page } = await launch(pw, bin, userData, projectDir));
    assert.equal(await page.locator('#settings-dialog[open]').count(), 0, '已配置时重启不应再弹出设置');
    await page.waitForFunction((name) => document.querySelector('.explorer .psel .pid')?.textContent?.includes(name), 'demo-project', { timeout: 10_000 });
    await showSession(page);
    await page.locator('.chat .ubub').filter({ hasText: '把 hello.txt 改成大写' }).waitFor({ state: 'visible', timeout: 10_000 });
    // 过程区已无标题行、不再折叠：工具卡片直接可见，且同一回合只有一个过程区
    await page.locator('.chat .verify.tool[data-call="call_edit1"]').waitFor({ state: 'visible', timeout: 5_000 });
    assert.equal(await page.locator('.chat .think-sum').count(), 0, '不应再有过程区标题行');
    await openThinkOf(page, 'call_edit1');
    await toolCard(page, 'call_edit1').locator('.chip').filter({ hasText: '完成' }).waitFor({ timeout: 10_000 });
    await openThinkOf(page, 'call_edit2');
    await toolCard(page, 'call_edit2').locator('.chip').filter({ hasText: '已拒绝' }).waitFor({ timeout: 10_000 });
    await openThinkOf(page, 'call_cmd1');
    await toolCard(page, 'call_cmd1').locator('.chip').filter({ hasText: '完成' }).waitFor({ timeout: 10_000 });
    await page.locator('.chat .msg .md').filter({ hasText: '全部完成' }).waitFor({ state: 'visible', timeout: 10_000 });
    assert.equal(await page.locator('.chat .appr').count(), 0, '恢复后不应残留待批准按钮');
    assert.equal(fake.requests.length, 4, '恢复会话不应触发新的模型请求');
  } finally {
    fake.releaseFinal();
    if (app) await app.close().catch(() => undefined);
    await fake.close();
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
});
