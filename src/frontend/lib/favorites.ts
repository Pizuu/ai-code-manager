/**
 * 回答收藏（纯前端状态）：收藏的 assistant 回答存 localStorage，跨会话/重启保留。
 * chat 的收藏按钮与 shell 的收藏栏共用本模块，变更经 onFavoritesChanged 广播。
 * 存储不可用（如测试环境无 localStorage）时退化为内存态，不抛错。
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

let cache: Favorite[] | null = null;
const listeners = new Set<() => void>();

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
  type StoredFavorite = { id: string; sessionId: string; text: string; sessionTitle?: string; at?: number };
  cache = Array.isArray(parsed)
    ? parsed.filter((f): f is StoredFavorite =>
      !!f && typeof f === 'object'
      && typeof (f as StoredFavorite).id === 'string'
      && typeof (f as StoredFavorite).sessionId === 'string'
      && typeof (f as StoredFavorite).text === 'string')
      .map((f) => ({ id: f.id, sessionId: f.sessionId, sessionTitle: f.sessionTitle ?? '', text: f.text, at: f.at ?? 0 }))
    : [];
  return cache;
}

function persist(): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(cache ?? []));
  } catch {
    /* 存储不可用：仅内存态 */
  }
}

function changed(): void {
  persist();
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
  const i = list.findIndex((f) => f.id === fav.id);
  if (i >= 0) {
    list.splice(i, 1);
    changed();
    return false;
  }
  list.push(fav);
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
