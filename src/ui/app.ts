import { DEFAULT_CONFIG, type GameConfig, type Tier } from '../game/config.ts';
import {
  cloneState,
  createGame,
  deserialize,
  move as applyMove,
  serialize,
  type Direction,
  type GameState,
  type MoveResult,
} from '../game/engine.ts';
import { createKV, type KV } from './storage.ts';

export interface AppOptions {
  config?: GameConfig;
  storage?: KV;
  rng?: () => number;
}

export interface AppApi {
  readonly state: GameState;
  readonly best: number;
  move(dir: Direction): void;
  restart(): void;
  undo(): void;
  openGuide(): void;
  destroy(): void;
}

/** 与 CSS 里的过渡时长保持一致 */
const SLIDE_MS = 120;
const OVERLAY_MS = 240;
const SHEET_MS = 280;
const FLOAT_MS = 700;

interface OverlayAction {
  label: string;
  primary?: boolean;
  action: () => void;
}

interface OverlayContent {
  kind: 'win' | 'over' | 'confirm';
  eyebrow: string;
  title: string;
  text: string;
  stats?: { label: string; value: string }[];
  actions: OverlayAction[];
  burst?: boolean;
  focus?: 'primary' | 'first';
}

export function createApp(root: HTMLElement, options: AppOptions = {}): AppApi {
  const doc = root.ownerDocument;
  const w = doc.defaultView;
  const config = options.config ?? DEFAULT_CONFIG;
  const kv = options.storage ?? createKV(w);
  const rng = options.rng ?? Math.random;

  /* ---------------- 取节点 ---------------- */
  function need<T extends Element>(selector: string): T {
    const node = root.querySelector<T>(selector);
    if (!node) throw new Error(`缺少节点：${selector}`);
    return node;
  }
  const board = need<HTMLElement>('#board');
  const grid = need<HTMLElement>('#grid');
  const tilesLayer = need<HTMLElement>('#tiles');
  const fxLayer = need<HTMLElement>('#fx');
  const scoreEl = need<HTMLElement>('#score');
  const bestEl = need<HTMLElement>('#best');
  const scoreBox = need<HTMLElement>('#score-box');
  const caption = need<HTMLElement>('#chain-caption');
  const live = need<HTMLElement>('#live');
  const btnNew = need<HTMLButtonElement>('#btn-new');
  const btnUndo = need<HTMLButtonElement>('#btn-undo');
  const btnGuide = need<HTMLButtonElement>('#btn-guide');
  const btnSheetDone = need<HTMLButtonElement>('#sheet-done');
  const btnSheetClose = need<HTMLButtonElement>('#sheet-close');

  const overlay = need<HTMLElement>('#overlay');
  const overlayScrim = need<HTMLElement>('#overlay-scrim');
  const overlayEyebrow = need<HTMLElement>('#overlay-eyebrow');
  const overlayTitle = need<HTMLElement>('#overlay-title');
  const overlayText = need<HTMLElement>('#overlay-text');
  const overlayStats = need<HTMLElement>('#overlay-stats');
  const overlayActions = need<HTMLElement>('#overlay-actions');
  const burst = need<HTMLElement>('#burst');

  const sheet = need<HTMLElement>('#sheet');
  const sheetScrim = need<HTMLElement>('#sheet-scrim');
  const sheetTitle = need<HTMLElement>('#sheet-title');
  const sheetSub = need<HTMLElement>('#sheet-sub');
  const chain = need<HTMLElement>('#chain');

  /* ---------------- 计时工具 ---------------- */
  function later(fn: () => void, ms: number): number {
    return w ? w.setTimeout(fn, ms) : (setTimeout(fn, ms) as unknown as number);
  }
  function cancelTimer(id: number): void {
    if (w) w.clearTimeout(id);
    else clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
  }

  /* ---------------- 状态 ---------------- */
  const history: GameState[] = [];
  const views = new Map<number, HTMLElement>();
  let state: GameState;
  let best = readBest();
  let busy = false;
  let queued: Direction | null = null;
  let pending: (() => void) | null = null;
  let moveTimer: number | null = null;
  let nudgeTimer: number | null = null;
  let overlayKind: OverlayContent['kind'] | null = null;
  let overlayHideTimer: number | null = null;
  let sheetOpen = false;
  let sheetHideTimer: number | null = null;
  let focusBeforeOverlay: HTMLElement | null = null;
  let focusBeforeSheet: HTMLElement | null = null;
  let drag: { x: number; y: number; pointerId: number | undefined } | null = null;
  let destroyed = false;

  /* ---------------- 小工具 ---------------- */
  function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    text?: string,
  ): HTMLElementTagNameMap[K] {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function cellPosition(index: number): { row: number; col: number } {
    return { row: Math.floor(index / config.size), col: index % config.size };
  }

  function setCell(node: HTMLElement, index: number): void {
    const { row, col } = cellPosition(index);
    node.style.setProperty('--r', String(row));
    node.style.setProperty('--c', String(col));
  }

  function buildLabel(tier: Tier): HTMLElement {
    const label = el('span', `tile__label${tier.latin ? ' tile__label--latin' : ''}`);
    label.append(el('span', 'tile__main', tier.label));
    if (tier.sup) label.append(el('span', 'tile__sup', tier.sup));
    return label;
  }

  function createTile(rank: number, cell: number, extraClass?: string): HTMLElement {
    const tier = config.tiers[rank];
    if (!tier) throw new Error(`未知等级：${rank}`);
    const node = el('div', 'tile');
    node.dataset.rank = String(rank);
    node.setAttribute('aria-hidden', 'true');
    if (extraClass) node.classList.add(extraClass);
    setCell(node, cell);
    const face = el('div', 'tile__face');
    face.append(buildLabel(tier));
    node.append(face);
    node.addEventListener('animationend', (event) => {
      if (event.target === face) node.classList.remove('tile--pop', 'tile--spawn');
    });
    tilesLayer.append(node);
    return node;
  }

  /* ---------------- 存档 ---------------- */
  function readBest(): number {
    const raw = kv.get(`${config.storageKey}.best`);
    const value = raw ? Number(raw) : 0;
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }

  function writeBest(): void {
    if (best > 0) kv.set(`${config.storageKey}.best`, String(best));
  }

  function loadState(): GameState | null {
    const raw = kv.get(config.storageKey);
    if (!raw) return null;
    try {
      return deserialize(JSON.parse(raw), config);
    } catch {
      return null;
    }
  }

  function save(): void {
    try {
      kv.set(config.storageKey, JSON.stringify(serialize(state, config)));
    } catch {
      /* 存档失败不影响继续玩 */
    }
    writeBest();
  }

  /* ---------------- 渲染 ---------------- */
  function updateScores(animate: boolean): void {
    scoreEl.textContent = String(state.score);
    if (state.score > best) {
      best = state.score;
      writeBest();
    }
    bestEl.textContent = String(best);
    if (animate) {
      scoreBox.classList.remove('is-bump');
      void scoreBox.offsetWidth;
      scoreBox.classList.add('is-bump');
    }
  }

  function updateUndo(): void {
    btnUndo.disabled = history.length === 0;
  }

  function paintAll(): void {
    views.clear();
    tilesLayer.textContent = '';
    for (let i = 0; i < state.cells.length; i += 1) {
      const tile = state.cells[i];
      if (!tile) continue;
      views.set(tile.id, createTile(tile.rank, i));
    }
    updateScores(false);
    updateUndo();
  }

  function floatScore(cell: number, gained: number): void {
    const node = el('div', 'float');
    setCell(node, cell);
    const text = el('span', undefined, `+${gained}`);
    node.append(text);
    fxLayer.append(node);
    const kill = (): void => node.remove();
    text.addEventListener('animationend', kill, { once: true });
    later(kill, FLOAT_MS + 400);
  }

  function nudge(): void {
    if (nudgeTimer !== null) return;
    board.classList.remove('board--nudge');
    void board.offsetWidth;
    board.classList.add('board--nudge');
    nudgeTimer = later(() => {
      nudgeTimer = null;
      board.classList.remove('board--nudge');
    }, 260);
  }

  /* ---------------- 弹窗（通关 / 结束 / 确认） ---------------- */
  function dialogOpen(): boolean {
    return overlayKind !== null || sheetOpen;
  }

  function showOverlay(content: OverlayContent): void {
    if (overlayHideTimer !== null) {
      cancelTimer(overlayHideTimer);
      overlayHideTimer = null;
    }
    if (overlayKind === null) {
      focusBeforeOverlay = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
    }
    overlayKind = content.kind;
    overlayEyebrow.textContent = content.eyebrow;
    overlayTitle.textContent = content.title;
    overlayTitle.classList.toggle('panel__title--win', content.kind === 'win');
    overlayText.textContent = content.text;

    overlayStats.textContent = '';
    const stats = content.stats ?? [];
    overlayStats.hidden = stats.length === 0;
    for (const stat of stats) {
      const box = el('div', 'stat');
      box.append(el('span', 'stat__k', stat.label));
      box.append(el('strong', 'stat__v', stat.value));
      overlayStats.append(box);
    }

    overlayActions.textContent = '';
    for (const action of content.actions) {
      const button = el('button', `pill${action.primary ? ' pill--primary' : ''}`, action.label);
      button.type = 'button';
      button.addEventListener('click', () => {
        closeOverlay();
        action.action();
      });
      overlayActions.append(button);
    }

    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
    void overlay.offsetWidth;
    overlay.classList.add('is-open');
    if (content.burst) burstConfetti();

    const wanted =
      content.focus === 'first'
        ? overlayActions.querySelector<HTMLButtonElement>('button')
        : (overlayActions.querySelector<HTMLButtonElement>('.pill--primary') ??
          overlayActions.querySelector<HTMLButtonElement>('button'));
    wanted?.focus({ preventScroll: true });
  }

  function closeOverlay(): void {
    if (overlayKind === null) return;
    overlayKind = null;
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
    if (overlayHideTimer !== null) cancelTimer(overlayHideTimer);
    overlayHideTimer = later(() => {
      overlayHideTimer = null;
      overlay.hidden = true;
      burst.textContent = '';
    }, OVERLAY_MS);
    if (focusBeforeOverlay?.isConnected) focusBeforeOverlay.focus({ preventScroll: true });
    focusBeforeOverlay = null;
  }

  function burstConfetti(): void {
    burst.textContent = '';
    const hues = [210, 190, 275, 35, 330, 160];
    for (let i = 0; i < 22; i += 1) {
      const spark = el('span', 'spark');
      const hue = hues[i % hues.length]!;
      spark.style.setProperty('--hue', String(hue));
      spark.style.setProperty('--dx', `${Math.round((rng() - 0.5) * 300)}px`);
      spark.style.setProperty('--dy', `${Math.round(80 + rng() * 240)}px`);
      spark.style.setProperty('--rot', `${Math.round(180 + rng() * 900)}deg`);
      spark.style.setProperty('--delay', `${Math.round(rng() * 140)}ms`);
      spark.style.left = `${35 + rng() * 30}%`;
      spark.style.top = '46%';
      spark.addEventListener('animationend', () => spark.remove(), { once: true });
      burst.append(spark);
    }
    later(() => {
      burst.textContent = '';
    }, 2200);
  }

  function openWin(): void {
    const top = config.tiers[config.winRank]!;
    showOverlay({
      kind: 'win',
      eyebrow: '通关 · 终极合成',
      title: top.name,
      text: `你合出了终极形态，本局 ${state.moves} 步、得分 ${state.score}。还想再冲就继续玩。`,
      stats: [
        { label: '得分', value: String(state.score) },
        { label: '步数', value: String(state.moves) },
      ],
      actions: [
        { label: '继续玩', primary: true, action: () => {} },
        { label: '再来一局', action: () => startNew() },
      ],
      burst: true,
    });
  }

  function openGameOver(fromRestore = false): void {
    const actions: OverlayAction[] = [{ label: '再来一局', primary: true, action: () => startNew() }];
    if (!fromRestore && history.length > 0) actions.unshift({ label: '撤销一步', action: () => undo() });
    showOverlay({
      kind: 'over',
      eyebrow: '本局结束',
      title: '无处可合了',
      text: `本局 ${state.moves} 步，得分 ${state.score} · 最高 ${best}。`,
      stats: [
        { label: '本局得分', value: String(state.score) },
        { label: '最高分', value: String(best) },
      ],
      actions,
    });
  }

  function requestNewGame(): void {
    if (busy) {
      whenIdle(requestNewGame);
      return;
    }
    if (state.moves === 0) {
      startNew();
      return;
    }
    showOverlay({
      kind: 'confirm',
      eyebrow: '重新开始',
      title: '要清空这一局吗？',
      text: `当前得分 ${state.score}，最高 ${best}。这一步不会留在撤销记录里。`,
      actions: [
        { label: '继续玩', action: () => {} },
        { label: '重新开始', primary: true, action: () => startNew() },
      ],
      focus: 'first',
    });
  }

  function startNew(): void {
    if (moveTimer !== null) {
      cancelTimer(moveTimer);
      moveTimer = null;
    }
    closeOverlay();
    closeSheet();
    busy = false;
    pending = null;
    queued = null;
    state = createGame(config, rng);
    history.length = 0;
    paintAll();
    save();
    live.textContent = '新的一局开始了';
  }

  /* ---------------- 图鉴 ---------------- */
  function miniTile(rank: number): HTMLElement {
    const node = el('span', 'mini');
    node.dataset.rank = String(rank);
    const face = el('span', 'mini__face');
    const tier = config.tiers[rank];
    if (tier) face.append(buildLabel(tier));
    node.append(face);
    return node;
  }

  function buildGuide(): void {
    chain.textContent = '';
    const tiers = config.tiers;
    const top = tiers[tiers.length - 1]!;
    sheetSub.textContent = `两枚同级相碰，合成下一级。${top.name} 是这套体系的终点，不会再合成。`;
    for (let rank = 0; rank < tiers.length - 1; rank += 1) {
      const row = el('div', 'chain__row');
      row.append(miniTile(rank));
      row.append(el('span', 'chain__times', '×2'));
      row.append(el('span', 'chain__arrow', '→'));
      row.append(miniTile(rank + 1));
      row.append(el('span', 'chain__name', tiers[rank + 1]!.name));
      chain.append(row);
    }
    const finalRow = el('div', 'chain__row chain__row--final');
    finalRow.append(miniTile(tiers.length - 1));
    finalRow.append(el('span', 'chain__badge', '终点'));
    finalRow.append(el('span', 'chain__name', `${top.name} · 不再合成`));
    chain.append(finalRow);
  }

  function openSheet(): void {
    if (sheetOpen) return;
    if (sheetHideTimer !== null) {
      cancelTimer(sheetHideTimer);
      sheetHideTimer = null;
    }
    buildGuide();
    focusBeforeSheet = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
    sheet.hidden = false;
    sheet.setAttribute('aria-hidden', 'false');
    void sheet.offsetWidth;
    sheet.classList.add('is-open');
    sheetOpen = true;
    btnSheetClose.focus({ preventScroll: true });
  }

  function closeSheet(): void {
    if (!sheetOpen) return;
    sheetOpen = false;
    sheet.classList.remove('is-open');
    sheet.setAttribute('aria-hidden', 'true');
    if (sheetHideTimer !== null) cancelTimer(sheetHideTimer);
    sheetHideTimer = later(() => {
      sheetHideTimer = null;
      sheet.hidden = true;
    }, SHEET_MS);
    if (focusBeforeSheet?.isConnected) focusBeforeSheet.focus({ preventScroll: true });
    focusBeforeSheet = null;
  }

  /* ---------------- 移动 ---------------- */
  function whenIdle(fn: () => void): void {
    if (busy) pending = fn;
    else fn();
  }

  function settle(): void {
    busy = false;
    updateUndo();
    const action = pending;
    pending = null;
    if (action) {
      action();
      return;
    }
    if (dialogOpen()) {
      queued = null;
      return;
    }
    const nextDir = queued;
    queued = null;
    if (nextDir) doMove(nextDir);
  }

  function input(dir: Direction): void {
    if (destroyed) return;
    if (dialogOpen()) return;
    if (busy) {
      queued = dir;
      return;
    }
    doMove(dir);
  }

  function doMove(dir: Direction): void {
    if (destroyed) return;
    if (dialogOpen()) return;
    const before = cloneState(state);
    const result = applyMove(state, dir, config, rng);
    if (!result.moved) {
      nudge();
      return;
    }
    state = result.state;
    history.push(before);
    while (history.length > config.undoLimit) history.shift();
    busy = true;
    updateUndo();

    // 1) 现有方块先滑到新位置（CSS transition 负责动画）
    for (const slide of result.slides) {
      const node = views.get(slide.id);
      if (node) setCell(node, slide.to);
    }
    // 2) 合并结果先以透明状态占位，滑完再弹出
    for (const merge of result.merges) {
      const node = createTile(merge.rank, merge.cell, 'tile--born');
      views.set(merge.targetId, node);
    }

    updateScores(true);
    save();

    moveTimer = later(() => {
      moveTimer = null;
      finishMove(result);
      settle();
    }, SLIDE_MS);
  }

  function finishMove(result: MoveResult): void {
    for (const merge of result.merges) {
      for (const id of merge.sources) {
        const node = views.get(id);
        if (node) {
          node.remove();
          views.delete(id);
        }
      }
      const target = views.get(merge.targetId);
      if (target) {
        target.classList.remove('tile--born');
        target.classList.add('tile--pop');
        floatScore(merge.cell, merge.gained);
      }
    }
    if (result.spawn) {
      const node = createTile(result.spawn.rank, result.spawn.cell, 'tile--spawn');
      views.set(result.spawn.id, node);
    }
    updateUndo();
    live.textContent = `得分 ${state.score}`;

    if (result.justWon) openWin();
    else if (state.over) openGameOver();
  }

  function undo(): void {
    whenIdle(() => {
      const previous = history.pop();
      if (!previous) {
        updateUndo();
        return;
      }
      if (moveTimer !== null) {
        cancelTimer(moveTimer);
        moveTimer = null;
      }
      closeOverlay();
      closeSheet();
      queued = null;
      state = previous;
      paintAll();
      save();
      live.textContent = '已撤销一步';
    });
  }

  /* ---------------- 尺寸：按真实宽度算成 px，保证任何屏幕都精确对齐 ---------------- */
  function layoutBoard(): void {
    const width = board.clientWidth;
    if (width <= 0) return;
    const round = (value: number): number => Math.round(value * 2) / 2;
    const pad = round(Math.min(14, Math.max(7, width * 0.028)));
    const gap = round(Math.min(12, Math.max(6, width * 0.024)));
    const tile = (width - 2 * pad - (config.size - 1) * gap) / config.size;
    board.style.setProperty('--pad', `${pad}px`);
    board.style.setProperty('--gap', `${gap}px`);
    board.style.setProperty('--tile', `${tile}px`);
    board.style.setProperty('--radius', `${(tile * 0.23).toFixed(2)}px`);
  }

  let resizeObserver: ResizeObserver | null = null;
  let resizeTimer: number | null = null;
  function onResize(): void {
    if (resizeTimer !== null) cancelTimer(resizeTimer);
    resizeTimer = later(() => {
      resizeTimer = null;
      layoutBoard();
    }, 60);
  }

  /* ---------------- 初始化 ---------------- */
  caption.textContent = config.tiers.map((tier) => tier.name).join(' → ');
  board.style.setProperty('--n', String(config.size));
  grid.textContent = '';
  for (let i = 0; i < config.size * config.size; i += 1) {
    grid.append(el('div', 'cell'));
  }

  layoutBoard();
  if (w && 'ResizeObserver' in w) {
    resizeObserver = new (w as Window & typeof globalThis).ResizeObserver(onResize);
    resizeObserver.observe(board);
  }
  w?.addEventListener('resize', onResize);
  w?.addEventListener('orientationchange', onResize);

  const restored = loadState();
  state = restored ?? createGame(config, rng);
  paintAll();
  if (!restored) save();
  if (restored?.over) later(() => openGameOver(true), 260);

  /* ---------------- 事件绑定 ---------------- */
  function onKeyDown(event: KeyboardEvent): void {
    if (event.defaultPrevented) return;
    const key = event.key;
    if (key === 'Escape') {
      if (overlayKind !== null) closeOverlay();
      else if (sheetOpen) closeSheet();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (dialogOpen()) return;
    if (key === 'z' || key === 'Z') {
      event.preventDefault();
      undo();
      return;
    }
    const map: Record<string, Direction | undefined> = {
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
    const dir = map[key];
    if (!dir) return;
    event.preventDefault();
    input(dir);
  }

  function onPointerDown(event: PointerEvent): void {
    if (dialogOpen()) return;
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
    if (Math.abs(dx) > Math.abs(dy)) input(dx > 0 ? 'right' : 'left');
    else input(dy > 0 ? 'down' : 'up');
  }

  function onPointerCancel(): void {
    drag = null;
  }

  function onPageHide(): void {
    save();
  }

  btnNew.addEventListener('click', requestNewGame);
  btnUndo.addEventListener('click', undo);
  btnGuide.addEventListener('click', openSheet);
  btnSheetDone.addEventListener('click', closeSheet);
  btnSheetClose.addEventListener('click', closeSheet);
  sheetScrim.addEventListener('click', closeSheet);
  overlayScrim.addEventListener('click', closeOverlay);
  board.addEventListener('pointerdown', onPointerDown);
  board.addEventListener('contextmenu', (event) => event.preventDefault());
  doc.addEventListener('keydown', onKeyDown);
  w?.addEventListener('pointerup', onPointerUp);
  w?.addEventListener('pointercancel', onPointerCancel);
  w?.addEventListener('pagehide', onPageHide);
  board.addEventListener('animationend', (event) => {
    if (event.target === board) board.classList.remove('board--nudge');
  });
  scoreBox.addEventListener('animationend', () => scoreBox.classList.remove('is-bump'));

  const api: AppApi = {
    get state() {
      return state;
    },
    get best() {
      return best;
    },
    move: input,
    restart: startNew,
    undo,
    openGuide: openSheet,
    destroy() {
      destroyed = true;
      if (moveTimer !== null) cancelTimer(moveTimer);
      if (nudgeTimer !== null) cancelTimer(nudgeTimer);
      if (overlayHideTimer !== null) cancelTimer(overlayHideTimer);
      if (sheetHideTimer !== null) cancelTimer(sheetHideTimer);
      btnNew.removeEventListener('click', requestNewGame);
      btnUndo.removeEventListener('click', undo);
      btnGuide.removeEventListener('click', openSheet);
      btnSheetDone.removeEventListener('click', closeSheet);
      btnSheetClose.removeEventListener('click', closeSheet);
      sheetScrim.removeEventListener('click', closeSheet);
      overlayScrim.removeEventListener('click', closeOverlay);
      board.removeEventListener('pointerdown', onPointerDown);
      doc.removeEventListener('keydown', onKeyDown);
      w?.removeEventListener('pointerup', onPointerUp);
      w?.removeEventListener('pointercancel', onPointerCancel);
      w?.removeEventListener('pagehide', onPageHide);
      w?.removeEventListener('resize', onResize);
      w?.removeEventListener('orientationchange', onResize);
      resizeObserver?.disconnect();
      resizeObserver = null;
      if (resizeTimer !== null) cancelTimer(resizeTimer);
    },
  };

  return api;
}
