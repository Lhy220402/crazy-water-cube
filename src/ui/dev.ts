/**
 * 开发者模式（v3.2.0）—— 本机调试用，不影响正式玩法。
 *
 * 解锁：在「存档导入」文本框里输入魔法码 `JWC1.DEV-2048`（不是有效存档码，不会覆盖存档）。
 * 解锁后游戏界面出现「开发者模式」开关；开关是否解锁 / 是否开启都记在
 * `${storageKey}.dev`（第 7 个 key，只给开发者模式用）：
 *   - key 不存在 = 没解锁，开关不显示；
 *   - 'on' / 'off' = 已解锁，开关一直显示，值就是开关状态。
 * 开发者记录不进存档码，也不改主题 / 声音 / 版本记录与游戏存档语义。
 *
 * 权限（工具面板）：图鉴全收 / 清空、最高分与当前分、棋盘清空 / 随机铺词条 /
 * 加任意词条 / 加传奇 / 加记赢赢、假通真通标记、清空增益。
 */
import type { KV } from './storage.ts';
import { allEntries, type GameConfig } from '../game/config.ts';
import { RARITIES } from '../game/codex.ts';
import { el } from './dom.ts';

export const DEV_SAVE_CODE = 'JWC1.DEV-2048';

export function devKey(storageKey: string): string {
  return `${storageKey}.dev`;
}

export interface DevMode {
  readonly unlocked: boolean;
  readonly enabled: boolean;
}

/** 导入框里输入的是不是开发者魔法码（大小写不敏感，前后空白忽略） */
export function isDevSaveCode(text: string): boolean {
  return text.trim().toUpperCase() === DEV_SAVE_CODE.toUpperCase();
}

export function readDevMode(kv: KV, storageKey: string): DevMode {
  let raw: string | null = null;
  try {
    raw = kv.get(devKey(storageKey));
  } catch {
    raw = null;
  }
  if (raw === null) return { unlocked: false, enabled: false };
  return { unlocked: true, enabled: raw !== 'off' };
}

export function writeDevMode(kv: KV, storageKey: string, mode: DevMode): void {
  try {
    if (!mode.unlocked) {
      kv.remove(devKey(storageKey));
      return;
    }
    kv.set(devKey(storageKey), mode.enabled ? 'on' : 'off');
  } catch {
    /* 存不了就只在本次会话里记着 */
  }
}

/* ------------------------------------------------------------------ */
/* 游戏界面里的开关                                                    */
/* ------------------------------------------------------------------ */

export interface DevBarOptions {
  bar: HTMLElement;
  toggle: HTMLButtonElement;
  openButton: HTMLButtonElement;
  mode: DevMode;
  onToggle(enabled: boolean): void;
  onOpen(): void;
}

export interface DevBarView {
  sync(mode: DevMode): void;
  destroy(): void;
}

export function createDevBar(opts: DevBarOptions): DevBarView {
  let mode = opts.mode;

  function sync(next: DevMode = mode): void {
    mode = next;
    opts.bar.hidden = !mode.unlocked;
    opts.toggle.setAttribute('aria-checked', String(mode.enabled));
    opts.toggle.classList.toggle('is-on', mode.enabled);
    opts.toggle.textContent = mode.enabled ? '开' : '关';
    opts.openButton.hidden = !mode.enabled;
    opts.openButton.disabled = !mode.enabled;
  }

  function onToggleClick(): void {
    opts.onToggle(!mode.enabled);
  }

  function onOpenClick(): void {
    if (mode.enabled) opts.onOpen();
  }

  opts.toggle.addEventListener('click', onToggleClick);
  opts.openButton.addEventListener('click', onOpenClick);
  sync(mode);

  return {
    sync,
    destroy() {
      opts.toggle.removeEventListener('click', onToggleClick);
      opts.openButton.removeEventListener('click', onOpenClick);
    },
  };
}

/* ------------------------------------------------------------------ */
/* 开发者工具面板                                                      */
/* ------------------------------------------------------------------ */

export interface DevStatus {
  score: number;
  best: number;
  collected: number;
  total: number;
  tiles: number;
  won: boolean;
  trueWon: boolean;
  buffs: number;
}

export interface DevActions {
  collectAll(): string;
  clearCodex(): string;
  setBest(value: number): string;
  setScore(value: number): string;
  clearBoard(): string;
  fillRandom(): string;
  addEntry(entryId: string): string;
  addMyth(): string;
  addJiYingYing(): string;
  setWon(value: boolean): string;
  setTrueWon(value: boolean): string;
  clearBuffs(): string;
}

export interface DevPanelOptions {
  doc: Document;
  config: GameConfig;
  actions: DevActions;
  status(): DevStatus;
}

export interface DevPanelView {
  root: HTMLElement;
  refresh(): void;
}

export function buildDevPanel(opts: DevPanelOptions): DevPanelView {
  const { doc, config, actions, status } = opts;
  const root = el(doc, 'div', 'dev');
  const statusEl = el(doc, 'p', 'dev__status');
  const msgEl = el(doc, 'p', 'dev__msg');
  msgEl.hidden = true;
  root.append(statusEl);

  function message(text: string): void {
    if (text.length === 0) {
      msgEl.hidden = true;
      return;
    }
    msgEl.hidden = false;
    msgEl.textContent = text;
  }

  function section(title: string): HTMLElement {
    const box = el(doc, 'section', 'dev__group');
    box.append(el(doc, 'p', 'dev__title', title));
    return box;
  }

  function actionButton(label: string, run: () => string): HTMLButtonElement {
    const button = el(doc, 'button', 'pill pill--ghost dev__btn', label);
    button.type = 'button';
    button.addEventListener('click', () => {
      message(run());
      refresh();
    });
    return button;
  }

  function numberField(label: string, value: number): {
    field: HTMLLabelElement;
    input: HTMLInputElement;
  } {
    const field = el(doc, 'label', 'dev__field');
    field.append(el(doc, 'span', 'dev__field-label', label));
    const input = el(doc, 'input', 'dev__input');
    input.type = 'number';
    input.min = '0';
    input.step = '1';
    input.inputMode = 'numeric';
    input.value = String(value);
    input.setAttribute('aria-label', label);
    field.append(input);
    return { field, input };
  }

  /* 图鉴 */
  const codexGroup = section('图鉴');
  const codexRow = el(doc, 'div', 'dev__row');
  codexRow.append(
    actionButton('图鉴全收集', () => actions.collectAll()),
    actionButton('清空图鉴', () => actions.clearCodex()),
  );
  codexGroup.append(codexRow);

  /* 分数 */
  const scoreGroup = section('分数');
  const bestValue = numberField('最高分', status().best);
  const bestRow = el(doc, 'div', 'dev__row');
  bestRow.append(
    bestValue.field,
    actionButton('设置最高分', () => actions.setBest(Number(bestValue.input.value))),
  );
  const scoreValue = numberField('当前分', status().score);
  const scoreRow = el(doc, 'div', 'dev__row');
  scoreRow.append(
    scoreValue.field,
    actionButton('设置当前分', () => actions.setScore(Number(scoreValue.input.value))),
  );
  scoreGroup.append(bestRow, scoreRow);

  /* 棋盘 */
  const boardGroup = section('棋盘');
  const boardRow = el(doc, 'div', 'dev__row');
  boardRow.append(
    actionButton('清空棋盘', () => actions.clearBoard()),
    actionButton('随机铺满词条', () => actions.fillRandom()),
    actionButton('加一枚传奇', () => actions.addMyth()),
    actionButton('加两枚记赢赢', () => actions.addJiYingYing()),
  );
  const entryRow = el(doc, 'div', 'dev__row');
  const select = el(doc, 'select', 'dev__select');
  select.setAttribute('aria-label', '选择要加入的词条');
  for (const entry of allEntries(config)) {
    const option = el(doc, 'option', '', `${entry.name}（${RARITIES[entry.rarity].label}）`);
    option.value = entry.id;
    select.append(option);
  }
  const addButton = actionButton('加入选中词条', () => actions.addEntry(select.value));
  addButton.classList.add('pill--primary');
  addButton.classList.remove('pill--ghost');
  entryRow.append(select, addButton);
  boardGroup.append(boardRow, entryRow);

  /* 通关标记与增益 */
  const stateGroup = section('通关 / 增益');
  const stateRow = el(doc, 'div', 'dev__row');
  stateRow.append(
    actionButton('设为假通关', () => actions.setWon(true)),
    actionButton('取消假通关', () => actions.setWon(false)),
    actionButton('设为真通关', () => actions.setTrueWon(true)),
    actionButton('取消真通关', () => actions.setTrueWon(false)),
    actionButton('清空增益', () => actions.clearBuffs()),
  );
  stateGroup.append(stateRow);

  const note = el(
    doc,
    'p',
    'dev__note',
    '改动立即写入本机存档；开发者模式记录不进存档码。面板会剧透未收录的传奇名字。',
  );
  root.append(codexGroup, scoreGroup, boardGroup, stateGroup, msgEl, note);

  function refresh(): void {
    const s = status();
    statusEl.textContent = `最高分 ${s.best} · 当前 ${s.score} · 图鉴 ${s.collected}/${s.total} · 棋盘 ${s.tiles}/16 · 假通关：${s.won ? '是' : '否'} · 真通关：${s.trueWon ? '是' : '否'} · 增益 ${s.buffs}`;
    bestValue.input.value = String(s.best);
    scoreValue.input.value = String(s.score);
  }

  refresh();
  return { root, refresh };
}
