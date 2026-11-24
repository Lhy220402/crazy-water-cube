import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEV_SAVE_CODE,
  devKey,
  isDevSaveCode,
  readDevMode,
  writeDevMode,
} from '../src/ui/dev.ts';
import type { KV } from '../src/ui/storage.ts';

function kvOf(entries: Record<string, string> = {}): KV & { raw(): Map<string, string> } {
  const map = new Map(Object.entries(entries));
  return {
    get: (key) => map.get(key) ?? null,
    set: (key, value) => {
      map.set(key, value);
    },
    remove: (key) => {
      map.delete(key);
    },
    raw: () => map,
  };
}

test('开发者魔法码：识别大小写与空白，普通存档码不误判', () => {
  assert.equal(isDevSaveCode(DEV_SAVE_CODE), true);
  assert.equal(isDevSaveCode(`  ${DEV_SAVE_CODE}  `), true);
  assert.equal(isDevSaveCode('jwc1.dev-2048'), true, '大小写不敏感');
  assert.equal(isDevSaveCode(''), false);
  assert.equal(isDevSaveCode('JWC1.DEV'), false);
  assert.equal(isDevSaveCode('JWC1.abc'), false);
  assert.equal(isDevSaveCode('hello'), false);
});

test('开发者状态：没有 key = 未解锁；on / off 都算解锁过', () => {
  const empty = kvOf();
  assert.deepEqual(readDevMode(empty, 'jun2048'), { unlocked: false, enabled: false });
  assert.equal(devKey('jun2048'), 'jun2048.dev');

  const on = kvOf({ 'jun2048.dev': 'on' });
  assert.deepEqual(readDevMode(on, 'jun2048'), { unlocked: true, enabled: true });

  const off = kvOf({ 'jun2048.dev': 'off' });
  assert.deepEqual(readDevMode(off, 'jun2048'), { unlocked: true, enabled: false });

  // 兼容手工写入的其它值：只要存在就视为解锁并开启
  const other = kvOf({ 'jun2048.dev': '1' });
  assert.deepEqual(readDevMode(other, 'jun2048'), { unlocked: true, enabled: true });
});

test('开发者状态：写入 on / off，未解锁时删除 key', () => {
  const kv = kvOf();
  writeDevMode(kv, 'jun2048', { unlocked: true, enabled: true });
  assert.equal(kv.get('jun2048.dev'), 'on');
  writeDevMode(kv, 'jun2048', { unlocked: true, enabled: false });
  assert.equal(kv.get('jun2048.dev'), 'off');
  writeDevMode(kv, 'jun2048', { unlocked: false, enabled: false });
  assert.equal(kv.get('jun2048.dev'), null);
  assert.deepEqual(readDevMode(kv, 'jun2048'), { unlocked: false, enabled: false });
});
