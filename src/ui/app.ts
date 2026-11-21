/**
 * 应用编排：状态 / 历史 / 移动管线 / 收集 / 弹层优先级 / 存档。
 * 渲染、输入、弹层、图鉴、主题各自独立模块，这里只负责接线与游戏规则落地。
 */
import {
  DEFAULT_CONFIG,
  allEntries,
  entryById,
  type GameConfig,
} from '../game/config.ts';
import { RARITIES, entryText, type CodexEntry } from '../game/codex.ts';
import { buffMultiplier } from '../game/buffs.ts';
import { specialProduct } from '../game/recipes.ts';
import { loreOf } from '../game/lore.ts';
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
import { cancelTimer, later, need } from './dom.ts';
import { createBoard } from './board.ts';
import { createHud } from './hud.ts';
import { createOverlay, type OverlayAction, type OverlayContent } from './overlay.ts';
import { createSheet, type CodexCounts, type SheetTab } from './sheet.ts';
import { createTheme } from './theme.ts';
import { createInput } from './input.ts';
import { createIntro, type IntroView } from './intro.ts';
import { createAudio } from './audio.ts';
import { buildAbout } from './about.ts';

export interface AppOptions {
  config?: GameConfig;
  storage?: KV;
  rng?: () => number;
}

export type { CodexCounts } from './sheet.ts';

export interface AppApi {
  readonly state: GameState;
  readonly best: number;
  readonly codex: Readonly<CodexCounts>;
  move(dir: Direction): void;
  restart(): void;
  undo(): void;
  openGuide(tab?: SheetTab): void;
  openAbout(): void;
  destroy(): void;
}

/** 与 CSS 里的过渡时长保持一致 */
const SLIDE_MS = 120;

export function createApp(root: HTMLElement, options: AppOptions = {}): AppApi {
  const doc = root.ownerDocument;
  const w = doc.defaultView;
  const config = options.config ?? DEFAULT_CONFIG;
  const kv = options.storage ?? createKV(w);
  const rng = options.rng ?? Math.random;

  /* ---------------- 模块接线 ---------------- */
  const board = createBoard({
    doc, w, config,
    board: need<HTMLElement>(root, '#board'),
    grid: need<HTMLElement>(root, '#grid'),
    tilesLayer: need<HTMLElement>(root, '#tiles'),
    fxLayer: need<HTMLElement>(root, '#fx'),
  });
  const hud = createHud({
    doc, config,
    scoreEl: need<HTMLElement>(root, '#score'),
    bestEl: need<HTMLElement>(root, '#best'),
    scoreBox: need<HTMLElement>(root, '#score-box'),
    caption: need<HTMLElement>(root, '#chain-caption'),
    live: need<HTMLElement>(root, '#live'),
    btnUndo: need<HTMLButtonElement>(root, '#btn-undo'),
    buffsEl: need<HTMLElement>(root, '#buffs'),
  });
  const overlay = createOverlay({
    doc, w, rng,
    overlay: need<HTMLElement>(root, '#overlay'),
    scrim: need<HTMLElement>(root, '#overlay-scrim'),
    eyebrow: need<HTMLElement>(root, '#overlay-eyebrow'),
    title: need<HTMLElement>(root, '#overlay-title'),
    text: need<HTMLElement>(root, '#overlay-text'),
    stats: need<HTMLElement>(root, '#overlay-stats'),
    actions: need<HTMLElement>(root, '#overlay-actions'),
    burst: need<HTMLElement>(root, '#burst'),
  });
  const sheet = createSheet({
    doc, w, config,
    getCounts: () => codexCounts,
    sheet: need<HTMLElement>(root, '#sheet'),
    scrim: need<HTMLElement>(root, '#sheet-scrim'),
    sub: need<HTMLElement>(root, '#sheet-sub'),
    chain: need<HTMLElement>(root, '#chain'),
    codexList: need<HTMLElement>(root, '#codex'),
    tabChain: need<HTMLButtonElement>(root, '#tab-chain'),
    tabCodex: need<HTMLButtonElement>(root, '#tab-codex'),
    tabCodexCount: need<HTMLElement>(root, '#tab-codex-count'),
    paneChain: need<HTMLElement>(root, '#pane-chain'),
    paneCodex: need<HTMLElement>(root, '#pane-codex'),
    btnClose: need<HTMLButtonElement>(root, '#sheet-close'),
    btnDone: need<HTMLButtonElement>(root, '#sheet-done'),
  });
  const theme = createTheme({
    doc, w, kv,
    storageKey: config.storageKey,
    button: need<HTMLButtonElement>(root, '#btn-theme'),
  });
  // 音频预留：当前是空实现，以后在 audio.ts 里接背景音乐 / 音效即可
  const audio = createAudio({ w });

  /* ---------------- 状态 ---------------- */
  const history: GameState[] = [];
  let state: GameState;
  let best = readBest();
  const codexCounts: CodexCounts = readCodex();
  let busy = false;
  let queued: Direction | null = null;
  let pending: (() => void) | null = null;
  let moveTimer: number | null = null;
  let destroyed = false;
  /** 开场界面期间发现读档是死局：等玩家点「继续游戏」后再弹结束层 */
  let pendingGameOver = false;
  let intro: IntroView | null = null;

  const btnNew = need<HTMLButtonElement>(root, '#btn-new');
  const btnUndo = need<HTMLButtonElement>(root, '#btn-undo');
  const btnGuide = need<HTMLButtonElement>(root, '#btn-guide');
  const btnAbout = need<HTMLButtonElement>(root, '#btn-about');
  const boardEl = need<HTMLElement>(root, '#board');

  /* ---------------- 存档 ---------------- */
  function readBest(): number {
    const raw = kv.get(`${config.storageKey}.best`);
    const value = raw ? Number(raw) : 0;
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }

  function writeBest(): void {
    if (best > 0) kv.set(`${config.storageKey}.best`, String(best));
  }

  function readCodex(): CodexCounts {
    const raw = kv.get(`${config.storageKey}.codex`);
    const out: CodexCounts = {};
    if (!raw) return out;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return out;
      for (const [id, count] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof count === 'number' && Number.isFinite(count) && count > 0) {
          // 只保留池子/特殊产物表里还存在的 id，换池子不会污染图鉴
          if (entryById(config, id)) out[id] = Math.floor(count);
        }
      }
    } catch {
      /* 坏档当作空图鉴 */
    }
    return out;
  }

  function writeCodex(): void {
    try {
      kv.set(`${config.storageKey}.codex`, JSON.stringify(codexCounts));
    } catch {
      /* 存不了就只在本次会话里记着 */
    }
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
    if (state.score > best) {
      best = state.score;
      writeBest();
    }
    hud.render(state, best, animate);
  }

  function paintAll(): void {
    board.paintAll(state);
    hud.renderBuffs(state.buffs);
    updateScores(false);
    hud.setUndoEnabled(history.length > 0);
  }

  /* ---------------- 弹层内容 ---------------- */
  function dialogOpen(): boolean {
    return overlay.isOpen() || sheet.isOpen();
  }

  function openFakeWin(): void {
    const tail =
      config.codex === undefined
        ? '还想再冲就继续玩。'
        : '但这真的是通关吗？从这一步起，每次词条合成都随机刷出一条词条，收进图鉴——剩下的，交给你自己探索。';
    overlay.show({
      kind: 'win',
      eyebrow: '通关 · ？',
      title: '真通关了吗？',
      text: `你合出了 OLD FIVE，本局 ${state.moves} 步、得分 ${state.score}。${tail}`,
      stats: [
        { label: '得分', value: String(state.score) },
        { label: '步数', value: String(state.moves) },
      ],
      actions: [
        { label: '继续合成', primary: true, action: () => {} },
        ...(config.codex !== undefined
          ? [{ label: '看图鉴', action: () => sheet.open('codex') }]
          : []),
        { label: '再来一局', action: () => startNew() },
      ],
      burst: true,
    });
  }

  function openTrueWin(): void {
    overlay.show({
      kind: 'truewin',
      eyebrow: '真通关 · 记赢赢',
      title: '真·通关！',
      text: `「记」与「赢²」相撞，合出了记赢赢——这才是真通关！本局 ${state.moves} 步、得分 ${state.score}。记赢赢·长赢已生效：本局得分永久 ×2。继续收集全部词条吧。`,
      stats: [
        { label: '得分', value: String(state.score) },
        { label: '步数', value: String(state.moves) },
      ],
      actions: [
        { label: '继续合成', primary: true, action: () => {} },
        { label: '看图鉴', action: () => sheet.open('codex') },
        { label: '再来一局', action: () => startNew() },
      ],
      burst: true,
    });
  }

  /** 首次收录词条 / 首次触发特殊合成：弹解释卡（文案在 game/lore.ts） */
  function openLore(entry: CodexEntry): void {
    const special = specialProduct(entry.id);
    const stats = [
      { label: '已收录', value: String(sheet.collectedCount()) },
      { label: '得分', value: String(state.score) },
    ];
    if (special) {
      const buff = special.buff;
      stats.push({
        label: '增益',
        value: `×${buff.mult} · ${buff.moves < 0 ? '永久' : `${buff.moves}步`}`,
      });
    }
    overlay.show({
      kind: 'lore',
      eyebrow: special ? '特殊合成 · 首次触发' : `图鉴收录 · ${RARITIES[entry.rarity].label}`,
      title: entryText(entry),
      text: loreOf(entry.id),
      stats,
      actions: [
        { label: '继续合成', primary: true, action: () => {} },
        { label: '查看图鉴', action: () => sheet.open('codex') },
      ],
      burst: true,
    });
  }

  function openGameOver(fromRestore = false): void {
    audio.play('over');
    const actions: OverlayAction[] = [{ label: '再来一局', primary: true, action: () => startNew() }];
    if (!fromRestore && history.length > 0) actions.unshift({ label: '撤销一步', action: () => undo() });
    overlay.show({
      kind: 'over',
      eyebrow: '本局结束',
      title: '无处可合了',
      text: `本局 ${state.moves} 步，得分 ${state.score} · 最高 ${best}。图鉴收录会在下一局继续累积。`,
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
    overlay.show({
      kind: 'confirm',
      eyebrow: '重新开始',
      title: '要清空这一局吗？',
      text: `当前得分 ${state.score}，最高 ${best}。图鉴收录不会清空。`,
      actions: [
        { label: '继续玩', action: () => {} },
        { label: '重新开始', primary: true, action: () => startNew() },
      ],
      focus: 'first',
    });
  }

  function startNew(): void {
    if (moveTimer !== null) {
      cancelTimer(w, moveTimer);
      moveTimer = null;
    }
    overlay.close();
    sheet.close();
    busy = false;
    pending = null;
    queued = null;
    state = createGame(config, rng);
    history.length = 0;
    paintAll();
    save();
    audio.play('restart');
    hud.announce('新的一局开始了');
  }

  /** 从开场界面进入棋局（开始 / 继续） */
  function enterGame(): void {
    // 用户手势：解锁音频并开始（未来的）背景音乐
    audio.unlock();
    audio.startMusic();
    if (pendingGameOver) {
      pendingGameOver = false;
      openGameOver(true);
      return;
    }
    audio.play('start');
    hud.announce(state.moves > 0 ? '继续上一局' : '开局！滑动或按方向键合成');
  }

  /* ---------------- 收集 ---------------- */
  /** 记录一条词条/特殊产物；返回是否为新收录 */
  function collect(entryId: string): boolean {
    const known = (codexCounts[entryId] ?? 0) > 0;
    codexCounts[entryId] = (codexCounts[entryId] ?? 0) + 1;
    writeCodex();
    sheet.refresh();
    // 特殊产物由 finishMove 单独播音效，这里只报随机词条的首次收录
    if (!known && !specialProduct(entryId)) audio.play('collect');
    return !known;
  }

  /* ---------------- 移动管线 ---------------- */
  function whenIdle(fn: () => void): void {
    if (busy) pending = fn;
    else fn();
  }

  function settle(): void {
    busy = false;
    hud.setUndoEnabled(history.length > 0);
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
    // 开场界面还没收起时，方向键 / 滑动都不推棋盘
    if (intro?.isOpen()) return;
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
    const mult = buffMultiplier(state.buffs);
    const result = applyMove(state, dir, config, rng);
    if (!result.moved) {
      audio.play('invalid');
      board.nudge();
      return;
    }
    state = result.state;
    history.push(before);
    while (history.length > config.undoLimit) history.shift();
    busy = true;
    hud.setUndoEnabled(true);

    // 1) 现有方块先滑到新位置（CSS transition 负责动画）
    board.slide(result.slides);
    // 2) 合并结果先以透明状态占位，滑完再弹出
    board.born(result.merges);

    updateScores(true);
    hud.renderBuffs(state.buffs);
    save();

    moveTimer = later(w, () => {
      moveTimer = null;
      finishMove(result, mult, dir);
      settle();
    }, SLIDE_MS);
  }

  function finishMove(result: MoveResult, mult: number, dir: Direction): void {
    // 音效钩子：特殊产物 > 通关 > 普通合成 > 普通移动（附带方向 / 合并数 / 得分 / 产物）
    const specials = result.merges.filter((merge) => specialProduct(merge.variant));
    const cue = result.justTrueWon
      ? 'truewin'
      : result.justWon
        ? 'win'
        : specials.length > 0
          ? 'special'
          : result.merges.length > 0
            ? 'merge'
            : 'move';
    audio.play({
      cue,
      direction: dir,
      merges: result.merges.length,
      gained: result.scoreGain,
      variants: result.merges
        .map((merge) => merge.variant)
        .filter((variant): variant is string => variant !== undefined),
    });

    board.pop(result.merges, mult);
    if (result.spawn) board.spawnTile(result.spawn);
    hud.setUndoEnabled(history.length > 0);

    // 收集：随机抽取 + 特殊产物（都跨局累积，撤销不回退）
    let firstNew: CodexEntry | undefined;
    const newNames: string[] = [];
    for (const draw of result.codexDraws) {
      const isNew = collect(draw.entryId);
      if (isNew) {
        const entry = entryById(config, draw.entryId);
        if (entry && !firstNew) firstNew = entry;
        newNames.push(draw.name);
      }
    }
    for (const merge of result.merges) {
      const product = specialProduct(merge.variant);
      if (!product) continue;
      const isNew = collect(product.entry.id);
      if (isNew && !firstNew) firstNew = product.entry;
    }

    if (result.justTrueWon) hud.announce('真通关！合出了记赢赢，本局得分永久 ×2');
    else if (result.justWon) hud.announce('合出 OLD FIVE——真通关了吗？');
    else if (firstNew) hud.announce(`首次收录 ${entryText(firstNew)}，图鉴已收录 ${sheet.collectedCount()} 条`);
    else if (newNames.length > 0) hud.announce(`抽到词条 ${newNames.join('、')}`);
    else hud.announce(`得分 ${state.score}`);

    // 弹层优先级：真通关 > 假通关 > 首次收录解释 > 结束
    if (result.justTrueWon) openTrueWin();
    else if (result.justWon) openFakeWin();
    else if (firstNew) openLore(firstNew);
    else if (state.over) openGameOver();
  }

  function undo(): void {
    whenIdle(() => {
      const previous = history.pop();
      if (!previous) {
        hud.setUndoEnabled(false);
        return;
      }
      if (moveTimer !== null) {
        cancelTimer(w, moveTimer);
        moveTimer = null;
      }
      overlay.close();
      sheet.close();
      queued = null;
      state = previous;
      paintAll();
      save();
      audio.play('undo');
      hud.announce('已撤销一步（图鉴收录不会回退）');
    });
  }

  /* ---------------- 尺寸自适应 ---------------- */
  let resizeObserver: ResizeObserver | null = null;
  let resizeTimer: number | null = null;
  function onResize(): void {
    if (resizeTimer !== null) cancelTimer(w, resizeTimer);
    resizeTimer = later(w, () => {
      resizeTimer = null;
      board.layout();
    }, 60);
  }

  /* ---------------- 输入 ---------------- */
  const inputModule = createInput({
    doc, w, board: boardEl,
    handlers: {
      input,
      undo,
      escape: () => {
        if (overlay.isOpen()) overlay.close();
        else if (sheet.isOpen()) sheet.close();
      },
      dialogOpen,
    },
  });

  /* ---------------- 初始化 ---------------- */
  hud.setCaption(
    config.tiers.map((tier) => tier.name).join(' → ') + (config.codex ? ' → ?' : ''),
  );
  board.layout();
  if (w && 'ResizeObserver' in w) {
    resizeObserver = new (w as Window & typeof globalThis).ResizeObserver(onResize);
    resizeObserver.observe(boardEl);
  }
  w?.addEventListener('resize', onResize);
  w?.addEventListener('orientationchange', onResize);

  const restored = loadState();
  state = restored ?? createGame(config, rng);
  paintAll();
  sheet.refresh();
  if (!restored) save();

  // 开场界面：每次打开页面出现一次，展示最高分 / 图鉴进度，点「开始合成」进入
  intro = createIntro({
    doc,
    w,
    intro: need<HTMLElement>(root, '#intro'),
    startButton: need<HTMLButtonElement>(root, '#intro-start'),
    guideButton: need<HTMLButtonElement>(root, '#intro-guide'),
    bestEl: need<HTMLElement>(root, '#intro-best'),
    codexEl: need<HTMLElement>(root, '#intro-codex'),
    onStart: enterGame,
    onGuide: () => {
      // 「玩法说明」也视为进入游戏：解锁音频、处理读档死局，再把合成链抽屉叠在上面
      enterGame();
      sheet.open('chain');
    },
  });
  intro.setStats({
    best: Math.max(best, state.score),
    collected: sheet.collectedCount(),
    hasSave: restored !== null,
  });
  if (restored?.over) {
    pendingGameOver = true;
    later(w, () => {
      // 开场界面还开着就先不弹，等玩家进入游戏时再弹
      if (!pendingGameOver || intro?.isOpen()) return;
      pendingGameOver = false;
      openGameOver(true);
    }, 260);
  }

  function onNew(): void {
    requestNewGame();
  }
  function onGuide(): void {
    sheet.open('chain');
  }
  function onAbout(): void {
    overlay.show(buildAbout());
  }
  function onPageHide(): void {
    save();
  }
  btnNew.addEventListener('click', onNew);
  btnUndo.addEventListener('click', undo);
  btnGuide.addEventListener('click', onGuide);
  btnAbout.addEventListener('click', onAbout);
  w?.addEventListener('pagehide', onPageHide);

  const api: AppApi = {
    get state() {
      return state;
    },
    get best() {
      return best;
    },
    get codex() {
      return codexCounts;
    },
    move: input,
    restart: startNew,
    undo,
    openGuide: (tab?: SheetTab) => sheet.open(tab),
    openAbout: onAbout,
    destroy() {
      destroyed = true;
      if (moveTimer !== null) cancelTimer(w, moveTimer);
      if (resizeTimer !== null) cancelTimer(w, resizeTimer);
      btnNew.removeEventListener('click', onNew);
      btnUndo.removeEventListener('click', undo);
      btnGuide.removeEventListener('click', onGuide);
      btnAbout.removeEventListener('click', onAbout);
      w?.removeEventListener('pagehide', onPageHide);
      w?.removeEventListener('resize', onResize);
      w?.removeEventListener('orientationchange', onResize);
      resizeObserver?.disconnect();
      resizeObserver = null;
      inputModule.destroy();
      theme.destroy();
      audio.destroy();
      intro?.destroy();
      sheet.destroy();
      overlay.destroy();
      hud.destroy();
      board.destroy();
    },
  };

  return api;
}