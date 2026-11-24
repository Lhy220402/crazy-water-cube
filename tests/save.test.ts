import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SAVE_CODE_PREFIX,
  decodeSaveBundle,
  encodeSaveBundle,
  readSaveBundle,
  summarizeSaveBundle,
  writeSaveBundle,
} from '../src/ui/save-transfer.ts';
import type { KV } from '../src/ui/storage.ts';

function kvOf(entries: Record<string, string> = {}): KV {
  const map = new Map(Object.entries(entries));
  return {
    get: (key) => map.get(key) ?? null,
    set: (key, value) => {
      map.set(key, value);
    },
    remove: (key) => {
      map.delete(key);
    },
  };
}

const bundle = {
  game: JSON.stringify({
    v: 3,
    size: 4,
    ranks: [6, null],
    variants: ['yingtao', null],
    buffs: [{ id: 'ji-ying-ying', label: '记赢赢·长赢', mult: 2, movesLeft: -1 }],
  }),
  best: '4096',
  codex: JSON.stringify({ yingtao: 2, meihui: 1, ji: 3 }),
};

test('存档码：导出 / 导入往返一致，中文与 emoji 不丢', () => {
  const code = encodeSaveBundle(bundle);
  assert.ok(code.startsWith(SAVE_CODE_PREFIX));
  assert.equal(/^[A-Za-z0-9._-]+$/.test(code), true, '存档码只含安全字符');
  assert.deepEqual(decodeSaveBundle(code), bundle);
  // 前后空白 / 微信换行不影响
  assert.deepEqual(decodeSaveBundle(`\n ${code} \n`), bundle);
  const decoded = decodeSaveBundle(code);
  assert.ok(decoded);
  assert.equal(decoded.game?.includes('记赢赢·长赢'), true);
});

test('存档码：空字段也能往返（只导最高分 / 只有图鉴）', () => {
  const onlyBest = { game: null, best: '12', codex: null };
  assert.deepEqual(decodeSaveBundle(encodeSaveBundle(onlyBest)), onlyBest);
  const empty = { game: null, best: null, codex: null };
  assert.deepEqual(decodeSaveBundle(encodeSaveBundle(empty)), empty);
});

test('存档码：坏输入全部拒绝', () => {
  const good = encodeSaveBundle(bundle);
  assert.equal(decodeSaveBundle(''), null);
  assert.equal(decodeSaveBundle('hello'), null);
  assert.equal(decodeSaveBundle('JWC2.abc'), null);
  assert.equal(decodeSaveBundle(`${SAVE_CODE_PREFIX}not-base64!!`), null);
  assert.equal(decodeSaveBundle(good.slice(0, -3)), null, '截断的存档码应拒绝');
  // 合法 base64 但 JSON 结构不对
  const badJson = `${SAVE_CODE_PREFIX}${Buffer.from('{"v":2}').toString('base64url')}`;
  assert.equal(decodeSaveBundle(badJson), null);
  const badBest = `${SAVE_CODE_PREFIX}${Buffer.from(JSON.stringify({ v: 1, game: null, best: 'abc', codex: null })).toString('base64url')}`;
  assert.equal(decodeSaveBundle(badBest), null);
  const badCodex = `${SAVE_CODE_PREFIX}${Buffer.from(JSON.stringify({ v: 1, game: null, best: '1', codex: '[]' })).toString('base64url')}`;
  assert.equal(decodeSaveBundle(badCodex), null);
});

test('存档读写：只碰 game / best / codex 三个 key', () => {
  const kv = kvOf({
    jun2048: 'game-old',
    'jun2048.best': '9',
    'jun2048.codex': '{"sui":1}',
    'jun2048.theme': 'dark',
    'jun2048.sound': 'off',
    'jun2048.version': '3.0.2',
  });
  assert.deepEqual(readSaveBundle(kv, 'jun2048'), {
    game: 'game-old',
    best: '9',
    codex: '{"sui":1}',
  });
  writeSaveBundle(kv, 'jun2048', { game: 'game-new', best: '10', codex: '{"ji":2}' });
  assert.equal(kv.get('jun2048'), 'game-new');
  assert.equal(kv.get('jun2048.best'), '10');
  assert.equal(kv.get('jun2048.codex'), '{"ji":2}');
  assert.equal(kv.get('jun2048.theme'), 'dark', '主题偏好不受影响');
  assert.equal(kv.get('jun2048.sound'), 'off', '声音偏好不受影响');
  assert.equal(kv.get('jun2048.version'), '3.0.2', '版本记录不受影响');
  // 字段为 null 时删除对应 key，不留下空字符串
  writeSaveBundle(kv, 'jun2048', { game: null, best: null, codex: null });
  assert.equal(kv.get('jun2048'), null);
  assert.equal(kv.get('jun2048.best'), null);
  assert.equal(kv.get('jun2048.codex'), null);
});

test('导入摘要：最高分与图鉴条数', () => {
  assert.equal(summarizeSaveBundle(bundle), '最高分 4096 · 图鉴 3 条');
  assert.equal(summarizeSaveBundle({ game: null, best: null, codex: null }), '最高分 0 · 图鉴 0 条');
  assert.equal(
    summarizeSaveBundle({ game: null, best: 'not-a-number', codex: '{"bad":0}' }),
    '最高分 0 · 图鉴 0 条',
  );
});
