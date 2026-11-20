import test from 'node:test';
import assert from 'node:assert/strict';
import { TIERS, createConfig } from '../src/game/config.ts';
import {
  canMove,
  cellIndex,
  createGame,
  deserialize,
  move,
  serialize,
  type Direction,
  type GameState,
} from '../src/game/engine.ts';

/** 用等级矩阵造局面（null = 空），从左上到右下 */
function board(rows: (number | null)[][], config = createConfig()): GameState {
  assert.equal(rows.length, config.size);
  const cells: GameState['cells'] = new Array(config.size * config.size).fill(null);
  let id = 1;
  rows.forEach((row, r) => {
    assert.equal(row.length, config.size);
    row.forEach((rank, c) => {
      if (rank !== null) cells[cellIndex(config, r, c)] = { id: id++, rank };
    });
  });
  return { cells, score: 0, moves: 0, nextId: id, won: false, over: false };
}

function ranks(state: GameState): (number | null)[][] {
  const size = Math.sqrt(state.cells.length);
  const out: (number | null)[][] = [];
  for (let r = 0; r < size; r += 1) {
    const row: (number | null)[] = [];
    for (let c = 0; c < size; c += 1) row.push(state.cells[r * size + c]?.rank ?? null);
    out.push(row);
  }
  return out;
}

/** 固定 rng：先抽位置再抽等级，这里让生成永远落在第一个空格、等级为 0 */
function fixedRng(value = 0): () => number {
  return () => value;
}

test('默认体系与生成规则符合预期', () => {
  assert.deepEqual(
    TIERS.map((tier) => tier.name),
    ['军', '赢²', '水³', 'Lec', '刘 No.5'],
  );
  const config = createConfig();
  assert.equal(config.size, 4);
  assert.equal(config.winRank, 4);
  assert.deepEqual(
    config.spawn.map((rule) => rule.rank),
    [0, 1],
  );
});

test('开局有两个方块且分数为 0', () => {
  const config = createConfig();
  const state = createGame(config, fixedRng(0));
  assert.equal(state.cells.filter(Boolean).length, 2);
  assert.equal(state.score, 0);
  assert.equal(state.over, false);
  const ids = state.cells.filter(Boolean).map((tile) => tile!.id);
  assert.equal(new Set(ids).size, 2);
});

test('两枚「军」合成「赢²」，只计分一次', () => {
  const config = createConfig();
  const state = board(
    [
      [0, 0, null, null],
      [null, null, null, null],
      [null, null, null, null],
      [null, null, null, null],
    ],
    config,
  );
  const result = move(state, 'left', config, fixedRng(0));
  assert.equal(result.moved, true);
  assert.equal(result.merges.length, 1);
  assert.equal(result.merges[0]!.rank, 1);
  assert.equal(result.merges[0]!.cell, cellIndex(config, 0, 0));
  assert.equal(result.scoreGain, TIERS[1]!.points);
  // 合成后还会生成一个新方块（落在最后一个空格，等级 0）
  assert.equal(ranks(result.state)[0]![0], 1);
  assert.equal(result.state.score, TIERS[1]!.points);
  assert.equal(result.state.moves, 1);
});

test('同一行四枚相同只合成两次，不会连锁', () => {
  const config = createConfig();
  const state = board(
    [
      [0, 0, 0, 0],
      [null, null, null, null],
      [null, null, null, null],
      [null, null, null, null],
    ],
    config,
  );
  const result = move(state, 'left', config, fixedRng(0));
  assert.deepEqual(ranks(result.state)[0]!.slice(0, 2), [1, 1]);
  assert.equal(result.merges.length, 2);
  assert.equal(result.scoreGain, 2 * TIERS[1]!.points);
});

test('三枚相同靠边：先靠边的两枚合成，第三枚留在后面', () => {
  const config = createConfig();
  const state = board(
    [
      [0, 0, 0, null],
      [null, null, null, null],
      [null, null, null, null],
      [null, null, null, null],
    ],
    config,
  );
  const result = move(state, 'left', config, fixedRng(0));
  assert.deepEqual(ranks(result.state)[0]!.slice(0, 2), [1, 0]);
});

test('四个方向都能正确合并', () => {
  const config = createConfig();
  const cases: {
    dir: Direction;
    rows: (number | null)[][];
    expect: [number, number, number];
  }[] = [
    {
      dir: 'right',
      rows: [
        [1, 1, null, null],
        [null, null, null, null],
        [null, null, null, null],
        [null, null, null, null],
      ],
      expect: [0, 3, 2],
    },
    {
      dir: 'left',
      rows: [
        [null, null, 1, 1],
        [null, null, null, null],
        [null, null, null, null],
        [null, null, null, null],
      ],
      expect: [0, 0, 2],
    },
    {
      dir: 'up',
      rows: [
        [2, null, null, null],
        [2, null, null, null],
        [null, null, null, null],
        [null, null, null, null],
      ],
      expect: [0, 0, 3],
    },
    {
      dir: 'down',
      rows: [
        [3, null, null, null],
        [3, null, null, null],
        [null, null, null, null],
        [null, null, null, null],
      ],
      expect: [3, 0, 4],
    },
  ];
  for (const item of cases) {
    const result = move(board(item.rows, config), item.dir, config, fixedRng(0));
    assert.equal(result.moved, true, `${item.dir} 应该发生移动`);
    const [r, c, want] = item.expect;
    assert.equal(ranks(result.state)[r]![c], want, `${item.dir} 合成位置`);
  }
});

test('完整合成链：军 → 赢² → 水³ → Lec → 刘 No.5', () => {
  const config = createConfig();
  let state = board(
    [
      [0, 0, null, null],
      [null, null, null, null],
      [null, null, null, null],
      [null, null, null, null],
    ],
    config,
  );
  const expected = [1, 2, 3, 4];
  for (const target of expected) {
    const previous = state;
    const merged = move(previous, 'left', config, fixedRng(0));
    assert.equal(merged.merges[0]!.rank, target, `应合成 ${TIERS[target]!.name}`);
    // 把结果整理成「同行相邻两枚」，继续下一级合成
    const rank = target;
    state = board(
      [
        [rank, rank, null, null],
        [null, null, null, null],
        [null, null, null, null],
        [null, null, null, null],
      ],
      config,
    );
  }
  const top = state.cells.filter(Boolean)[0]!;
  assert.equal(top.rank, 4);
});

test('终点等级不再合并，也不会误判为可移动', () => {
  const config = createConfig();
  const state = board(
    [
      [null, 4, 4, null],
      [null, null, null, null],
      [null, null, null, null],
      [null, null, null, null],
    ],
    config,
  );
  const result = move(state, 'left', config, fixedRng(0));
  assert.equal(result.moved, true); // 方块确实滑动了
  assert.equal(result.merges.length, 0);
  assert.equal(result.scoreGain, 0);
  assert.deepEqual(ranks(result.state)[0]!.slice(0, 2), [4, 4]);
});

test('合出终点等级时 justWon 只触发一次', () => {
  const config = createConfig();
  const before = board(
    [
      [3, 3, null, null],
      [null, null, null, null],
      [null, null, null, null],
      [null, null, null, null],
    ],
    config,
  );
  const first = move(before, 'left', config, fixedRng(0));
  assert.equal(first.justWon, true);
  assert.equal(first.state.won, true);

  const second = move(
    board(
      [
        [3, 3, null, null],
        [null, null, null, null],
        [null, null, null, null],
        [null, null, null, null],
      ],
      config,
    ),
    'left',
    config,
    fixedRng(0),
  );
  assert.equal(second.justWon, true); // 单独测试的初态没通关过

  // 已经通关的局面再合出终点，不再重复触发
  const afterWin = { ...first.state, won: true };
  const again = move(afterWin, 'left', config, fixedRng(0));
  if (again.moved) assert.equal(again.justWon, false);
});

test('无效移动不推进回合', () => {
  const config = createConfig();
  const state = board(
    [
      [0, 1, 2, 3],
      [4, 0, 1, 2],
      [3, 4, 0, 1],
      [2, 3, 4, 0],
    ],
    config,
  );
  const result = move(state, 'left', config, fixedRng(0));
  assert.equal(result.moved, false);
  assert.equal(result.state, state);
  assert.equal(result.spawn, null);
});

test('满盘无解时判定结束', () => {
  const config = createConfig();
  const state = board(
    [
      [0, 1, 2, 3],
      [4, 0, 1, 2],
      [3, 4, 0, 1],
      [2, 3, 4, 0],
    ],
    config,
  );
  assert.equal(canMove(state, config), false);

  const withEmpty = board(
    [
      [0, 1, 2, 3],
      [4, 0, 1, 2],
      [3, 4, 0, 1],
      [2, 3, null, 0],
    ],
    config,
  );
  assert.equal(canMove(withEmpty, config), true);
});

test('该等级与终点判断：相邻终点对不提供可移动性', () => {
  const config = createConfig();
  const state = board(
    [
      [4, 4, 0, 1],
      [2, 3, 4, 0],
      [1, 2, 3, 4],
      [0, 1, 2, 3],
    ],
    config,
  );
  assert.equal(canMove(state, config), false);
});

test('存档往返一致，坏档与旧配置被拒绝', () => {
  const config = createConfig();
  const state = createGame(config, fixedRng(0.42));
  const saved = JSON.parse(JSON.stringify(serialize(state, config)));
  const restored = deserialize(saved, config);
  assert.ok(restored);
  assert.equal(restored.score, state.score);
  assert.equal(restored.moves, state.moves);
  assert.deepEqual(ranks(restored), ranks(state));

  assert.equal(deserialize({ ...saved, size: 5 }, config), null);
  assert.equal(deserialize({ ...saved, sig: 'other' }, config), null);
  assert.equal(deserialize({ ...saved, ranks: [99] }, config), null);
  assert.equal(deserialize({ ...saved, score: -1 }, config), null);
  assert.equal(deserialize(null, config), null);
  assert.equal(deserialize('nope', config), null);
});

test('合成体系可扩展：加一级后自动成为新的终点', () => {
  const extendedTiers = [...TIERS, { id: 'legend', label: '传奇', name: '传奇', points: 64 }];
  const config = createConfig({ tiers: extendedTiers });
  assert.equal(config.winRank, 5);
  assert.equal(config.spawn.at(-1)!.rank, 1);

  const state = board(
    [
      [4, 4, 0, 1],
      [null, null, null, null],
      [0, 1, 0, 1],
      [1, 0, 1, 0],
    ],
    config,
  );
  const result = move(state, 'left', config, fixedRng(0));
  assert.equal(result.merges[0]!.rank, 5);
  assert.equal(result.justWon, true);
  assert.equal(config.tiers[5]!.name, '传奇');
});

test('自定义生成规则按权重分布', () => {
  const config = createConfig({ spawn: [{ rank: 0, weight: 3 }, { rank: 2, weight: 1 }] });
  const seen = new Set<number>();
  for (let i = 0; i < 200; i += 1) {
    const state = createGame(config, () => i / 200);
    for (const tile of state.cells) if (tile) seen.add(tile.rank);
  }
  assert.deepEqual([...seen].sort(), [0, 2]);
});

test('随机模拟：核心不变量始终成立', () => {
  const config = createConfig();
  let seed = 123456789;
  const rng = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const dirs: Direction[] = ['up', 'down', 'left', 'right'];
  for (let round = 0; round < 40; round += 1) {
    let state = createGame(config, rng);
    let previousScore = 0;
    for (let step = 0; step < 120; step += 1) {
      const dir = dirs[Math.floor(rng() * 4)]!;
      const result = move(state, dir, config, rng);
      if (!result.moved) continue;
      state = result.state;
      assert.ok(state.score >= previousScore, '分数不可下降');
      previousScore = state.score;
      const tiles = state.cells.filter((tile): tile is NonNullable<typeof tile> => tile !== null);
      assert.ok(tiles.length <= config.size * config.size);
      assert.equal(new Set(tiles.map((tile) => tile.id)).size, tiles.length, '方块 id 必须唯一');
      for (const tile of tiles) assert.ok(tile.rank >= 0 && tile.rank < config.tiers.length);
      assert.equal(
        state.over,
        !canMove(state, config),
        '终局标记要与可移动性一致',
      );
      if (state.won) assert.ok(tiles.some((tile) => tile.rank === config.winRank));
    }
  }
});
