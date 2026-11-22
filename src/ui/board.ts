/**
 * 棋盘渲染：方块创建 / 滑动 / 合并弹出 / 生成 / 飘分 / 抖动 / 几何布局。
 * 动画全部由 CSS transform/transition/keyframes 完成，这里只编排 class 与计时。
 */
import { entryById, isCodexRank, type GameConfig, type Tier } from '../game/config.ts';
import { RARITIES, huesOf, type CodexEntry } from '../game/codex.ts';
import { specialProduct } from '../game/recipes.ts';
import type { GameState, Merge, Slide, Spawn } from '../game/engine.ts';
import { cancelTimer, el, later, setCell } from './dom.ts';

const FLOAT_MS = 700;

export interface BoardView {
  paintAll(state: GameState): void;
  slide(slides: Slide[]): void;
  born(merges: Merge[]): void;
  pop(merges: Merge[], mult: number): void;
  spawnTile(spawn: Spawn): void;
  /** 「妙」增益期间：在妙所在格生成爱心粒子（跟随妙移动；纯 CSS 动画） */
  heartBurst(cells: readonly number[]): void;
  nudge(): void;
  layout(): void;
  destroy(): void;
}

export interface BoardOptions {
  doc: Document;
  w: Window | null;
  config: GameConfig;
  board: HTMLElement;
  grid: HTMLElement;
  tilesLayer: HTMLElement;
  fxLayer: HTMLElement;
  /** 粒子随机源；默认 Math.random */
  rng?: () => number;
}

export function createBoard(opts: BoardOptions): BoardView {
  const { doc, w, config, board, grid, tilesLayer, fxLayer } = opts;
  const rng = opts.rng ?? Math.random;
  const views = new Map<number, HTMLElement>();
  let nudgeTimer: number | null = null;

  /* ---------------- 标签 ---------------- */

  /** 普通等级标签；带空格的名字（OLD FIVE）竖排两行，²/³ 上标加大发光 */
  function buildTierLabel(tier: Tier): HTMLElement {
    const label = el(doc, 'span', `tile__label${tier.latin ? ' tile__label--latin' : ''}`);
    if (tier.label.includes(' ')) {
      const stack = el(doc, 'span', 'tile__main tile__main--stack');
      for (const word of tier.label.split(' ')) stack.append(el(doc, 'span', undefined, word));
      label.append(stack);
    } else {
      label.append(el(doc, 'span', 'tile__main', tier.label));
    }
    if (tier.sup) label.append(el(doc, 'span', 'tile__sup tile__sup--power', tier.sup));
    return label;
  }

  /** 词条方块内容：名字（圆环词条显示 tileName）+ 稀有度角标 + 配方提示 + 稀有/传说光效 */
  function buildCodexContent(entry: CodexEntry | undefined, fallbackId: string): HTMLElement[] {
    const text = entry?.tileName ?? entry?.name ?? fallbackId;
    const width = [...text].length;
    const size = width <= 2 ? 'is-s1' : width === 3 ? 'is-s2' : width === 4 ? 'is-s3' : 'is-s4';
    const label = el(doc, 'span', `tile__label tile__label--codex ${size}`);
    const main = el(doc, 'span', `tile__main${entry?.ring ? ' tile__main--ring' : ''}`, text);
    label.append(main);

    const nodes: HTMLElement[] = [];
    const special = specialProduct(entry?.id);
    const rarity = RARITIES[special ? 'legend' : (entry?.rarity ?? 'legend')];
    const rarityId = special ? 'legend' : (entry?.rarity ?? 'legend');
    // v2.4 光效：稀有 = 流光扫过，传说 = 呼吸光晕 + 闪点（只在稀有/传说上出现）
    if (rarityId === 'rare' || rarityId === 'legend') {
      const aura = el(doc, 'span', `tile__aura tile__aura--${rarityId}`);
      aura.setAttribute('aria-hidden', 'true');
      nodes.push(aura);
    }
    nodes.push(label);
    const chip = el(
      doc,
      'span',
      'tile__rarity',
      special ? '特' : rarity.short,
    );
    chip.dataset.rarity = special ? 'legend' : (entry?.rarity ?? 'legend');
    nodes.push(chip);
    if (entry?.recipe) nodes.push(el(doc, 'span', 'tile__recipe', entry.recipe));
    return nodes;
  }

  /** 水³ 方块里的气泡（纯 CSS 动画） */
  function buildBubbles(): HTMLElement {
    const wrap = el(doc, 'span', 'tile__bubbles');
    wrap.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 3; i += 1) wrap.append(el(doc, 'i'));
    return wrap;
  }

  function createTile(rank: number, cell: number, extraClass?: string, variant?: string): HTMLElement {
    const tier = config.tiers[rank];
    const codex = isCodexRank(config, rank);
    if (!tier && !codex) throw new Error(`未知等级：${rank}`);
    const node = el(doc, 'div', 'tile');
    node.dataset.rank = String(rank);
    let entry: CodexEntry | undefined;
    if (codex) {
      entry = variant ? entryById(config, variant) : undefined;
      const special = specialProduct(variant) !== undefined;
      node.dataset.entry = variant ?? '';
      // 特殊产物统一按「传说」材质 + 金色描边，和普通稀有词条区分
      node.dataset.rarity = special ? 'legend' : (entry?.rarity ?? 'legend');
      if (special) node.dataset.special = '1';
      const { hue, hue2 } = huesOf(entry, config.codex?.entries ?? [], variant ?? '');
      node.style.setProperty('--hue', String(hue));
      node.style.setProperty('--hue2', String(hue2));
      node.style.setProperty(
        '--rarity',
        RARITIES[special ? 'legend' : (entry?.rarity ?? 'legend')].color,
      );
    }
    node.setAttribute('aria-hidden', 'true');
    if (extraClass) node.classList.add(extraClass);
    setCell(node, cell, config.size);
    const face = el(doc, 'div', 'tile__face');
    if (codex) {
      for (const child of buildCodexContent(entry, variant ?? '?')) face.append(child);
    } else {
      face.append(buildTierLabel(tier!));
      if (tier!.id === 'water') face.append(buildBubbles());
    }
    node.append(face);
    node.addEventListener('animationend', (event) => {
      if (event.target === face) node.classList.remove('tile--pop', 'tile--spawn');
    });
    tilesLayer.append(node);
    return node;
  }

  /* ---------------- 渲染编排 ---------------- */

  function paintAll(state: GameState): void {
    views.clear();
    tilesLayer.textContent = '';
    for (let i = 0; i < state.cells.length; i += 1) {
      const tile = state.cells[i];
      if (!tile) continue;
      views.set(tile.id, createTile(tile.rank, i, undefined, tile.variant));
    }
  }

  function slide(slides: Slide[]): void {
    for (const item of slides) {
      const node = views.get(item.id);
      if (node) setCell(node, item.to, config.size);
    }
  }

  function born(merges: Merge[]): void {
    for (const merge of merges) {
      const node = createTile(merge.rank, merge.cell, 'tile--born', merge.variant);
      views.set(merge.targetId, node);
    }
  }

  function floatScore(cell: number, gained: number, boost: boolean): void {
    const node = el(doc, 'div', `float${boost ? ' float--boost' : ''}`);
    setCell(node, cell, config.size);
    const text = el(doc, 'span', undefined, `+${gained}`);
    node.append(text);
    fxLayer.append(node);
    const kill = (): void => node.remove();
    text.addEventListener('animationend', kill, { once: true });
    later(w, kill, FLOAT_MS + 400);
  }

  function pop(merges: Merge[], mult: number): void {
    for (const merge of merges) {
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
        floatScore(merge.cell, merge.gained, mult > 1);
      }
    }
  }

  function spawnTile(spawn: Spawn): void {
    const node = createTile(spawn.rank, spawn.cell, 'tile--spawn');
    views.set(spawn.id, node);
  }

  const HEART_GLYPHS = ['❤', '💗', '💖'];

  /**
   * 爱心粒子：在每个「妙」所在格生成一圈爱心，粒子从妙的格子里升起；
   * 妙移动后会在新位置生成（跟随妙），不再随机铺满棋盘。
   */
  function heartBurst(cells: readonly number[]): void {
    for (const cell of cells) {
      for (let i = 0; i < 7; i += 1) {
        const node = el(doc, 'span', 'heart');
        node.setAttribute('aria-hidden', 'true');
        setCell(node, cell, config.size);
        const glyph = el(doc, 'span', 'heart__glyph', HEART_GLYPHS[i % HEART_GLYPHS.length]!);
        // 爱心在妙的格子里左右散开一点，再往上飘
        glyph.style.left = `${44 + Math.round((rng() - 0.5) * 46)}%`;
        glyph.style.setProperty('--delay', `${Math.round(rng() * 240)}ms`);
        glyph.style.setProperty('--size', `${(0.72 + rng() * 0.5).toFixed(2)}`);
        glyph.addEventListener('animationend', () => node.remove(), { once: true });
        node.append(glyph);
        fxLayer.append(node);
      }
    }
  }

  function nudge(): void {
    if (nudgeTimer !== null) return;
    board.classList.remove('board--nudge');
    void board.offsetWidth;
    board.classList.add('board--nudge');
    nudgeTimer = later(w, () => {
      nudgeTimer = null;
      board.classList.remove('board--nudge');
    }, 260);
  }

  /* ---------------- 几何：按真实宽度算成 px，任何屏幕都精确对齐 ---------------- */

  function layout(): void {
    const width = board.clientWidth;
    if (width <= 0) return; // jsdom 没有布局，直接跳过
    const round = (value: number): number => Math.round(value * 2) / 2;
    const pad = round(Math.min(14, Math.max(7, width * 0.028)));
    const gap = round(Math.min(12, Math.max(6, width * 0.024)));
    const tile = (width - 2 * pad - (config.size - 1) * gap) / config.size;
    board.style.setProperty('--pad', `${pad}px`);
    board.style.setProperty('--gap', `${gap}px`);
    board.style.setProperty('--tile', `${tile}px`);
    board.style.setProperty('--radius', `${(tile * 0.23).toFixed(2)}px`);
  }

  // 初始格线
  board.style.setProperty('--n', String(config.size));
  grid.textContent = '';
  for (let i = 0; i < config.size * config.size; i += 1) {
    grid.append(el(doc, 'div', 'cell'));
  }
  board.addEventListener('animationend', (event) => {
    if (event.target === board) board.classList.remove('board--nudge');
  });

  return {
    paintAll,
    slide,
    born,
    pop,
    spawnTile,
    heartBurst,
    nudge,
    layout,
    destroy() {
      if (nudgeTimer !== null) cancelTimer(w, nudgeTimer);
      views.clear();
      tilesLayer.textContent = '';
      fxLayer.textContent = '';
    },
  };
}