/**
 * 疯狂水立方 规则引擎：纯函数，不碰 DOM，不读全局。
 * 外部只需要 config / rng，因此可以单测、可以换棋盘尺寸、可以扩展等级与词条。
 *
 * 配对规则（单步内每枚方块最多参与一次合成，不连锁）：
 *   1. 特殊配方优先：隋+军→水军、隋圆+军→隋军隋圆、隋+钢→水缸、记+赢²→记赢赢（无序匹配）
 *   2. 同级相碰：普通等级升一级；OLD FIVE 与词条级、任意两条词条 → 全池随机抽一条
 * 增益：特殊合成挂 buff，后续若干步所有合成得分乘倍率（多个乘算叠加）。
 * 通关：首次合出 OLD FIVE = 假通关（won）；首次合出 记赢赢 = 真通关（trueWon）。
 */
import {
  canMergeRank,
  entryById,
  isCodexRank,
  mergedRankOf,
  pointsForRank,
  type GameConfig,
} from './config.ts';
import { drawCodexEntry, type CodexEntry } from './codex.ts';
import { matchRecipe, specialProduct, type SpecialProduct } from './recipes.ts';
import { buffMultiplier, cloneBuffs, parseBuffs, tickBuffs, type Buff } from './buffs.ts';

export type Direction = 'up' | 'down' | 'left' | 'right';
export type Rng = () => number;

export interface Tile {
  readonly id: number;
  readonly rank: number;
  /** 词条级（含特殊产物）使用：词条 id */
  readonly variant?: string;
}

export interface GameState {
  /** 长度 size*size，按行优先排列 */
  cells: (Tile | null)[];
  score: number;
  moves: number;
  nextId: number;
  /** 假通关：首次合出 OLD FIVE（达成后继续玩不会重复触发） */
  won: boolean;
  /** 真通关：首次合出 记赢赢 */
  trueWon: boolean;
  /** 当前生效的得分增益 */
  buffs: Buff[];
  /** 是否已经无路可走 */
  over: boolean;
}

export interface Slide {
  id: number;
  rank: number;
  from: number;
  to: number;
}

export interface Merge {
  sources: [number, number];
  targetId: number;
  rank: number;
  cell: number;
  gained: number;
  /** 合成结果若是词条/特殊产物，这里是其 id */
  variant?: string;
}

export interface Spawn {
  id: number;
  rank: number;
  cell: number;
}

/** 本次移动新抽到的随机词条（可能重复抽到已有词条；特殊产物不在这里，见 merges） */
export interface CodexDraw {
  entryId: string;
  name: string;
  cell: number;
}

export interface MoveResult {
  moved: boolean;
  state: GameState;
  slides: Slide[];
  merges: Merge[];
  spawn: Spawn | null;
  scoreGain: number;
  /** 本次移动第一次合出了 OLD FIVE（假通关） */
  justWon: boolean;
  /** 本次移动第一次合出了 记赢赢（真通关） */
  justTrueWon: boolean;
  /** 本次移动抽到的随机词条 */
  codexDraws: CodexDraw[];
}

export interface SavedGame {
  v: 3;
  size: number;
  sig: string;
  ranks: (number | null)[];
  /** 与 ranks 一一对应：词条方块的词条 id，其余为 null */
  variants: (string | null)[];
  score: number;
  moves: number;
  won: boolean;
  trueWon: boolean;
  buffs: Buff[];
}

/* ------------------------------------------------------------------ */
/* 基础工具                                                            */
/* ------------------------------------------------------------------ */

export function cellIndex(config: GameConfig, row: number, col: number): number {
  return row * config.size + col;
}

export function rowCol(config: GameConfig, index: number): { row: number; col: number } {
  return { row: Math.floor(index / config.size), col: index % config.size };
}

export function tileAt(config: GameConfig, state: GameState, row: number, col: number): Tile | null {
  if (row < 0 || col < 0 || row >= config.size || col >= config.size) return null;
  return state.cells[cellIndex(config, row, col)] ?? null;
}

export function eachTile(state: GameState): Tile[] {
  const out: Tile[] = [];
  for (const tile of state.cells) if (tile) out.push(tile);
  return out;
}

export function emptyCells(state: GameState): number[] {
  const out: number[] = [];
  for (let i = 0; i < state.cells.length; i += 1) if (!state.cells[i]) out.push(i);
  return out;
}

export function cloneState(state: GameState): GameState {
  return {
    cells: state.cells.map((tile) =>
      tile ? (tile.variant === undefined ? { id: tile.id, rank: tile.rank } : { id: tile.id, rank: tile.rank, variant: tile.variant }) : null,
    ),
    score: state.score,
    moves: state.moves,
    nextId: state.nextId,
    won: state.won,
    trueWon: state.trueWon,
    buffs: cloneBuffs(state.buffs),
    over: state.over,
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 0.999999999;
  return value;
}

/** 按权重抽一个生成等级 */
export function pickSpawnRank(config: GameConfig, rng: Rng): number {
  const rules = config.spawn;
  if (rules.length === 0) return 0;
  let total = 0;
  for (const rule of rules) total += rule.weight;
  let roll = clamp01(rng()) * total;
  for (const rule of rules) {
    roll -= rule.weight;
    if (roll < 0) return rule.rank;
  }
  return rules[rules.length - 1]!.rank;
}

/** 随机挑一个空格并放上新方块，返回生成信息 */
function spawnRandom(state: GameState, config: GameConfig, rng: Rng): Spawn | null {
  const empties = emptyCells(state);
  if (empties.length === 0) return null;
  const cell = empties[Math.floor(clamp01(rng()) * empties.length)]!;
  const rank = pickSpawnRank(config, rng);
  const tile: Tile = { id: state.nextId, rank };
  state.nextId += 1;
  state.cells[cell] = tile;
  return { id: tile.id, rank, cell };
}

function drawEntry(config: GameConfig, rng: Rng): CodexEntry {
  const entries = config.codex?.entries ?? [];
  return drawCodexEntry(entries, rng);
}

/* ------------------------------------------------------------------ */
/* 配对判定                                                            */
/* ------------------------------------------------------------------ */

type PairResult =
  | { kind: 'special'; product: SpecialProduct }
  | { kind: 'rank'; rank: number }
  | { kind: 'codex' }
  | null;

/** 两枚方块相撞能否合成：先特殊配方，再同级（词条级任意配对） */
export function pairResult(config: GameConfig, a: Tile, b: Tile): PairResult {
  const product = matchRecipe(a, b);
  if (product) return { kind: 'special', product };
  if (a.rank !== b.rank || !canMergeRank(config, a.rank)) return null;
  const rank = mergedRankOf(config, a.rank);
  return isCodexRank(config, rank) ? { kind: 'codex' } : { kind: 'rank', rank };
}

/* ------------------------------------------------------------------ */
/* 棋盘格线（按移动方向排好序，队头 = 靠边的那一端）                     */
/* ------------------------------------------------------------------ */

const lineCache = new Map<string, readonly (readonly number[])[]>();

function linesFor(size: number, dir: Direction): readonly (readonly number[])[] {
  const key = `${size}:${dir}`;
  const cached = lineCache.get(key);
  if (cached) return cached;
  const rowsFirst = dir === 'left' || dir === 'right';
  const forward = dir === 'left' || dir === 'up';
  const lines: number[][] = [];
  for (let a = 0; a < size; a += 1) {
    const line: number[] = [];
    for (let b = 0; b < size; b += 1) {
      const step = forward ? b : size - 1 - b;
      const row = rowsFirst ? a : step;
      const col = rowsFirst ? step : a;
      line.push(row * size + col);
    }
    lines.push(line);
  }
  lineCache.set(key, lines);
  return lines;
}

/* ------------------------------------------------------------------ */
/* 开局 / 移动 / 判负 / 判胜                                           */
/* ------------------------------------------------------------------ */

export function createGame(config: GameConfig, rng: Rng = Math.random): GameState {
  const state: GameState = {
    cells: new Array<Tile | null>(config.size * config.size).fill(null),
    score: 0,
    moves: 0,
    nextId: 1,
    won: false,
    trueWon: false,
    buffs: [],
    over: false,
  };
  spawnRandom(state, config, rng);
  spawnRandom(state, config, rng);
  state.over = !canMove(state, config);
  return state;
}

interface Entry {
  tile: Tile;
  srcIds: number[];
  srcRanks: number[];
  from: number[];
  merge: Merge | null;
}

export function move(
  state: GameState,
  dir: Direction,
  config: GameConfig,
  rng: Rng = Math.random,
): MoveResult {
  const noop: MoveResult = {
    moved: false,
    state,
    slides: [],
    merges: [],
    spawn: null,
    scoreGain: 0,
    justWon: false,
    justTrueWon: false,
    codexDraws: [],
  };
  if (state.over) return noop;

  const cells = state.cells.slice();
  const slides: Slide[] = [];
  const merges: Merge[] = [];
  const codexDraws: CodexDraw[] = [];
  const newBuffs: Buff[] = [];
  let nextId = state.nextId;
  let scoreGain = 0;
  let justTrueWon = false;
  // 本步所有合成都用移动开始时的增益倍率；新挂的增益从下一步生效
  const mult = buffMultiplier(state.buffs);

  for (const line of linesFor(config.size, dir)) {
    const entries: Entry[] = [];
    const packed: { tile: Tile; from: number }[] = [];
    for (const cell of line) {
      const tile = cells[cell];
      if (tile) packed.push({ tile, from: cell });
    }

    for (let i = 0; i < packed.length; i += 1) {
      const first = packed[i]!;
      const second = packed[i + 1];
      const pair = second ? pairResult(config, first.tile, second.tile) : null;
      if (second && pair) {
        const targetId = nextId;
        nextId += 1;
        let resultTile: Tile;
        let gained: number;
        if (pair.kind === 'special') {
          const product = pair.product;
          resultTile = { id: targetId, rank: config.codexRank, variant: product.entry.id };
          gained = Math.round(product.points * mult);
          newBuffs.push({
            id: product.buff.id,
            label: product.buff.label,
            mult: product.buff.mult,
            movesLeft: product.buff.moves,
          });
          if (product.trueWin && !state.trueWon) justTrueWon = true;
        } else if (pair.kind === 'codex') {
          const entry = drawEntry(config, rng);
          resultTile = { id: targetId, rank: config.codexRank, variant: entry.id };
          gained = Math.round((config.codex?.points ?? 0) * mult);
        } else {
          resultTile = { id: targetId, rank: pair.rank };
          gained = Math.round(pointsForRank(config, pair.rank) * mult);
        }
        const merge: Merge = {
          sources: [first.tile.id, second.tile.id],
          targetId,
          rank: resultTile.rank,
          cell: -1,
          gained,
        };
        entries.push({
          tile: resultTile,
          srcIds: [first.tile.id, second.tile.id],
          srcRanks: [first.tile.rank, second.tile.rank],
          from: [first.from, second.from],
          merge,
        });
        scoreGain += gained;
        i += 1;
      } else {
        entries.push({
          tile: first.tile,
          srcIds: [first.tile.id],
          srcRanks: [first.tile.rank],
          from: [first.from],
          merge: null,
        });
      }
    }

    // 先清空整行，再按队头顺序填回
    for (const cell of line) cells[cell] = null;
    for (let k = 0; k < entries.length; k += 1) {
      const entry = entries[k]!;
      const to = line[k]!;
      cells[to] = entry.tile;
      for (let s = 0; s < entry.srcIds.length; s += 1) {
        const from = entry.from[s]!;
        if (from === to) continue;
        slides.push({
          id: entry.srcIds[s]!,
          rank: entry.srcRanks[s]!,
          from,
          to,
        });
      }
      if (entry.merge) {
        entry.merge.cell = to;
        if (entry.tile.variant !== undefined) {
          entry.merge.variant = entry.tile.variant;
          // 只有随机抽取才进 codexDraws；特殊产物由 UI 从 merges 里识别
          if (!specialProduct(entry.tile.variant)) {
            const found = entryById(config, entry.tile.variant);
            codexDraws.push({
              entryId: entry.tile.variant,
              name: found?.name ?? entry.tile.variant,
              cell: to,
            });
          }
        }
        merges.push(entry.merge);
      }
    }
  }

  // 没有任何方块位移 = 无效操作
  if (slides.length === 0) return noop;

  const next: GameState = {
    cells,
    score: state.score + scoreGain,
    moves: state.moves + 1,
    nextId,
    won: state.won,
    trueWon: state.trueWon || justTrueWon,
    // 旧增益倒数一步，新增益满步数挂上（创建当步不消耗）
    buffs: [...tickBuffs(state.buffs), ...newBuffs],
    over: false,
  };
  const spawn = spawnRandom(next, config, rng);
  next.nextId = Math.max(next.nextId, nextId);

  const justWon =
    !state.won &&
    merges.some((merge) => merge.rank >= config.winRank && !isCodexRank(config, merge.rank));
  if (justWon) next.won = true;
  next.over = !canMove(next, config);

  return { moved: true, state: next, slides, merges, spawn, scoreGain, justWon, justTrueWon, codexDraws };
}

export function canMove(state: GameState, config: GameConfig): boolean {
  const size = config.size;
  const cells = state.cells;
  for (const tile of cells) if (!tile) return true;
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      const tile = cells[row * size + col];
      if (!tile) continue;
      const right = col + 1 < size ? cells[row * size + col + 1] : null;
      const down = row + 1 < size ? cells[(row + 1) * size + col] : null;
      if (right && pairResult(config, tile, right)) return true;
      if (down && pairResult(config, tile, down)) return true;
    }
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* 存档（只存等级/词条/增益与分数，读档时重新分配 tile id，避免 id 冲突） */
/* ------------------------------------------------------------------ */

export function serialize(state: GameState, config: GameConfig): SavedGame {
  return {
    v: 3,
    size: config.size,
    sig: config.tiersSignature,
    ranks: state.cells.map((tile) => (tile ? tile.rank : null)),
    variants: state.cells.map((tile) => (tile && tile.variant !== undefined ? tile.variant : null)),
    score: state.score,
    moves: state.moves,
    won: state.won,
    trueWon: state.trueWon,
    buffs: cloneBuffs(state.buffs),
  };
}

function isInt(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

export function deserialize(raw: unknown, config: GameConfig): GameState | null {
  if (!raw || typeof raw !== 'object') return null;
  // 兼容 v1（无词条字段）、v2（无真通关/增益）与 v3
  const data = raw as Partial<Omit<SavedGame, 'v'>> & { v?: number };
  if (data.v !== 1 && data.v !== 2 && data.v !== 3) return null;
  if (data.size !== config.size || data.sig !== config.tiersSignature) return null;
  if (!Array.isArray(data.ranks) || data.ranks.length !== config.size * config.size) return null;
  if (typeof data.score !== 'number' || !Number.isFinite(data.score) || data.score < 0) return null;
  if (!isInt(data.moves, 0, Number.MAX_SAFE_INTEGER)) return null;
  const variants = Array.isArray(data.variants) ? data.variants : null;

  const cells: (Tile | null)[] = new Array(config.size * config.size).fill(null);
  let nextId = 1;
  for (let i = 0; i < data.ranks.length; i += 1) {
    const rank = data.ranks[i];
    if (rank === null) continue;
    if (!isInt(rank, 0, config.maxRank)) return null;
    const variant = variants?.[i] ?? null;
    if (isCodexRank(config, rank)) {
      // 词条方块必须带当前池子里还存在的词条 id；池子换血后旧档判坏档开新局
      if (typeof variant !== 'string' || variant.length === 0) return null;
      if (!entryById(config, variant)) return null;
      cells[i] = { id: nextId, rank, variant };
    } else {
      cells[i] = { id: nextId, rank };
    }
    nextId += 1;
  }
  const state: GameState = {
    cells,
    score: Math.floor(data.score),
    moves: data.moves,
    nextId,
    won: data.won === true,
    trueWon: data.trueWon === true,
    // 旧档里的增益 label 是当时的快照文案（如「隋军·蓄水」）；改名后按当前定义刷新文案，
    // 只改 label，倍率和剩余步数照旧，旧棋盘不会因此作废。
    buffs: parseBuffs(data.buffs).map((buff) => {
      const label = specialProduct(buff.id)?.buff.label;
      return label !== undefined && label !== buff.label ? { ...buff, label } : buff;
    }),
    over: false,
  };
  state.over = !canMove(state, config);
  return state;
}