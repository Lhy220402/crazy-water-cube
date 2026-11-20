/**
 * 合成体系配置 —— 想加新等级时，只改这里（外加可选的 CSS 主题变量）。
 *
 * 规则：rank = tiers 数组下标；两枚同级相碰 → 合成下标 +1 的等级。
 * 数组最后一项就是「终点」，它不会再合并（通关判定默认也是它）。
 * 以后要加「刘 No.5 → ???」，只需在 TIERS 末尾追加一项，
 * 通关等级 winRank 会自动跟着最后一项走。
 */

export interface Tier {
  /** 稳定 id，写进存档签名；改名不影响存档兼容性 */
  readonly id: string;
  /** 主标签 */
  readonly label: string;
  /** 上标（如 ²、³、No.5），可省略 */
  readonly sup?: string;
  /** 完整名称，用于图鉴、无障碍文本、标题 */
  readonly name: string;
  /** 合成出该等级时加的分数 */
  readonly points: number;
  /** 拉丁字母标签，排版时用更小的字号 */
  readonly latin?: boolean;
}

export interface SpawnRule {
  /** 新方块等级 */
  readonly rank: number;
  /** 权重（相对值） */
  readonly weight: number;
}

export interface GameConfig {
  /** 棋盘边长（格子数） */
  readonly size: number;
  readonly tiers: readonly Tier[];
  /** 开局 / 每次移动后生成新方块的等级分布 */
  readonly spawn: readonly SpawnRule[];
  /** 合出该等级即通关；默认 = tiers 最后一项 */
  readonly winRank: number;
  /** 撤销步数上限 */
  readonly undoLimit: number;
  /** 存档键前缀 */
  readonly storageKey: string;
  /** 等级配置签名；存档签名不一致时自动放弃旧档，避免等级错位 */
  readonly tiersSignature: string;
}

/** 当前这套合成体系：军 → 赢² → 水³ → Lec → 刘 No.5 */
export const TIERS: readonly Tier[] = [
  { id: 'jun', label: '军', name: '军', points: 2 },
  { id: 'win', label: '赢', sup: '²', name: '赢²', points: 4 },
  { id: 'water', label: '水', sup: '³', name: '水³', points: 8 },
  { id: 'lec', label: 'Lec', name: 'Lec', points: 16, latin: true },
  { id: 'liu', label: '刘', sup: 'No.5', name: '刘 No.5', points: 32 },
];

/** 90% 生成「军」，10% 生成「赢²」，和原版 2048 的 2/4 手感一致 */
export const DEFAULT_SPAWN: readonly SpawnRule[] = [
  { rank: 0, weight: 9 },
  { rank: 1, weight: 1 },
];

function signatureOf(tiers: readonly Tier[]): string {
  return tiers.map((tier) => tier.id).join('|');
}

/** 由覆盖项生成一份完整配置；不传参数就是默认配置 */
export function createConfig(overrides: Partial<Omit<GameConfig, 'tiersSignature'>> = {}): GameConfig {
  const tiers = overrides.tiers ?? TIERS;
  if (tiers.length < 2) throw new Error('合成体系至少需要两个等级');
  const spawn =
    overrides.spawn ??
    tiers
      .slice(0, Math.min(2, tiers.length))
      .map((_, rank) => ({ rank, weight: rank === 0 ? 9 : 1 }));
  const winRank = overrides.winRank ?? tiers.length - 1;
  if (winRank < 1 || winRank >= tiers.length) throw new Error('winRank 超出等级范围');
  for (const rule of spawn) {
    if (!Number.isInteger(rule.rank) || rule.rank < 0 || rule.rank >= tiers.length) {
      throw new Error(`生成规则 rank=${rule.rank} 超出等级范围`);
    }
    if (!(rule.weight > 0)) throw new Error('生成规则权重必须为正数');
  }
  return {
    size: overrides.size ?? 4,
    tiers,
    spawn,
    winRank,
    undoLimit: overrides.undoLimit ?? 20,
    storageKey: overrides.storageKey ?? 'jun2048',
    tiersSignature: signatureOf(tiers),
  };
}

export const DEFAULT_CONFIG: GameConfig = createConfig();

/** 该等级能否继续参与合成（终点等级不行） */
export function canMergeRank(config: GameConfig, rank: number): boolean {
  return rank >= 0 && rank + 1 < config.tiers.length;
}

export function tierAt(config: GameConfig, rank: number): Tier | undefined {
  return config.tiers[rank];
}
