/**
 * 开场界面：水主题标题卡 + 最高分 / 图鉴进度 + 开始按钮。
 *
 * 每次打开页面都会出现一次；点击「开始合成 / 继续游戏」或按 Enter / Space 进入游戏。
 * 它只负责「盖住 + 收起」和展示统计，不碰棋局状态；开始 / 玩法说明的动作由 app 注入。
 * 动画只用 opacity / transform，收起后立刻解除输入锁（不必等淡出结束）。
 */
import { cancelTimer, later } from './dom.ts';

/** 与 CSS 里 .intro 的 transition 时长保持一致 */
const LEAVE_MS = 380;

export interface IntroStats {
  /** 最高分（取存档最高分与本局得分的较大值） */
  best: number;
  /** 已收录词条数（不显示总数，遵守图鉴悬念契约） */
  collected: number;
  /** 是否有可继续的存档：有则按钮显示「继续游戏」 */
  hasSave: boolean;
}

export interface IntroView {
  isOpen(): boolean;
  close(): void;
  setStats(stats: IntroStats): void;
  destroy(): void;
}

export interface IntroOptions {
  doc: Document;
  w: Window | null;
  intro: HTMLElement;
  startButton: HTMLButtonElement;
  guideButton: HTMLButtonElement;
  bestEl: HTMLElement;
  codexEl: HTMLElement;
  /** 进入游戏（关掉开场界面之后） */
  onStart(): void;
  /** 打开玩法说明（先收起开场界面） */
  onGuide(): void;
}

export function createIntro(opts: IntroOptions): IntroView {
  const { doc, w, intro, startButton, guideButton, bestEl, codexEl, onStart, onGuide } = opts;
  let open = true;
  let leaveTimer: number | null = null;

  function close(): void {
    if (!open) return;
    open = false;
    intro.classList.add('is-leaving');
    intro.setAttribute('aria-hidden', 'true');
    if (leaveTimer !== null) cancelTimer(w, leaveTimer);
    leaveTimer = later(w, () => {
      leaveTimer = null;
      intro.hidden = true;
      intro.classList.remove('is-leaving');
    }, LEAVE_MS);
  }

  function enter(): void {
    if (!open) return;
    close();
    onStart();
  }

  function setStats(stats: IntroStats): void {
    bestEl.textContent = String(stats.best);
    codexEl.textContent = stats.collected > 0 ? `${stats.collected} 条` : '0 条';
    startButton.textContent = stats.hasSave ? '继续游戏' : '开始合成';
  }

  function onStartClick(): void {
    enter();
  }

  function onGuideClick(): void {
    if (!open) return;
    close();
    onGuide();
  }

  function onKey(event: KeyboardEvent): void {
    if (!open) return;
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      enter();
    }
  }

  startButton.addEventListener('click', onStartClick);
  guideButton.addEventListener('click', onGuideClick);
  doc.addEventListener('keydown', onKey);
  startButton.focus({ preventScroll: true });

  return {
    isOpen: () => open,
    close,
    setStats,
    destroy() {
      if (leaveTimer !== null) cancelTimer(w, leaveTimer);
      startButton.removeEventListener('click', onStartClick);
      guideButton.removeEventListener('click', onGuideClick);
      doc.removeEventListener('keydown', onKey);
    },
  };
}
