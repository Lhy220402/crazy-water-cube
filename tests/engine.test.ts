import test from 'node:test';
import assert from 'node:assert/strict';
import { TIERS, allEntries, createConfig, entryById } from '../src/game/config.ts';
import { LORE, LORE_FALLBACK, loreOf } from '../src/game/lore.ts';
import { buffMultiplier, parseBuffs, tickBuffs } from '../src/game/buffs.ts';
import { specialProduct } from '../src/game/recipes.ts';
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

/** 棋盘格规格：数字 = 普通等级；[rank, variant] = 词条/特殊产物；null = 空 */
type CellSpec = number | [number, string] | null;

/** 用等级矩阵造局面（null = 空），从左上到右下 */
function board(rows: CellSpec[][], config = createConfig()): GameState {
  assert.equal(rows.length, config.size);
  const cells: GameState['cells'] = new Array(config.size * config.size).fill(null);
  let id = 1;
  rows.forEach((row, r) => {
    assert.equal(row.length, config.size);
    row.forEach((spec, c) => {
      if (spec === null) return;
      const [rank, variant] = typeof spec === 'number' ? [spec, undefined] : spec;
      cells[cellIndex(config, r, c)] =
        variant === undefined ? { id: id++, rank } : { id: id++, rank, variant };
    });
  });
  return { cells, score: 0, moves: 0, nextId: id, won: false, trueWon: false, buffs: [], over: false };
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
    ['军', '赢²', '水³', 'Lec', 'OLD FIVE'],
  );
  const config = createConfig();
  assert.equal(config.size, 4);
  assert.equal(config.winRank, 4);
  assert.deepEqual(
    config.spawn.map((rule) => rule.rank),
    [0, 1],
  );
  // 等级签名保持兼容（liu 是存档身份，不随改名变化）
  assert.equal(config.tiersSignature, 'jun|win|water|lec|liu');
});

test('开局有两个方块且分数为 0，无增益未通关', () => {
  const config = createConfig();
  const state = createGame(config, fixedRng(0));
  assert.equal(state.cells.filter(Boolean).length, 2);
  assert.equal(state.score, 0);
  assert.equal(state.over, false);
  assert.equal(state.won, false);
  assert.equal(state.trueWon, false);
  assert.deepEqual(state.buffs, []);
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
    rows: CellSpec[][];
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

test('完整合成链：军 → 赢² → 水³ → Lec → OLD FIVE', () => {
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
    const merged = move(state, 'left', config, fixedRng(0));
    assert.equal(merged.merges[0]!.rank, target, `应合成 ${TIERS[target]!.name}`);
    state = board(
      [
        [target, target, null, null],
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

test('关掉词条模式时，终点两枚不合并（旧规则）', () => {
  const config = createConfig({ codex: null });
  assert.equal(config.codexRank, -1);
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
  assert.equal(result.moved, true);
  assert.equal(result.merges.length, 0);
  assert.equal(result.scoreGain, 0);
  assert.deepEqual(ranks(result.state)[0]!.slice(0, 2), [4, 4]);
});

test('两枚 OLD FIVE 合成后随机抽一条词条', () => {
  const config = createConfig();
  const state = board(
    [
      [4, 4, null, null],
      [null, null, null, null],
      [null, null, null, null],
      [null, null, null, null],
    ],
    config,
  );
  const result = move(state, 'left', config, fixedRng(0));
  assert.equal(result.moved, true);
  assert.equal(result.merges.length, 1);
  assert.equal(result.merges[0]!.rank, config.codexRank);
  assert.equal(result.merges[0]!.gained, config.codex!.points);
  assert.equal(result.codexDraws.length, 1);
  assert.equal(result.codexDraws[0]!.entryId, 'sui'); // rng=0 抽权重最高的第一条
  assert.equal(result.codexDraws[0]!.name, '隋');
  const produced = result.state.cells.find((tile) => tile?.rank === config.codexRank);
  assert.ok(produced);
  assert.equal(produced.variant, 'sui');
  assert.equal(result.scoreGain, config.codex!.points);
});

test('任意两条词条都能合（稀有度不影响配对），结果全池随机', () => {
  const config = createConfig();
  // 普通「隋」 + 传说「记」：跨稀有度照样合
  const state = board(
    [
      [[5, 'sui'], [5, 'ji'], null, null],
      [null, null, null, null],
      [null, null, null, null],
      [null, null, null, null],
    ],
    config,
  );
  // 权重总和 45；0.5×45=22.5 落在「Li」（21–23 区间）
  const result = move(state, 'left', config, fixedRng(0.5));
  assert.equal(result.moved, true);
  assert.equal(result.merges[0]!.rank, config.codexRank);
  assert.equal(result.codexDraws.length, 1);
  assert.equal(result.codexDraws[0]!.entryId, 'li');
  const produced = result.state.cells.find((tile) => tile?.rank === config.codexRank);
  assert.equal(produced?.variant, 'li');
});

test('词条按权重随机，允许重复，21 条都能抽到', () => {
  const config = createConfig();
  const seen = new Map<string, number>();
  for (let i = 0; i < 500; i += 1) {
    const state = board(
      [
        [4, 4, null, null],
        [null, null, null, null],
        [null, null, null, null],
        [null, null, null, null],
      ],
      config,
    );
    const result = move(state, 'left', config, fixedRng((i % 50) / 50));
    const draw = result.codexDraws[0];
    assert.ok(draw);
    seen.set(draw.entryId, (seen.get(draw.entryId) ?? 0) + 1);
  }
  assert.deepEqual([...seen.keys()].sort(), [
    'bayi',
    'biao',
    'dingjian',
    'doubao',
    'eyu-qi',
    'eyu-shi-jun',
    'fuli',
    'gang',
    'hongmei',
    'huicheng',
    'ji',
    'jinshan',
    'junzhu',
    'li',
    'na',
    'sui',
    'sui-ring',
    'weihai',
    'xiaoming',
    'xiaoyu',
    'yanzi',
  ]);
  for (const count of seen.values()) assert.ok(count > 0);
  // 普通「隋」权重最高，抽到次数应明显多于传说「记」
  assert.ok(seen.get('sui')! > seen.get('ji')!);
});

test('特殊配方：Li + Na → 李娜（+128，×2/8步，和水军同一梯队）', () => {
  const config = createConfig();
  const state = board(
    [
      [[5, 'li'], [5, 'na'], null, null],
      [null, null, null, null],
      [null, null, null, null],
      [null, null, null, null],
    ],
    config,
  );
  const result = move(state, 'left', config, fixedRng(0));
  assert.equal(result.moved, true);
  assert.equal(result.merges.length, 1);
  const merge = result.merges[0]!;
  assert.equal(merge.variant, 'lina');
  assert.equal(merge.rank, config.codexRank);
  assert.equal(merge.gained, 128);
  assert.equal(result.codexDraws.length, 0, '特殊产物不是随机抽取');
  assert.deepEqual(result.state.buffs, [
    { id: 'lina', label: '李娜·夺冠', mult: 2, movesLeft: 8 },
  ]);
  assert.equal(result.justTrueWon, false);

  // 无序：Na 撞 Li 也一样触发
  const reversed = move(
    board(
      [
        [null, null, [5, 'na'], [5, 'li']],
        [null, null, null, null],
        [null, null, null, null],
        [null, null, null, null],
      ],
      config,
    ),
    'right',
    config,
    fixedRng(0),
  );
  assert.equal(reversed.merges[0]!.variant, 'lina');

  // 李娜也是词条级：可以和任意词条继续合成
  const followUp = move(
    board(
      [
        [[5, 'lina'], [5, 'bayi'], null, null],
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
  assert.equal(followUp.merges.length, 1);
  assert.equal(followUp.codexDraws.length, 1);
  assert.equal(followUp.merges[0]!.gained, 64);
});

test('每条词条与特殊产物都有解释文案（图鉴池 21 + 特殊产物 5）', () => {
  const config = createConfig();
  assert.equal(config.codex!.entries.length, 21);
  assert.equal(config.codex!.specials.length, 5);
  const entries = allEntries(config);
  assert.equal(entries.length, 26);
  for (const entry of entries) {
    const text = loreOf(entry.id);
    assert.ok(text.length > 0, `${entry.id} 缺解释`);
    assert.notEqual(text, LORE_FALLBACK, `${entry.id} 还是兜底句`);
    assert.equal(text.includes('占位'), false, `${entry.id} 还是占位`);
  }
  // v2.2 新增词条：文案按用户原文，🌧️ 保留两行
  assert.equal(LORE.biao, '彪！');
  assert.equal(LORE.huicheng, '会成吗？');
  assert.equal(LORE.xiaoyu, '这雨似乎不大\n这是小雨啊');
  // v2.3 新词条 / 水缸 / 水军改名：全部按用户原文
  assert.equal(LORE.gang, '一种金属');
  assert.equal(LORE.weihai, '一个地名');
  assert.equal(LORE.dingjian, '钉子怎么能做剑？');
  assert.equal(LORE.junzhu, '竹子中的皇帝是吗');
  assert.equal(LORE['shui-gang'], '一种容器');
  assert.equal(LORE['sui-jun'], '水里的军队');
});

test('特殊配方：隋 + 军 → 水军（+64，挂 ×2/8步 增益；内部 id 仍是 sui-jun）', () => {
  const config = createConfig();
  const state = board(
    [
      [[5, 'sui'], 0, null, null],
      [null, null, null, null],
      [null, null, null, null],
      [null, null, null, null],
    ],
    config,
  );
  const result = move(state, 'left', config, fixedRng(0));
  assert.equal(result.merges.length, 1);
  const merge = result.merges[0]!;
  assert.equal(merge.rank, config.codexRank);
  assert.equal(merge.variant, 'sui-jun');
  assert.equal(merge.gained, 64);
  assert.equal(result.codexDraws.length, 0, '特殊产物不是随机抽取');
  assert.deepEqual(result.state.buffs, [
    { id: 'sui-jun', label: '水军·蓄水', mult: 2, movesLeft: 8 },
  ]);
  assert.equal(result.justTrueWon, false);
  // 改名只动显示名，id 与增益数值都不变（存档兼容）
  assert.equal(specialProduct('sui-jun')!.entry.name, '水军');
});

test('特殊配方无序：军撞隋也一样；配方优先于普通判定', () => {
  const config = createConfig();
  const state = board(
    [
      [0, [5, 'sui'], 0, null],
      [null, null, null, null],
      [null, null, null, null],
      [null, null, null, null],
    ],
    config,
  );
  const result = move(state, 'left', config, fixedRng(0));
  // 队头 军+隋 先触发配方，剩下的军单独留在后面
  assert.equal(result.merges.length, 1);
  assert.equal(result.merges[0]!.variant, 'sui-jun');
  assert.deepEqual(ranks(result.state)[0]!.slice(0, 2), [5, 0]);
});

test('特殊配方：圈隋 + 军 → 水军·环（+128，×3/12步）', () => {
  const config = createConfig();
  const state = board(
    [
      [[5, 'sui-ring'], 0, null, null],
      [null, null, null, null],
      [null, null, null, null],
      [null, null, null, null],
    ],
    config,
  );
  const result = move(state, 'left', config, fixedRng(0));
  assert.equal(result.merges[0]!.variant, 'sui-jun-ring');
  assert.equal(result.merges[0]!.gained, 128);
  assert.deepEqual(result.state.buffs, [
    { id: 'sui-jun-ring', label: '水军·洪峰', mult: 3, movesLeft: 12 },
  ]);
});

test('特殊配方：隋 + 钢 → 水缸（+128，×2/8步，与水军同一梯队）', () => {
  const config = createConfig();
  const state = board(
    [
      [[5, 'sui'], [5, 'gang'], null, null],
      [null, null, null, null],
      [null, null, null, null],
      [null, null, null, null],
    ],
    config,
  );
  const result = move(state, 'left', config, fixedRng(0));
  assert.equal(result.moved, true);
  assert.equal(result.merges.length, 1);
  const merge = result.merges[0]!;
  assert.equal(merge.variant, 'shui-gang');
  assert.equal(merge.rank, config.codexRank);
  assert.equal(merge.gained, 128);
  assert.equal(result.codexDraws.length, 0, '特殊产物不是随机抽取');
  assert.deepEqual(result.state.buffs, [
    { id: 'shui-gang', label: '水缸·盛水', mult: 2, movesLeft: 8 },
  ]);
  assert.equal(result.justTrueWon, false);
  // 与水军同梯队：×2 / 8 步
  assert.equal(specialProduct('shui-gang')!.buff.mult, specialProduct('sui-jun')!.buff.mult);
  assert.equal(specialProduct('shui-gang')!.buff.moves, specialProduct('sui-jun')!.buff.moves);

  // 无序：钢撞隋也一样触发
  const reversed = move(
    board(
      [
        [null, null, [5, 'gang'], [5, 'sui']],
        [null, null, null, null],
        [null, null, null, null],
        [null, null, null, null],
      ],
      config,
    ),
    'right',
    config,
    fixedRng(0),
  );
  assert.equal(reversed.merges[0]!.variant, 'shui-gang');

  // 水缸也是词条级：可以和任意词条继续合成
  const followUp = move(
    board(
      [
        [[5, 'shui-gang'], [5, 'weihai'], null, null],
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
  assert.equal(followUp.merges.length, 1);
  assert.equal(followUp.codexDraws.length, 1);
  assert.equal(followUp.merges[0]!.gained, 64);
});

test('特殊配方：记 + 赢² → 记赢赢，真通关只触发一次，永久 ×2', () => {
  const config = createConfig();
  const state = board(
    [
      [[5, 'ji'], 1, null, null],
      [null, null, null, null],
      [null, null, null, null],
      [null, null, null, null],
    ],
    config,
  );
  const first = move(state, 'left', config, fixedRng(0));
  assert.equal(first.merges[0]!.variant, 'ji-ying-ying');
  assert.equal(first.merges[0]!.gained, 256);
  assert.equal(first.justTrueWon, true);
  assert.equal(first.state.trueWon, true);
  assert.deepEqual(first.state.buffs, [
    { id: 'ji-ying-ying', label: '记赢赢·长赢', mult: 2, movesLeft: -1 },
  ]);

  // 真通关后再合出记赢赢，不重复触发；永久增益仍在
  const again = move(
    { ...first.state, cells: board([[[5, 'ji'], 1, null, null], [null, null, null, null], [null, null, null, null], [null, null, null, null]], config).cells },
    'left',
    config,
    fixedRng(0),
  );
  assert.equal(again.justTrueWon, false);
  assert.equal(again.state.trueWon, true);
  assert.equal(again.state.buffs.filter((buff) => buff.id === 'ji-ying-ying').length, 2);
});

test('记 + 军 不合成；隋 + 隋 走普通词条抽取', () => {
  const config = createConfig();
  const noRecipe = move(
    board(
      [
        [null, [5, 'ji'], 0, null],
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
  assert.equal(noRecipe.moved, true);
  assert.equal(noRecipe.merges.length, 0);

  const suiPair = move(
    board(
      [
        [[5, 'sui'], [5, 'sui'], null, null],
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
  assert.equal(suiPair.merges.length, 1);
  assert.equal(suiPair.codexDraws.length, 1);
  assert.equal(suiPair.codexDraws[0]!.entryId, 'sui');
});

test('特殊产物也是词条级：可以和任意词条继续合成', () => {
  const config = createConfig();
  const result = move(
    board(
      [
        [[5, 'sui-jun'], [5, 'eyu-qi'], null, null],
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
  assert.equal(result.merges.length, 1);
  assert.equal(result.codexDraws.length, 1);
  assert.equal(result.merges[0]!.gained, 64);
});

test('增益让得分翻倍，并逐步倒数到过期', () => {
  const config = createConfig();
  const state = {
    ...board(
      [
        [0, 0, null, null],
        [null, null, null, null],
        [null, null, null, null],
        [null, null, null, null],
      ],
      config,
    ),
    buffs: [{ id: 'sui-jun', label: '水军·蓄水', mult: 2, movesLeft: 2 }],
  };
  const first = move(state, 'left', config, fixedRng(0.99));
  assert.equal(first.scoreGain, 8); // 4 × 2
  assert.equal(first.state.buffs[0]!.movesLeft, 1);
  // 再走一步有效移动（右下角的生成块上移），增益到期移除
  const second = move(first.state, 'up', config, fixedRng(0.99));
  assert.equal(second.moved, true);
  assert.deepEqual(second.state.buffs, []);
});

test('新增益创建当步不生效也不消耗，下一步才开始', () => {
  const config = createConfig();
  const state = board(
    [
      [[5, 'sui'], 0, null, null],
      [0, 0, null, null],
      [null, null, null, null],
      [null, null, null, null],
    ],
    config,
  );
  const result = move(state, 'left', config, fixedRng(0));
  // 水军 +64（无倍率），同一步的 军×2 仍是 +4 而不是 +8
  assert.equal(result.scoreGain, 64 + 4);
  assert.equal(result.state.buffs[0]!.movesLeft, 8);
  // 下一步合成开始吃 ×2
  const next = move(
    { ...result.state, cells: board([[0, 0, null, null], [null, null, null, null], [null, null, null, null], [null, null, null, null]], config).cells },
    'left',
    config,
    fixedRng(0),
  );
  assert.equal(next.scoreGain, 8);
  assert.equal(next.state.buffs[0]!.movesLeft, 7);
});

test('多个增益乘算叠加', () => {
  const config = createConfig();
  const state = {
    ...board(
      [
        [0, 0, null, null],
        [null, null, null, null],
        [null, null, null, null],
        [null, null, null, null],
      ],
      config,
    ),
    buffs: [
      { id: 'a', label: 'a', mult: 2, movesLeft: 3 },
      { id: 'b', label: 'b', mult: 3, movesLeft: 5 },
    ],
  };
  const result = move(state, 'left', config, fixedRng(0));
  assert.equal(result.scoreGain, 24); // 4 × 2 × 3
  assert.equal(result.state.buffs[0]!.movesLeft, 2);
  assert.equal(result.state.buffs[1]!.movesLeft, 4);
});

test('增益工具：倍率 / 倒数 / 存档校验', () => {
  assert.equal(buffMultiplier([]), 1);
  assert.equal(
    buffMultiplier([
      { id: 'a', label: 'a', mult: 2, movesLeft: 1 },
      { id: 'b', label: 'b', mult: 3, movesLeft: -1 },
    ]),
    6,
  );
  assert.deepEqual(
    tickBuffs([
      { id: 'a', label: 'a', mult: 2, movesLeft: 1 },
      { id: 'b', label: 'b', mult: 3, movesLeft: 2 },
      { id: 'c', label: 'c', mult: 2, movesLeft: -1 },
    ]),
    [
      { id: 'b', label: 'b', mult: 3, movesLeft: 1 },
      { id: 'c', label: 'c', mult: 2, movesLeft: -1 },
    ],
  );
  assert.deepEqual(parseBuffs(null), []);
  assert.deepEqual(parseBuffs([{ id: 'x', label: 'x', mult: 2, movesLeft: 3 }, { bad: true }]), [
    { id: 'x', label: 'x', mult: 2, movesLeft: 3 },
  ]);
});

test('合出 OLD FIVE 时假通关 justWon 只触发一次', () => {
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
  assert.equal(first.state.trueWon, false, 'OLD FIVE 只是假通关');

  const again = move(
    { ...first.state, cells: board([[3, 3, null, null], [null, null, null, null], [null, null, null, null], [null, null, null, null]], config).cells },
    'left',
    config,
    fixedRng(0),
  );
  assert.equal(again.moved, true);
  assert.equal(again.justWon, false);
});

test('无效移动不推进回合、不消耗增益', () => {
  const config = createConfig();
  const state = {
    ...board(
      [
        [0, 1, 2, 3],
        [4, 0, 1, 2],
        [3, 4, 0, 1],
        [2, 3, 4, 0],
      ],
      config,
    ),
    buffs: [{ id: 'a', label: 'a', mult: 2, movesLeft: 3 }],
  };
  const result = move(state, 'left', config, fixedRng(0));
  assert.equal(result.moved, false);
  assert.equal(result.state, state);
  assert.equal(result.spawn, null);
  assert.equal(result.state.buffs[0]!.movesLeft, 3);
});

test('满盘无解时判定结束；特殊配方相邻也算有路可走', () => {
  const config = createConfig();
  const dead = board(
    [
      [0, 1, 2, 3],
      [4, 0, 1, 2],
      [3, 4, 0, 1],
      [2, 3, 4, 0],
    ],
    config,
  );
  assert.equal(canMove(dead, config), false);

  // 把军右边的一枚换成「隋」：与军构成配方，死局复活
  const revived = board(
    [
      [0, [5, 'sui'], 2, 3],
      [4, 0, 1, 2],
      [3, 4, 0, 1],
      [2, 3, 4, 0],
    ],
    config,
  );
  assert.equal(canMove(revived, config), true);

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

test('词条模式下的可移动判定：词条对也能继续合', () => {
  const config = createConfig();
  const state = board(
    [
      [[5, 'sui'], [5, 'ji'], 0, 1],
      [2, 3, 4, 0],
      [1, 2, 3, 4],
      [0, 1, 2, 3],
    ],
    config,
  );
  assert.equal(canMove(state, config), true);

  const blocked = board(
    [
      [0, 1, 2, 3],
      [4, 0, 1, 2],
      [3, 4, 0, 1],
      [2, 3, 4, 0],
    ],
    config,
  );
  assert.equal(canMove(blocked, config), false);
});

test('关掉词条模式时，相邻的终点对不提供可移动性', () => {
  const config = createConfig({ codex: null });
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

test('存档往返一致（v3 含增益与真通关），坏档与旧配置被拒绝', () => {
  const config = createConfig();
  const state = {
    ...createGame(config, fixedRng(0.42)),
    won: true,
    trueWon: true,
    buffs: [{ id: 'ji-ying-ying', label: '记赢赢·长赢', mult: 2, movesLeft: -1 }],
  };
  const saved = JSON.parse(JSON.stringify(serialize(state, config)));
  assert.equal(saved.v, 3);
  const restored = deserialize(saved, config);
  assert.ok(restored);
  assert.equal(restored.score, state.score);
  assert.equal(restored.moves, state.moves);
  assert.equal(restored.trueWon, true);
  assert.deepEqual(restored.buffs, state.buffs);
  assert.deepEqual(ranks(restored), ranks(state));
  assert.deepEqual(saved.variants, state.cells.map((tile) => tile?.variant ?? null));

  assert.equal(deserialize({ ...saved, size: 5 }, config), null);
  assert.equal(deserialize({ ...saved, sig: 'other' }, config), null);
  assert.equal(deserialize({ ...saved, ranks: [99] }, config), null);
  assert.equal(deserialize({ ...saved, score: -1 }, config), null);
  assert.equal(deserialize(null, config), null);
  assert.equal(deserialize('nope', config), null);
});

test('词条存档校验：未知词条 id 判坏档；v1/v2 旧档兼容', () => {
  const config = createConfig();
  const base = {
    v: 3,
    size: 4,
    sig: config.tiersSignature,
    ranks: [5, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    variants: ['sui', null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    score: 10,
    moves: 3,
    won: true,
    trueWon: false,
    buffs: [],
  };
  assert.ok(deserialize(base, config));
  // 旧池子里的词条 id 已不存在 → 坏档（用不会出现在池子里的 id）
  assert.equal(deserialize({ ...base, variants: ['removed-entry', ...base.variants.slice(1)] }, config), null);
  // 词条级缺 variant → 坏档
  assert.equal(deserialize({ ...base, variants: [null, ...base.variants.slice(1)] }, config), null);
  // 特殊产物 id 合法
  assert.ok(deserialize({ ...base, variants: ['sui-jun', ...base.variants.slice(1)] }, config));
  assert.ok(deserialize({ ...base, variants: ['lina', ...base.variants.slice(1)] }, config));

  // v2.3 改名：旧档里的「隋军·蓄水」快照文案按当前定义刷新成「水军·蓄水」，倍率与步数不变
  const renamed = deserialize(
    { ...base, buffs: [{ id: 'sui-jun', label: '隋军·蓄水', mult: 2, movesLeft: 2 }] },
    config,
  );
  assert.ok(renamed);
  assert.deepEqual(renamed.buffs, [
    { id: 'sui-jun', label: '水军·蓄水', mult: 2, movesLeft: 2 },
  ]);
  // 未知 id 的自定义增益保持原样，不因刷新被丢掉或报错
  const unknownBuff = deserialize(
    { ...base, buffs: [{ id: 'custom', label: '自定义', mult: 2, movesLeft: 1 }] },
    config,
  );
  assert.ok(unknownBuff);
  assert.deepEqual(unknownBuff.buffs[0], { id: 'custom', label: '自定义', mult: 2, movesLeft: 1 });

  // v2：没有 trueWon / buffs 字段 → 默认值
  const v2 = { ...base, v: 2 } as Record<string, unknown>;
  delete v2.trueWon;
  delete v2.buffs;
  const restored2 = deserialize(v2, config);
  assert.ok(restored2);
  assert.equal(restored2.trueWon, false);
  assert.deepEqual(restored2.buffs, []);

  // v1：没有 variants 字段（普通局面）
  const v1 = {
    v: 1,
    size: 4,
    sig: config.tiersSignature,
    ranks: [0, 0, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    score: 0,
    moves: 0,
    won: false,
  };
  assert.ok(deserialize(v1, config));
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
      assert.ok(Number.isInteger(state.score), '分数必须是整数');
      previousScore = state.score;
      const tiles = state.cells.filter((tile): tile is NonNullable<typeof tile> => tile !== null);
      assert.ok(tiles.length <= config.size * config.size);
      assert.equal(new Set(tiles.map((tile) => tile.id)).size, tiles.length, '方块 id 必须唯一');
      for (const tile of tiles) assert.ok(tile.rank >= 0 && tile.rank <= config.maxRank);
      for (const tile of tiles) {
        if (tile.rank === config.codexRank) {
          assert.ok(tile.variant, '词条方块必须带词条 id');
          assert.ok(entryById(config, tile.variant!), '词条 id 必须在池子或特殊产物表里');
        } else {
          assert.equal(tile.variant, undefined, '普通等级不应该有词条 id');
        }
      }
      for (const buff of state.buffs) {
        assert.ok(buff.mult >= 1);
        assert.ok(buff.movesLeft >= -1);
      }
      assert.equal(state.over, !canMove(state, config), '终局标记要与可移动性一致');
      if (state.won) {
        assert.ok(tiles.some((tile) => tile.rank >= config.winRank));
      }
    }
  }
});