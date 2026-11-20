/**
 * 2048 规则引擎：纯函数，不碰 DOM，不读全局。
 * 外部只需要 config / rng，因此可以单测、可以换棋盘尺寸、可以扩展等级。
 */
import { canMergeRank, type GameConfig } from './config.ts';

export type Direction = 'up' | 'down' | 'left' | 'right';
export type Rng = () => number;

export interface Tile {
  readonly id: number;
  readonly rank: number;
}

export interface GameState {
  /** 长度 size*size，按行优先排列 */
  cells: (Tile | null)[];
  score: number;
  moves: number;
  nextId: number;
  /** 本局是否已达成通关（达成后继续玩不会重复触发） */
  won: boolean;
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
}

export interface Spawn {
  id: number;
  rank: number;
  cell: number;
}

export interface MoveResult {
  moved: boolean;
  state: GameState;
  slides: Slide[];
  merges: Merge[];
  spawn: Spawn | null;
  scoreGain: number;
  /** 本次移动第一次合出了通关等级 */
  justWon: boolean;
}

export interface SavedGame {
  v: 1;
  size: number;
  sig: string;
  ranks: (number | null)[];
  score: number;
  moves: number;
  won: boolean;
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
    cells: state.cells.map((tile) => (tile ? { id: tile.id, rank: tile.rank } : null)),
    score: state.score,
    moves: state.moves,
    nextId: state.nextId,
    won: state.won,
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
  };
  if (state.over) return noop;

  const cells = state.cells.slice();
  const slides: Slide[] = [];
  const merges: Merge[] = [];
  let nextId = state.nextId;
  let scoreGain = 0;

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
      if (second && second.tile.rank === first.tile.rank && canMergeRank(config, first.tile.rank)) {
        const rank = first.tile.rank + 1;
        const targetId = nextId;
        nextId += 1;
        const merge: Merge = {
          sources: [first.tile.id, second.tile.id],
          targetId,
          rank,
          cell: -1,
          gained: config.tiers[rank]!.points,
        };
        entries.push({
          tile: { id: targetId, rank },
          srcIds: [first.tile.id, second.tile.id],
          from: [first.from, second.from],
          merge,
        });
        scoreGain += merge.gained;
        i += 1;
      } else {
        entries.push({ tile: first.tile, srcIds: [first.tile.id], from: [first.from], merge: null });
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
          rank: entry.merge ? entry.tile.rank - 1 : entry.tile.rank,
          from,
          to,
        });
      }
      if (entry.merge) {
        entry.merge.cell = to;
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
    over: false,
  };
  const spawn = spawnRandom(next, config, rng);
  next.nextId = Math.max(next.nextId, nextId);

  const justWon = !state.won && merges.some((merge) => merge.rank >= config.winRank);
  if (justWon) next.won = true;
  next.over = !canMove(next, config);

  return { moved: true, state: next, slides, merges, spawn, scoreGain, justWon };
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
      if (right && right.rank === tile.rank && canMergeRank(config, tile.rank)) return true;
      if (down && down.rank === tile.rank && canMergeRank(config, tile.rank)) return true;
    }
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* 存档（只存等级与分数，读档时重新分配 tile id，避免 id 冲突）          */
/* ------------------------------------------------------------------ */

export function serialize(state: GameState, config: GameConfig): SavedGame {
  return {
    v: 1,
    size: config.size,
    sig: config.tiersSignature,
    ranks: state.cells.map((tile) => (tile ? tile.rank : null)),
    score: state.score,
    moves: state.moves,
    won: state.won,
  };
}

function isInt(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

export function deserialize(raw: unknown, config: GameConfig): GameState | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Partial<SavedGame>;
  if (data.v !== 1) return null;
  if (data.size !== config.size || data.sig !== config.tiersSignature) return null;
  if (!Array.isArray(data.ranks) || data.ranks.length !== config.size * config.size) return null;
  if (typeof data.score !== 'number' || !Number.isFinite(data.score) || data.score < 0) return null;
  if (!isInt(data.moves, 0, Number.MAX_SAFE_INTEGER)) return null;

  const cells: (Tile | null)[] = new Array(config.size * config.size).fill(null);
  let nextId = 1;
  for (let i = 0; i < data.ranks.length; i += 1) {
    const rank = data.ranks[i];
    if (rank === null) continue;
    if (!isInt(rank, 0, config.tiers.length - 1)) return null;
    cells[i] = { id: nextId, rank };
    nextId += 1;
  }
  const state: GameState = {
    cells,
    score: Math.floor(data.score),
    moves: data.moves,
    nextId,
    won: data.won === true,
    over: false,
  };
  state.over = !canMove(state, config);
  return state;
}
