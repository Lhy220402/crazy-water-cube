/**
 * 版本更新提示（v2.3.0）：
 * 把玩家上次进入游戏时的版本记在 `${storageKey}.version`（第 6 个 localStorage key）。
 * 下次进入游戏时如果版本变了，就弹一次「版本已更新」，只显示版本号变动（v2.2.2 → v2.3.0）。
 *
 * 没有版本记录时怎么判断：
 *   - 已经有其它存档痕迹（棋局 / 最高分 / 图鉴 / 外观 / 声音）→ 老玩家，按 LEGACY_VERSION 算升级；
 *   - 什么存档都没有 → 新玩家，不弹（没必要告诉新玩家「更新了」）。
 * 弹过 / 进过游戏后写入当前版本，同一版本不会重复弹；读不到 / 存不了时静默降级。
 */
import type { KV } from './storage.ts';

export interface VersionChange {
  readonly from: string;
  readonly to: string;
}

export function versionKey(storageKey: string): string {
  return `${storageKey}.version`;
}

/** 去掉首尾空白与可能的 v 前缀；空值当没有记录 */
function cleanVersion(raw: string | null): string | null {
  if (!raw) return null;
  const value = raw.trim().replace(/^v/i, '');
  return value.length > 0 ? value : null;
}

/** 上次进入游戏时的版本；没有记录 / 坏值返回 null */
export function readSeenVersion(kv: KV, storageKey: string): string | null {
  try {
    return cleanVersion(kv.get(versionKey(storageKey)));
  } catch {
    return null;
  }
}

export function writeSeenVersion(kv: KV, storageKey: string, version: string): void {
  try {
    kv.set(versionKey(storageKey), version);
  } catch {
    /* 存不了就下次再弹，不影响游戏 */
  }
}

/** 有没有旧玩家的存档痕迹（不含 version 本身） */
export function hasLegacyData(kv: KV, storageKey: string): boolean {
  for (const suffix of ['', '.best', '.codex', '.theme', '.sound']) {
    try {
      if (kv.get(`${storageKey}${suffix}`) !== null) return true;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * 计算这次进入游戏要显示的版本变化（只读，不写存档）。
 * @param legacy 启用版本记录前的最后一个发布版本，用于老玩家第一次升级
 */
export function detectVersionChange(
  kv: KV,
  storageKey: string,
  current: string,
  legacy: string,
): VersionChange | null {
  const seen = readSeenVersion(kv, storageKey);
  if (seen !== null) {
    return seen === current ? null : { from: seen, to: current };
  }
  if (!hasLegacyData(kv, storageKey)) return null;
  return legacy === current ? null : { from: legacy, to: current };
}

/** 弹层里显示的文案：只显示版本号变动 */
export function versionChangeText(change: VersionChange): string {
  return `v${change.from} → v${change.to}`;
}
