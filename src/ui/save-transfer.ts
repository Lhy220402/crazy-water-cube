/**
 * 存档导出 / 导入：把 localStorage 里的棋局、最高分、图鉴打包成一段可复制的存档码。
 *
 * 只有这三个 key 会进存档码：
 *   jun2048 / jun2048.best / jun2048.codex
 * 不包含外观、声音偏好，也不包含任何设备信息；不联网。
 *
 * 存档码格式：JWC1.<base64url(JSON { v:1, game, best, codex })>
 * 外部入口（微信临时文件、不同浏览器、Pages / 本地文件）之间 localStorage 不互通，
 * 需要换入口时用这里导出 / 导入。
 */
import type { KV } from './storage.ts';

export const SAVE_CODE_PREFIX = 'JWC1.';
const MAX_FIELD_LENGTH = 300_000;
const MAX_CODE_LENGTH = 500_000;

export interface SaveBundle {
  /** `jun2048` 原始 JSON 字符串（当前棋局） */
  readonly game: string | null;
  /** `jun2048.best` 原始字符串 */
  readonly best: string | null;
  /** `jun2048.codex` 原始 JSON 字符串（图鉴计数） */
  readonly codex: string | null;
}

export function readSaveBundle(kv: KV, storageKey: string): SaveBundle {
  return {
    game: kv.get(storageKey),
    best: kv.get(`${storageKey}.best`),
    codex: kv.get(`${storageKey}.codex`),
  };
}

export function writeSaveBundle(kv: KV, storageKey: string, bundle: SaveBundle): void {
  writeOrRemove(kv, storageKey, bundle.game);
  writeOrRemove(kv, `${storageKey}.best`, bundle.best);
  writeOrRemove(kv, `${storageKey}.codex`, bundle.codex);
}

function writeOrRemove(kv: KV, key: string, value: string | null): void {
  if (value === null) {
    kv.remove(key);
    return;
  }
  kv.set(key, value);
}

function utf8Bytes(text: string): number[] {
  if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(text));
  // jsdom / 老 WebView 没有 TextEncoder 时的兜底：按 UTF-8 百分号编码还原字节
  const encoded = encodeURIComponent(text);
  const bytes: number[] = [];
  for (let i = 0; i < encoded.length; i += 1) {
    if (encoded[i] === '%') {
      bytes.push(Number.parseInt(encoded.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(encoded.charCodeAt(i));
    }
  }
  return bytes;
}

function decodeUtf8(bytes: ArrayLike<number>): string {
  const array = Array.from(bytes);
  if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(Uint8Array.from(array));
  let encoded = '';
  for (const byte of array) encoded += `%${byte.toString(16).padStart(2, '0')}`;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return '';
  }
}

function toBase64Url(text: string): string {
  let binary = '';
  for (const byte of utf8Bytes(text)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(code: string): string | null {
  try {
    const normalized = code.replaceAll('-', '+').replaceAll('_', '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    return decodeUtf8(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
  } catch {
    return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validField(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.length <= MAX_FIELD_LENGTH);
}

function validJsonObject(text: string): boolean {
  try {
    return isPlainObject(JSON.parse(text));
  } catch {
    return false;
  }
}

export function encodeSaveBundle(bundle: SaveBundle): string {
  const payload = JSON.stringify({
    v: 1,
    game: bundle.game,
    best: bundle.best,
    codex: bundle.codex,
  });
  return SAVE_CODE_PREFIX + toBase64Url(payload);
}

export function decodeSaveBundle(text: string): SaveBundle | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith(SAVE_CODE_PREFIX) || trimmed.length > MAX_CODE_LENGTH) return null;
  const json = fromBase64Url(trimmed.slice(SAVE_CODE_PREFIX.length));
  if (json === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed) || parsed.v !== 1) return null;
  const { game, best, codex } = parsed;
  if (!validField(game) || !validField(best) || !validField(codex)) return null;
  if (best !== null && !/^\d{1,15}$/.test(best)) return null;
  if (codex !== null && !validJsonObject(codex)) return null;
  if (game !== null && !validJsonObject(game)) return null;
  return { game, best, codex };
}

/** 导入成功后展示的摘要：最高分 + 图鉴条数 */
export function summarizeSaveBundle(bundle: SaveBundle): string {
  const bestValue = bundle.best ? Number(bundle.best) : 0;
  const best = Number.isFinite(bestValue) && bestValue > 0 ? Math.floor(bestValue) : 0;
  let collected = 0;
  if (bundle.codex !== null) {
    try {
      const parsed: unknown = JSON.parse(bundle.codex);
      if (isPlainObject(parsed)) {
        collected = Object.values(parsed).filter(
          (count) => typeof count === 'number' && Number.isFinite(count) && count > 0,
        ).length;
      }
    } catch {
      collected = 0;
    }
  }
  return `最高分 ${best} · 图鉴 ${collected} 条`;
}
