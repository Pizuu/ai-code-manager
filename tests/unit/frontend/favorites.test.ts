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
