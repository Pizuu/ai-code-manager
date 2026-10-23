/**
 * 消息收藏（纯前端状态）：保存消息快照存 localStorage，跨会话/重启保留。
 * chat 的收藏按钮与 shell 的收藏栏共用本模块，变更经 onFavoritesChanged 广播。
 * 存储不可用（如测试环境无 localStorage）时退化为内存态，不抛错。
 * 落盘为批量合并：变更先落内存态并立即广播，写入经微任务合并（同一拍多次变更只写一次）；
 * 页面关闭 / 隐藏前若有待写数据，同步冲刷一次兜底。
 */
export interface Favorite {
  /** `${sessionId}:${messageId}`，同一来源消息唯一。 */
  id: string;
  sessionId: string;
  sessionTitle: string;
  /** 消息快照全文（收藏栏展示时截断，跳转靠 sessionId 与 messageId）。 */
  text: string;
  /** 收藏时间（epoch ms）。 */
  at: number;
  /** 来源消息 id（可缺省：旧条目从 id 推导，任意选中文字可能没有所属消息）。 */
  messageId?: string;
  /** 收藏的是选中的一段文字时为 true：跳转时高亮这段文字。 */
  quote?: boolean;
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
        ...(typeof (f as Record<string, unknown>).messageId === 'string' ? { messageId: (f as Record<string, unknown>).messageId as string } : {}),
        ...((f as Record<string, unknown>).quote === true ? { quote: true } : {}),
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

/** 选中文字收藏的 id：同一来源（消息或会话）下按文字内容去重。 */
export function quoteFavoriteId(sessionId: string, messageId: string | undefined, text: string): string {
  let h = 0;
  for (const ch of text.trim().replace(/\s+/g, ' ')) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return `${sessionId}:${messageId ?? '-'}:q${h.toString(36)}`;
}

/** 收藏条目的来源消息 id：优先显式字段，否则从 `${sessionId}:${messageId}` 推导。 */
export function favoriteMessageId(f: Favorite): string | undefined {
  if (f.messageId) return f.messageId;
  const rest = f.id.slice(f.sessionId.length + 1);
  return rest && !rest.includes(':') ? rest : undefined;
}

/** 只添加不切换：已存在返回 false。 */
export function addFavorite(fav: Favorite): boolean {
  if (isFavorite(fav.id)) return false;
  return toggleFavorite(fav);
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
  if (!fav.text) return false;
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

/** 编辑已保存的收藏快照，不修改来源会话中的原始消息；两端空白去除，空文本拒绝保存。 */
export function updateFavorite(id: string, text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  const favorite = load().find((item) => item.id === id);
  if (!favorite) return false;
  if (favorite.text === normalized) return true;
  favorite.text = normalized;
  changed();
  return true;
}

/** 订阅收藏变更，返回退订函数。 */
export function onFavoritesChanged(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
