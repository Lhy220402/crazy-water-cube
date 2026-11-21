import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectVersionChange,
  hasLegacyData,
  readSeenVersion,
  versionChangeText,
  writeSeenVersion,
} from '../src/ui/version.ts';
import type { KV } from '../src/ui/storage.ts';

/** 用 Map 做一个和 localStorage 行为一致的 KV */
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

test('版本更新：版本没变不弹，变了弹旧版本 → 新版本', () => {
  const kv = kvOf({ jun2048: '{}', 'jun2048.version': '2.2.2' });
  assert.deepEqual(detectVersionChange(kv, 'jun2048', '2.3.0', '2.2.2'), {
    from: '2.2.2',
    to: '2.3.0',
  });
  assert.equal(detectVersionChange(kv, 'jun2048', '2.2.2', '2.2.2'), null, '同一版本不重复弹');
  // 跳过多个版本：只显示「上次进入的版本 → 当前版本」
  const skipped = kvOf({ 'jun2048.version': '2.1.0' });
  assert.deepEqual(detectVersionChange(skipped, 'jun2048', '2.3.0', '2.2.2'), {
    from: '2.1.0',
    to: '2.3.0',
  });
  // 记录里带 v 前缀 / 空格也能识别
  const messy = kvOf({ 'jun2048.version': ' v2.2.2 ' });
  assert.deepEqual(detectVersionChange(messy, 'jun2048', '2.3.0', '2.2.2'), {
    from: '2.2.2',
    to: '2.3.0',
  });
});

test('版本更新：没有版本记录时，老玩家按 LEGACY 算，全新玩家不弹', () => {
  // 有棋局 / 图鉴 / 外观 / 声音任一旧数据 = 从旧版升级上来的老玩家
  for (const key of ['jun2048', 'jun2048.best', 'jun2048.codex', 'jun2048.theme', 'jun2048.sound']) {
    assert.deepEqual(
      detectVersionChange(kvOf({ [key]: 'x' }), 'jun2048', '2.3.0', '2.2.2'),
      { from: '2.2.2', to: '2.3.0' },
      `${key} 应被识别为老玩家`,
    );
  }
  // 全新玩家：什么记录都没有 → 不弹
  assert.equal(detectVersionChange(kvOf(), 'jun2048', '2.3.0', '2.2.2'), null);
  // 只有当前版本的版本记录 → 不弹
  assert.equal(
    detectVersionChange(kvOf({ 'jun2048.version': '2.3.0' }), 'jun2048', '2.3.0', '2.2.2'),
    null,
  );
  // 版本记录是坏值（空白）时按「没有记录」处理
  assert.equal(
    detectVersionChange(kvOf({ 'jun2048.version': '   ' }), 'jun2048', '2.3.0', '2.2.2'),
    null,
  );
});

test('版本记录读写、旧数据探测与展示文案', () => {
  const kv = kvOf();
  assert.equal(readSeenVersion(kv, 'jun2048'), null);
  assert.equal(hasLegacyData(kv, 'jun2048'), false);

  writeSeenVersion(kv, 'jun2048', '2.3.0');
  assert.equal(readSeenVersion(kv, 'jun2048'), '2.3.0');
  // version 本身不算「旧玩家数据」，避免新玩家被误判
  assert.equal(hasLegacyData(kv, 'jun2048'), false);

  assert.equal(hasLegacyData(kvOf({ 'jun2048.sound': 'off' }), 'jun2048'), true);
  assert.equal(versionChangeText({ from: '2.2.2', to: '2.3.0' }), 'v2.2.2 → v2.3.0');

  // 读 / 写抛异常时静默降级，不影响游戏
  const throwing: KV = {
    get() {
      throw new Error('denied');
    },
    set() {
      throw new Error('denied');
    },
    remove() {
      throw new Error('denied');
    },
  };
  assert.equal(readSeenVersion(throwing, 'jun2048'), null);
  writeSeenVersion(throwing, 'jun2048', '2.3.0');
  assert.equal(hasLegacyData(throwing, 'jun2048'), false);
  assert.equal(detectVersionChange(throwing, 'jun2048', '2.3.0', '2.2.2'), null);
});
