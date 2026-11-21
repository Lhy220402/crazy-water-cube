/** 输入：触摸滑动（Pointer Events）+ 键盘方向键/WASD/Z/Esc。 */
import type { Direction } from '../game/engine.ts';

export interface InputHandlers {
  input(dir: Direction): void;
  undo(): void;
  escape(): void;
  dialogOpen(): boolean;
}

export interface InputOptions {
  doc: Document;
  w: Window | null;
  board: HTMLElement;
  handlers: InputHandlers;
}

export interface Input {
  destroy(): void;
}

const KEY_MAP: Record<string, Direction | undefined> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  w: 'up',
  W: 'up',
  a: 'left',
  A: 'left',
  s: 'down',
  S: 'down',
  d: 'right',
  D: 'right',
};

export function createInput(opts: InputOptions): Input {
  const { doc, w, board, handlers } = opts;
  let drag: { x: number; y: number; pointerId: number | undefined } | null = null;

  function onKeyDown(event: KeyboardEvent): void {
    if (event.defaultPrevented) return;
    const key = event.key;
    if (key === 'Escape') {
      handlers.escape();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (handlers.dialogOpen()) return;
    if (key === 'z' || key === 'Z') {
      event.preventDefault();
      handlers.undo();
      return;
    }
    const dir = KEY_MAP[key];
    if (!dir) return;
    event.preventDefault();
    handlers.input(dir);
  }

  function onPointerDown(event: PointerEvent): void {
    if (handlers.dialogOpen()) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    drag = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    try {
      board.setPointerCapture?.(event.pointerId);
    } catch {
      /* 某些浏览器不支持指针捕获 */
    }
    event.preventDefault();
  }

  function onPointerUp(event: PointerEvent): void {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag = null;
    const limit = Math.max(14, Math.min(28, board.clientWidth * 0.05));
    if (Math.max(Math.abs(dx), Math.abs(dy)) < limit) return;
    if (Math.abs(dx) > Math.abs(dy)) handlers.input(dx > 0 ? 'right' : 'left');
    else handlers.input(dy > 0 ? 'down' : 'up');
  }

  function onPointerCancel(): void {
    drag = null;
  }

  function onContextMenu(event: Event): void {
    event.preventDefault();
  }

  doc.addEventListener('keydown', onKeyDown);
  board.addEventListener('pointerdown', onPointerDown);
  board.addEventListener('contextmenu', onContextMenu);
  w?.addEventListener('pointerup', onPointerUp);
  w?.addEventListener('pointercancel', onPointerCancel);

  return {
    destroy() {
      doc.removeEventListener('keydown', onKeyDown);
      board.removeEventListener('pointerdown', onPointerDown);
      board.removeEventListener('contextmenu', onContextMenu);
      w?.removeEventListener('pointerup', onPointerUp);
      w?.removeEventListener('pointercancel', onPointerCancel);
    },
  };
}