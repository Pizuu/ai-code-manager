import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  favoriteId, isFavorite, listFavorites, onFavoritesChanged, removeFavorite, toggleFavorite,
  type Favorite,
} from '../../../src/frontend/lib/favorites.ts';

const fav = (id: string, at: number): Favorite => ({
  id, sessionId: 's1', sessionTitle: '会话', text: `回答 ${id}`, at,
});

test('favoriteId 由 sessionId 与 messageId 组成', () => {
  assert.equal(favoriteId('sess', 'msg'), 'sess:msg');
});

test('toggleFavorite 收藏/取消往返，isFavorite 同步', () => {
  const f = fav('s1:m1', 100);
  assert.equal(isFavorite(f.id), false);
  assert.equal(toggleFavorite(f), true);
  assert.equal(isFavorite(f.id), true);
  assert.equal(toggleFavorite(f), false);
  assert.equal(isFavorite(f.id), false);
});

test('listFavorites 按收藏时间倒序，removeFavorite 删除指定条', () => {
  toggleFavorite(fav('s1:a', 1));
  toggleFavorite(fav('s1:b', 3));
  toggleFavorite(fav('s1:c', 2));
  assert.deepEqual(listFavorites().map((f) => f.id), ['s1:b', 's1:c', 's1:a']);
  removeFavorite('s1:c');
  assert.deepEqual(listFavorites().map((f) => f.id), ['s1:b', 's1:a']);
  removeFavorite('s1:不存在');
  assert.equal(listFavorites().length, 2);
});

test('变更订阅：toggle/remove 触发通知，退订后不再触发', () => {
  let n = 0;
  const off = onFavoritesChanged(() => { n += 1; });
  toggleFavorite(fav('s1:x', 9));
  assert.equal(n, 1);
  removeFavorite('s1:x');
  assert.equal(n, 2);
  off();
  toggleFavorite(fav('s1:y', 10));
  assert.equal(n, 2);
  removeFavorite('s1:y');
});

/* ── 落盘合并 / 上限 / 加载校验：每例用带查询串的动态 import 取独立模块实例（各自 cache），互不干扰 ── */

interface FavoritesModule {
  favoriteId: typeof favoriteId;
  isFavorite: typeof isFavorite;
  listFavorites: typeof listFavorites;
  onFavoritesChanged: typeof onFavoritesChanged;
  removeFavorite: typeof removeFavorite;
  toggleFavorite: typeof toggleFavorite;
}

const freshFavorites = async (tag: string): Promise<FavoritesModule> => {
  const spec = `../../../src/frontend/lib/favorites.ts?test=${tag}`;
  return (await import(spec)) as FavoritesModule;
};

interface FakeStorage {
  value: string | null;
  setCount: number;
  getItem: () => string | null;
  setItem: (_key: string, v: string) => void;
  removeItem: () => void;
}

const makeStorage = (initial: string | null): FakeStorage => {
  const fake: FakeStorage = {
    value: initial,
    setCount: 0,
    getItem: () => fake.value,
    setItem: (_key, v) => { fake.setCount += 1; fake.value = v; },
    removeItem: () => { fake.value = null; },
  };
  return fake;
};

const installStorage = (fake: FakeStorage): void => {
  (globalThis as { localStorage?: unknown }).localStorage = fake;
};

/** 等一拍（宏任务），确保合并落盘的微任务已执行完。 */
const tick = (): Promise<void> => new Promise((r) => { setTimeout(r, 0); });

const favN = (id: string, at: number): Favorite => ({
  id, sessionId: id.split(':')[0] ?? 's', sessionTitle: '会话', text: `回答 ${id}`, at,
});

test('合并落盘：同一拍多次 toggle/remove 只 setItem 一次，广播仍即时逐次触发', async () => {
  const mod = await freshFavorites('batch');
  const fake = makeStorage(null);
  installStorage(fake);
  let broadcasts = 0;
  mod.onFavoritesChanged(() => { broadcasts += 1; });
  mod.toggleFavorite(favN('batch:a', 1));
  mod.toggleFavorite(favN('batch:b', 2));
  mod.toggleFavorite(favN('batch:c', 3));
  mod.removeFavorite('batch:a');
  mod.toggleFavorite(favN('batch:d', 4));
  assert.equal(broadcasts, 5); // 内存态与广播不延迟
  assert.equal(fake.setCount, 0); // 落盘已合并、尚未写
  await tick();
  assert.equal(fake.setCount, 1);
  const stored = JSON.parse(fake.value ?? '[]') as Favorite[];
  assert.deepEqual(stored.map((f) => f.id), ['batch:b', 'batch:c', 'batch:d']);
});

test('上限 300 条：超出时按收藏时间裁掉最旧的，刚新增的保留', async () => {
  const mod = await freshFavorites('cap');
  installStorage(makeStorage(null));
  for (let i = 1; i <= 305; i += 1) mod.toggleFavorite(favN(`cap:m${i}`, i));
  const list = mod.listFavorites();
  assert.equal(list.length, 300);
  for (const dropped of ['cap:m1', 'cap:m2', 'cap:m3', 'cap:m4', 'cap:m5']) {
    assert.equal(mod.isFavorite(dropped), false, `${dropped} 应被裁掉`);
  }
  assert.equal(mod.isFavorite('cap:m6'), true);
  assert.equal(mod.isFavorite('cap:m305'), true);
  assert.equal(list[0]?.id, 'cap:m305');
  assert.equal(list[list.length - 1]?.id, 'cap:m6');
});

test('加载校验：存量混入损坏条目时只丢损坏条，其余正常加载', async () => {
  const mod = await freshFavorites('mixed');
  const stored: unknown[] = [
    { id: 's9:m1', sessionId: 's9', sessionTitle: '标题', text: '正文', at: 42 },
    { id: 's9:m2', sessionId: 's9', text: '无标题条', at: 7 }, // sessionTitle 可缺省
    null,
    'not-an-object',
    42,
    {},
    { id: 's9:缺text', sessionId: 's9', at: 1 },
    { id: 123, sessionId: 's9', text: 'id 非字符串', at: 1 },
    { sessionId: 's9', text: '缺 id', at: 1 },
    { id: 's9:at字符串', sessionId: 's9', text: 'x', at: '42' },
    { id: 's9:at为null', sessionId: 's9', text: 'x', at: null },
    { id: 's9:at缺失', sessionId: 's9', text: 'x' },
    { id: 's9:sessionId缺失', text: 'x', at: 1 },
  ];
  installStorage(makeStorage(JSON.stringify(stored)));
  const list = mod.listFavorites();
  assert.deepEqual(list.map((f) => f.id), ['s9:m1', 's9:m2']);
  assert.equal(list[0]?.sessionTitle, '标题');
  assert.equal(list[1]?.sessionTitle, '');
});

test('加载校验：整体 JSON 损坏时回退空列表，之后仍可正常收藏', async () => {
  const mod = await freshFavorites('corrupt');
  const fake = makeStorage('{broken json');
  installStorage(fake);
  assert.deepEqual(mod.listFavorites(), []);
  assert.equal(mod.toggleFavorite(favN('s7:m1', 5)), true);
  assert.equal(mod.isFavorite('s7:m1'), true);
  await tick();
  const stored = JSON.parse(fake.value ?? '[]') as Favorite[];
  assert.deepEqual(stored.map((f) => f.id), ['s7:m1']);
});

test('落盘抛错（配额满）不打断 toggle：内存态与广播照常', async () => {
  const mod = await freshFavorites('quota');
  const fake = makeStorage(null);
  fake.setItem = () => { throw new Error('QuotaExceededError'); };
  installStorage(fake);
  let broadcasts = 0;
  mod.onFavoritesChanged(() => { broadcasts += 1; });
  assert.equal(mod.toggleFavorite(favN('s8:m1', 1)), true);
  assert.equal(mod.isFavorite('s8:m1'), true);
  assert.equal(broadcasts, 1);
  await tick(); // 微任务里的落盘失败也必须被吞掉，不能变成未捕获异常
  assert.equal(mod.isFavorite('s8:m1'), true);
});

