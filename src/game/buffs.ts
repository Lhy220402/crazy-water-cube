/**
 * 增益（buff）机制 —— 纯函数。
 * 特殊合成会挂一个增益：后续若干步内所有合成得分乘以倍率；多个增益乘算叠加。
 * 创建当步不消耗步数，从下一步开始倒数；movesLeft = -1 表示本局永久。
 */

export interface Buff {
  readonly id: string;
  readonly label: string;
  readonly mult: number;
  /** 剩余步数；-1 = 永久 */
  readonly movesLeft: number;
}

export function buffMultiplier(buffs: readonly Buff[]): number {
  let mult = 1;
  for (const buff of buffs) if (buff.mult > 0) mult *= buff.mult;
  return mult;
}

/** 一次有效移动后：有限增益 -1 步，到 0 移除；永久增益保留 */
export function tickBuffs(buffs: readonly Buff[]): Buff[] {
  const out: Buff[] = [];
  for (const buff of buffs) {
    if (buff.movesLeft < 0) {
      out.push({ ...buff });
    } else if (buff.movesLeft > 1) {
      out.push({ ...buff, movesLeft: buff.movesLeft - 1 });
    }
  }
  return out;
}

export function cloneBuffs(buffs: readonly Buff[]): Buff[] {
  return buffs.map((buff) => ({ ...buff }));
}

/** 存档里的增益校验：坏数据当作没有增益（不让棋局作废） */
export function parseBuffs(raw: unknown): Buff[] {
  if (!Array.isArray(raw)) return [];
  const out: Buff[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const buff = item as Partial<Buff>;
    if (
      typeof buff.id === 'string' &&
      typeof buff.label === 'string' &&
      typeof buff.mult === 'number' &&
      Number.isFinite(buff.mult) &&
      buff.mult >= 1 &&
      typeof buff.movesLeft === 'number' &&
      Number.isInteger(buff.movesLeft) &&
      buff.movesLeft >= -1
    ) {
      out.push({ id: buff.id, label: buff.label, mult: buff.mult, movesLeft: buff.movesLeft });
    }
  }
  return out;
}