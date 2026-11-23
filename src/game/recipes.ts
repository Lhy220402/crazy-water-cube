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
  /**
   * 合成链页里，这条配方要等某个隐藏产物首次触发后才显示。
   * 用于「记赢赢 + 会成 → 记会成」：记赢赢本身是真通关隐藏内容，
   * 提前显示这一行会泄露记赢赢的名字与来源。
   */
  readonly revealAfter?: string;
}

/** 配方的一侧：按等级匹配，或按词条 id 匹配 */
export type TileMatcher = { readonly rank: number } | { readonly variant: string };

export interface Recipe {
  readonly a: TileMatcher;
  readonly b: TileMatcher;
  readonly product: string;
}

/**
 * 「抽取型」传奇配方（v3.0）：不产出固定产物，而是从 config.codex.myths 里随机抽一条。
 * 目前只有一条：记赢赢 × 记赢赢 → 随机传奇。因为它依赖真通关隐藏产物记赢赢，
 * 合成链页要等记赢赢首次收集后才显示整行（与记会成延伸行同理）。
 */
export interface MythRecipe {
  readonly a: TileMatcher;
  readonly b: TileMatcher;
  /** 合成链显示用：材料里出现过的产物名（用于隐藏判断） */
  readonly revealAfter: string;
}

export const MYTH_RECIPES: readonly MythRecipe[] = [
  { a: { variant: 'ji-ying-ying' }, b: { variant: 'ji-ying-ying' }, revealAfter: 'ji-ying-ying' },
];

export const PRODUCTS: Readonly<Record<string, SpecialProduct>> = {
  // 内部 id 保持 'sui-jun' 不变（写进存档），v2.3 只把显示名改成「水军」
  'sui-jun': {
    entry: { id: 'sui-jun', name: '水军', rarity: 'rare', kind: 'special', hue: 208, hue2: 184 },
    points: 64,
    buff: { id: 'sui-jun', label: '水军·蓄水', mult: 2, moves: 8 },
  },
  'sui-jun-ring': {
    // v2.4：显示名按用户原文改成「隋军隋圆」（内部 id 仍 sui-jun-ring，存档兼容）
    entry: { id: 'sui-jun-ring', name: '隋军隋圆', rarity: 'legend', kind: 'special', hue: 232, hue2: 260 },
    points: 128,
    buff: { id: 'sui-jun-ring', label: '隋军隋圆·洪峰', mult: 3, moves: 12 },
  },
  // 隋 + 钢 → 水缸：传说级，但要两条随机词条才凑得齐，给 +128；
  // 增益与水军同一梯队（×2 / 8 步），符合「水缸和水军同一梯队」的设定
  'shui-gang': {
    entry: { id: 'shui-gang', name: '水缸', rarity: 'legend', kind: 'special', hue: 172, hue2: 200 },
    points: 128,
    buff: { id: 'shui-gang', label: '水缸·盛水', mult: 2, moves: 8 },
  },
  'ji-ying-ying': {
    // v3.0：传说组里最高的牌，颜色按用户要求向 OLD FIVE 的金虹材质看齐
    entry: { id: 'ji-ying-ying', name: '记赢赢', rarity: 'legend', kind: 'special', mythic: true, hue: 292, hue2: 264 },
    points: 256,
    buff: { id: 'ji-ying-ying', label: '记赢赢·长赢', mult: 2, moves: -1 },
    trueWin: true,
  },
  // Li + Na → 李娜：跟水军同一梯队（×2 / 8 步），分数略高以匹配两条稀有词条的门槛
  lina: {
    entry: { id: 'lina', name: '李娜', rarity: 'legend', kind: 'special', hue: 46, hue2: 68 },
    points: 128,
    buff: { id: 'lina', label: '李娜·夺冠', mult: 2, moves: 8 },
  },
  // 彪 + 水³ → 妙（v2.4）：传说彩蛋，+128 / ×2 / 10 步；
  // 增益期间每次有效移动还会在棋盘上飘爱心粒子（纯表现，逻辑见 ui/board.ts + ui/app.ts）
  miao: {
    entry: { id: 'miao', name: '妙', rarity: 'legend', kind: 'special', hue: 304, hue2: 336 },
    points: 128,
    buff: { id: 'miao', label: '妙·藏庙', mult: 2, moves: 10 },
  },
  // 记赢赢 + 会成 → 记会成（v2.5）：真通关之后的隐藏延伸，+256 / ×2 / 10 步；
  // 记赢赢本身是隐藏内容，合成链行要等它首次触发后才显示，避免提前剧透。
  'ji-hui-cheng': {
    entry: { id: 'ji-hui-cheng', name: '记会成', rarity: 'legend', kind: 'special', hue: 288, hue2: 308 },
    points: 256,
    buff: { id: 'ji-hui-cheng', label: '记会成·必成', mult: 2, moves: 10 },
    revealAfter: 'ji-ying-ying',
  },
};

export const RECIPES: readonly Recipe[] = [
  { a: { variant: 'sui' }, b: { rank: 0 }, product: 'sui-jun' },
  { a: { variant: 'sui-ring' }, b: { rank: 0 }, product: 'sui-jun-ring' },
  { a: { variant: 'sui' }, b: { variant: 'gang' }, product: 'shui-gang' },
  { a: { variant: 'li' }, b: { variant: 'na' }, product: 'lina' },
  { a: { variant: 'biao' }, b: { rank: 2 }, product: 'miao' },
  { a: { variant: 'ji' }, b: { rank: 1 }, product: 'ji-ying-ying' },
  { a: { variant: 'ji-ying-ying' }, b: { variant: 'huicheng' }, product: 'ji-hui-cheng' },
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

/** 两枚方块相撞是否触发「随机传奇」配方；无序匹配，返回配方或 null */
export function matchMythRecipe(a: MatchTile, b: MatchTile): MythRecipe | null {
  for (const recipe of MYTH_RECIPES) {
    if (
      (matches(recipe.a, a) && matches(recipe.b, b)) ||
      (matches(recipe.a, b) && matches(recipe.b, a))
    ) {
      return recipe;
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