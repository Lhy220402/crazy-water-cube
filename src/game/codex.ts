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
 *   name   显示名（图鉴卡片 / 解释卡 / 配方文本用）
 *   rarity 稀有度：只影响显示与抽取概率，不影响配对（任意两条词条都能合）
 *   ring   true 时棋子上名字外面画一个圆圈（「隋圆」的棋子视觉）
 *   recipe 配方提示，显示在棋子角上（如 '+军'），告诉玩家它还能跟谁特殊合成
 *   tileName 棋子上显示的字（圆环词条用；省略时用 name）
 *   desc   一句话说明；详细解释放在 lore.ts（首次收录时弹出）
 *   weight 抽取权重，默认 1；稀有度越高权重越小
 *   hue    方块/卡片渐变的主色相（0-360）；不写则按池子顺序自动分配
 *   hue2   渐变的第二色相；不写则主色相 +34，保证同一色系的两条词条也能区分
 *
 * 特殊合成产物（水军 / 隋军隋圆 / 水缸 / 记赢赢 / 李娜 / 妙 / 记会成）不在抽取池里，见 recipes.ts。
 */

export type RarityId = 'common' | 'rare' | 'legend' | 'myth';

export interface Rarity {
  readonly id: RarityId;
  readonly label: string;
  /** 棋子角标上的单字 */
  readonly short: string;
  /** 描边 / 徽标色 */
  readonly color: string;
}

/**
 * 稀有度配色：只负责「身份 + 描边 + 角标 + 光效」，词条本身的颜色看 hue。
 * v2.4 起游戏内不再出现「普通」词条（全部升为稀有），common 仅保留给旧接口兼容。
 * v2.4 重新定调：低饱和的银蓝 / 香槟金，不要电光蓝和亮金，光效改为静态细边高光。
 */
export const RARITIES: Readonly<Record<RarityId, Rarity>> = {
  common: { id: 'common', label: '普通', short: '普', color: '#8aa2b4' },
  rare: { id: 'rare', label: '稀有', short: '稀', color: '#8ca6bc' },
  legend: { id: 'legend', label: '传说', short: '传', color: '#c3a675' },
  // v3.0：传奇是当前版本最高等级，只从「两枚记赢赢」的抽取里出现
  myth: { id: 'myth', label: '传奇', short: '奇', color: '#c1903f' },
};

export interface CodexEntry {
  readonly id: string;
  readonly name: string;
  readonly rarity: RarityId;
  /** 'entry' = 随机池词条；'special' = 特殊合成产物（不进抽取池） */
  readonly kind?: 'entry' | 'special';
  /** 名字外画圆圈（棋子视觉；图鉴名称仍用 name） */
  readonly ring?: boolean;
  /** 棋子上显示的字（带圆环的词条用，如隋圆 → 棋子写「隋」） */
  readonly tileName?: string;
  /** 特殊配方提示，如 '+军' */
  readonly recipe?: string;
  readonly desc?: string;
  readonly weight?: number;
  /** 棋子 / 卡片渐变主色相（0-360） */
  readonly hue?: number;
  /** 渐变第二色相（0-360）；v2.4 起与 hue 的差值收窄，避免两块颜色打架 */
  readonly hue2?: number;
  /**
   * v3.0：传说完美级材质 —— 与 OLD FIVE 同款金虹玻璃（记赢赢用）。
   * 只影响表现层；传奇稀有度有自己的一整套金虹材质，不需要这个字段。
   */
  readonly mythic?: boolean;
}

/**
 * 随机词条池（33 条）。
 *
 * v2.4 配色原则：
 *   - 只取「水」的色域：湖蓝 / 青灰 / 雾蓝 / 靛蓝为主，局部用低饱和的梅粉、赭红、香槟金做语义点缀；
 *   - 色相本身不再拉满彩虹，实际饱和度由 CSS 控制在 40%–55%，呈现水彩玻璃质感；
 *   - hue2 与 hue 只差 12°–24°，让一块方块内部是一个色系，不是撞色。
 */
export const CODEX_ENTRIES: readonly CodexEntry[] = [
  // 原有 5 条
  // v2.4：游戏内不再有「普通」词条，隋（权重最高的常客）一并升为稀有
  { id: 'sui', name: '隋', rarity: 'rare', recipe: '+军', weight: 6, hue: 202, hue2: 216 }, // 湖蓝
  { id: 'eyu-qi', name: '鳄鱼鳍', rarity: 'rare', weight: 3, hue: 162, hue2: 176 }, // 水下苔绿
  { id: 'sui-ring', name: '隋圆', tileName: '隋', rarity: 'rare', ring: true, recipe: '+军', weight: 2, hue: 222, hue2: 236 }, // 深水蓝
  { id: 'eyu-shi-jun', name: '鳄食菌', rarity: 'legend', weight: 1.2, hue: 130, hue2: 146 }, // 苔原青
  { id: 'ji', name: '记', rarity: 'legend', weight: 0.8, hue: 258, hue2: 272 }, // 靛紫

  // 新增 9 条稀有词条
  { id: 'bayi', name: '八一', rarity: 'rare', weight: 2, hue: 8, hue2: 350 }, // 军旗暗红
  { id: 'hongmei', name: '红梅', rarity: 'rare', weight: 2, hue: 344, hue2: 330 }, // 雾梅粉
  { id: 'jinshan', name: '金山', rarity: 'rare', weight: 2, hue: 44, hue2: 54 }, // 旧金
  { id: 'fuli', name: '浮力', rarity: 'rare', weight: 2, hue: 184, hue2: 170 }, // 浮力青
  { id: 'li', name: 'Li', rarity: 'rare', weight: 2, hue: 306, hue2: 322 }, // 锂焰灰紫
  { id: 'na', name: 'Na', rarity: 'rare', weight: 2, hue: 46, hue2: 34 }, // 钠焰浅琥珀
  { id: 'xiaoming', name: '小明', rarity: 'rare', weight: 2, hue: 238, hue2: 220 }, // 课本蓝紫
  { id: 'yanzi', name: '燕子', rarity: 'rare', weight: 2, hue: 208, hue2: 190 }, // 天空蓝
  { id: 'doubao', name: '豆包AI', rarity: 'rare', weight: 2, hue: 270, hue2: 250 }, // AI 雾紫

  // v2.2 新增 3 条
  // v2.4：彪 + 水³ → 妙，棋子上显示「+水³」配方提示
  { id: 'biao', name: '彪', rarity: 'rare', weight: 2, recipe: '+水³', hue: 22, hue2: 352 }, // 赭红
  { id: 'huicheng', name: '会成', rarity: 'rare', weight: 2, hue: 142, hue2: 122 }, // 灰绿
  { id: 'xiaoyu', name: '🌧️', rarity: 'rare', weight: 2, hue: 250, hue2: 230 }, // 雨雾蓝紫

  // v2.3 新增 4 条
  { id: 'gang', name: '钢', rarity: 'rare', weight: 2, recipe: '+隋', hue: 206, hue2: 194 }, // 钢蓝灰
  { id: 'weihai', name: '威海', rarity: 'rare', weight: 2, hue: 190, hue2: 174 }, // 海风青
  { id: 'dingjian', name: '钉剑', rarity: 'rare', weight: 2, hue: 32, hue2: 48 }, // 锈铁褐
  { id: 'junzhu', name: '君竹', rarity: 'rare', weight: 2, hue: 116, hue2: 96 }, // 竹青

  // v2.4 新增 5 条
  { id: 'chenglong', name: '成龙', rarity: 'rare', weight: 2, hue: 2, hue2: 346 }, // 港片暗红
  { id: 'batian', name: '霸天', rarity: 'rare', weight: 2, hue: 280, hue2: 260 }, // 雾紫
  { id: 'neng', name: '能', rarity: 'rare', weight: 2, hue: 170, hue2: 150 }, // 能量青
  { id: 'zhaoyiming', name: '赵一鸣', rarity: 'rare', weight: 2, hue: 38, hue2: 54 }, // 暖沙
  { id: 'sudailiao', name: '塑料袋', rarity: 'rare', weight: 2, hue: 216, hue2: 200 }, // 塑封蓝灰

  // v2.5 新增 3 条
  { id: 'zuolun', name: '左轮', rarity: 'rare', weight: 2, hue: 218, hue2: 202 }, // 冷钢蓝
  { id: 'yu-zi', name: '鱼籽', rarity: 'rare', weight: 2, hue: 16, hue2: 30 }, // 鱼籽橙
  { id: 'he-si', name: '何思', rarity: 'rare', weight: 2, hue: 248, hue2: 232 }, // 雾沉思蓝

  // v3.0.1 修正：按用户最初给的稀有度，这 4 条回到普通抽取池（不是传奇）
  { id: 'meihui', name: '煤灰', rarity: 'legend', weight: 1, hue: 218, hue2: 200 }, // 冷灰
  { id: 'zhaojun', name: '昭君', rarity: 'legend', weight: 1, hue: 350, hue2: 22 }, // 昭君红
  { id: 'xiangjun', name: '象郡', rarity: 'rare', weight: 2, hue: 36, hue2: 24 }, // 旧铜
  { id: 'xiaofeng', name: '小风', rarity: 'legend', weight: 1, hue: 190, hue2: 170 }, // 风青
];

/**
 * 传奇词条池（8 条，v3.0.1）。不进上面的随机池，也不会从 OLD FIVE / 普通词条合成里抽到：
 * 唯一入口是「记赢赢 × 记赢赢」相撞后从这里随机抽一条。
 * 全部为 myth 稀有度、权重均匀（默认 1），图鉴里单独分区。
 */
export const MYTH_ENTRIES: readonly CodexEntry[] = [
  { id: 'yingtao', name: '🍒', rarity: 'myth', weight: 1, hue: 344, hue2: 352 }, // 樱桃
  { id: 'jiasheng', name: '假生', rarity: 'myth', weight: 1, hue: 42, hue2: 30 }, // 暖金
  { id: '666', name: '666', rarity: 'myth', weight: 1, hue: 28, hue2: 48 }, // 琥珀
  { id: 'hongying', name: '红鹰', rarity: 'myth', weight: 1, hue: 12, hue2: 350 }, // 红鹰
  { id: 'wangxuedi', name: '王雪地', rarity: 'myth', weight: 1, hue: 205, hue2: 188 }, // 雪地蓝
  { id: 'zhongshu', name: '种树', rarity: 'myth', weight: 1, hue: 128, hue2: 108 }, // 树青
  { id: 'guojing', name: '国晶', rarity: 'myth', weight: 1, hue: 260, hue2: 240 }, // 晶紫
  { id: 'chuncheng', name: '春橙', rarity: 'myth', weight: 1, hue: 18, hue2: 36 }, // 春橙
];

/**
 * v3.0.1 修正前误放进传奇池的 4 条 id（现在分别是传说 / 稀有）。
 * 读旧档迁移时，只把 rank 6 上的这些 id 随机换成当前传奇池里的正确传奇；
 * 其他位置（普通词条、图鉴收录）保持不动。
 */
export const LEGACY_MISLABELED_MYTH_IDS: readonly string[] = [
  'meihui',
  'zhaojun',
  'xiangjun',
  'xiaofeng',
];

/** 纯文本场景（无障碍、图鉴卡片、解释卡、配方列表）用的名字 */
export function entryText(entry: CodexEntry): string {
  return entry.name;
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
