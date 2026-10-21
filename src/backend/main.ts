/**
 * Electron 主进程入口：安全窗口（宪法 十二）、app:// 协议提供界面文件、IPC 注册、主题跟随系统。
 */
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, net, protocol, safeStorage, shell } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AgentEvent, IpcInvokeChannel } from '../../contracts/ipc.ts';
import { AGENT_EVENT_CHANNEL } from '../../contracts/ipc.ts';
import { AppState } from './app-state.ts';
import { createHandlers } from './ipc/handlers.ts';
import { ActivateGate } from './notify/activate-gate.ts';
import { createElectronNotifier } from './notify/electron-notifier.ts';
import { NotifyService } from './notify/notify-service.ts';
import { AcpProcessManager } from './agent-cli/acp-runner.ts';
import { OpencodeServeManager } from './agent-cli/serve-runner.ts';
import { SessionStore } from './sessions/session-store.ts';
import { SettingsStore, type KeyCipher } from './settings/settings-store.ts';
import { resolveInsideRoot } from './tools/sandbox.ts';
import { TerminalManager } from './terminal/terminal-manager.ts';
import { createGitRunner } from './workspace/git.ts';
import { watchRefs } from './workspace/refs-watcher.ts';

const APP_SCHEME = 'app';
const APP_HOST = 'bundle';
const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
const ENTRY_URL = `${APP_ORIGIN}/src/frontend/index.html`;
/** app:// 只允许读取这些目录（相对应用根）。 */
const SERVED_PREFIXES = ['src/frontend/', 'dist/src/frontend/', 'dist/contracts/'];

protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const safeStorageCipher: KeyCipher = {
  isAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
  decrypt: (enc) => safeStorage.decryptString(Buffer.from(enc, 'base64')),
};

let mainWindow: BrowserWindow | null = null;

/** T-053：通知激活就绪门（bootstrap 内构造）。通知点击的 notify-activate 经它出口：
 *  渲染层未就绪时暂存最新一次、就绪后补发，避免冷启动 / 页面重载窗口期内点击丢失。 */
let activateGate: ActivateGate | null = null;

function emit(event: AgentEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(AGENT_EVENT_CHANNEL, event);
}

function registerAppProtocol(): void {
  const appRoot = app.getAppPath();
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (url.host !== APP_HOST || !SERVED_PREFIXES.some((p) => rel.startsWith(p))) {
      return new Response('Not found', { status: 404 });
    }
    try {
      const abs = resolveInsideRoot(appRoot, rel);
      return await net.fetch(pathToFileURL(abs).toString());
    } catch (err) {
      return new Response(`Bad request: ${(err as Error).message}`, { status: 400 });
    }
  });
}

function createWindow(): BrowserWindow {
  // T-053：新窗口（含 macOS activate 重建）的渲染层必然未就绪，先同步复位就绪门；
  // 同一窗口的页面重载走 did-start-loading 复位（初始加载时复位是无害的空操作）。
  activateGate?.reset();
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    // 启动全屏（用户要求）；上面的尺寸是退出全屏时的兜底。
    // resizable 构造期不能设 false：Windows 上无 WS_THICKFRAME 的窗口进不了全屏，
    // 改为进入全屏后再锁定禁止改变大小（见下方 enter-full-screen 处理）。
    fullscreen: true,
    title: 'AI Code Manager',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1f22' : '#ffffff',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => {
    // 延迟显示（show:false）时构造期的 fullscreen 可能不被应用，显示前再显式设一次兜底。
    win.setFullScreen(true);
    win.show();
  });
  // 进入全屏后才禁止改变窗口大小：全屏本身无边框不可拖拽，锁定后即使退出全屏也保持不可缩放；
  // 若在进入全屏前就锁定（resizable:false），Windows 会因缺少 WS_THICKFRAME 而拒绝全屏。
  win.on('enter-full-screen', () => win.setResizable(false));
  win.webContents.on('did-start-loading', () => activateGate?.reset());
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== ENTRY_URL) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  void win.loadURL(ENTRY_URL);
  return win;
}

async function restoreLastProject(settings: SettingsStore, state: AppState): Promise<void> {
  const last = settings.getActive().lastProjectPath;
  if (!last) return;
  try {
    if ((await fs.stat(last)).isDirectory()) state.setProject(last);
  } catch (err) {
    console.warn(`上次打开的项目不可用：${(err as Error).message}`);
  }
}

async function bootstrap(): Promise<void> {
  nativeTheme.themeSource = 'system';
  registerAppProtocol();

  const userData = app.getPath('userData');
  const settings = new SettingsStore(path.join(userData, 'settings.json'), safeStorageCipher);
  try {
    await settings.load();
  } catch (err) {
    dialog.showErrorBox('设置已重置', (err as Error).message);
  }
  const sessions = new SessionStore(path.join(userData, 'sessions'));
  const state = new AppState();
  await restoreLastProject(settings, state);

  // T127（实验）：opencode serve 常驻进程在退出时结束进程树
  const serveManager = new OpencodeServeManager({ platform: process.platform });
  app.on('will-quit', () => serveManager.closeAll());
  // opencode ACP 进程池（默认通道）：退出时统一结束
  const acpManager = new AcpProcessManager({ platform: process.platform });
  app.on('will-quit', () => acpManager.closeAll());
  // v1.6：任务会话「终端模式」的终端进程池：退出时统一结束
  // 输出与退出经 agent:event 推给渲染进程（契约 v1.6 的 terminal-data / terminal-exit）。
  const terminalManager = new TerminalManager({
    platform: process.platform,
    onData: (sessionId, terminalId, data) => emit({ type: 'terminal-data', sessionId, terminalId, data }),
    onExit: (sessionId, terminalId, code) => emit({ type: 'terminal-exit', sessionId, terminalId, code }),
  });
  app.on('will-quit', () => terminalManager.closeAll());
  // 功能 005（T-047）：主进程通知服务。窗口聚焦判定 / 聚焦走既有 mainWindow 管理（闭包懒读，
  // handlers 在窗口创建前注册也不受影响）；点击通知只聚焦 + 回传 notify-activate，不带审批动作。
  // T-053：服务的 emit 只发 notify-activate，统一经就绪门出口（未就绪暂存、就绪补发一次）；
  // handlers 与其余 agent:event 不经此门，保持即发即弃。
  const gate = new ActivateGate(emit);
  activateGate = gate;
  const notifyService = new NotifyService({
    notifier: createElectronNotifier(),
    isWindowFocused: () => Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()),
    focusWindow: () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    },
    emit: (event) => gate.activate(event),
    getSettings: () => settings.getNotifySettings(),
  });
  app.on('will-quit', () => notifyService.dispose());
  const handlers = createHandlers({
    notifyService,
    serveManager,
    acpManager,
    terminalManager,
    settings,
    sessions,
    state,
    emit,
    platform: process.platform,
    pickDirectory: async () => {
      const opts = { title: '选择项目文件夹', properties: ['openDirectory' as const] };
      const res = mainWindow ? await dialog.showOpenDialog(mainWindow, opts) : await dialog.showOpenDialog(opts);
      return res.canceled ? null : (res.filePaths[0] ?? null);
    },
    pickFiles: async () => {
      const opts = { title: '选择文件', properties: ['openFile' as const, 'multiSelections' as const] };
      const res = mainWindow ? await dialog.showOpenDialog(mainWindow, opts) : await dialog.showOpenDialog(opts);
      return res.canceled ? [] : res.filePaths;
    },
    openPath: async (p) => {
      await shell.openPath(p);
    },
  });
  for (const channel of Object.keys(handlers) as IpcInvokeChannel[]) {
    const handler = handlers[channel] as (...args: unknown[]) => Promise<unknown>;
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      // 只接受来自本应用界面的调用
      if (!event.senderFrame?.url.startsWith(`${APP_ORIGIN}/`)) throw new Error('E_VALIDATION: 非法的调用来源');
      // T-053 就绪信号：前端 bootstrap 在 api.onEvent 订阅注册之后必达 sessions:get（有会话时
      // selectSession）或 sessions:create（无会话时）之一，且发出时首轮数据已加载完成——调用
      // 到达即证明订阅已活，此时补发暂存的 notify-activate（论证见 notify/activate-gate.ts）。
      if (channel === 'sessions:get' || channel === 'sessions:create') gate.markReady();
      return handler(...args);
    });
  }

  mainWindow = createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });

  // P1-8：监听项目 git 引用变化（分支增删 / 移动 / 切换 HEAD）→ 通知渲染进程重拉看板与 Git 快照。
  // 只读轮询，不修改仓库；窗口获得焦点时渲染进程也会主动刷新一次。
  const stopRefsWatcher = watchRefs(
    (root) => createGitRunner(root),
    () => state.project?.root ?? null,
    () => emit({ type: 'git-changed' }),
  );
  app.on('will-quit', stopRefsWatcher);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.whenReady().then(bootstrap).catch((err: unknown) => {
    dialog.showErrorBox('启动失败', err instanceof Error ? err.message : String(err));
    app.quit();
  });
}
