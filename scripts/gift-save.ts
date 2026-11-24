/**
 * 补偿存档生成器（v3.2.0）。
 *
 * 用途：给因为微信文件预览 / 换入口丢掉进度的玩家补一份「最高分 + 图鉴 + 棋局」。
 * 输出与游戏内导出的存档码完全同格式：JWC1.<base64url(JSON {v:1, game, best, codex})>，
 * 在游戏「存档导入」里粘贴即可。
 *
 * 内容约定（用户 2026-11-24 确认）：
 *   - 最高分 91780，当前得分 61312、640 步；
 *   - 图鉴 40/48：33 条随机池稀有/传说 + 7 条特殊产物全收录；8 条传奇留空（保留现世悬念）；
 *   - 棋局 13 格：2 枚记赢赢 + 7 种特殊产物 + 稀有/传说词条混排，**不放 rank 6 传奇方块**；
 *   - won / trueWon 均为 true，带记赢赢的永久 ×2 增益，与实际真通关后的状态一致。
 *
 * 用法：
 *   node scripts/gift-save.ts            # 生成到 release/gift-save.txt
 *   node scripts/gift-save.ts <输出路径>  # 自定义输出
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_CONFIG,
  allEntries,
  entryById,
  type GameConfig,
} from '../src/game/config.ts';
import {
  canMove,
  serialize,
  type GameState,
  type Tile,
} from '../src/game/engine.ts';
import { encodeSaveBundle, type SaveBundle } from '../src/ui/save-transfer.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const GIFT_BEST = 91780;
export const GIFT_SCORE = 61312;
export const GIFT_MOVES = 640;

/** 棋盘：null = 空格；{ entry } = 词条/特殊产物；{ rank } = 普通等级（如 水³=2） */
export type GiftCell = null | { readonly entry: string } | { readonly rank: number };

export const GIFT_BOARD: readonly GiftCell[] = [
  { entry: 'ji-ying-ying' },
  { entry: 'ji-ying-ying' },
  { entry: 'sui-jun' },
  null,
  { entry: 'sui-jun-ring' },
  { entry: 'shui-gang' },
  { entry: 'lina' },
  null,
  { entry: 'miao' },
  { entry: 'ji-hui-cheng' },
  { entry: 'sui' },
  null,
  { entry: 'meihui' },
  { entry: 'zhaojun' },
  { entry: 'biao' },
  { rank: 2 },
];

function rankOfEntry(config: GameConfig, entryId: string): number {
  const entry = entryById(config, entryId);
  if (!entry) throw new Error(`补偿存档引用了不存在的词条：${entryId}`);
  return entry.rarity === 'myth' ? config.mythRank : config.codexRank;
}

export function buildGiftState(config: GameConfig = DEFAULT_CONFIG): GameState {
  let nextId = 1;
  const cells: (Tile | null)[] = [];
  for (const cell of GIFT_BOARD) {
    if (cell === null) {
      cells.push(null);
      continue;
    }
    const tile: Tile =
      'rank' in cell
        ? { id: nextId, rank: cell.rank }
        : { id: nextId, rank: rankOfEntry(config, cell.entry), variant: cell.entry };
    cells.push(tile);
    nextId += 1;
  }
  const state: GameState = {
    cells,
    score: GIFT_SCORE,
    moves: GIFT_MOVES,
    nextId,
    won: true,
    trueWon: true,
    buffs: [{ id: 'ji-ying-ying', label: '记赢赢·长赢', mult: 2, movesLeft: -1 }],
    over: false,
  };
  state.over = !canMove(state, config);
  return state;
}

/** 图鉴：所有非传奇词条（33 随机池 + 7 特殊产物）各收录 1 次，传奇保留空白 */
export function buildGiftCodex(config: GameConfig = DEFAULT_CONFIG): Record<string, number> {
  const codex: Record<string, number> = {};
  for (const entry of allEntries(config)) {
    if (entry.rarity !== 'myth') codex[entry.id] = 1;
  }
  return codex;
}

export interface GiftSave {
  readonly bundle: SaveBundle;
  readonly code: string;
  readonly state: GameState;
}

export function buildGiftSave(config: GameConfig = DEFAULT_CONFIG): GiftSave {
  const state = buildGiftState(config);
  if (!canMove(state, config)) throw new Error('补偿存档棋盘不可移动，检查 GIFT_BOARD');
  const bundle: SaveBundle = {
    game: JSON.stringify(serialize(state, config)),
    best: String(GIFT_BEST),
    codex: JSON.stringify(buildGiftCodex(config)),
  };
  return { bundle, code: encodeSaveBundle(bundle), state };
}

/** CLI：写出只含存档码的纯文本文件（方便全选复制） */
async function main(): Promise<void> {
  const out = resolve(process.argv[2] ?? resolve(root, 'release/gift-save.txt'));
  const { bundle, code, state } = buildGiftSave();
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, code, 'utf8');
  const codex = JSON.parse(bundle.codex ?? '{}') as Record<string, number>;
  console.log(`✓ 补偿存档码已写入 ${out}`);
  console.log(`  最高分 ${bundle.best} · 当前分 ${state.score} · ${state.moves} 步`);
  console.log(
    `  图鉴 ${Object.keys(codex).length}/48（传奇留空）· 棋盘 ${state.cells.filter(Boolean).length}/16 格`,
  );
  console.log(`  存档码 ${code.length} 字符`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
