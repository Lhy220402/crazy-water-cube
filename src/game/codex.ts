/**
 * 图鉴词条池 —— 合出 OLD FIVE 之后，每次词条级合成都从这里随机抽一条。
 *
 * 想加新词条，只在 CODEX_ENTRIES 追加一项，其余全部自动生效：
 *   - 棋盘方块、图鉴收集页、进度统计、无障碍文本都会跟着变
 *   - 存档只记词条 id，加词条不会让正在进行的这局作废
 *   - 调整顺序/权重只影响之后的抽取，不影响已收集记录
 *
 * 字段说明：
 *   id     稳定标识，写进存档；改名不会丢收集记录（不要轻易改 id）
 *   name   显示名（图鉴、棋子上都显示这个）
 *   rarity 稀有度：只影响显示与抽取概率，不影响配对（任意两条词条都能合）
 *   ring   true 时名字外面画一个圆圈（「圈隋」）
 *   recipe 配方提示，显示在棋子角上（如 '+军'），告诉玩家它还能跟谁特殊合成
 *   desc   一句话说明；详细解释放在 lore.ts（首次收录时弹出）
 *   weight 抽取权重，默认 1；稀有度越高权重越小
 *   hue    方块/卡片渐变的主色相（0-360）；不写则按池子顺序自动分配
 *   hue2   渐变的第二色相；不写则主色相 +34，保证同一色系的两条词条也能区分
 *
 * 特殊合成产物（水军 / 水军·环 / 水缸 / 记赢赢 / 李娜）不在抽取池里，见 recipes.ts。
 */

export type RarityId = 'common' | 'rare' | 'legend';

export interface Rarity {
  readonly id: RarityId;
  readonly label: string;
  /** 棋子角标上的单字 */
  readonly short: string;
  /** 描边 / 徽标色 */
  readonly color: string;
}

/**
 * 稀有度配色：只负责「身份 + 描边 + 角标」，词条本身的颜色看 hue。
 * 普通 = 浅海青，稀有 = 深水蓝，传说 = 落日金。
 */
export const RARITIES: Readonly<Record<RarityId, Rarity>> = {
  common: { id: 'common', label: '普通', short: '普', color: '#5aa9bd' },
  rare: { id: 'rare', label: '稀有', short: '稀', color: '#4a82e0' },
  legend: { id: 'legend', label: '传说', short: '传', color: '#dda23a' },
};

export interface CodexEntry {
  readonly id: string;
  readonly name: string;
  readonly rarity: RarityId;
  /** 'entry' = 随机池词条；'special' = 特殊合成产物（不进抽取池） */
  readonly kind?: 'entry' | 'special';
  /** 名字外画圆圈 */
  readonly ring?: boolean;
  /** 特殊配方提示，如 '+军' */
  readonly recipe?: string;
  readonly desc?: string;
  readonly weight?: number;
  /** 棋子 / 卡片渐变主色相（0-360） */
  readonly hue?: number;
  /** 渐变第二色相（0-360） */
  readonly hue2?: number;
}

/** 随机词条池：OLD FIVE 之后按权重抽取（普通多、稀有少、传说最少） */
export const CODEX_ENTRIES: readonly CodexEntry[] = [
  // 原有 5 条：颜色按「水」的层次安排，保持老玩家熟悉的观感
  { id: 'sui', name: '隋', rarity: 'common', recipe: '+军', weight: 6, hue: 196, hue2: 224 },
  { id: 'eyu-qi', name: '鳄鱼鳍', rarity: 'rare', weight: 3, hue: 148, hue2: 176 },
  { id: 'sui-ring', name: '隋', rarity: 'rare', ring: true, recipe: '+军', weight: 2, hue: 216, hue2: 246 },
  { id: 'eyu-shi-jun', name: '鳄食菌', rarity: 'legend', weight: 1.2, hue: 96, hue2: 126 },
  { id: 'ji', name: '记', rarity: 'legend', weight: 0.8, hue: 276, hue2: 306 },

  // 新增 9 条稀有词条：颜色尽量按语义分开
  { id: 'bayi', name: '八一', rarity: 'rare', weight: 2, hue: 4, hue2: 32 }, // 军旗红
  { id: 'hongmei', name: '红梅', rarity: 'rare', weight: 2, hue: 338, hue2: 310 }, // 梅花粉
  { id: 'jinshan', name: '金山', rarity: 'rare', weight: 2, hue: 44, hue2: 70 }, // 金山金
  { id: 'fuli', name: '浮力', rarity: 'rare', weight: 2, hue: 182, hue2: 156 }, // 浮力青
  { id: 'li', name: 'Li', rarity: 'rare', weight: 2, hue: 318, hue2: 346 }, // 锂焰紫红
  { id: 'na', name: 'Na', rarity: 'rare', weight: 2, hue: 58, hue2: 86 }, // 钠焰黄
  { id: 'xiaoming', name: '小明', rarity: 'rare', weight: 2, hue: 236, hue2: 208 }, // 课本蓝紫
  { id: 'yanzi', name: '燕子', rarity: 'rare', weight: 2, hue: 202, hue2: 176 }, // 天空蓝
  { id: 'doubao', name: '豆包AI', rarity: 'rare', weight: 2, hue: 266, hue2: 296 }, // AI 紫

  // v2.2 新增 3 条（用户提供文案）：仍按稀有默认权重 2，颜色避开已有色相
  { id: 'biao', name: '彪', rarity: 'rare', weight: 2, hue: 24, hue2: 350 }, // 彪悍橙红
  { id: 'huicheng', name: '会成', rarity: 'rare', weight: 2, hue: 132, hue2: 104 }, // 会成绿
  { id: 'xiaoyu', name: '🌧️', rarity: 'rare', weight: 2, hue: 252, hue2: 224 }, // 小雨蓝紫

  // v2.3 新增 4 条（用户提供文案）：钢 是「隋 + 钢 → 水缸」的配方材料，带 +隋 提示
  { id: 'gang', name: '钢', rarity: 'rare', weight: 2, recipe: '+隋', hue: 205, hue2: 235 }, // 钢蓝
  { id: 'weihai', name: '威海', rarity: 'rare', weight: 2, hue: 188, hue2: 164 }, // 海风青
  { id: 'dingjian', name: '钉剑', rarity: 'rare', weight: 2, hue: 30, hue2: 52 }, // 锈铁橙
  { id: 'junzhu', name: '君竹', rarity: 'rare', weight: 2, hue: 106, hue2: 82 }, // 竹青
];

/** 纯文本场景（无障碍、配方列表）用的名字：圈隋写作「隋·环」 */
export function entryText(entry: CodexEntry): string {
  return entry.ring ? `${entry.name}·环` : entry.name;
}

export function findCodexEntry(
  entries: readonly CodexEntry[],
  id: string,
): CodexEntry | undefined {
  return entries.find((entry) => entry.id === id);
}

/** 按权重随机抽一条词条；允许重复抽到同一条（重复只增加出现次数） */
export function drawCodexEntry(entries: readonly CodexEntry[], rng: () => number): CodexEntry {
  if (entries.length === 0) throw new Error('词条池为空');
  let total = 0;
  for (const entry of entries) total += entry.weight && entry.weight > 0 ? entry.weight : 1;
  let roll = Math.min(Math.max(rng(), 0), 0.999999999) * total;
  for (const entry of entries) {
    roll -= entry.weight && entry.weight > 0 ? entry.weight : 1;
    if (roll < 0) return entry;
  }
  return entries[entries.length - 1]!;
}

/** 给每条词条一个稳定的色相，图鉴和棋子配色都用它（显式 hue 优先） */
export function entryHue(entries: readonly CodexEntry[], id: string): number {
  const entry = entries.find((item) => item.id === id);
  if (entry?.hue !== undefined) return entry.hue;
  const index = entries.findIndex((item) => item.id === id);
  if (index >= 0) return (196 + index * 67) % 360;
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) % 360;
  return hash;
}

/** 配色的第二色相（显式 hue2 优先，否则向后偏移 34°） */
export function entryHue2(entries: readonly CodexEntry[], id: string): number {
  const entry = entries.find((item) => item.id === id);
  if (entry?.hue2 !== undefined) return entry.hue2;
  return (entryHue(entries, id) + 34) % 360;
}

/** 从词条对象直接取两个色相：特殊产物不在抽取池里，用这个少一次查找 */
export function huesOf(
  entry: CodexEntry | undefined,
  entries: readonly CodexEntry[],
  fallbackId: string,
): { hue: number; hue2: number } {
  const hue = entry?.hue ?? entryHue(entries, fallbackId);
  return { hue, hue2: entry?.hue2 ?? entryHue2(entries, fallbackId) };
}
