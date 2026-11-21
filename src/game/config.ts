/**
 * 合成体系配置 —— 想加新等级 / 新词条时，只改这里（外加可选的 CSS 变量）。
 *
 * 固定等级链：rank = tiers 数组下标；两枚同级相碰 → 合成下标 +1 的等级。
 * 终点之后的收集模式：tiers 最后一项（OLD FIVE）之后没有固定名字了，
 * 继续合成会从 codex 词条池里随机抽一条，此后任意两条词条相碰都再随机抽一条。
 * 特殊配方（隋+军 等）见 recipes.ts，优先于同级判定。
 * 想加新的固定等级？直接在 TIERS 末尾追加一项，词条模式的入口会自动后移。
 */
import { CODEX_ENTRIES, findCodexEntry, type CodexEntry } from './codex.ts';
import { specialEntries } from './recipes.ts';

export type { CodexEntry } from './codex.ts';

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

/** 终点之后的「词条收集」模式配置 */
export interface CodexConfig {
  /** 随机抽取池 */
  readonly entries: readonly CodexEntry[];
  /** 每次词条合成都加这么多分（再乘增益倍率） */
  readonly points: number;
  /** 特殊合成产物：不进抽取池，触发即收录图鉴 */
  readonly specials: readonly CodexEntry[];
}

export interface GameConfig {
  /** 棋盘边长（格子数） */
  readonly size: number;
  readonly tiers: readonly Tier[];
  /** 开局 / 每次移动后生成新方块的等级分布 */
  readonly spawn: readonly SpawnRule[];
  /** 合出该等级即假通关（第一次合出 OLD FIVE）；默认 = tiers 最后一项 */
  readonly winRank: number;
  /** 撤销步数上限 */
  readonly undoLimit: number;
  /** 存档键前缀 */
  readonly storageKey: string;
  /** 词条收集模式；不传则不开启，tiers 最后一级就是终点 */
  readonly codex?: CodexConfig;
  /** 词条等级的 rank（= tiers.length）；没有词条模式时为 -1 */
  readonly codexRank: number;
  /** 合法等级上限，用于存档校验 */
  readonly maxRank: number;
  /** 等级配置签名；存档签名不一致时自动放弃旧档，避免等级错位 */
  readonly tiersSignature: string;
}

/** 当前这套合成体系：军 → 赢² → 水³ → Lec → OLD FIVE →（随机词条…）
 *  注意：liu 这个 id 是存档身份，改名不改 id，等级签名保持兼容。 */
export const TIERS: readonly Tier[] = [
  { id: 'jun', label: '军', name: '军', points: 2 },
  { id: 'win', label: '赢', sup: '²', name: '赢²', points: 4 },
  { id: 'water', label: '水', sup: '³', name: '水³', points: 8 },
  { id: 'lec', label: 'Lec', name: 'Lec', points: 16, latin: true },
  { id: 'liu', label: 'OLD FIVE', name: 'OLD FIVE', points: 32, latin: true },
];

/** 90% 生成「军」，10% 生成「赢²」，和原版 2048 的 2/4 手感一致 */
export const DEFAULT_SPAWN: readonly SpawnRule[] = [
  { rank: 0, weight: 9 },
  { rank: 1, weight: 1 },
];

/** 默认的词条收集配置：词条池 + 特殊产物 + 每次合成得分 */
export const DEFAULT_CODEX: CodexConfig = {
  entries: CODEX_ENTRIES,
  points: 64,
  specials: specialEntries(),
};

function signatureOf(tiers: readonly Tier[]): string {
  return tiers.map((tier) => tier.id).join('|');
}

/** 由覆盖项生成一份完整配置；不传参数就是默认配置 */
export type ConfigOverrides = Partial<Omit<GameConfig, 'tiersSignature' | 'codex'>> & {
  /** 传 null 表示关闭词条收集模式，让 tiers 最后一级重新变回终点 */
  codex?: CodexConfig | null;
};

export function createConfig(overrides: ConfigOverrides = {}): GameConfig {
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

  const codex = overrides.codex === null ? undefined : (overrides.codex ?? DEFAULT_CODEX);
  if (codex && codex.entries.length === 0) throw new Error('词条池不能为空');
  if (codex && !(codex.points > 0)) throw new Error('词条得分必须为正数');
  const codexRank = codex ? tiers.length : -1;
  const maxRank = codex ? codexRank : tiers.length - 1;

  return {
    size: overrides.size ?? 4,
    tiers,
    spawn,
    winRank,
    undoLimit: overrides.undoLimit ?? 20,
    storageKey: overrides.storageKey ?? 'jun2048',
    ...(codex ? { codex } : {}),
    codexRank,
    maxRank,
    tiersSignature: signatureOf(tiers),
  };
}

export const DEFAULT_CONFIG: GameConfig = createConfig();

/** 该等级能否继续参与合成：普通等级升一级；OLD FIVE 进词条；词条之间继续随机 */
export function canMergeRank(config: GameConfig, rank: number): boolean {
  if (rank < 0) return false;
  if (rank + 1 < config.tiers.length) return true;
  if (rank === config.tiers.length - 1) return config.codex !== undefined;
  return config.codex !== undefined && rank === config.codexRank;
}

/** 两枚 rank 级合成后得到的等级：普通等级升一级，OLD FIVE 及词条都落在词条级 */
export function mergedRankOf(config: GameConfig, rank: number): number {
  return rank >= config.tiers.length - 1 ? config.codexRank : rank + 1;
}

/** 合成出某个等级时的得分 */
export function pointsForRank(config: GameConfig, rank: number): number {
  if (rank === config.codexRank) return config.codex?.points ?? 0;
  return config.tiers[rank]?.points ?? 0;
}

/** 这个等级是不是「随机词条级」 */
export function isCodexRank(config: GameConfig, rank: number): boolean {
  return config.codex !== undefined && rank === config.codexRank;
}

export function tierAt(config: GameConfig, rank: number): Tier | undefined {
  return config.tiers[rank];
}

/** 按 id 找词条（抽取池 + 特殊产物）；存档校验与渲染都用它 */
export function entryById(config: GameConfig, id: string): CodexEntry | undefined {
  if (!config.codex) return undefined;
  return (
    findCodexEntry(config.codex.entries, id) ?? findCodexEntry(config.codex.specials, id)
  );
}

/** 图鉴可收录的全部词条（抽取池 + 特殊产物） */
export function allEntries(config: GameConfig): readonly CodexEntry[] {
  if (!config.codex) return [];
  return [...config.codex.entries, ...config.codex.specials];
}
