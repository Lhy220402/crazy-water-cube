/**
 * 图鉴抽屉：合成链页 + 词条页。
 * 悬念契约：未收录的词条不剧透名字、不显示 x/y 总数，只留一张问号卡；
 * 特殊配方在合成链页公开配对（玩法需要），但产物名字首次触发前同样打码。
 */
import { allEntries, entryById, isCodexRank, type GameConfig } from '../game/config.ts';
import { RARITIES, entryText, huesOf, type CodexEntry } from '../game/codex.ts';
import { RECIPES, specialProduct } from '../game/recipes.ts';
import { loreOf } from '../game/lore.ts';
import { cancelTimer, el, later } from './dom.ts';

const SHEET_MS = 280;

export type SheetTab = 'chain' | 'codex';
export type CodexCounts = Record<string, number>;

export interface SheetView {
  open(tab?: SheetTab): void;
  close(): void;
  isOpen(): boolean;
  refresh(): void;
  collectedCount(): number;
  destroy(): void;
}

export interface SheetOptions {
  doc: Document;
  w: Window | null;
  config: GameConfig;
  getCounts: () => CodexCounts;
  sheet: HTMLElement;
  scrim: HTMLElement;
  sub: HTMLElement;
  chain: HTMLElement;
  codexList: HTMLElement;
  tabChain: HTMLButtonElement;
  tabCodex: HTMLButtonElement;
  tabCodexCount: HTMLElement;
  paneChain: HTMLElement;
  paneCodex: HTMLElement;
  btnClose: HTMLButtonElement;
  btnDone: HTMLButtonElement;
}

export function createSheet(opts: SheetOptions): SheetView {
  const {
    doc, w, config, getCounts, sheet, scrim, sub, chain, codexList,
    tabChain, tabCodex, tabCodexCount, paneChain, paneCodex, btnClose, btnDone,
  } = opts;
  let open = false;
  let hideTimer: number | null = null;
  let tab: SheetTab = 'chain';
  let focusBefore: HTMLElement | null = null;

  const entries = allEntries(config);

  function collectedCount(): number {
    const counts = getCounts();
    return entries.filter((entry) => (counts[entry.id] ?? 0) > 0).length;
  }

  function complete(): boolean {
    return collectedCount() >= entries.length;
  }

  /* ---------------- 小方块 ---------------- */

  function miniTile(rank: number, variant?: string): HTMLElement {
    const node = el(doc, 'span', 'mini');
    node.dataset.rank = String(rank);
    const face = el(doc, 'span', 'mini__face');
    if (isCodexRank(config, rank)) {
      const entry = variant ? entryById(config, variant) : undefined;
      const special = specialProduct(variant) !== undefined;
      const rarityId = special ? 'legend' : (entry?.rarity ?? 'legend');
      const { hue, hue2 } = huesOf(entry, config.codex?.entries ?? [], variant ?? '');
      node.style.setProperty('--hue', String(hue));
      node.style.setProperty('--hue2', String(hue2));
      node.style.setProperty('--rarity', RARITIES[rarityId].color);
      if (entry) node.dataset.rarity = special ? 'legend' : entry.rarity;
      const text = entry?.tileName ?? entry?.name ?? '?';
      const width = [...text].length;
      const size = width <= 2 ? 'is-s1' : width === 3 ? 'is-s2' : width === 4 ? 'is-s3' : 'is-s4';
      const label = el(doc, 'span', `tile__label tile__label--codex ${size}`);
      label.append(el(doc, 'span', `tile__main${entry?.ring ? ' tile__main--ring' : ''}`, text));
      // 图鉴里的小方块也带稀有度光效，和棋盘保持一致
      if (rarityId === 'rare' || rarityId === 'legend') {
        const aura = el(doc, 'span', `tile__aura tile__aura--${rarityId}`);
        aura.setAttribute('aria-hidden', 'true');
        face.append(aura);
      }
      face.append(label);
    } else {
      const tier = config.tiers[rank];
      if (tier) {
        const label = el(doc, 'span', `tile__label${tier.latin ? ' tile__label--latin' : ''}`);
        if (tier.label.includes(' ')) {
          const stack = el(doc, 'span', 'tile__main tile__main--stack');
          for (const word of tier.label.split(' ')) stack.append(el(doc, 'span', undefined, word));
          label.append(stack);
        } else {
          label.append(el(doc, 'span', 'tile__main', tier.label));
        }
        if (tier.sup) label.append(el(doc, 'span', 'tile__sup tile__sup--power', tier.sup));
        face.append(label);
      }
    }
    node.append(face);
    return node;
  }

  function mysteryMini(): HTMLElement {
    const node = el(doc, 'span', 'mini mini--mystery');
    node.append(el(doc, 'span', 'mini__face', '?'));
    return node;
  }

  /* ---------------- 合成链页 ---------------- */

  function buildChain(): void {
    chain.textContent = '';
    const tiers = config.tiers;
    const top = tiers[tiers.length - 1]!;
    sub.textContent =
      config.codex === undefined
        ? `两枚同级相碰，合成下一级。${top.name} 是这套体系的终点，不会再合成。`
        : `两枚同级相碰，合成下一级。${top.name} 之后没有固定名字了——每次合成都随机抽一条词条，收进图鉴。稀有度只影响出现概率，任意两条词条都能合。`;

    for (let rank = 0; rank < tiers.length - 1; rank += 1) {
      const row = el(doc, 'div', 'chain__row');
      row.append(miniTile(rank));
      row.append(el(doc, 'span', 'chain__times', '×2'));
      row.append(el(doc, 'span', 'chain__arrow', '→'));
      row.append(miniTile(rank + 1));
      row.append(el(doc, 'span', 'chain__name', tiers[rank + 1]!.name));
      chain.append(row);
    }

    const finalRow = el(doc, 'div', 'chain__row chain__row--final');
    finalRow.append(miniTile(tiers.length - 1));
    finalRow.append(el(doc, 'span', 'chain__times', '×2'));
    finalRow.append(el(doc, 'span', 'chain__arrow', '→'));
    finalRow.append(mysteryMini());
    finalRow.append(
      el(doc, 'span', 'chain__name', config.codex === undefined ? `${top.name} · 终点` : '随机词条 · 图鉴收录'),
    );
    chain.append(finalRow);

    if (config.codex !== undefined) {
      chain.append(el(doc, 'p', 'chain__section', '特殊配方 · 相撞即合 · 产物首次触发前打码'));
      const counts = getCounts();
      for (const recipe of RECIPES) {
        const product = specialProduct(recipe.product);
        if (!product) continue;
        const known = (counts[product.entry.id] ?? 0) > 0;
        // 真通关配方是隐藏内容：首次触发前连配方行都不显示，留给玩家探索
        if (product.trueWin && !known) continue;
        const row = el(doc, 'div', 'chain__row chain__row--recipe');
        row.append(recipeMini(recipe.a));
        row.append(el(doc, 'span', 'chain__times', '+'));
        row.append(recipeMini(recipe.b));
        row.append(el(doc, 'span', 'chain__arrow', '→'));
        row.append(known ? miniTile(config.codexRank, product.entry.id) : mysteryMini());
        const buffText = product.buff.moves < 0 ? '永久' : `${product.buff.moves}步`;
        row.append(
          el(
            doc,
            'span',
            'chain__name',
            known
              ? `${product.entry.name} · ×${product.buff.mult}/${buffText}${product.trueWin ? ' · 真通关' : ''}`
              : '？？？ · 特殊合成',
          ),
        );
        chain.append(row);
      }
    }
  }

  function recipeMini(matcher: { rank: number } | { variant: string }): HTMLElement {
    if ('variant' in matcher) return miniTile(config.codexRank, matcher.variant);
    return miniTile(matcher.rank);
  }

  /* ---------------- 词条页 ---------------- */

  function buildCodex(): void {
    codexList.textContent = '';
    const counts = getCounts();
    const got = collectedCount();
    const total = entries.length;

    const head = el(doc, 'div', 'codex__head');
    head.append(
      el(
        doc,
        'span',
        'codex__progress',
        complete() ? `全部收录 · 共 ${total} 条` : got === 0 ? '图鉴还是空白的' : `已收录 ${got} 条`,
      ),
    );
    if (complete()) head.append(el(doc, 'span', 'codex__badge', '✦ 集齐'));
    codexList.append(head);

    // v2.4 收集进度条：未集齐时不写总数（保持悬念），集齐后才揭示总数
    const bar = el(doc, 'div', 'codex__bar');
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', String(total));
    bar.setAttribute('aria-valuenow', String(got));
    bar.setAttribute('aria-label', '图鉴收集进度');
    const fill = el(doc, 'span', 'codex__bar-fill');
    fill.style.width = `${total > 0 ? Math.round((got / total) * 100) : 0}%`;
    bar.append(fill);
    codexList.append(bar);

    const collected = entries.filter((entry) => (counts[entry.id] ?? 0) > 0);
    if (collected.length > 0) {
      const grid = el(doc, 'div', 'codex__grid');
      codexList.append(grid);
      for (const entry of collected) {
        grid.append(buildCard(entry, counts[entry.id] ?? 0));
      }
    }

    if (!complete()) {
      const mystery = el(doc, 'div', 'mystery');
      const veil = el(doc, 'div', 'mystery__face');
      veil.append(el(doc, 'span', 'mystery__mark', '？'));
      mystery.append(veil);
      mystery.append(el(doc, 'p', 'mystery__text', '还没收录的词条，继续合成才能揭开'));
      codexList.append(mystery);
    } else {
      // 集齐后的收尾：不把话说死，留一个继续更新的口子
      const tail = el(doc, 'div', 'codex__continue');
      tail.append(el(doc, 'span', 'codex__continue-text', '未完待续'));
      tail.append(el(doc, 'p', 'codex__continue-hint', '新的词条还在路上，先把这一页收好'));
      codexList.append(tail);
    }

    tabCodexCount.textContent = got > 0 ? String(got) : '';
  }

  function buildCard(entry: CodexEntry, times: number): HTMLElement {
    const special = entry.kind === 'special';
    const rarity = RARITIES[entry.rarity];
    const card = el(doc, 'article', 'card');
    const { hue, hue2 } = huesOf(entry, config.codex?.entries ?? [], entry.id);
    card.style.setProperty('--hue', String(hue));
    card.style.setProperty('--hue2', String(hue2));
    card.style.setProperty('--rarity', (special ? RARITIES.legend : rarity).color);
    card.dataset.entry = entry.id;
    card.dataset.rarity = entry.rarity;
    card.dataset.kind = entry.kind ?? 'entry';

    const face = el(doc, 'div', 'card__face');
    const name = entryText(entry);
    const width = [...name].length;
    const nameEl = el(doc, 'span', `card__name${width > 3 ? ' card__name--small' : ''}`, name);
    if (entry.ring) nameEl.classList.add('card__name--ring');
    face.append(nameEl);
    card.append(face);

    const meta = el(doc, 'div', 'card__meta');
    meta.append(
      el(doc, 'span', 'card__rarity', entry.kind === 'special' ? '特殊合成' : rarity.label),
    );
    if (times > 1) meta.append(el(doc, 'span', 'card__times', `×${times}`));
    card.append(meta);
    // 没有解释文案的词条（隋 / 李娜）不显示说明区
    const desc = loreOf(entry.id);
    if (desc.length > 0) card.append(el(doc, 'p', 'card__desc', desc));
    return card;
  }

  /* ---------------- 开关与分页 ---------------- */

  function selectTab(next: SheetTab): void {
    tab = next;
    const onChain = next === 'chain';
    tabChain.classList.toggle('is-active', onChain);
    tabCodex.classList.toggle('is-active', !onChain);
    tabChain.setAttribute('aria-selected', String(onChain));
    tabCodex.setAttribute('aria-selected', String(!onChain));
    paneChain.hidden = !onChain;
    paneCodex.hidden = onChain;
    if (onChain) buildChain();
    else buildCodex();
  }

  function openSheet(next: SheetTab = 'chain'): void {
    if (open) {
      selectTab(next);
      return;
    }
    if (hideTimer !== null) {
      cancelTimer(w, hideTimer);
      hideTimer = null;
    }
    selectTab(next);
    focusBefore = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
    sheet.hidden = false;
    sheet.setAttribute('aria-hidden', 'false');
    void sheet.offsetWidth;
    sheet.classList.add('is-open');
    open = true;
    btnClose.focus({ preventScroll: true });
  }

  function closeSheet(): void {
    if (!open) return;
    open = false;
    sheet.classList.remove('is-open');
    sheet.setAttribute('aria-hidden', 'true');
    if (hideTimer !== null) cancelTimer(w, hideTimer);
    hideTimer = later(w, () => {
      hideTimer = null;
      sheet.hidden = true;
    }, SHEET_MS);
    if (focusBefore?.isConnected) focusBefore.focus({ preventScroll: true });
    focusBefore = null;
  }

  function onTabChain(): void {
    selectTab('chain');
  }
  function onTabCodex(): void {
    selectTab('codex');
  }
  tabChain.addEventListener('click', onTabChain);
  tabCodex.addEventListener('click', onTabCodex);
  scrim.addEventListener('click', closeSheet);
  btnClose.addEventListener('click', closeSheet);
  btnDone.addEventListener('click', closeSheet);

  return {
    open: openSheet,
    close: closeSheet,
    isOpen: () => open,
    refresh() {
      tabCodexCount.textContent = collectedCount() > 0 ? String(collectedCount()) : '';
      if (open) selectTab(tab);
    },
    collectedCount,
    destroy() {
      if (hideTimer !== null) cancelTimer(w, hideTimer);
      tabChain.removeEventListener('click', onTabChain);
      tabCodex.removeEventListener('click', onTabCodex);
      scrim.removeEventListener('click', closeSheet);
      btnClose.removeEventListener('click', closeSheet);
      btnDone.removeEventListener('click', closeSheet);
    },
  };
}