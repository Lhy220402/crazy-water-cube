/** HUD：得分 / 最高分 / 增益徽章 / 撤销按钮状态 / 无障碍播报 / 合成链副标题。 */
import type { GameConfig } from '../game/config.ts';
import type { Buff } from '../game/buffs.ts';
import type { GameState } from '../game/engine.ts';
import { el } from './dom.ts';

export interface HudOptions {
  doc: Document;
  config: GameConfig;
  scoreEl: HTMLElement;
  bestEl: HTMLElement;
  scoreBox: HTMLElement;
  caption: HTMLElement;
  live: HTMLElement;
  btnUndo: HTMLButtonElement;
  buffsEl: HTMLElement;
}

export interface Hud {
  render(state: GameState, best: number, animate: boolean): void;
  renderBuffs(buffs: readonly Buff[]): void;
  setUndoEnabled(enabled: boolean): void;
  announce(text: string): void;
  setCaption(text: string): void;
  destroy(): void;
}

export function createHud(opts: HudOptions): Hud {
  const { doc, scoreEl, bestEl, scoreBox, caption, live, btnUndo, buffsEl } = opts;

  function onBumpEnd(): void {
    scoreBox.classList.remove('is-bump');
  }
  scoreBox.addEventListener('animationend', onBumpEnd);

  return {
    render(state, best, animate) {
      scoreEl.textContent = String(state.score);
      bestEl.textContent = String(best);
      if (animate) {
        scoreBox.classList.remove('is-bump');
        void scoreBox.offsetWidth;
        scoreBox.classList.add('is-bump');
      }
    },
    renderBuffs(buffs) {
      buffsEl.textContent = '';
      buffsEl.hidden = buffs.length === 0;
      for (const buff of buffs) {
        const chip = el(doc, 'span', 'buff');
        chip.dataset.buff = buff.id;
        chip.append(el(doc, 'b', 'buff__mult', `×${buff.mult}`));
        const steps = buff.movesLeft < 0 ? '∞' : `${buff.movesLeft}步`;
        chip.append(el(doc, 'span', 'buff__label', `${buff.label} · ${steps}`));
        buffsEl.append(chip);
      }
    },
    setUndoEnabled(enabled) {
      btnUndo.disabled = !enabled;
    },
    announce(text) {
      live.textContent = text;
    },
    setCaption(text) {
      caption.textContent = text;
    },
    destroy() {
      scoreBox.removeEventListener('animationend', onBumpEnd);
    },
  };
}