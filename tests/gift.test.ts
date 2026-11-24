import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GIFT_BEST,
  GIFT_BOARD,
  GIFT_MOVES,
  GIFT_SCORE,
  buildGiftSave,
} from '../scripts/gift-save.ts';
import { decodeSaveBundle } from '../src/ui/save-transfer.ts';
import { DEFAULT_CONFIG, allEntries } from '../src/game/config.ts';
import { canMove, deserialize, serialize, type SavedGame } from '../src/game/engine.ts';

test('补偿存档：JWC1 码可被当前版本解码并正常读档', () => {
  const { bundle, code, state } = buildGiftSave();
  assert.ok(code.startsWith('JWC1.'));
  assert.ok(code.length < 5000, '存档码不应过长');
  assert.deepEqual(decodeSaveBundle(code), bundle);

  const decoded = decodeSaveBundle(code);
  assert.ok(decoded);
  assert.equal(decoded.best, String(GIFT_BEST));
  assert.equal(GIFT_BEST, 91780);

  const saved = JSON.parse(decoded.game ?? '{}') as SavedGame;
  assert.equal(saved.v, 3);
  assert.equal(saved.sig, DEFAULT_CONFIG.tiersSignature);
  assert.equal(saved.size, 4);
  assert.equal(saved.ranks.length, 16);
  assert.equal(saved.variants.length, 16);

  const restored = deserialize(saved, DEFAULT_CONFIG, () => 0.5);
  assert.ok(restored, '补偿棋局应能通过 deserialize 校验');
  assert.equal(restored.score, GIFT_SCORE);
  assert.equal(restored.moves, GIFT_MOVES);
  assert.equal(restored.won, true);
  assert.equal(restored.trueWon, true);
  assert.equal(restored.over, false);
  assert.equal(canMove(restored, DEFAULT_CONFIG), true);
  // 读档后立刻回写不会改变存档内容
  assert.deepEqual(JSON.parse(JSON.stringify(serialize(restored, DEFAULT_CONFIG))), saved);
  assert.deepEqual(JSON.parse(JSON.stringify(serialize(state, DEFAULT_CONFIG))), saved);
});

test('补偿存档：最高分 / 图鉴 / 棋盘内容符合约定', () => {
  const { bundle } = buildGiftSave();
  const codex = JSON.parse(bundle.codex ?? '{}') as Record<string, number>;
  const entries = allEntries(DEFAULT_CONFIG);
  const nonMyth = entries.filter((entry) => entry.rarity !== 'myth');
  const myths = entries.filter((entry) => entry.rarity === 'myth');

  assert.equal(nonMyth.length, 40, '随机池 33 + 特殊产物 7');
  assert.equal(myths.length, 8);
  assert.equal(Object.keys(codex).length, 40);
  for (const entry of nonMyth) {
    assert.ok((codex[entry.id] ?? 0) > 0, `图鉴应收录 ${entry.name}`);
  }
  for (const entry of myths) {
    assert.equal(codex[entry.id], undefined, `传奇「${entry.name}」应保留空白`);
  }

  // 棋盘：13 格、2 枚记赢赢、7 种特殊产物都出现、没有 rank 6 传奇
  assert.equal(GIFT_BOARD.length, 16);
  const state = deserialize(JSON.parse(bundle.game ?? '{}'), DEFAULT_CONFIG, () => 0.5);
  assert.ok(state);
  const tiles = state.cells.filter((tile): tile is NonNullable<typeof tile> => tile !== null);
  assert.equal(tiles.length, 13);
  assert.equal(tiles.filter((tile) => tile.rank === 6).length, 0, '补偿棋盘不放传奇方块');
  assert.equal(tiles.filter((tile) => tile.variant === 'ji-ying-ying').length, 2);
  for (const id of ['sui-jun', 'sui-jun-ring', 'shui-gang', 'lina', 'miao', 'ji-hui-cheng']) {
    assert.equal(tiles.filter((tile) => tile.variant === id).length, 1, `棋盘应含 ${id}`);
  }
  assert.equal(state.buffs.length, 1);
  assert.equal(state.buffs[0]?.id, 'ji-ying-ying');
  assert.equal(state.buffs[0]?.movesLeft, -1);
});
