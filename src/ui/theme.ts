/**
 * 外观主题：自动（跟随系统）/ 浅色 / 深色 三态循环，偏好持久化。
 * 自动 = 不设 data-theme，交给 CSS 的 prefers-color-scheme；
 * 手动 = <html data-theme="light|dark"> 覆盖系统偏好。
 */
import type { KV } from './storage.ts';

export type ThemeMode = 'auto' | 'light' | 'dark';

const MODES: ThemeMode[] = ['auto', 'light', 'dark'];
const ICONS: Record<ThemeMode, string> = { auto: '◐', light: '☀', dark: '☾' };
const LABELS: Record<ThemeMode, string> = { auto: '跟随系统', light: '浅色', dark: '深色' };
const META_COLOR: Record<'light' | 'dark', string> = { light: '#eaf4fa', dark: '#06121a' };

export interface Theme {
  mode(): ThemeMode;
  cycle(): void;
  destroy(): void;
}

export interface ThemeOptions {
  doc: Document;
  w: Window | null;
  kv: KV;
  storageKey: string;
  button: HTMLButtonElement;
}

export function createTheme(opts: ThemeOptions): Theme {
  const { doc, w, kv, storageKey, button } = opts;
  const key = `${storageKey}.theme`;
  let mode: ThemeMode = read();

  function read(): ThemeMode {
    const raw = kv.get(key);
    return raw === 'light' || raw === 'dark' ? raw : 'auto';
  }

  function systemDark(): boolean {
    try {
      return w?.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    } catch {
      return false;
    }
  }

  function apply(): void {
    const root = doc.documentElement;
    if (mode === 'auto') root.removeAttribute('data-theme');
    else root.dataset.theme = mode;
    const effective = mode === 'auto' ? (systemDark() ? 'dark' : 'light') : mode;
    for (const meta of Array.from(doc.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'))) {
      meta.content = META_COLOR[effective];
    }
    button.textContent = ICONS[mode];
    button.setAttribute('aria-label', `外观：${LABELS[mode]}，点击切换`);
    button.title = `外观：${LABELS[mode]}（点击切换）`;
  }

  function cycle(): void {
    mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length]!;
    try {
      kv.set(key, mode);
    } catch {
      /* 存不了就只在本次会话生效 */
    }
    apply();
  }

  function onClick(): void {
    cycle();
  }
  button.addEventListener('click', onClick);

  let media: MediaQueryList | null = null;
  function onSystem(): void {
    if (mode === 'auto') apply();
  }
  try {
    media = w?.matchMedia?.('(prefers-color-scheme: dark)') ?? null;
    media?.addEventListener?.('change', onSystem);
  } catch {
    media = null;
  }

  apply();

  return {
    mode: () => mode,
    cycle,
    destroy() {
      button.removeEventListener('click', onClick);
      media?.removeEventListener?.('change', onSystem);
    },
  };
}