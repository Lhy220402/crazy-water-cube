/**
 * 特殊合成配方 —— 「相连」= 2048 式相撞：滑动时两枚方块碰撞即触发，单步不连锁。
 * 配方优先于普通同级判定；配对无序（隋撞军、军撞隋都一样）。
 *
 * 想加新配方：
 *   1. 在 PRODUCTS 里加一个产物（含增益定义）
 *   2. 在 RECIPES 里加一条配对
 *   3. 在 lore.ts 里补首次触发的解释文案
 * 其余（图鉴收录、棋子渲染、存档校验）全部自动生效。
 */
import type { CodexEntry } from './codex.ts';

/** 增益定义：mult = 得分倍率；moves = 持续步数，-1 表示本局永久 */
export interface BuffDef {
  readonly id: string;
  readonly label: string;
  readonly mult: number;
  readonly moves: number;
}

export interface SpecialProduct {
  readonly entry: CodexEntry;
  /** 合成出该产物时的基础分（再乘当前增益倍率） */
  readonly points: number;
  readonly buff: BuffDef;
  /** 触发真通关 */
  readonly trueWin?: boolean;
}

/** 配方的一侧：按等级匹配，或按词条 id 匹配 */
export type TileMatcher = { readonly rank: number } | { readonly variant: string };

export interface Recipe {
  readonly a: TileMatcher;
  readonly b: TileMatcher;
  readonly product: string;
}

export const PRODUCTS: Readonly<Record<string, SpecialProduct>> = {
  'sui-jun': {
    entry: { id: 'sui-jun', name: '隋军', rarity: 'rare', kind: 'special', hue: 208, hue2: 184 },
    points: 64,
    buff: { id: 'sui-jun', label: '隋军·蓄水', mult: 2, moves: 8 },
  },
  'sui-jun-ring': {
    entry: { id: 'sui-jun-ring', name: '隋军·环', rarity: 'legend', kind: 'special', hue: 232, hue2: 260 },
    points: 128,
    buff: { id: 'sui-jun-ring', label: '隋军·洪峰', mult: 3, moves: 12 },
  },
  'ji-ying-ying': {
    entry: { id: 'ji-ying-ying', name: '记赢赢', rarity: 'legend', kind: 'special', hue: 292, hue2: 264 },
    points: 256,
    buff: { id: 'ji-ying-ying', label: '记赢赢·长赢', mult: 2, moves: -1 },
    trueWin: true,
  },
  // Li + Na → 李娜：跟隋军同一梯队（×2 / 8 步），分数略高以匹配两条稀有词条的门槛
  lina: {
    entry: { id: 'lina', name: '李娜', rarity: 'legend', kind: 'special', hue: 46, hue2: 68 },
    points: 128,
    buff: { id: 'lina', label: '李娜·夺冠', mult: 2, moves: 8 },
  },
};

export const RECIPES: readonly Recipe[] = [
  { a: { variant: 'sui' }, b: { rank: 0 }, product: 'sui-jun' },
  { a: { variant: 'sui-ring' }, b: { rank: 0 }, product: 'sui-jun-ring' },
  { a: { variant: 'li' }, b: { variant: 'na' }, product: 'lina' },
  { a: { variant: 'ji' }, b: { rank: 1 }, product: 'ji-ying-ying' },
];

/** 引擎用的最小方块形状（与 engine.Tile 结构兼容，避免循环依赖） */
export interface MatchTile {
  readonly rank: number;
  readonly variant?: string;
}

function matches(matcher: TileMatcher, tile: MatchTile): boolean {
  if ('variant' in matcher) return tile.variant === matcher.variant;
  return tile.rank === matcher.rank && tile.variant === undefined;
}

/** 两枚方块相撞是否触发特殊配方；无序匹配，返回产物或 null */
export function matchRecipe(a: MatchTile, b: MatchTile): SpecialProduct | null {
  for (const recipe of RECIPES) {
    if (
      (matches(recipe.a, a) && matches(recipe.b, b)) ||
      (matches(recipe.a, b) && matches(recipe.b, a))
    ) {
      return PRODUCTS[recipe.product] ?? null;
    }
  }
  return null;
}

export function specialProduct(id: string | undefined): SpecialProduct | undefined {
  return id === undefined ? undefined : PRODUCTS[id];
}

/** 全部特殊产物词条（图鉴收录用，不进抽取池） */
export function specialEntries(): CodexEntry[] {
  return Object.values(PRODUCTS).map((product) => product.entry);
}