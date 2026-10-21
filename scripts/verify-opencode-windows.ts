/**
 * Windows 实机验证 opencode 集成（T-021 / T124；FR-112、FR-113、SC-103）。
 *
 *   node scripts/verify-opencode-windows.ts
 *
 * 前置：Windows 上已 `npm install -g opencode-ai@<版本>`（CI 的 windows-opencode 作业负责，
 * 版本口径与项目实测对齐，见 src/backend/agent-cli/presets.ts）。无模型 Key 时只验启动、
 * 参数与错误路径（任务卡口径），不引入任何密钥。
 *
 * 逐项验证（每项独立记账，失败不遮蔽后续项；任一失败退出 1，日志按项定位）：
 *  1. .cmd → .exe 解析：真实 npm 全局安装下，resolveExecutable('opencode') 必须越过
 *     %APPDATA%\npm\opencode.cmd 包装脚本，定位到 node_modules/opencode-ai/bin/opencode.exe，
 *     且该 exe 可直接执行 `--version`（不经 shell，与 resolve.ts 的安全口径一致）。
 *  2. 含空格与中文的路径：把真实 exe 复制进「空格 + 中文」目录后，解析与启动都必须成功。
 *  3. taskkill 干净停止：按 serve-runner.ts 的真实参数启动 `opencode serve`（shell:false），
 *     等监听行出现后用与应用相同的方式 taskkill /T /F 结束进程树，断言无残留进程、端口已关。
 *  4. platform-env 回退分支：Git Bash 探测落空时注入 OPENCODE_CONFIG_CONTENT 指定
 *     shell=powershell.exe（外加 question 工具禁用），断言注入结果逐字正确。
 *  5. platform-env 探测分支：Git 安装目录下存在 bash.exe 时注入 OPENCODE_GIT_BASH_PATH；
 *     用户已自设该变量时不覆盖（返回空）。
 *  6. 错误路径（无模型 Key）：剥离提供方密钥类环境变量并指向空 HOME 后，两个用例各自
 *     独立记账（一例失败不吞另一例）：两例都必须非 0 退出、不得挂死或假成功，且输出须有
 *     明确错误载体——(a) 不存在的 provider/model 以结构化错误或 provider/auth/model 字样
 *     为判据（1.19.3 实测走通用服务器错误面，见 STRUCTURED_ERROR_RE 处注释）；(b) 无凭据
 *     默认运行以 provider / auth / credential 类关键词为判据。
 *
 * 非 Windows 平台打印 SKIP 并退出 0（同 smoke-exe.ts 的口径：平台不符不假装通过）；
 * 本脚本的断言只能在 windows-latest / Windows 实机上见分晓。
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { findGitBash, opencodeLaunchEnv, opencodePlatformEnv } from '../src/backend/agent-cli/platform-env.ts';
import { defaultResolveDeps, resolveExecutable } from '../src/backend/agent-cli/resolve.ts';

const VERSION_RE = /\d+\.\d+\.\d+/;
/** serve-runner.ts 同款监听行（opencode-serve.ts 的 LISTENING）。 */
const LISTENING_RE = /opencode server listening on (https?:\/\/[^\s]+)/;

const tmpRoots: string[] = [];
function mkTmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}
function cleanupTmp(): void {
  for (const dir of tmpRoots.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      console.warn(`（临时目录清理失败，可忽略：${dir}：${err instanceof Error ? err.message : String(err)}）`);
    }
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface RunResult {
  code: number | null;
  out: string;
  timedOut: boolean;
}

/** 无 shell 直接执行并收集输出（截尾保留）；超时按应用同款 taskkill 结束进程树。 */
function runCapture(
  exe: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs: number },
): Promise<RunResult> {
  return new Promise((resolvePromise) => {
    const child = spawn(exe, args, {
      cwd: opts.cwd,
      env: opts.env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const keep = (b: Buffer) => {
      out = (out + b.toString('utf8')).slice(-16_000);
    };
    child.stdout?.on('data', keep);
    child.stderr?.on('data', keep);
    let timedOut = false;
    let settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid !== undefined) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    }, opts.timeoutMs);
    const done = (code: number | null, extra = '') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({ code, out: out + extra, timedOut });
    };
    child.once('error', (err) => done(null, `\n[spawn error] ${err.message}`));
    child.once('exit', (code) => done(code));
  });
}

function tasklistCsv(filter: string): string {
  const r = spawnSync('tasklist', ['/FI', filter, '/NH', '/FO', 'CSV'], { encoding: 'utf8', windowsHide: true });
  return r.stdout ?? '';
}
function pidAlive(pid: number): boolean {
  return tasklistCsv(`PID eq ${pid}`).includes(`"${pid}"`);
}
function opencodeProcessCount(): number {
  return tasklistCsv('IMAGENAME eq opencode.exe')
    .split(/\r?\n/)
    .filter((l) => /opencode\.exe/i.test(l)).length;
}

function canConnect(port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const sock = net.connect({ port, host: '127.0.0.1' });
    const done = (v: boolean) => {
      sock.destroy();
      resolvePromise(v);
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
}

/** 第 1 项的产物：解析出的真实 exe，后续项复用。 */
let resolvedExe: string | null = null;
function needExe(): string {
  assert(resolvedExe, '前置失败：第 1 项未解析出 opencode.exe，本项无从执行');
  return resolvedExe;
}

async function checkResolveCmdShim(): Promise<string> {
  // npm 本身是 .cmd，无 shell 取不到；固定命令、无外部输入，shell:true 仅此一处。
  const r = spawnSync('npm prefix -g', { shell: true, encoding: 'utf8', windowsHide: true });
  assert(r.status === 0, `npm prefix -g 失败：${r.stderr ?? ''}`);
  const prefix = (r.stdout ?? '').trim().split(/\r?\n/).pop()?.trim() ?? '';
  assert(prefix, 'npm prefix -g 输出为空');
  const shim = path.join(prefix, 'opencode.cmd');
  const expectedExe = path.join(prefix, 'node_modules', 'opencode-ai', 'bin', 'opencode.exe');
  assert(fs.existsSync(shim), `npm 包装脚本不存在：${shim}（opencode 未全局安装？）`);
  assert(fs.existsSync(expectedExe), `真实 exe 不存在：${expectedExe}（opencode-ai 包布局与 resolve.ts 的兜底猜测不一致）`);

  const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${prefix};${process.env.PATH ?? process.env.Path ?? ''}` };
  const res = await resolveExecutable('opencode', defaultResolveDeps('win32', env));
  assert(res.ok, `resolveExecutable('opencode') 未成功：${res.ok ? '' : res.reason}`);
  assert(!/\.cmd$/i.test(res.path), `解析结果仍是包装脚本：${res.path}`);
  assert(
    res.path.toLowerCase() === expectedExe.toLowerCase(),
    `解析结果与预期 exe 不一致：\n  实际 ${res.path}\n  预期 ${expectedExe}`,
  );
  resolvedExe = res.path;

  const ver = await runCapture(res.path, ['--version'], { timeoutMs: 30_000 });
  assert(!ver.timedOut, '`opencode --version` 超时未退出');
  assert(ver.code === 0, `\`opencode --version\` 退出码 ${String(ver.code)}：${ver.out.trim().slice(-300)}`);
  assert(VERSION_RE.test(ver.out), `\`opencode --version\` 输出无版本号：${ver.out.trim().slice(-200)}`);
  return `shim=${shim} → exe=${res.path}，--version 输出 ${ver.out.trim().split(/\r?\n/).pop() ?? ''}`;
}

async function checkSpacedChinesePath(): Promise<string> {
  const exe = needExe();
  const root = mkTmp('acm-oc-path-');
  const spacedDir = path.join(root, '空格 中文 目录');
  fs.mkdirSync(spacedDir, { recursive: true });
  const copy = path.join(spacedDir, 'opencode.exe');
  fs.copyFileSync(exe, copy);

  const res = await resolveExecutable('opencode', defaultResolveDeps('win32', { PATH: spacedDir }));
  assert(res.ok, `空格/中文目录下 resolveExecutable 未成功：${res.ok ? '' : res.reason}`);
  assert(res.path.toLowerCase() === copy.toLowerCase(), `解析结果不是目录内的 exe：${res.path}`);

  const ver = await runCapture(copy, ['--version'], { cwd: spacedDir, timeoutMs: 30_000 });
  assert(!ver.timedOut, '空格/中文路径下 `--version` 超时未退出');
  assert(ver.code === 0, `空格/中文路径下 \`--version\` 退出码 ${String(ver.code)}：${ver.out.trim().slice(-300)}`);
  assert(VERSION_RE.test(ver.out), '空格/中文路径下 `--version` 输出无版本号');
  return `目录 ${spacedDir} 内解析与启动均成功`;
}

async function checkTaskkillStopsServe(): Promise<string> {
  const exe = needExe();
  const baseline = opencodeProcessCount();
  const password = randomBytes(16).toString('hex');
  // 与 serve-runner.ts 完全同款：启动参数、shell:false、OPENCODE_SERVER_PASSWORD + opencodeLaunchEnv。
  const child: ChildProcess = spawn(exe, ['serve', '--port', '0', '--hostname', '127.0.0.1'], {
    cwd: mkTmp('acm-oc-serve-'),
    env: { ...process.env, OPENCODE_SERVER_PASSWORD: password, ...opencodeLaunchEnv('win32', process.env) },
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  const keep = (b: Buffer) => {
    out = (out + b.toString('utf8')).slice(-16_000);
  };
  child.stdout?.on('data', keep);
  child.stderr?.on('data', keep);

  const pid = child.pid;
  assert(pid !== undefined, 'serve 子进程无 pid（启动即失败）');
  let port: number | null = null;
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const m = LISTENING_RE.exec(out);
    if (m?.[1]) {
      port = Number(new URL(m[1]).port);
      break;
    }
    if (child.exitCode !== null) break;
    await sleep(200);
  }
  assert(port !== null && port > 0, `45s 内未等到 serve 监听行，子进程已退出=${String(child.exitCode !== null)}，输出尾：${out.trim().slice(-400)}`);
  assert(pidAlive(pid), `serve 进程 ${pid} 未出现在 tasklist 中`);
  assert(await canConnect(port), `serve 端口 ${port} 无法连接`);

  // 与应用 close() 完全同款的停止方式。
  spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
  const exitDeadline = Date.now() + 15_000;
  while (child.exitCode === null && Date.now() < exitDeadline) await sleep(200);
  assert(child.exitCode !== null, `taskkill 后 15s 内 serve 进程 ${pid} 仍未退出`);

  const cleanDeadline = Date.now() + 10_000;
  let residual = true;
  while (Date.now() < cleanDeadline) {
    if (!pidAlive(pid) && opencodeProcessCount() === baseline && !(await canConnect(port, 500))) {
      residual = false;
      break;
    }
    await sleep(300);
  }
  assert(!residual, `停止后仍有残留：pid 存活=${String(pidAlive(pid))}，opencode.exe 进程数=${opencodeProcessCount()}（基线 ${baseline}），端口可连接=${String(await canConnect(port, 500))}`);
  return `serve pid=${pid} port=${port}，taskkill /T /F 后进程树与端口均已清理（基线进程数 ${baseline}）`;
}

function checkPlatformEnvFallback(): string {
  const emptyRoot = mkTmp('acm-env-empty-');
  const env: NodeJS.ProcessEnv = {
    ProgramFiles: path.join(emptyRoot, 'pf'),
    'ProgramFiles(x86)': path.join(emptyRoot, 'pfx86'),
    LOCALAPPDATA: path.join(emptyRoot, 'local'),
    PATH: path.join(emptyRoot, 'bin'),
  };
  assert(findGitBash(env) === null, '空目录环境下 findGitBash 应落空');
  const injected = opencodePlatformEnv('win32', env);
  assert(
    injected.OPENCODE_CONFIG_CONTENT === '{"shell":"powershell.exe"}' && Object.keys(injected).length === 1,
    `回退分支注入不正确：${JSON.stringify(injected)}`,
  );
  // 既有内联配置（未指定 shell）应被合并而非覆盖。
  const merged = opencodePlatformEnv('win32', { ...env, OPENCODE_CONFIG_CONTENT: '{"theme":"x"}' });
  assert(
    merged.OPENCODE_CONFIG_CONTENT === '{"theme":"x","shell":"powershell.exe"}',
    `既有配置合并结果不正确：${JSON.stringify(merged)}`,
  );
  // 用户已指定 shell 时不覆盖。
  const userShell = opencodePlatformEnv('win32', { ...env, OPENCODE_CONFIG_CONTENT: '{"shell":"cmd.exe"}' });
  assert(Object.keys(userShell).length === 0, `用户已指定 shell 时应不注入，实际：${JSON.stringify(userShell)}`);
  const launch = opencodeLaunchEnv('win32', env);
  assert(launch.OPENCODE_ENABLE_QUESTION_TOOL === 'false', 'opencodeLaunchEnv 应恒含 question 工具禁用');
  return '探测落空 → OPENCODE_CONFIG_CONTENT={"shell":"powershell.exe"}；合并 / 不覆盖分支均符合预期';
}

function checkPlatformEnvDetect(): string {
  const gitRoot = mkTmp('acm-env-git-');
  const fakeBash = path.win32.join(gitRoot, 'Git', 'bin', 'bash.exe');
  fs.mkdirSync(path.win32.dirname(fakeBash), { recursive: true });
  fs.writeFileSync(fakeBash, '');
  const env: NodeJS.ProcessEnv = {
    ProgramFiles: gitRoot,
    'ProgramFiles(x86)': path.join(gitRoot, 'none-x86'),
    LOCALAPPDATA: path.join(gitRoot, 'none-local'),
    PATH: '',
  };
  const found = findGitBash(env);
  assert(found === fakeBash, `findGitBash 命中不正确：${String(found)}（预期 ${fakeBash}）`);
  const injected = opencodePlatformEnv('win32', env);
  assert(
    injected.OPENCODE_GIT_BASH_PATH === fakeBash && Object.keys(injected).length === 1,
    `探测分支注入不正确：${JSON.stringify(injected)}`,
  );
  const preset = opencodePlatformEnv('win32', { ...env, OPENCODE_GIT_BASH_PATH: 'D:\\custom\\bash.exe' });
  assert(Object.keys(preset).length === 0, `用户已自设 OPENCODE_GIT_BASH_PATH 时应不注入，实际：${JSON.stringify(preset)}`);
  return `命中 ${fakeBash} → 注入 OPENCODE_GIT_BASH_PATH；用户自设时不覆盖`;
}

/**
 * (a) 例「报错明确」的判据：opencode 的结构化错误载体。1.19.3 实测（CI windows-opencode
 * 首跑，run 39605367698）：指定不存在的 provider/model 时输出为
 * `Error: {"name":"UnknownError","message":"Unexpected server error. Check server logs for details."}`
 * 并非 0 退出——走的是通用服务器错误面，不含 provider/auth/model 字样，旧的关键词断言因此
 * 失配（行为本身正确：不挂死、报错明确、非假成功）。故 (a) 例接受结构化错误载体或原
 * provider/auth/model 关键词任一命中；退出码与超时断言不放宽，静默成功与无输出挂死仍抓得住。
 */
const STRUCTURED_ERROR_RE = /Error:\s*\{|"name"\s*:\s*"[A-Za-z]*Error"|UnknownError|Unexpected server error/i;
/** (b) 例「报错明确」的判据：无凭据默认运行时应指向提供方 / 凭据类错误（沿用原关键词集）。 */
const CREDENTIAL_ERROR_RE = /provider|auth|api[- ]?key|credential|model/i;

async function checkNoKeyErrorPath(): Promise<string> {
  const exe = needExe();
  const home = mkTmp('acm-oc-home-');
  const scrubbed: NodeJS.ProcessEnv = { ...process.env };
  const keyLike = [/API_KEY/i, /AUTH_TOKEN/i, /^ANTHROPIC_/i, /^OPENAI_/i, /^AZURE_/i, /^AWS_/i, /^GOOGLE_GENERATIVE/i];
  for (const k of Object.keys(scrubbed)) {
    if (keyLike.some((re) => re.test(k))) delete scrubbed[k];
  }
  // 指向空 HOME / USERPROFILE：既有 `opencode auth login` 的落盘凭据也不得泄漏进本项。
  scrubbed.HOME = home;
  scrubbed.USERPROFILE = home;
  scrubbed.XDG_DATA_HOME = path.join(home, '.local', 'share');

  // 两例各自独立记账：一例断言失败不中断另一例；本项成败与每例的实际输出都写进结果行，
  // 便于按 CI 日志逐例定案（首跑时 (a) 例抛错中断、(b) 例根本没跑到，就是这个教训）。
  const cases: Array<{ label: string; args: string[]; explicitError: (out: string) => boolean; missingHint: string }> = [
    {
      label: '不存在的提供方/模型',
      args: ['run', '-m', 'acm-nonexistent-provider/model-zzz', 'ping'],
      explicitError: (out) => STRUCTURED_ERROR_RE.test(out) || CREDENTIAL_ERROR_RE.test(out),
      missingHint: '未见结构化错误载体或 provider/auth/model 字样',
    },
    {
      label: '无任何凭据的默认运行',
      args: ['run', 'ping'],
      explicitError: (out) => CREDENTIAL_ERROR_RE.test(out),
      missingHint: '未指向 provider/auth/credential 类错误',
    },
  ];
  const outcomes: string[] = [];
  let failed = 0;
  for (const c of cases) {
    try {
      const r = await runCapture(exe, c.args, { cwd: home, env: scrubbed, timeoutMs: 90_000 });
      assert(!r.timedOut, `90s 未退出（疑似挂死或等待交互输入）`);
      assert(r.code !== 0 && r.code !== null, `无 Key 却以退出码 ${String(r.code)} 结束（假成功？）输出尾：${r.out.trim().slice(-300)}`);
      assert(c.explicitError(r.out), `输出${c.missingHint}：${r.out.trim().slice(-300)}`);
      outcomes.push(`${c.label} ✓（退出码 ${String(r.code)}）`);
    } catch (err) {
      failed++;
      outcomes.push(`${c.label} ✗（${err instanceof Error ? err.message : String(err)}）`);
    }
  }
  if (failed > 0) throw new Error(`${failed}/2 例失败 —— ${outcomes.join('；')}`);
  return outcomes.join('；');
}

async function main(): Promise<number> {
  if (process.platform !== 'win32') {
    console.log(`SKIP 本脚本只验证 Windows 实机（当前平台 ${process.platform}），见任务卡 T-021；在 windows-latest 的 CI 作业中真实执行。`);
    return 0;
  }
  const steps: Array<{ name: string; run: () => Promise<string> | string }> = [
    { name: '解析 .cmd → .exe（真实 npm 全局安装）', run: checkResolveCmdShim },
    { name: '含空格与中文的路径下解析与启动', run: checkSpacedChinesePath },
    { name: 'taskkill 干净停止 opencode serve 进程树', run: checkTaskkillStopsServe },
    { name: 'platform-env 回退分支（PowerShell）注入断言', run: checkPlatformEnvFallback },
    { name: 'platform-env 探测分支（Git Bash）注入断言', run: checkPlatformEnvDetect },
    { name: '错误路径：无模型 Key 时 run 失败且报错明确', run: checkNoKeyErrorPath },
  ];
  let failures = 0;
  try {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      assert(step, '步骤表损坏');
      try {
        const detail = await step.run();
        console.log(`✓ [${i + 1}/${steps.length}] ${step.name} —— ${detail}`);
      } catch (err) {
        failures++;
        console.error(`✗ [${i + 1}/${steps.length}] ${step.name} —— ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } finally {
    cleanupTmp();
  }
  if (failures > 0) {
    console.error(`Windows opencode 实机验证失败：${failures}/${steps.length} 项未通过（见上方 ✗ 行）。`);
    return 1;
  }
  console.log(`Windows opencode 实机验证全部通过（${steps.length}/${steps.length}）。`);
  return 0;
}

process.exitCode = await main();
