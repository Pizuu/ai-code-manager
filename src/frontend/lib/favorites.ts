/**
 * 回答收藏（纯前端状态）：收藏的 assistant 回答存 localStorage，跨会话/重启保留。
 * chat 的收藏按钮与 shell 的收藏栏共用本模块，变更经 onFavoritesChanged 广播。
 * 存储不可用（如测试环境无 localStorage）时退化为内存态，不抛错。
 * 落盘为批量合并：变更先落内存态并立即广播，写入经微任务合并（同一拍多次变更只写一次）；
 * 页面关闭 / 隐藏前若有待写数据，同步冲刷一次兜底。
 */
export interface Favorite {
  /** `${sessionId}:${messageId}`，同一回答唯一。 */
  id: string;
  sessionId: string;
  sessionTitle: string;
  /** 回答全文（收藏栏展示时截断，跳转靠 sessionId）。 */
  text: string;
  /** 收藏时间（epoch ms）。 */
  at: number;
}

const KEY = 'acm.favorites.v1';
/** 收藏条数上限；新增超出时按收藏时间丢弃最旧的条目。 */
const MAX_FAVORITES = 300;

let cache: Favorite[] | null = null;
const listeners = new Set<() => void>();

/** 存量条目的形状校验：id/sessionId/text 须为字符串、at 须为有限数，不合者视为损坏丢弃。 */
function isValidStored(f: unknown): f is { id: string; sessionId: string; text: string; at: number; sessionTitle?: unknown } {
  if (!f || typeof f !== 'object') return false;
  const s = f as Record<string, unknown>;
  return typeof s.id === 'string'
    && typeof s.sessionId === 'string'
    && typeof s.text === 'string'
    && typeof s.at === 'number' && Number.isFinite(s.at);
}

function load(): Favorite[] {
  if (cache) return cache;
  let raw: string | null;
  try {
    raw = globalThis.localStorage?.getItem(KEY) ?? null;
  } catch {
    raw = null;
  }
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  cache = Array.isArray(parsed)
    ? parsed.filter(isValidStored)
      .map((f) => ({
        id: f.id,
        sessionId: f.sessionId,
        sessionTitle: typeof f.sessionTitle === 'string' ? f.sessionTitle : '',
        text: f.text,
        at: f.at,
      }))
    : [];
  return cache;
}

/** 有未落盘变更（落盘失败时保持为 true，下次变更 / 冲刷以全量序列化重试）。 */
let writePending = false;
/** 合并写入的微任务已排队。 */
let writeScheduled = false;
let flushHooksInstalled = false;

/** 同步写一次当前内存态；存储不可用 / 抛错时吞掉，内存态不受影响。 */
function flushPendingWrite(): void {
  if (!writePending) return;
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(cache ?? []));
    writePending = false;
  } catch {
    /* 存储不可用：仅内存态，保留待写标记待重试 */
  }
}

/** 页面关闭 / 隐藏前兜底冲刷；环境不支持事件时静默跳过（如测试环境）。 */
function installFlushHooks(): void {
  if (flushHooksInstalled) return;
  flushHooksInstalled = true;
  try {
    globalThis.addEventListener?.('beforeunload', flushPendingWrite);
  } catch { /* 环境不支持：无此兜底 */ }
  try {
    globalThis.document?.addEventListener?.('visibilitychange', () => {
      if (globalThis.document?.visibilityState === 'hidden') flushPendingWrite();
    });
  } catch { /* 环境不支持：无此兜底 */ }
}

/** 安排一次合并落盘：同一拍内的多次变更只在微任务里写一次。 */
function schedulePersist(): void {
  writePending = true;
  installFlushHooks();
  if (writeScheduled) return;
  writeScheduled = true;
  queueMicrotask(() => {
    writeScheduled = false;
    flushPendingWrite();
  });
}

function changed(): void {
  schedulePersist();
  for (const cb of [...listeners]) cb();
}

export function favoriteId(sessionId: string, messageId: string): string {
  return `${sessionId}:${messageId}`;
}

/** 按收藏时间倒序（最新在前）。 */
export function listFavorites(): Favorite[] {
  return [...load()].sort((a, b) => b.at - a.at);
}

export function isFavorite(id: string): boolean {
  return load().some((f) => f.id === id);
}

/** 切换收藏状态，返回切换后是否为已收藏。同 id 重复收藏只保留一条（刷新内容与时间）。 */
export function toggleFavorite(fav: Favorite): boolean {
  const list = load();
  fav = { ...fav, sessionTitle: fav.sessionTitle.trim(), text: fav.text.trim() };
  const i = list.findIndex((f) => f.id === fav.id);
  if (i >= 0) {
    list.splice(i, 1);
    changed();
    return false;
  }
  list.push(fav);
  if (list.length > MAX_FAVORITES) {
    // 超上限：按收藏时间从旧到新裁掉多余条目（刚新增的这条不裁）。
    let excess = list.length - MAX_FAVORITES;
    const oldestFirst = [...list].sort((a, b) => a.at - b.at);
    for (const old of oldestFirst) {
      if (excess <= 0) break;
      if (old.id === fav.id) continue;
      const j = list.findIndex((f) => f.id === old.id);
      if (j >= 0) {
        list.splice(j, 1);
        excess -= 1;
      }
    }
  }
  changed();
  return true;
}

export function removeFavorite(id: string): void {
  const list = load();
  const i = list.findIndex((f) => f.id === id);
  if (i < 0) return;
  list.splice(i, 1);
  changed();
}

/** 订阅收藏变更，返回退订函数。 */
export function onFavoritesChanged(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
