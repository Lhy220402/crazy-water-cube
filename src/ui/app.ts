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
  needsLegacyMythMigration,
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
import { GAME_VERSION, LEGACY_VERSION } from '../game/meta.ts';
import {
  detectVersionChange,
  hasLegacyData,
  readSeenVersion,
  versionChangeText,
  writeSeenVersion,
  type VersionChange,
} from './version.ts';

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
    rng,
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
  // 音频：合成猫叫 + 失败音效（本局结束 / 读档死局）+ 声音开关（偏好存 jun2048.sound）
  const audio = createAudio({ w, kv, storageKey: config.storageKey });

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
  /** 本次死局是否已经播过失败音效（同一死局不重复播；重开 / 撤销后复位） */
  let overAnnounced = false;
  /**
   * 进入游戏时要弹的版本更新（启动时只读推导，不写存档）：
   * 老玩家升级 / 换版本后第一次进入游戏弹一次，只显示版本号变动。
   */
  const seenVersion = readSeenVersion(kv, config.storageKey);
  let pendingUpdate: VersionChange | null = detectVersionChange(
    kv,
    config.storageKey,
    GAME_VERSION,
    LEGACY_VERSION,
  );
  // 全新玩家（没有版本记录、也没有任何旧存档）：启动就记下当前版本，
  // 免得这一局在初始化时写入的 jun2048 让自己下次被误认成「从 2.2.2 升级上来的老玩家」
  if (seenVersion === null && !hasLegacyData(kv, config.storageKey)) {
    writeSeenVersion(kv, config.storageKey, GAME_VERSION);
  }
  let intro: IntroView | null = null;

  const btnNew = need<HTMLButtonElement>(root, '#btn-new');
  const btnUndo = need<HTMLButtonElement>(root, '#btn-undo');
  const btnGuide = need<HTMLButtonElement>(root, '#btn-guide');
  const btnAbout = need<HTMLButtonElement>(root, '#btn-about');
  const btnSound = need<HTMLButtonElement>(root, '#btn-sound');
  const boardEl = need<HTMLElement>(root, '#board');

  /** 同步声音按钮的图标 / 无障碍状态 */
  function syncSoundButton(): void {
    const on = audio.enabled;
    btnSound.textContent = on ? '🔊' : '🔇';
    btnSound.setAttribute('aria-pressed', String(on));
    btnSound.classList.toggle('is-off', !on);
    const label = `音效：${on ? '开' : '关'}，点击${on ? '关闭' : '开启'}`;
    btnSound.setAttribute('aria-label', label);
    btnSound.title = label;
  }
  syncSoundButton();

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

  function loadState(): { state: GameState; migrated: boolean } | null {
    const raw = kv.get(config.storageKey);
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      // v3.0.2 旧档迁移：rank 6 上误标的 4 条旧传奇会在 deserialize 里随机换成正确传奇；
      // 这里先判断是否需要回写，避免每次刷新都重新随机一次。
      const migrated = needsLegacyMythMigration(parsed, config);
      const state = deserialize(parsed, config, rng);
      return state ? { state, migrated } : null;
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

  /**
   * 结束层的弹层优先级最低，但失败判定不能因此被吞掉：
   * 解释卡 / 通关层关闭后再补弹结束层；如果它同时开了图鉴，结束层会盖在抽屉上面，
   * 关掉结束层还能继续看图鉴。
   */
  function scheduleGameOverAfterClose(): void {
    later(w, () => {
      if (destroyed || !state.over) return;
      if (overlay.isOpen() || intro?.isOpen()) return;
      // 这里不是「读档死局」，本局刚走完最后一步，历史里通常还能撤销
      openGameOver();
    }, 0);
  }

  function openFakeWin(deferOver = false): void {
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
      onClose: deferOver ? scheduleGameOverAfterClose : undefined,
    });
  }

  function openTrueWin(deferOver = false): void {
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
      onClose: deferOver ? scheduleGameOverAfterClose : undefined,
    });
  }

  /** 首次收录词条 / 首次触发特殊合成：弹解释卡（文案在 game/lore.ts） */
  function openLore(entry: CodexEntry, deferOver = false): void {
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
      onClose: deferOver ? scheduleGameOverAfterClose : undefined,
    });
  }

  /** v3.0：抽到传奇——全屏直接放大词条名，配金虹标题 + 大礼花（用户要求「体现震撼」） */
  function openMythReveal(entry: CodexEntry, after?: () => void): void {
    overlay.show({
      kind: 'myth',
      eyebrow: '传奇 · 现世',
      title: entryText(entry),
      text: loreOf(entry.id),
      stats: [
        { label: '图鉴收录', value: `×${codexCounts[entry.id] ?? 1}` },
        { label: '得分', value: String(state.score) },
      ],
      actions: [
        { label: '继续合成', primary: true, action: () => {} },
        { label: '查看图鉴', action: () => sheet.open('codex') },
      ],
      burst: true,
      onClose: after,
    });
  }

  function openGameOver(fromRestore = false): void {
    // 失败音效每个死局只播一次：被解释卡 / 通关层挡住后补弹结束层时不再重复
    if (!overAnnounced) {
      overAnnounced = true;
      audio.play('over');
    }
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
    overAnnounced = false;
    history.length = 0;
    paintAll();
    save();
    audio.play('restart');
    hud.announce('新的一局开始了');
  }

  /** 版本更新弹层：只显示版本号变动；关掉后接着进入游戏 */
  function showUpdateNotice(change: VersionChange, done: () => void): void {
    overlay.show({
      kind: 'update',
      eyebrow: '版本更新',
      title: '版本已更新',
      text: versionChangeText(change),
      actions: [{ label: '开始玩', primary: true }],
      onClose: done,
    });
  }

  /** 从开场界面进入棋局（开始 / 继续）；afterEnter 用于「玩法说明」在弹层关掉后接图鉴 */
  function enterGame(afterEnter?: () => void): void {
    // 用户手势：解锁音频并开始（未来的）背景音乐
    audio.unlock();
    audio.startMusic();
    // 进入游戏（哪怕这次没弹更新）就记下当前版本，同一版本不再重复提示
    writeSeenVersion(kv, config.storageKey, GAME_VERSION);
    const update = pendingUpdate;
    pendingUpdate = null;
    const finish = (): void => {
      if (pendingGameOver) {
        pendingGameOver = false;
        openGameOver(true);
        return;
      }
      audio.play('start');
      hud.announce(state.moves > 0 ? '继续上一局' : '开局！滑动或按方向键合成');
      afterEnter?.();
    };
    if (update) showUpdateNotice(update, finish);
    else finish();
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
    // 已经无路可走：结束层被遮罩 / Esc 关掉后再操作时重新提示（失败音效不重复）
    if (state.over) {
      openGameOver();
      return;
    }
    // 「妙」增益期间：记录本步开始前棋盘上的妙，移动后爱心跟着妙的新位置生成
    const heartIds = state.buffs.some((buff) => buff.id === 'miao')
      ? state.cells
          .filter((tile): tile is NonNullable<typeof tile> => tile?.variant === 'miao')
          .map((tile) => tile.id)
      : [];
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

    // 妙移动到哪儿，爱心就在哪儿生成（若这步把妙合掉了，就落在合成后的格子）
    const heartCells = heartCellsAfterMove(heartIds, result);
    moveTimer = later(w, () => {
      moveTimer = null;
      finishMove(result, mult, dir, heartCells);
      settle();
    }, SLIDE_MS);
  }

  /** 本步开始前那些「妙」方块移动/合并后落在哪些格子 */
  function heartCellsAfterMove(ids: readonly number[], result: MoveResult): number[] {
    const cells = new Set<number>();
    for (const id of ids) {
      const slide = result.slides.find((item) => item.id === id);
      if (slide) {
        cells.add(slide.to);
        continue;
      }
      const merge = result.merges.find((item) => item.sources.includes(id));
      if (merge) {
        cells.add(merge.cell);
        continue;
      }
      const index = result.state.cells.findIndex((tile) => tile?.id === id);
      if (index >= 0) cells.add(index);
    }
    return [...cells];
  }

  function finishMove(
    result: MoveResult,
    mult: number,
    dir: Direction,
    heartCells: readonly number[],
  ): void {
    // 本步结束后已经无路可走：本步只播失败音效，不再让合成猫叫叠上来
    const overNow = state.over;
    // 音效钩子：特殊产物 > 通关 > 普通合成 > 普通移动（附带方向 / 合并数 / 得分 / 产物）
    const specials = result.merges.filter((merge) => specialProduct(merge.variant));
    const cue = overNow
      ? 'move'
      : result.justTrueWon
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
    // 妙增益期间：爱心从妙所在格生成，跟随妙移动（纯表现，不影响规则）
    if (heartCells.length > 0) board.heartBurst(heartCells);
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

    // v3.0：本步抽到的传奇（记赢赢 ×2 / 传奇 ×2）——要全屏揭示，且优先级最高
    const mythDraw = result.codexDraws.find(
      (draw) => entryById(config, draw.entryId)?.rarity === 'myth',
    );
    const mythEntry = mythDraw ? entryById(config, mythDraw.entryId) : undefined;

    if (mythEntry) hud.announce(`传奇现世：${entryText(mythEntry)}`);
    else if (result.justTrueWon) hud.announce('真通关！合出了记赢赢，本局得分永久 ×2');
    else if (result.justWon) hud.announce('合出 OLD FIVE——真通关了吗？');
    else if (firstNew) hud.announce(`首次收录 ${entryText(firstNew)}，图鉴已收录 ${sheet.collectedCount()} 条`);
    else if (newNames.length > 0) hud.announce(`抽到词条 ${newNames.join('、')}`);
    else hud.announce(`得分 ${state.score}`);

    // 弹层优先级：传奇现世 > 真通关 > 假通关 > 首次收录解释 > 结束
    // 「隋」「李娜」没有解释文案（v2.4 用户要求去掉）：首次收录不弹解释卡，只播报收录结果
    // 结束层优先级最低，但必须补弹：本步同时触发解释卡 / 通关层时，先记下 over，
    // 等这些弹层关闭后再由 onClose 补上「无处可合」，否则失败判定会被吞掉。
    if (mythEntry) {
      openMythReveal(mythEntry, () => {
        // 同一步的其它高优先级事件（真/假通关、首次解释、结束）在传奇层关闭后接续
        if (result.justTrueWon) openTrueWin(overNow);
        else if (result.justWon) openFakeWin(overNow);
        else if (firstNew && firstNew.id !== mythEntry.id && loreOf(firstNew.id).length > 0) {
          openLore(firstNew, overNow);
        } else if (overNow) {
          scheduleGameOverAfterClose();
        }
      });
    } else if (result.justTrueWon) openTrueWin(overNow);
    else if (result.justWon) openFakeWin(overNow);
    else if (firstNew && loreOf(firstNew.id).length > 0) openLore(firstNew, overNow);
    else if (overNow) openGameOver();
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
      overAnnounced = false;
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
  state = restored?.state ?? createGame(config, rng);
  paintAll();
  sheet.refresh();
  // 新局要写档；旧档做过传奇迁移时也要立刻回写，保证下次打开不再重新随机
  if (!restored || restored.migrated) save();

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
      // 「玩法说明」也视为进入游戏：解锁音频、处理版本更新 / 读档死局，再把合成链抽屉叠在上面
      enterGame(() => sheet.open('chain'));
    },
  });
  intro.setStats({
    best: Math.max(best, state.score),
    collected: sheet.collectedCount(),
    hasSave: restored !== null,
  });
  if (restored?.state.over) {
    pendingGameOver = true;
    later(w, () => {
      // 开场界面还开着就先不弹，等玩家进入游戏时再弹；
      // 版本更新弹层正开着也交给 enterGame 的关闭回调去接续，别抢在它上面
      if (!pendingGameOver || intro?.isOpen() || overlay.isOpen()) return;
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
    // 「关于」入口在图鉴抽屉底部：先收起抽屉，再在它上面弹说明层
    if (sheet.isOpen()) sheet.close();
    overlay.show(buildAbout());
  }
  function onSound(): void {
    audio.setEnabled(!audio.enabled);
    syncSoundButton();
    hud.announce(audio.enabled ? '音效已开启' : '音效已关闭');
  }
  function onPageHide(): void {
    save();
  }
  btnNew.addEventListener('click', onNew);
  btnUndo.addEventListener('click', undo);
  btnGuide.addEventListener('click', onGuide);
  btnAbout.addEventListener('click', onAbout);
  btnSound.addEventListener('click', onSound);
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
      btnSound.removeEventListener('click', onSound);
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