/**
 * Electron E2E 三板块与 CLI 路径（T-020 / T123；FR-101、FR-109、FR-112）。
 *
 * 基座与 core-path.test.ts（T040）同源：Playwright `_electron` 启动真实应用、临时 userData 隔离、
 * dialog.showOpenDialog 替换、本地假 OpenAI 兼容 SSE 服务（纯文本回复，不访问真实模型）。
 *
 * 覆盖：
 * - FR-101：看板 / 会话 / Git 三板块切换，会话板块未发送草稿不丢；Git 板块分支图真实渲染
 *   （临时 git 仓库：main 两提交 → 分支一提交 → main 再一提交 → 合并，共 5 提交 2 泳道，
 *   断言 SVG 节点 / 连线 / 合并环 / 提交行与分支标注的结构，而非只断言容器存在）。
 * - FR-109：看板点任务卡 → 新建任务会话并预填「T-101 标题：」→ 发送后会话标题关联任务卡，
 *   对话顶部出现任务卡摘要（.sysb）；再次点同一卡 → 打开已有会话（不新建、不预填）。
 * - FR-112：假 opencode 替身（本地脚本，不访问网络、无真实密钥）经 PATH 被设置页「自动检测」注册为
 *   CLI agent；AICM_OPENCODE_MODE=run 选定 run 通道（spawn 参数数组 + opencode-json JSONL 解析）；
 *   两轮对话断言替身预定回复渲染、替身实际写出文件、第二轮 argv 带 --session 续接同一 CLI 会话。
 *
 * 跳过条件与 core-path 一致（不得假装通过）：未安装 playwright、Electron 二进制缺失或无法启动、
 * Linux 无图形环境（请用 xvfb-run）。设 AICM_E2E=0 可显式跳过。
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
const CLI_REPLY = '假 opencode 已执行（E2E 替身回复）';
const CLI_SESSION_ID = 'ses_fake_e2e';
const CARD_ID = 'T-101';
const CARD_TITLE = '演示任务卡甲';
const CARD_GOAL = '验证看板卡片进入任务会话并携带任务上下文';

// ───────────── Playwright 最小类型（同 core-path，不静态 import） ─────────────

interface PwLocator {
  click(opts?: { timeout?: number }): Promise<void>;
  fill(value: string, opts?: { timeout?: number }): Promise<void>;
  press(key: string, opts?: { timeout?: number }): Promise<void>;
  textContent(opts?: { timeout?: number }): Promise<string | null>;
  inputValue(opts?: { timeout?: number }): Promise<string>;
  getAttribute(name: string, opts?: { timeout?: number }): Promise<string | null>;
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

// ───────────── 环境探测（同 core-path） ─────────────

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

function environmentProblem(bin: string): string | null {
  if (process.env.AICM_E2E === '0') return 'AICM_E2E=0，显式跳过 Electron E2E';
  if (!bin) return 'Electron 二进制不存在（node_modules/electron 未下载 dist，可运行 node node_modules/electron/install.js）';
  if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    return '无图形环境（未设置 DISPLAY / WAYLAND_DISPLAY）；请用 xvfb-run -a npm run test:e2e 运行';
  }
  const probe = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 30_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
  if (probe.status !== 0) {
    const reason = (probe.stderr || probe.error?.message || `退出码 ${String(probe.status)}`).trim().split('\n').slice(-2).join(' ');
    return `Electron 无法启动（缺少系统库？）：${reason}`;
  }
  return null;
}

// ───────────── 假 OpenAI 兼容 SSE 服务（纯文本回复，无工具调用） ─────────────

interface FakeTextServer { baseUrl: string; close(): Promise<void> }

function sseChunk(delta: Record<string, unknown>, finish: string | null = null): string {
  return `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
}

async function startFakeTextServer(reply: string): Promise<FakeTextServer> {
  const server = http.createServer((req, res) => {
    req.on('data', () => undefined); // 排空请求体即可，本替身不看消息内容
    req.on('end', () => {
      if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      res.write(sseChunk({ role: 'assistant', content: reply }));
      res.write(sseChunk({}, 'stop'));
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }),
  };
}

// ───────────── 启动应用（同 core-path，env 可追加） ─────────────

function launchArgs(userData: string): string[] {
  const args = [APP_ROOT, `--user-data-dir=${userData}`];
  if (process.platform === 'linux') {
    args.push('--no-sandbox', '--password-store=basic');
  }
  return args;
}

function launchEnv(userData: string, extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  delete env.ELECTRON_RUN_AS_NODE;
  Object.assign(env, extra);
  env.XDG_CONFIG_HOME = userData;
  if (process.platform === 'win32') env.APPDATA = userData;
  return env;
}

async function launch(pw: PwElectron, bin: string, userData: string, projectDir: string, extraEnv: Record<string, string> = {}): Promise<{ app: PwElectronApp; page: PwPage }> {
  const app = await pw.launch({ executablePath: bin, args: launchArgs(userData), cwd: APP_ROOT, env: launchEnv(userData, extraEnv), timeout: 60_000 });
  const actualUserData = await app.evaluate(({ app: a }) => a.getPath('userData'), null);
  assert.ok(path.resolve(actualUserData).startsWith(path.resolve(userData)), `userData 未隔离：${actualUserData}`);
  await app.evaluate(({ dialog, shell }, dir) => {
    const g = globalThis as unknown as { __e2eOpened: string[] };
    g.__e2eOpened = [];
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir] })) as typeof dialog.showOpenDialog;
    shell.openExternal = async (url: string) => { g.__e2eOpened.push(url); };
  }, projectDir);
  if (process.platform === 'linux') {
    await app.evaluate(({ safeStorage }) => {
      if (!safeStorage.isEncryptionAvailable()) safeStorage.setUsePlainTextEncryption(true);
    }, null);
  }
  const page = await app.firstWindow({ timeout: 60_000 });
  page.on('console', (msg) => { if (msg.type() === 'error') console.error(`[renderer] ${msg.text()}`); });
  await page.locator('.explorer .psel').waitFor({ state: 'visible', timeout: 30_000 });
  return { app, page };
}

// ───────────── 夹具工程：泳道 + 任务卡 + git 仓库（多分支 + 合并） ─────────────

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } });
}

function cardMarkdown(id: string, lane: string, title: string, goal: string): string {
  return [
    `# ${id} ${title}`,
    '',
    '| 字段 | 值 |',
    '|---|---|',
    `| 泳道 | ${lane} |`,
    '| 对应需求 | FR-101 |',
    '| 包含任务号 | T901 |',
    `| 分支 | \`feat/${lane}/${id}-demo\` |`,
    '| PR 目标 | `main` |',
    '| 前置任务 | 无 |',
    '| 状态 | ready |',
    '| 执行者 | （待派发） |',
    '',
    '## 目标',
    '',
    goal,
    '',
    '## 验收标准',
    '',
    '- [ ] 演示用任务卡（E2E 夹具）',
    '',
  ].join('\n');
}

async function createProjectFixture(projectDir: string): Promise<void> {
  await fsp.mkdir(path.join(projectDir, '.agents'), { recursive: true });
  await fsp.mkdir(path.join(projectDir, 'docs', 'tasks'), { recursive: true });
  await fsp.writeFile(path.join(projectDir, '.agents', 'lanes.conf'), [
    '# E2E 夹具泳道',
    'frontend src/frontend/* tests/*/frontend/*',
    'backend src/backend/* tests/*/backend/*',
    'docs docs/* README.md CHANGELOG.md',
    '',
  ].join('\n'), 'utf8');
  await fsp.writeFile(path.join(projectDir, 'docs', 'tasks', `${CARD_ID}.md`), cardMarkdown(CARD_ID, 'frontend', CARD_TITLE, CARD_GOAL), 'utf8');
  await fsp.writeFile(path.join(projectDir, 'docs', 'tasks', 'T-102.md'), cardMarkdown('T-102', 'backend', '演示任务卡乙', '演示用第二张任务卡。'), 'utf8');
  await fsp.writeFile(path.join(projectDir, 'README.md'), '# demo-project（E2E 夹具）\n', 'utf8');

  git(projectDir, 'init', '-b', 'main');
  git(projectDir, 'config', 'user.email', 'e2e@example.invalid');
  git(projectDir, 'config', 'user.name', 'E2E Fixture');
  git(projectDir, 'config', 'commit.gpgsign', 'false');
  git(projectDir, 'add', '-A');
  git(projectDir, 'commit', '-m', 'c1 initial');
  await fsp.writeFile(path.join(projectDir, 'a.txt'), 'a\n', 'utf8');
  git(projectDir, 'add', '-A');
  git(projectDir, 'commit', '-m', 'c2 main work');
  git(projectDir, 'checkout', '-b', 'feat/e2e-graph');
  await fsp.writeFile(path.join(projectDir, 'b.txt'), 'b\n', 'utf8');
  git(projectDir, 'add', '-A');
  git(projectDir, 'commit', '-m', 'c3 branch work');
  git(projectDir, 'checkout', 'main');
  await fsp.writeFile(path.join(projectDir, 'c.txt'), 'c\n', 'utf8');
  git(projectDir, 'add', '-A');
  git(projectDir, 'commit', '-m', 'c4 main more');
  git(projectDir, 'merge', '--no-ff', 'feat/e2e-graph', '-m', 'c5 merge feat/e2e-graph');
}

// ───────────── 通用小步骤 ─────────────

/** 打开设置对话框（启动不再自动弹出，入口为 rail 齿轮）。 */
async function openSettings(page: PwPage): Promise<void> {
  await page.locator('.rail a[title="设置"]').click();
  await page.locator('#settings-dialog input[type="url"]').waitFor({ state: 'visible', timeout: 15_000 });
}

async function configureBuiltin(page: PwPage, baseUrl: string): Promise<void> {
  await openSettings(page);
  const dlg = page.locator('#settings-dialog');
  await dlg.locator('input[type="url"]').fill(baseUrl);
  await dlg.locator('input[type="text"]').fill('fake-model');
  await dlg.locator('input[type="password"]').fill(FAKE_KEY);
  await dlg.locator('button[type="submit"]').click();
  await dlg.waitFor({ state: 'hidden', timeout: 10_000 }).catch(async () => {
    const err = await dlg.locator('.error-text').textContent();
    assert.fail(`保存设置失败：${err ?? '(无错误文本)'}`);
  });
}

async function openFixtureProject(page: PwPage): Promise<void> {
  await page.locator('.explorer .psel').click();
  await page.waitForFunction((name) => document.querySelector('.explorer .psel .pid')?.textContent?.includes(name), 'demo-project', { timeout: 15_000 });
}

async function navTo(page: PwPage, label: string): Promise<void> {
  await page.locator('.explorer .nav a').filter({ hasText: label }).click();
}

async function showSession(page: PwPage): Promise<void> {
  await navTo(page, '任务会话');
  await page.locator('#wb-session .comp textarea').waitFor({ state: 'visible' });
}

async function waitTurnEnd(page: PwPage): Promise<void> {
  await page.waitForFunction(() => document.querySelector('.chat .stop')?.hasAttribute('hidden'), null, { timeout: 30_000 });
}

/** CLI 回合在 ask 权限模式下先弹启动批准卡：出现就点批准（不出现则直接返回）。 */
async function approveCliLaunchIfAsked(page: PwPage): Promise<void> {
  const btn = page.locator('.chat .appr .btn.pri').first();
  try {
    await btn.waitFor({ state: 'visible', timeout: 20_000 });
  } catch {
    return; // 无批准卡（权限模式非 ask 等）：直接进入等待回复
  }
  await btn.click();
}

// ───────────── 测试 ─────────────

const pwOrReason = await loadPlaywright();
const bin = electronBinary();
const skipReason = typeof pwOrReason === 'string' ? pwOrReason : environmentProblem(bin);

if (!skipReason) {
  // 用当前源码构建 dist/（应用从 dist/src/backend/main.js 启动），三条测试共用一次构建
  execFileSync(process.execPath, [path.join(APP_ROOT, 'node_modules/typescript/bin/tsc'), '-p', APP_ROOT], { cwd: APP_ROOT, stdio: 'inherit' });
}

test('FR-101 三板块导航与状态保持 + Git 分支图渲染', {
  skip: skipReason ?? false,
  timeout: 300_000,
}, async () => {
  const pw = pwOrReason as PwElectron;
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'aicm-e2e-boards-'));
  const userData = path.join(tmp, 'userData');
  const projectDir = path.join(tmp, 'demo-project');
  await fsp.mkdir(userData, { recursive: true });
  await fsp.mkdir(projectDir, { recursive: true });
  await createProjectFixture(projectDir);
  const fake = await startFakeTextServer('已接下任务，正在处理。');
  let app: PwElectronApp | null = null;
  try {
    let page: PwPage;
    ({ app, page } = await launch(pw, bin, userData, projectDir));
    await configureBuiltin(page, fake.baseUrl);
    await openFixtureProject(page);

    // 会话板块写未发送草稿（状态保持的断言对象：输入框内容是真实保持行为，视图 DOM 不卸载）
    await showSession(page);
    const textarea = page.locator('#wb-session .comp textarea');
    const draft = '草稿不要丢 e2e-draft';
    await textarea.fill(draft);

    // → 看板：会话视图隐藏、看板卡片渲染
    await navTo(page, '看板');
    await page.locator('#wb-board').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#wb-session').evaluate((el) => (el as HTMLElement).hidden, null), true, '切到看板后会话视图应隐藏');
    await page.locator('#wb-board a.card').filter({ hasText: CARD_ID }).waitFor({ state: 'visible', timeout: 30_000 });
    await page.locator('#wb-board a.card').filter({ hasText: 'T-102' }).waitFor({ state: 'visible', timeout: 10_000 });

    // → Git：分支图真实渲染（SVG 节点 / 连线 / 合并或 HEAD 环 / 提交行与分支标注）
    await navTo(page, '看板');
    await page.locator('#wb-git').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelectorAll('#graph svg circle.cn').length >= 5, null, { timeout: 30_000 });
    const graph = await page.evaluate(() => {
      const svg = document.querySelector('#graph svg');
      const branchRows = [...document.querySelectorAll('#graph .gr[data-branch]')].map((el) => el.getAttribute('data-branch') ?? '');
      return {
        nodes: document.querySelectorAll('#graph svg circle.cn').length,
        edges: svg?.querySelectorAll('path').length ?? 0,
        rings: document.querySelectorAll('#graph svg circle.ring').length,
        rows: document.querySelectorAll('#graph .gr[data-sha]').length,
        branchRows,
        subjects: [...document.querySelectorAll('#graph .gr')].map((el) => el.textContent ?? ''),
      };
    }, null);
    assert.equal(graph.nodes, 5, `图节点应为 5 个提交，实际 ${graph.nodes}`);
    assert.ok(graph.edges >= 4, `图连线应 ≥4 条（分支 + 合并双亲边），实际 ${graph.edges}`);
    assert.ok(graph.rings >= 1, '合并提交或 HEAD 应带 ring 圆环');
    assert.equal(graph.rows, 5, `提交行应为 5 行，实际 ${graph.rows}`);
    assert.ok(graph.branchRows.some((b) => b.includes('feat/e2e-graph')), `应有提交行标注 feat/e2e-graph 分支，实际 ${JSON.stringify(graph.branchRows)}`);
    assert.ok(graph.subjects.some((t) => t.includes('c5 merge feat/e2e-graph')), '提交行应含合并提交标题');

    // → 回到会话：草稿还在、当前板块高亮跟随
    await navTo(page, '任务会话');
    await page.locator('#wb-session').waitFor({ state: 'visible' });
    assert.equal(await textarea.inputValue(), draft, '三板块切换后未发送草稿不得丢失（FR-101）');
    const activeNav = await page.locator('.explorer .nav a.on').textContent();
    assert.ok(activeNav?.includes('任务会话'), '当前板块高亮应在任务会话');
    assert.equal(page.url(), ENTRY_URL, '板块切换不应离开入口页');
  } finally {
    if (app) await app.close().catch(() => undefined);
    await fake.close();
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
});

test('FR-109 看板卡片 → 任务会话（预填、标题关联、任务卡摘要、重进打开已有会话）', {
  skip: skipReason ?? false,
  timeout: 300_000,
}, async () => {
  const pw = pwOrReason as PwElectron;
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'aicm-e2e-card-'));
  const userData = path.join(tmp, 'userData');
  const projectDir = path.join(tmp, 'demo-project');
  await fsp.mkdir(userData, { recursive: true });
  await fsp.mkdir(projectDir, { recursive: true });
  await createProjectFixture(projectDir);
  const fake = await startFakeTextServer('已接下任务，正在处理。');
  let app: PwElectronApp | null = null;
  try {
    let page: PwPage;
    ({ app, page } = await launch(pw, bin, userData, projectDir));
    await configureBuiltin(page, fake.baseUrl);
    await openFixtureProject(page);

    // 看板点卡 → 切到任务会话并预填（不自动发送）
    await navTo(page, '看板');
    await page.locator('#wb-board a.card').filter({ hasText: CARD_ID }).waitFor({ state: 'visible', timeout: 30_000 });
    await page.locator('#wb-board a.card').filter({ hasText: CARD_ID }).click();
    await page.locator('#wb-session').waitFor({ state: 'visible' });
    const textarea = page.locator('#wb-session .comp textarea');
    await textarea.waitFor({ state: 'visible' });
    const prefilled = await textarea.inputValue();
    assert.ok(prefilled.startsWith(CARD_ID), '点卡后输入框应预填任务号开头，实际 ' + JSON.stringify(prefilled));
    assert.ok(prefilled.includes(CARD_TITLE), '预填应含任务卡标题，实际 ' + JSON.stringify(prefilled));

    // 发送预填消息 → 会话标题关联任务卡 → 顶部任务卡摘要出现 + 假模型回复渲染
    await textarea.press('Enter');
    await page.locator('.chat .msg .md').filter({ hasText: '已接下任务' }).waitFor({ state: 'visible', timeout: 30_000 });
    await waitTurnEnd(page);
    const title = await page.locator('.chat .th-title').textContent();
    assert.ok(title?.includes(CARD_ID), '会话标题应含任务号，实际 ' + JSON.stringify(title));
    const sysb = page.locator('.chat .sysb');
    await sysb.waitFor({ state: 'visible', timeout: 15_000 });
    const sysbText = (await sysb.textContent()) ?? '';
    assert.ok(sysbText.includes('任务卡 docs/tasks/' + CARD_ID + '.md'), '任务卡摘要应含卡片文件，实际 ' + JSON.stringify(sysbText));
    assert.ok(sysbText.includes(CARD_GOAL), '任务卡摘要应含卡片目标，实际 ' + JSON.stringify(sysbText));

    // 再次点同一张卡 → 打开已有会话（标题不变、输入框不再预填）
    await navTo(page, '看板');
    await page.locator('#wb-board a.card').filter({ hasText: CARD_ID }).waitFor({ state: 'visible', timeout: 30_000 });
    await page.locator('#wb-board a.card').filter({ hasText: CARD_ID }).click();
    await page.locator('#wb-session').waitFor({ state: 'visible' });
    assert.equal(await textarea.inputValue(), '', '重进已有任务会话不应再次预填');
    const title2 = await page.locator('.chat .th-title').textContent();
    assert.ok(title2?.includes(CARD_ID), '重进后仍应是含任务号的已有会话，实际 ' + JSON.stringify(title2));
    await page.locator('.chat .sysb').waitFor({ state: 'visible', timeout: 10_000 });
  } finally {
    if (app) await app.close().catch(() => undefined);
    await fake.close();
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
});

// ───────────── FR-112：假 opencode 替身（run 通道 JSONL） ─────────────

const FAKE_OPENCODE_SCRIPT = [
  '#!/usr/bin/env node',
  "const fs = require('node:fs');",
  "const path = require('node:path');",
  'const argv = process.argv.slice(2);',
  "if (argv.includes('--version')) { console.log('1.19.3'); process.exit(0); }",
  'const log = process.env.FAKE_OC_ARGV_LOG;',
  "if (log) fs.appendFileSync(log, JSON.stringify(argv) + '\\n');",
  "const sid = '" + CLI_SESSION_ID + "';",
  'const now = Date.now();',
  'const line = (o) => console.log(JSON.stringify(o));',
  "line({ type: 'step_start', timestamp: now, sessionID: sid, part: { id: 'prt_s1', messageID: 'msg_1', sessionID: sid, type: 'step-start' } });",
  "line({ type: 'text', timestamp: now, sessionID: sid, part: { id: 'prt_t1', messageID: 'msg_1', sessionID: sid, type: 'text', text: '" + CLI_REPLY + "' } });",
  "fs.writeFileSync(path.join(process.cwd(), 'fake-opencode-note.txt'), 'fake opencode was here\\n');",
  "line({ type: 'tool_use', timestamp: now, sessionID: sid, part: { id: 'prt_u1', messageID: 'msg_1', sessionID: sid, type: 'tool', tool: 'write', callID: 'call_fake1', state: { status: 'completed', input: { filePath: 'fake-opencode-note.txt' }, output: 'Wrote file successfully.', title: 'fake-opencode-note.txt', time: { start: now, end: now } } } });",
  "line({ type: 'step_finish', timestamp: now, sessionID: sid, part: { id: 'prt_f1', messageID: 'msg_1', sessionID: sid, type: 'step-finish', reason: 'stop', tokens: { input: 2, output: 1, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 0 } });",
  '',
].join('\n');

test('FR-112 假 opencode 对话路径（自动检测注册 → run 通道两轮 → --session 续接）', {
  skip: skipReason ?? false,
  timeout: 300_000,
}, async () => {
  const pw = pwOrReason as PwElectron;
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'aicm-e2e-cli-'));
  const userData = path.join(tmp, 'userData');
  const projectDir = path.join(tmp, 'demo-project');
  const binDir = path.join(tmp, 'fake-bin');
  const argvLog = path.join(tmp, 'argv.log');
  await fsp.mkdir(userData, { recursive: true });
  await fsp.mkdir(projectDir, { recursive: true });
  await fsp.mkdir(binDir, { recursive: true });
  await createProjectFixture(projectDir);
  const fakeBin = path.join(binDir, 'opencode');
  await fsp.writeFile(fakeBin, FAKE_OPENCODE_SCRIPT, 'utf8');
  await fsp.chmod(fakeBin, 0o755);
  let app: PwElectronApp | null = null;
  try {
    let page: PwPage;
    ({ app, page } = await launch(pw, bin, userData, projectDir, {
      AICM_OPENCODE_MODE: 'run',
      FAKE_OC_ARGV_LOG: argvLog,
      PATH: binDir + path.delimiter + (process.env.PATH ?? ''),
    }));

    // 设置页「Agent CLI」标签 → 自动检测（PATH 首位的假 opencode）→ 添加 → 保存（设为默认并关窗）
    await openSettings(page);
    const dlg = page.locator('#settings-dialog');
    await dlg.locator('.dtabs .chip').filter({ hasText: 'Agent CLI' }).click();
    await dlg.locator('.dhead .btn').filter({ hasText: '自动检测' }).click();
    await page.locator('#settings-dialog .detect-out .cli-item').filter({ hasText: 'opencode' }).waitFor({ state: 'visible', timeout: 30_000 });
    // 检测结果可能含其它候选 CLI：只点 opencode 那一项里的「添加」
    await page.locator('#settings-dialog .detect-out .cli-item').filter({ hasText: 'opencode' }).locator('.btn').filter({ hasText: '添加' }).first().click();
    await page.locator('#settings-dialog .cli-list .cli-item').filter({ hasText: 'opencode' }).waitFor({ state: 'visible', timeout: 15_000 });
    // 用条目自带的「设为默认」切默认 agent（对话框底部「保存」的 disabled 已由 T-052 改为随 CLI 列表
    // 实时刷新，新增第一条后即可点；本测试仍走「设为默认」路径，不依赖该按钮）
    await page.locator('#settings-dialog .cli-list .cli-item').filter({ hasText: 'opencode' }).locator('.btn').filter({ hasText: '设为默认' }).first().click();
    await page.locator('#settings-dialog .cli-list .cli-item .chip.grn').filter({ hasText: '使用中' }).waitFor({ state: 'visible', timeout: 10_000 });
    await dlg.press('Escape');
    await dlg.waitFor({ state: 'hidden', timeout: 10_000 });

    await openFixtureProject(page);
    await showSession(page);
    // 新建会话（绑定当前默认 agent = 刚注册的 opencode CLI）
    await page.locator('#wb-session button[title^="新建会话"]').click();
    const textarea = page.locator('#wb-session .comp textarea');
    await page.waitForFunction(() => document.querySelector('#wb-session .comp textarea')?.getAttribute('placeholder')?.includes('opencode'), null, { timeout: 15_000 });

    // 第一轮：发送 → （ask 模式）批准启动 → 替身回复渲染 + 无错误通知
    await textarea.fill('让假 opencode 干活');
    await textarea.press('Enter');
    await approveCliLaunchIfAsked(page);
    await page.locator('.chat .msg .md').filter({ hasText: CLI_REPLY }).waitFor({ state: 'visible', timeout: 30_000 });
    await waitTurnEnd(page);
    const notices = await page.evaluate(() => [...document.querySelectorAll('.chat .notice')].map((el) => el.textContent ?? ''), null);
    assert.ok(!notices.some((t) => t.includes('无法启动') || t.includes('异常退出') || t.includes('E_CLI')), 'CLI 回合不应出现启动错误通知，实际 ' + JSON.stringify(notices));
    assert.equal(await fsp.readFile(path.join(projectDir, 'fake-opencode-note.txt'), 'utf8'), 'fake opencode was here\n', '替身应以项目根为 cwd 实际写出文件');

    // 第二轮：续接同一 CLI 会话（argv 带 --session <替身会话 ID>）
    await textarea.fill('再来一轮');
    await textarea.press('Enter');
    await approveCliLaunchIfAsked(page);
    await page.waitForFunction((marker) => [...document.querySelectorAll('.chat .msg .md')].filter((el) => el.textContent?.includes(marker)).length >= 2, CLI_REPLY, { timeout: 30_000 });
    await waitTurnEnd(page);

    const invocations = (await fsp.readFile(argvLog, 'utf8')).trim().split('\n').map((l) => JSON.parse(l) as string[]);
    assert.ok(invocations.length >= 2, '替身应被启动至少两轮，实际 ' + String(invocations.length));
    const first = invocations[0] ?? [];
    assert.ok(first.includes('run') && first.includes('--format') && first.includes('json'), '首轮 argv 应为 opencode run --format json 口径，实际 ' + JSON.stringify(first));
    assert.ok(first.includes('让假 opencode 干活'), '首轮 argv 应以参数数组携带用户消息（不经 shell），实际 ' + JSON.stringify(first));
    const second = invocations[1] ?? [];
    const si = second.indexOf('--session');
    assert.ok(si >= 0 && second[si + 1] === CLI_SESSION_ID, '第二轮 argv 应带 --session ' + CLI_SESSION_ID + ' 续接，实际 ' + JSON.stringify(second));
  } finally {
    if (app) await app.close().catch(() => undefined);
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
});
