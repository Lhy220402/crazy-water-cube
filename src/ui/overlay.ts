/**
 * 居中弹层：假通关 / 真通关 / 结束 / 确认 / 词条解释 / 关于 / 版本更新。
 * 打开时禁止棋盘移动（由 app 的 dialogOpen 统一判断）；遮罩点击关闭；焦点恢复。
 */
import { cancelTimer, el, later } from './dom.ts';

const OVERLAY_MS = 240;

export type OverlayKind = 'win' | 'truewin' | 'myth' | 'over' | 'confirm' | 'lore' | 'about' | 'update';

export interface OverlayAction {
  label: string;
  primary?: boolean;
  action?: () => void;
  /** 有 href 时渲染成链接（新窗口打开），用于「关于」里的仓库地址 */
  href?: string;
}

export interface OverlayContent {
  kind: OverlayKind;
  eyebrow: string;
  title: string;
  text: string;
  stats?: { label: string; value: string }[];
  actions: OverlayAction[];
  burst?: boolean;
  focus?: 'primary' | 'first';
  /** 关闭后回调（版本更新弹窗用它接续「进入游戏」流程；遮罩 / Esc 关闭也会触发） */
  onClose?: () => void;
}

export interface OverlayView {
  show(content: OverlayContent): void;
  close(): void;
  isOpen(): boolean;
  destroy(): void;
}

export interface OverlayOptions {
  doc: Document;
  w: Window | null;
  rng: () => number;
  overlay: HTMLElement;
  scrim: HTMLElement;
  eyebrow: HTMLElement;
  title: HTMLElement;
  text: HTMLElement;
  stats: HTMLElement;
  actions: HTMLElement;
  burst: HTMLElement;
}

export function createOverlay(opts: OverlayOptions): OverlayView {
  const { doc, w, rng, overlay, scrim, eyebrow, title, text, stats, actions, burst } = opts;
  let kind: OverlayKind | null = null;
  let hideTimer: number | null = null;
  let focusBefore: HTMLElement | null = null;
  let afterClose: (() => void) | null = null;

  function burstConfetti(kind: OverlayKind): void {
    burst.textContent = '';
    // 水主题礼花：蓝 / 青 / 金 的水滴与亮片；传奇用更密的金 / 琥珀色，更「现世」
    const myth = kind === 'myth';
    const big = kind === 'truewin' || myth;
    const hues = myth ? [45, 38, 28, 52, 205, 190] : [205, 190, 215, 45, 175, 230];
    const count = myth ? 56 : big ? 36 : 22;
    for (let i = 0; i < count; i += 1) {
      const spark = el(doc, 'span', `spark${i % 3 === 0 ? ' spark--drop' : ''}`);
      const hue = hues[i % hues.length]!;
      spark.style.setProperty('--hue', String(hue));
      spark.style.setProperty('--dx', `${Math.round((rng() - 0.5) * (myth ? 420 : big ? 380 : 300))}px`);
      spark.style.setProperty('--dy', `${Math.round(80 + rng() * (myth ? 340 : big ? 300 : 240))}px`);
      spark.style.setProperty('--rot', `${Math.round(180 + rng() * 900)}deg`);
      spark.style.setProperty('--delay', `${Math.round(rng() * 140)}ms`);
      spark.style.left = `${35 + rng() * 30}%`;
      spark.style.top = '46%';
      spark.addEventListener('animationend', () => spark.remove(), { once: true });
      burst.append(spark);
    }
    later(w, () => {
      burst.textContent = '';
    }, 2400);
  }

  function show(content: OverlayContent): void {
    if (hideTimer !== null) {
      cancelTimer(w, hideTimer);
      hideTimer = null;
    }
    if (kind === null) {
      focusBefore = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
    }
    kind = content.kind;
    afterClose = content.onClose ?? null;
    overlay.dataset.kind = content.kind;
    eyebrow.textContent = content.eyebrow;
    title.textContent = content.title;
    title.classList.toggle('panel__title--win', content.kind === 'win');
    title.classList.toggle('panel__title--truewin', content.kind === 'truewin');
    title.classList.toggle('panel__title--myth', content.kind === 'myth');
    title.classList.toggle('panel__title--codex', content.kind === 'lore');
    text.textContent = content.text;

    stats.textContent = '';
    const items = content.stats ?? [];
    stats.hidden = items.length === 0;
    for (const item of items) {
      const box = el(doc, 'div', 'stat');
      box.append(el(doc, 'span', 'stat__k', item.label));
      box.append(el(doc, 'strong', 'stat__v', item.value));
      stats.append(box);
    }

    actions.textContent = '';
    for (const action of content.actions) {
      if (action.href) {
        const link = el(doc, 'a', `pill${action.primary ? ' pill--primary' : ''}`, action.label);
        link.href = action.href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        actions.append(link);
        continue;
      }
      const button = el(doc, 'button', `pill${action.primary ? ' pill--primary' : ''}`, action.label);
      button.type = 'button';
      button.addEventListener('click', () => {
        close();
        action.action?.();
      });
      actions.append(button);
    }

    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
    void overlay.offsetWidth; // 强制 reflow，否则过渡不触发
    overlay.classList.add('is-open');
    if (content.burst) burstConfetti(content.kind);

    const wanted =
      content.focus === 'first'
        ? actions.querySelector<HTMLButtonElement>('button')
        : (actions.querySelector<HTMLButtonElement>('.pill--primary') ??
          actions.querySelector<HTMLButtonElement>('button'));
    wanted?.focus({ preventScroll: true });
  }

  function close(): void {
    if (kind === null) return;
    kind = null;
    const after = afterClose;
    afterClose = null;
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
    if (hideTimer !== null) cancelTimer(w, hideTimer);
    hideTimer = later(w, () => {
      hideTimer = null;
      overlay.hidden = true;
      burst.textContent = '';
    }, OVERLAY_MS);
    if (focusBefore?.isConnected) focusBefore.focus({ preventScroll: true });
    focusBefore = null;
    // 关闭后回调放在最后：如果它又打开一个弹层，show() 会取消上面的隐藏定时器，弹层直接换内容
    if (after) after();
  }

  function onScrim(): void {
    close();
  }
  scrim.addEventListener('click', onScrim);

  return {
    show,
    close,
    isOpen: () => kind !== null,
    destroy() {
      if (hideTimer !== null) cancelTimer(w, hideTimer);
      scrim.removeEventListener('click', onScrim);
    },
  };
}