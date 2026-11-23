import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { GAME_VERSION } from '../src/game/meta.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = await readFile(resolve(root, 'dist/2048.html'), 'utf8');

const SLIDE = 120;
const OVERLAY = 240;
const SHEET = 280;
const SIG = 'jun|win|water|lec|liu';

interface Harness {
  dom: JSDOM;
  win: Window & typeof globalThis;
  doc: Document;
  app: {
    state: {
      cells: ({ id: number; rank: number; variant?: string } | null)[];
      score: number;
      moves: number;
      won: boolean;
      trueWon: boolean;
      buffs: { id: string; label: string; mult: number; movesLeft: number }[];
      over: boolean;
    };
    best: number;
    codex: Record<string, number>;
    move(dir: 'up' | 'down' | 'left' | 'right'): void;
    restart(): void;
    undo(): void;
    openGuide(tab?: 'chain' | 'codex'): void;
    openAbout(): void;
  };
  $<T extends Element = HTMLElement>(selector: string): T;
  close(): void;
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

async function boot(
  saved?: unknown,
  codex?: unknown,
  theme?: string,
  options: {
    skipIntro?: boolean;
    best?: number;
    sound?: 'on' | 'off';
    /** 上次进入游戏的版本；null = 没有版本记录（模拟从旧版升级） */
    version?: string | null;
    /** 固定随机源，让「抽到哪条词条」等断言可复现 */
    rng?: () => number;
  } = {},
): Promise<Harness> {
  const virtualConsole = new VirtualConsole();
  const errors: string[] = [];
  virtualConsole.on('jsdomError', (error: Error) => {
    // jsdom 的 CSS 解析器不认识 backdrop-filter 等新语法，这些噪声忽略
    if (!/Could not parse CSS/.test(error.message)) errors.push(error.message);
  });
  virtualConsole.on('error', (message: unknown) => errors.push(String(message)));

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://example.test/2048.html',
    virtualConsole,
    beforeParse(window) {
      // 脚本执行前先写入存档/图鉴，模拟「上次退出后重新打开」
      if (saved !== undefined) window.localStorage.setItem('jun2048', JSON.stringify(saved));
      if (codex !== undefined) window.localStorage.setItem('jun2048.codex', JSON.stringify(codex));
      if (theme !== undefined) window.localStorage.setItem('jun2048.theme', theme);
      if (options.best !== undefined) window.localStorage.setItem('jun2048.best', String(options.best));
      if (options.sound !== undefined) window.localStorage.setItem('jun2048.sound', options.sound);
      // 默认视为「当前版本已经打开过」；测版本更新弹窗时传 version: '2.2.2' 或 null
      if (options.version !== null) {
        window.localStorage.setItem('jun2048.version', options.version ?? GAME_VERSION);
      }
      // app 默认用 Math.random（main.ts 没传 rng）：在脚本执行前替换掉即可固定随机
      if (options.rng) {
        window.Math.random = options.rng;
      }
    },
  });
  const win = dom.window as unknown as Window & typeof globalThis;
  const doc = win.document;
  const app = (win as unknown as { __jun2048: Harness['app'] }).__jun2048;
  assert.ok(app, 'App 未挂载');
  if (options.skipIntro !== false) {
    // 默认跳过开场界面，老测试直接测棋盘；开场界面本身单独测
    const start = doc.querySelector<HTMLButtonElement>('#intro-start');
    assert.ok(start, '缺少开场界面的开始按钮');
    start.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  }
  const h: Harness = {
    dom,
    win,
    doc,
    app,
    $<T extends Element = HTMLElement>(selector: string): T {
      const node = doc.querySelector<T>(selector);
      assert.ok(node, `缺少节点 ${selector}`);
      return node;
    },
    close() {
      dom.window.close();
      assert.deepEqual(errors, [], '运行期不应有 JS 错误');
    },
  };
  return h;
}

function ranks(h: Harness): (number | null)[] {
  // 注意：state.cells 是 jsdom 领域里 new Array 出来的，直接 map 得到的是「另一个 realm」
  // 的数组，原型不同会让 assert.deepStrictEqual 误判，所以用 Array.from 回到本 realm。
  return Array.from(h.app.state.cells, (tile) => (tile ? tile.rank : null));
}

/** v3 存档构造器 */
function saved(
  ranksArr: (number | null)[],
  opts: {
    variants?: (string | null)[];
    score?: number;
    moves?: number;
    won?: boolean;
    trueWon?: boolean;
    buffs?: unknown[];
  } = {},
): unknown {
  return {
    v: 3,
    size: 4,
    sig: SIG,
    ranks: ranksArr,
    variants: opts.variants ?? ranksArr.map(() => null),
    score: opts.score ?? 0,
    moves: opts.moves ?? 0,
    won: opts.won ?? false,
    trueWon: opts.trueWon ?? false,
    buffs: opts.buffs ?? [],
  };
}

const EMPTY16: (number | null)[] = new Array(16).fill(null);

/** 图鉴 48 条全收录（随机池 29 + 特殊产物 7 + 传奇 12），用于测进度条与「未完待续」 */
const ALL_CODEX_IDS = [
  'sui', 'eyu-qi', 'sui-ring', 'eyu-shi-jun', 'ji', 'bayi', 'hongmei', 'jinshan', 'fuli',
  'li', 'na', 'xiaoming', 'yanzi', 'doubao', 'biao', 'huicheng', 'xiaoyu', 'gang', 'weihai',
  'dingjian', 'junzhu', 'chenglong', 'batian', 'neng', 'zhaoyiming', 'sudailiao',
  'zuolun', 'yu-zi', 'he-si',
  'sui-jun', 'sui-jun-ring', 'shui-gang', 'lina', 'ji-ying-ying', 'miao', 'ji-hui-cheng',
  'meihui', 'zhaojun', 'xiangjun', 'xiaofeng', 'yingtao', 'jiasheng', '666', 'hongying',
  'wangxuedi', 'zhongshu', 'guojing', 'chuncheng',
];
const ALL_CODEX: Record<string, number> = Object.fromEntries(ALL_CODEX_IDS.map((id) => [id, 1]));

/** 等一次移动彻底落定：状态连续两次采样不变，且 DOM 方块数与状态一致 */
async function settle(h: Harness, timeout = 2000): Promise<void> {
  const started = Date.now();
  let last = JSON.stringify(ranks(h)) + '|' + h.app.state.score + '|' + h.app.state.moves;
  let stable = 0;
  while (Date.now() - started < timeout) {
    await sleep(40);
    const now = JSON.stringify(ranks(h)) + '|' + h.app.state.score + '|' + h.app.state.moves;
    const domCount = h.$('#tiles').children.length;
    const stateCount = h.app.state.cells.filter(Boolean).length;
    if (now === last && domCount === stateCount) {
      stable += 1;
      if (stable >= 2 && Date.now() - started > SLIDE + 80) return;
    } else {
      stable = 0;
    }
    last = now;
  }
}

test('首屏渲染：品牌、16 格、2 方块、分数归零、无增益', async () => {
  const h = await boot();
  assert.match(h.doc.title, /疯狂水立方/);
  assert.match(h.$('.brand__title').textContent ?? '', /疯狂水立方/);
  assert.equal(h.$('#grid').children.length, 16);
  assert.equal(h.$('#tiles').children.length, 2);
  assert.equal(h.$('#score').textContent, '0');
  assert.equal(h.$('#best').textContent, '0');
  assert.equal(h.$('#btn-undo').hasAttribute('disabled'), true);
  assert.equal(h.$('#buffs').hidden, true);
  const hint = h.$('#hint').textContent ?? '';
  assert.equal(hint.includes('记'), false, '棋盘提示不泄露真通关');
  assert.equal(hint.includes('赢²'), false, '棋盘提示不泄露真通关');
  for (const tile of h.$('#tiles').children) {
    assert.equal(tile.classList.contains('tile'), true);
    const face = tile.querySelector('.tile__face .tile__label');
    assert.ok(face, '每个方块都要有文字标签');
  }
  assert.equal(h.app.state.moves, 0);
  assert.equal(h.app.state.trueWon, false);
  h.close();
});

test('键盘方向键可以移动方块并计分', async () => {
  const h = await boot();
  const before = JSON.stringify(ranks(h));
  let moved = false;
  for (const key of ['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp']) {
    h.doc.dispatchEvent(new h.win.KeyboardEvent('keydown', { key, bubbles: true }));
    await settle(h);
    if (JSON.stringify(ranks(h)) !== before || h.app.state.moves > 0) {
      moved = true;
      break;
    }
  }
  assert.equal(moved, true, '至少有一个方向能推动方块');
  assert.ok(h.app.state.moves >= 1);
  h.close();
});

test('移动后撤销恢复原局面，按钮状态跟随历史', async () => {
  const h = await boot();
  const before = ranks(h);
  h.doc.dispatchEvent(new h.win.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  await settle(h);
  if (h.app.state.moves === 0) {
    h.app.move('down');
    await settle(h);
  }
  assert.ok(h.app.state.moves > 0, '需要有一步有效移动');
  assert.equal(h.$('#btn-undo').hasAttribute('disabled'), false);
  h.$('#btn-undo').dispatchEvent(new h.win.MouseEvent('click', { bubbles: true }));
  await settle(h);
  assert.deepEqual(ranks(h), before, '撤销后等级布局应回到移动前');
  assert.equal(h.app.state.moves, 0);
  assert.equal(h.$('#btn-undo').hasAttribute('disabled'), true);
  h.close();
});

test('合成「赢²」加分，²/³ 上标醒目渲染', async () => {
  const h = await boot(saved([0, 0, ...EMPTY16.slice(2)]));
  h.app.move('left');
  await settle(h);
  assert.equal(h.app.state.cells.some((tile) => tile && tile.rank === 1), true);
  assert.equal(h.app.state.score, 4);
  assert.ok(h.$('#fx').querySelector('.float'), '应显示 +分 浮字');
  const sup = h.$('#tiles').querySelector('.tile[data-rank="1"] .tile__sup--power');
  assert.ok(sup, '赢² 应有加大发光的幂上标');
  assert.equal(sup.textContent, '²');
  h.close();
});

test('水³ 方块带气泡特效', async () => {
  const h = await boot(saved([2, ...EMPTY16.slice(1)]));
  const bubbles = h.$('#tiles').querySelector('.tile[data-rank="2"] .tile__bubbles');
  assert.ok(bubbles, '水³ 应有气泡容器');
  assert.equal(bubbles.children.length, 3);
  h.close();
});

test('首次合出 OLD FIVE：假通关弹层「真通关了吗？」，不重复弹', async () => {
  const h = await boot(saved([3, 3, ...EMPTY16.slice(2)]));
  h.app.move('left');
  await settle(h);
  await sleep(60);
  assert.equal(h.$('#overlay').hidden, false, '假通关层应显示');
  assert.match(h.$('#overlay-title').textContent ?? '', /真通关了吗/);
  assert.equal(h.$('#overlay-title').classList.contains('panel__title--win'), true);
  assert.equal(h.$('#burst').children.length > 0, true, '假通关也放礼花');
  const fakeText = h.$('#overlay-text').textContent ?? '';
  assert.equal(fakeText.includes('记赢赢'), false, '假通关文案不能写明真通关配方');
  assert.equal(fakeText.includes('赢²'), false, '假通关文案不能提真通关材料');
  assert.match(fakeText, /自己探索/);
  assert.equal(h.win.localStorage.getItem('jun2048.best'), '32');
  assert.equal(h.app.state.won, true);
  assert.equal(h.app.state.trueWon, false, 'OLD FIVE 不是真通关');
  h.$('#overlay-actions .pill--primary').dispatchEvent(new h.win.MouseEvent('click', { bubbles: true }));
  await sleep(OVERLAY + 60);
  assert.equal(h.$('#overlay').hidden, true);
  h.close();
});

test('记 + 赢² → 记赢赢：真通关弹层、永久 ×2 增益徽章', async () => {
  const h = await boot(
    saved([5, 1, ...EMPTY16.slice(2)], { variants: ['ji', null, ...EMPTY16.slice(2).map(() => null)], won: true }),
  );
  h.app.move('left');
  await settle(h);
  await sleep(60);
  assert.equal(h.$('#overlay').hidden, false);
  assert.match(h.$('#overlay-title').textContent ?? '', /真·通关/);
  assert.equal(h.$('#overlay-title').classList.contains('panel__title--truewin'), true);
  assert.equal(h.app.state.trueWon, true);
  assert.equal(h.app.state.score, 256);
  const buff = h.app.state.buffs.find((item) => item.id === 'ji-ying-ying');
  assert.ok(buff, '应挂上记赢赢永久增益');
  assert.equal(buff.movesLeft, -1);
  assert.equal(h.$('#buffs').hidden, false);
  assert.match(h.$('#buffs').textContent ?? '', /×2/);
  assert.match(h.$('#buffs').textContent ?? '', /∞/);
  // 特殊产物进了图鉴
  assert.equal(h.app.codex['ji-ying-ying'], 1);
  h.close();
});

test('隋 + 军 → 水军（原隋军）：特殊收录 + 解释弹层 + ×2/8步 增益', async () => {
  const h = await boot(
    saved([5, 0, ...EMPTY16.slice(2)], { variants: ['sui', null, ...EMPTY16.slice(2).map(() => null)], won: true }),
  );
  h.app.move('left');
  await settle(h);
  await sleep(60);
  assert.equal(h.app.state.score, 64);
  const tile = h.$('#tiles').querySelector('.tile[data-entry="sui-jun"]');
  assert.ok(tile, '棋盘上应有水军方块（内部 id 仍是 sui-jun）');
  assert.equal(tile.getAttribute('data-special'), '1');
  assert.equal(h.app.codex['sui-jun'], 1);
  assert.equal(h.$('#overlay').hidden, false);
  assert.match(h.$('#overlay-eyebrow').textContent ?? '', /特殊合成/);
  assert.match(h.$('#overlay-title').textContent ?? '', /水军/);
  assert.match(h.$('#buffs').textContent ?? '', /×2/);
  assert.match(h.$('#buffs').textContent ?? '', /8步/);
  h.close();
});

test('首次抽到词条：弹解释卡、写入图鉴，名字此刻才可见', async () => {
  // 固定随机：rng=0.45 落在「燕子」（权重总和 61 → 27.45）
  const h = await boot(saved([4, 4, ...EMPTY16.slice(2)], { won: true }), undefined, undefined, {
    rng: () => 0.45,
  });
  h.app.move('left');
  await settle(h);
  await sleep(80);
  assert.equal(h.$('#overlay').hidden, false, '抽到新词条应弹解释层');
  assert.equal(h.$('#overlay-title').classList.contains('panel__title--codex'), true);
  const title = h.$('#overlay-title').textContent ?? '';
  assert.equal(title, '燕子');
  assert.match(h.$('#overlay-eyebrow').textContent ?? '', /图鉴收录/);
  assert.equal(h.$('#overlay-text').textContent, '可曾拍过什么全城热恋');

  const codexTile = h.$('#tiles').querySelector('.tile[data-rank="5"]');
  assert.ok(codexTile, '棋盘上应有词条方块');
  assert.ok(codexTile.querySelector('.tile__rarity'), '词条方块应带稀有度角标');
  assert.equal(Object.keys(h.app.codex).length, 1);
  assert.equal(h.$('#tab-codex-count').textContent, '1');

  h.$('#overlay-actions .pill--primary').dispatchEvent(new h.win.MouseEvent('click', { bubbles: true }));
  await sleep(OVERLAY + 40);
  h.app.openGuide('codex');
  await sleep(30);
  assert.equal(h.$('#codex').querySelectorAll('.card').length, 1);
  h.close();
});

test('重复抽到已收录词条不重复弹解释层', async () => {
  const h = await boot(saved([4, 4, ...EMPTY16.slice(2)], { won: true }), ALL_CODEX);
  assert.equal(Object.keys(h.app.codex).length, 48, '读档应恢复全部收录（含特殊产物与传奇）');
  h.app.move('left');
  await settle(h);
  await sleep(120);
  assert.equal(h.$('#overlay').hidden, true, '重复词条不弹解释层');
  const counts = Object.values(h.app.codex).reduce((sum, n) => sum + n, 0);
  assert.equal(counts, 49, '重复抽到也要累加出现次数');
  assert.equal(Object.keys(h.app.codex).length, 48);
  h.close();
});

test('图鉴词条页：没收集前完全空白、不剧透名字和数量', async () => {
  const h = await boot();
  h.app.openGuide('codex');
  await sleep(30);
  assert.equal(h.$('#pane-codex').hidden, false);
  assert.equal(h.$('#pane-chain').hidden, true);
  const text = h.$('#codex').textContent ?? '';
  assert.match(text, /图鉴还是空白的/);
  assert.equal(h.$('#codex').querySelectorAll('.card').length, 0);
  assert.equal(h.$('#codex').querySelectorAll('.mystery').length, 2, '普通词条 + 传奇分区各一张问号卡');
  assert.equal(h.$('#codex').querySelectorAll('.codex__section--myth').length, 1, '传奇应单独分区');
  for (const name of [
    '隋',
    '鳄鱼鳍',
    '鳄食菌',
    '记',
    '水军',
    '水缸',
    '记赢赢',
    '八一',
    '红梅',
    '金山',
    '浮力',
    'Li',
    'Na',
    '小明',
    '燕子',
    '豆包AI',
    '李娜',
    '彪',
    '会成',
    '🌧️',
    '钢',
    '威海',
    '钉剑',
    '君竹',
    '成龙',
    '霸天',
    '赵一鸣',
    '塑料袋',
    '左轮',
    '鱼籽',
    '何思',
    '妙',
    '记会成',
    '煤灰',
    '昭君',
    '象郡',
    '小风',
    '🍒',
    '假生',
    '666',
    '红鹰',
    '王雪地',
    '种树',
    '国晶',
    '春橙',
  ]) {
    assert.equal(text.includes(name), false, `不能剧透「${name}」`);
  }
  // 「能」是单字，正常提示文案里也会出现（如「才能揭开」），改查卡片名字
  assert.equal(h.$('#codex').querySelectorAll('.card').length, 0);
  assert.equal(
    Array.from(h.$('#codex').querySelectorAll('.card__name')).some((node) => node.textContent === '能'),
    false,
    '不能剧透「能」',
  );
  assert.equal(/\d+\s*\/\s*\d+/.test(text), false, '未集齐时不能显示 x/y 总数');
  // 进度条存在，但未集齐时不写总数
  assert.equal(h.$('#codex').querySelectorAll('.codex__bar').length, 1);
  assert.equal(h.$('#codex').querySelector<HTMLElement>('.codex__bar-fill')?.style.width, '0%');
  assert.equal(h.$('#tab-codex-count').textContent, '');
  h.close();
});

test('图鉴合成链页：固定链 + 词条入口 + 特殊配方（产物未触发前打码）', async () => {
  const h = await boot();
  h.$('#btn-guide').dispatchEvent(new h.win.MouseEvent('click', { bubbles: true }));
  await sleep(30);
  assert.equal(h.$('#sheet').hidden, false);
  const rows = h.$('#chain').querySelectorAll('.chain__row');
  assert.equal(rows.length, 10, '4 固定 + 1 词条入口 + 5 可见特殊配方（真通关配方隐藏）');
  const text = h.$('#chain').textContent ?? '';
  for (const name of ['军', '赢', '水', 'Lec', 'OLD FIVE', '随机词条']) {
    assert.ok(text.includes(name), `合成链应包含 ${name}`);
  }
  // Li / Na 作为配方材料公开（玩法需要），但产物李娜未触发前打码
  assert.ok(text.includes('Li'), 'Li + Na 配方材料应公开');
  assert.ok(text.includes('Na'), 'Li + Na 配方材料应公开');
  assert.equal(text.includes('李娜'), false, '李娜未触发前不剧透');
  // 隋 + 钢 的配方材料公开，产物水缸未触发前打码
  assert.ok(text.includes('钢'), '隋 + 钢 配方材料应公开');
  assert.equal(text.includes('水缸'), false, '水缸未触发前不剧透');
  // 彪 + 水³ 的配方材料公开，产物妙未触发前打码
  assert.ok(text.includes('彪'), '彪 + 水³ 配方材料应公开');
  assert.equal(text.includes('妙'), false, '妙未触发前不剧透');
  assert.equal(h.$('#chain').querySelectorAll('.chain__row--recipe').length, 5);
  assert.equal(h.$('#chain').querySelectorAll('.mini--mystery').length, 6, '词条入口 + 5 个未触发产物都打码');
  assert.equal(text.includes('水军'), false, '特殊产物未触发前不剧透');
  assert.equal(text.includes('记'), false, '真通关配方行首次触发前完全隐藏');
  assert.equal(text.includes('记赢赢'), false);
  assert.equal(text.includes('记会成'), false, '依赖记赢赢的延伸配方行也要隐藏');
  assert.equal(text.includes('会成'), false);
  assert.equal(h.$('#sheet-sub').textContent?.includes('随机抽一条词条'), true);
  h.$('#sheet-close').dispatchEvent(new h.win.MouseEvent('click', { bubbles: true }));
  await sleep(SHEET + 60);
  assert.equal(h.$('#sheet').hidden, true);
  h.close();
});

test('特殊产物触发后，合成链页揭示产物与增益；真通关配方触发后才出现', async () => {
  const h = await boot(undefined, { 'sui-jun': 1 });
  h.app.openGuide('chain');
  await sleep(30);
  const text = h.$('#chain').textContent ?? '';
  assert.ok(text.includes('水军'), '已触发的特殊产物应揭示名字');
  assert.match(text, /×2\/8步/);
  assert.ok(text.includes('？？？'), '未触发的产物仍打码');
  assert.equal(text.includes('记赢赢'), false, '真通关配方触发前仍隐藏');
  assert.equal(h.$('#chain').querySelectorAll('.chain__row').length, 10);
  h.close();

  // 李娜触发之后揭示产物与增益
  const hl = await boot(undefined, { lina: 1 });
  hl.app.openGuide('chain');
  await sleep(30);
  const textLina = hl.$('#chain').textContent ?? '';
  assert.ok(textLina.includes('李娜'), '已触发的李娜应揭示名字');
  assert.match(textLina, /×2\/8步/);
  assert.equal(hl.$('#chain').querySelectorAll('.chain__row').length, 10);
  assert.equal(hl.$('#chain').querySelectorAll('.mini--mystery').length, 5);
  hl.close();

  // 水缸触发之后揭示产物与增益
  const hg = await boot(undefined, { 'shui-gang': 1 });
  hg.app.openGuide('chain');
  await sleep(30);
  const textGang = hg.$('#chain').textContent ?? '';
  assert.ok(textGang.includes('水缸'), '已触发的水缸应揭示名字');
  assert.match(textGang, /×2\/8步/);
  assert.equal(hg.$('#chain').querySelectorAll('.chain__row').length, 10);
  assert.equal(hg.$('#chain').querySelectorAll('.mini--mystery').length, 5);
  hg.close();

  // 妙触发之后揭示产物与 10 步增益
  const hm = await boot(undefined, { miao: 1 });
  hm.app.openGuide('chain');
  await sleep(30);
  const textMiao = hm.$('#chain').textContent ?? '';
  assert.ok(textMiao.includes('妙'), '已触发的妙应揭示名字');
  assert.match(textMiao, /×2\/10步/);
  assert.equal(hm.$('#chain').querySelectorAll('.chain__row').length, 10);
  assert.equal(hm.$('#chain').querySelectorAll('.mini--mystery').length, 5);
  hm.close();

  // 真通关触发之后才揭示整行配方；依赖它的「记赢赢 + 会成」与传奇抽取也随之出现
  const h2 = await boot(undefined, { 'ji-ying-ying': 1 });
  h2.app.openGuide('chain');
  await sleep(30);
  const text2 = h2.$('#chain').textContent ?? '';
  assert.ok(text2.includes('记赢赢'), '真通关后应揭示记赢赢');
  assert.match(text2, /真通关/);
  assert.ok(text2.includes('会成'), '真通关后应揭示延伸配方的另一半材料');
  assert.equal(text2.includes('记会成'), false, '记会成未触发前产物名仍打码');
  assert.match(text2, /传奇 · 相撞即合/, '记赢赢解锁后出现传奇抽取配方');
  assert.match(text2, /\+512/, '传奇抽取说明应写 +512');
  assert.equal(h2.$('#chain').querySelectorAll('.chain__row').length, 13);
  assert.equal(h2.$('#chain').querySelectorAll('.mini--mystery').length, 8);
  h2.close();

  // 记会成也触发后，延伸配方行显示产物名与增益
  const h3 = await boot(undefined, { 'ji-ying-ying': 1, 'ji-hui-cheng': 1 });
  h3.app.openGuide('chain');
  await sleep(30);
  const text3 = h3.$('#chain').textContent ?? '';
  assert.ok(text3.includes('记会成'), '记会成触发后应揭示名字');
  assert.match(text3, /×2\/10步/);
  assert.equal(h3.$('#chain').querySelectorAll('.chain__row').length, 13);
  assert.equal(h3.$('#chain').querySelectorAll('.mini--mystery').length, 7);
  h3.close();
});

test('图鉴合成链页：传奇整节在记赢赢首次收集前完全隐藏', async () => {
  // 未触发真通关：不出现「记赢赢」「传奇」配方；触发后整节出现
  const before = await boot();
  before.app.openGuide('chain');
  await sleep(30);
  const beforeText = before.$('#chain').textContent ?? '';
  assert.equal(beforeText.includes('传奇'), false, '记赢赢解锁前不显示传奇配方');
  assert.equal(before.$('#chain').querySelectorAll('.chain__row--myth').length, 0);
  before.close();

  const after = await boot(undefined, { 'ji-ying-ying': 1 });
  after.app.openGuide('chain');
  await sleep(30);
  const afterText = after.$('#chain').textContent ?? '';
  assert.equal(after.$('#chain').querySelectorAll('.chain__row--myth').length, 1);
  assert.match(afterText, /传奇词条 · 随机抽取/);
  assert.match(afterText, /两枚传奇相撞/);
  // 未收集传奇词条时产物仍是问号 mini，不剧透传奇名字
  for (const name of ['煤灰', '昭君', '666', '🍒']) {
    assert.equal(afterText.includes(name), false, `传奇未现世前不能剧透「${name}」`);
  }
  after.close();
});

test('图鉴收录跨局累积，重新开局不清空，撤销不回退', async () => {
  const h = await boot(undefined, { sui: 2 });
  assert.equal(Object.keys(h.app.codex).length, 1);
  h.app.restart();
  await sleep(80);
  assert.equal(Object.keys(h.app.codex).length, 1, '重新开局不清空图鉴');
  h.app.openGuide('codex');
  await sleep(40);
  assert.equal(h.$('#codex').querySelectorAll('.card').length, 1);
  const text = h.$('#codex').textContent ?? '';
  assert.match(text, /隋/);
  assert.match(text, /×2/);
  h.close();
});

test('词条方块可视化：稀有度角标、配方提示、隋圆棋子、稀有/传说光效', async () => {
  const variants = ['sui', 'sui-ring', 'ji', null, ...EMPTY16.slice(4).map(() => null)];
  const h = await boot(saved([5, 5, 5, null, ...EMPTY16.slice(4)], { variants, won: true }));
  const sui = h.$('#tiles').querySelector('.tile[data-entry="sui"]');
  assert.ok(sui);
  // v2.4：普通词条全部升为稀有
  assert.equal(sui.querySelector('.tile__rarity')?.textContent, '稀');
  assert.equal(sui.querySelector('.tile__recipe')?.textContent, '+军');
  assert.ok(sui.querySelector('.tile__aura--rare'), '稀有词条应有流光光效');
  const ring = h.$('#tiles').querySelector('.tile[data-entry="sui-ring"]');
  assert.ok(ring);
  assert.equal(ring.querySelector('.tile__rarity')?.textContent, '稀');
  assert.ok(ring.querySelector('.tile__main--ring'), '隋圆棋子应带圆环');
  assert.equal(ring.querySelector('.tile__label--codex')?.textContent, '隋', '棋子上只写「隋」');
  const ji = h.$('#tiles').querySelector('.tile[data-entry="ji"]');
  assert.ok(ji);
  assert.equal(ji.querySelector('.tile__rarity')?.textContent, '传');
  assert.ok(ji.querySelector('.tile__aura--legend'), '传说词条应有金色光晕');
  assert.equal(ji.querySelector('.tile__recipe'), null, '记不显示配方提示（真通关隐藏）');
  h.close();
});

test('圆环词条与特殊产物的显示名：图鉴「隋圆」「隋军隋圆」，棋子保留圆环', async () => {
  const variants = ['sui-ring', 'sui-jun-ring', null, null, ...EMPTY16.slice(4).map(() => null)];
  const h = await boot(
    saved([5, 5, null, null, ...EMPTY16.slice(4)], { variants, won: true }),
    { 'sui-ring': 1, 'sui-jun-ring': 1 },
  );
  const ring = h.$('#tiles').querySelector('.tile[data-entry="sui-ring"]');
  assert.ok(ring);
  assert.equal(ring.querySelector('.tile__label--codex')?.textContent, '隋');
  assert.ok(ring.querySelector('.tile__main--ring'), '棋子保留圆环');
  const product = h.$('#tiles').querySelector('.tile[data-entry="sui-jun-ring"]');
  assert.ok(product);
  assert.equal(product.querySelector('.tile__label--codex')?.textContent, '隋军隋圆');

  h.app.openGuide('codex');
  await sleep(30);
  const suiRingCard = h.$('#codex').querySelector('.card[data-entry="sui-ring"]');
  assert.ok(suiRingCard);
  assert.equal(suiRingCard.querySelector('.card__name')?.textContent, '隋圆');
  const productCard = h.$('#codex').querySelector('.card[data-entry="sui-jun-ring"]');
  assert.ok(productCard);
  assert.equal(productCard.querySelector('.card__name')?.textContent, '隋军隋圆');
  h.close();

  // 合成链页的产物名也按新显示名
  const hc = await boot(undefined, { 'sui-jun-ring': 1 });
  hc.app.openGuide('chain');
  await sleep(30);
  const chainText = hc.$('#chain').textContent ?? '';
  assert.ok(chainText.includes('隋军隋圆'), '合成链应显示「隋军隋圆」');
  assert.equal(chainText.includes('水军·环'), false, '不再显示旧名');
  hc.close();
});

test('OLD FIVE 方块两行竖排渲染', async () => {
  const h = await boot(saved([4, ...EMPTY16.slice(1)], { won: true }));
  const stack = h.$('#tiles').querySelector('.tile[data-rank="4"] .tile__main--stack');
  assert.ok(stack);
  assert.equal(stack.textContent, 'OLDFIVE');
  h.close();
});

test('增益到期后徽章消失；增益期间飘分加强', async () => {
  const h = await boot(
    saved([0, 0, ...EMPTY16.slice(2)], {
      buffs: [{ id: 'sui-jun', label: '隋军·蓄水', mult: 2, movesLeft: 1 }],
    }),
  );
  assert.equal(h.$('#buffs').hidden, false, '读档应恢复增益徽章');
  // v2.3 改名：旧存档里的「隋军·蓄水」按当前定义刷新成「水军·蓄水」
  assert.match(h.$('#buffs').textContent ?? '', /水军·蓄水/);
  h.app.move('left');
  await settle(h);
  assert.equal(h.app.state.score, 8, '4 × 2');
  assert.ok(h.$('#fx').querySelector('.float--boost'), '增益期间的飘分应加强');
  // jsdom 跨 realm：buffs 是页面领域的数组，用长度判断而不是 deepEqual
  assert.equal(h.app.state.buffs.length, 0);
  assert.equal(h.$('#buffs').hidden, true, '到期后徽章消失');
  h.close();
});

test('无路可走时弹出结束层，可重新开局', async () => {
  const dead = [0, 1, 2, 3, 1, 2, 3, 4, 2, 3, 4, 0, 3, 4, 0, 1];
  const h = await boot(saved(dead, { score: 88, moves: 42 }));
  await sleep(OVERLAY + 120);
  assert.equal(h.$('#overlay').hidden, false, '读档死局应提示结束');
  assert.match(h.$('#overlay-title').textContent ?? '', /无处可合/);
  assert.match(h.$('#overlay-text').textContent ?? '', /88/);
  h.$('#overlay-actions .pill--primary').dispatchEvent(new h.win.MouseEvent('click', { bubbles: true }));
  await sleep(OVERLAY + 120);
  assert.equal(h.app.state.moves, 0);
  assert.equal(ranks(h).filter((rank) => rank !== null).length, 2);
  h.close();
});

test('最后一步同时首次收录时，解释卡关闭后仍会补弹结束层', async () => {
  // 满盘、只有左上角两枚词条相邻：右移合成并抽到「燕子」，新生成的军填满棋盘后无路可走。
  // 修复前这里会弹解释卡、然后永远不弹结束层（失败判定被吞掉）。
  const board = saved([5, 5, 2, 3, 1, 2, 3, 4, 2, 3, 4, 0, 3, 4, 0, 1], {
    variants: ['sui', 'hongmei', null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    won: true,
    moves: 42,
  });
  // rng：抽到燕子（0.45）、空格只有一个不消耗位置、生成军（0）
  const sequence = [0.45, 0, 0];
  let index = 0;
  const rng = (): number => sequence[Math.min(index++, sequence.length - 1)]!;
  const h = await boot(board, {}, undefined, { rng });
  h.app.move('right');
  await settle(h);
  assert.equal(h.app.state.over, true, '这一步之后应该已经无路可走');
  assert.equal(h.$('#overlay').hidden, false);
  assert.match(h.$('#overlay-eyebrow').textContent ?? '', /图鉴收录/, '先弹首次收录解释卡');
  h.$('#overlay-actions .pill--primary').dispatchEvent(new h.win.MouseEvent('click', { bubbles: true }));
  await sleep(OVERLAY + 120);
  assert.equal(h.$('#overlay').hidden, false, '解释卡关掉后结束层必须补上');
  assert.match(h.$('#overlay-title').textContent ?? '', /无处可合/);
  assert.ok(h.$('#overlay-actions').textContent?.includes('撤销一步'), '本局刚结束，应能撤销一步');
  h.close();
});

test('结束层被遮罩关掉后，再操作会重新提示结束', async () => {
  const dead = [0, 1, 2, 3, 1, 2, 3, 4, 2, 3, 4, 0, 3, 4, 0, 1];
  const h = await boot(saved(dead, { score: 88, moves: 42 }));
  await sleep(OVERLAY + 120);
  assert.equal(h.$('#overlay').hidden, false);
  h.$('#overlay-scrim').dispatchEvent(new h.win.MouseEvent('click', { bubbles: true }));
  await sleep(OVERLAY + 80);
  assert.equal(h.$('#overlay').hidden, true, '遮罩可以关掉结束层');
  h.app.move('left');
  await sleep(60);
  assert.equal(h.$('#overlay').hidden, false, '死局再操作时应重新提示结束');
  assert.match(h.$('#overlay-title').textContent ?? '', /无处可合/);
  h.close();
});

test('新游戏需要二次确认，取消不会清空', async () => {
  const h = await boot();
  h.app.move('left');
  await settle(h);
  if (h.app.state.moves === 0) h.app.move('up');
  await settle(h);
  assert.ok(h.app.state.moves > 0);
  const scoreBefore = h.app.state.score;
  h.$('#btn-new').dispatchEvent(new h.win.MouseEvent('click', { bubbles: true }));
  await sleep(30);
  assert.equal(h.$('#overlay').hidden, false);
  assert.match(h.$('#overlay-title').textContent ?? '', /清空/);
  const pills = h.$('#overlay-actions').querySelectorAll('.pill');
  pills[0]!.dispatchEvent(new h.win.MouseEvent('click', { bubbles: true }));
  await sleep(OVERLAY + 60);
  assert.equal(h.app.state.score, scoreBefore);
  h.close();
});

test('关于：简介 + Gitee/GitHub 两个仓库链接，入口在图鉴抽屉底部', async () => {
  const h = await boot();
  // v2.4：关于入口迁入图鉴抽屉底部，避免误触；点击时抽屉未打开也能正常弹层
  assert.ok(h.$('#sheet').contains(h.$('#btn-about')), '关于入口应在图鉴抽屉里');
  h.$('#btn-about').dispatchEvent(new h.win.MouseEvent('click', { bubbles: true }));
  await sleep(30);
  assert.equal(h.$('#overlay').hidden, false);
  assert.match(h.$('#overlay-title').textContent ?? '', /疯狂水立方/);
  assert.match(h.$('#overlay-eyebrow').textContent ?? '', /关于/);
  assert.match(h.$('#overlay-eyebrow').textContent ?? '', new RegExp(`v${GAME_VERSION.replaceAll('.', '\\.')}`));
  const aboutText = h.$('#overlay-text').textContent ?? '';
  assert.ok(aboutText.length > 20, '应有简介');
  assert.match(aboutText, /4×4/, '简介要写基本玩法');
  assert.match(aboutText, /滑动/);
  assert.match(aboutText, /图鉴/);
  assert.equal(aboutText.includes('记'), false, '关于不泄露真通关');
  assert.equal(aboutText.includes('记赢赢'), false, '关于不泄露真通关配方');
  assert.equal(aboutText.includes('赢²'), false, '关于不泄露真通关配方');
  const links = h.$('#overlay-actions').querySelectorAll('a.pill');
  assert.equal(links.length, 2, 'v2.4 去掉在线玩，只留两个仓库');
  assert.match(links[0]!.getAttribute('href') ?? '', /gitee\.com\/idealismo10\/crazy-water-cube/);
  assert.match(links[1]!.getAttribute('href') ?? '', /github\.com\/idealismo10\/crazy-water-cube/);
  assert.equal(
    (h.$('#overlay-actions').textContent ?? '').includes('在线玩'),
    false,
    '不应再出现在线玩按钮',
  );
  assert.equal(
    (h.$('#overlay-actions').innerHTML).includes('github.io'),
    false,
    '不应再出现 Pages 链接',
  );
  for (const link of links) {
    const href = link.getAttribute('href') ?? '';
    assert.equal(href.includes('your-name'), false, '链接不能是占位');
    assert.equal(link.getAttribute('target'), '_blank');
    assert.equal(link.getAttribute('rel'), 'noopener noreferrer');
  }
  h.$('#overlay-actions .pill--primary').dispatchEvent(new h.win.MouseEvent('click', { bubbles: true }));
  await sleep(OVERLAY + 60);
  assert.equal(h.$('#overlay').hidden, true);
  h.close();
});

test('主题三态切换并持久化；读档恢复深色', async () => {
  const h = await boot();
  const rootEl = h.doc.documentElement;
  assert.equal(rootEl.hasAttribute('data-theme'), false, '默认跟随系统');
  h.$('#btn-theme').dispatchEvent(new h.win.MouseEvent('click', { bubbles: true }));
  assert.equal(rootEl.getAttribute('data-theme'), 'light');
  h.$('#btn-theme').dispatchEvent(new h.win.MouseEvent('click', { bubbles: true }));
  assert.equal(rootEl.getAttribute('data-theme'), 'dark');
  assert.equal(h.win.localStorage.getItem('jun2048.theme'), 'dark');
  const meta = h.doc.querySelector('meta[name="theme-color"]');
  assert.equal(meta?.getAttribute('content'), '#06121a', '深色下 theme-color 应同步');
  h.$('#btn-theme').dispatchEvent(new h.win.MouseEvent('click', { bubbles: true }));
  assert.equal(rootEl.hasAttribute('data-theme'), false, '第三下回到自动');
  h.close();

  // 上次记住的深色偏好，重开页面直接生效
  const h2 = await boot(undefined, undefined, 'dark');
  assert.equal(h2.doc.documentElement.getAttribute('data-theme'), 'dark');
  h2.close();
});

test('图鉴按 ESC 关闭', async () => {
  const h = await boot();
  h.app.openGuide();
  await sleep(30);
  assert.equal(h.$('#sheet').hidden, false);
  h.doc.dispatchEvent(new h.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await sleep(SHEET + 60);
  assert.equal(h.$('#sheet').hidden, true);
  h.close();
});

test('分数与棋局写入 localStorage（v3），重开页面能续上', async () => {
  const h = await boot();
  h.app.move('left');
  await settle(h);
  if (h.app.state.moves === 0) h.app.move('down');
  await settle(h);
  const snapshot = ranks(h);
  const raw = h.win.localStorage.getItem('jun2048');
  assert.ok(raw, '应写入存档');
  assert.equal(JSON.parse(raw).v, 3);
  h.close();

  const h2 = await boot(JSON.parse(raw));
  assert.deepEqual(ranks(h2), snapshot, '重开应恢复棋局');
  h2.close();
});

test('坏存档与换池子的旧档不会白屏，退回新局', async () => {
  const h = await boot({ v: 1, size: 9, sig: 'x', ranks: [], score: -5, moves: 0 });
  assert.equal(h.app.state.moves, 0);
  assert.equal(ranks(h).filter((rank) => rank !== null).length, 2);
  h.close();

  // 旧池子词条（removed-entry）已不存在 → 判坏档开新局
  const h2 = await boot(
    saved([5, ...EMPTY16.slice(1)], { variants: ['removed-entry', ...EMPTY16.slice(1).map(() => null)], won: true }),
  );
  assert.equal(ranks(h2).filter((rank) => rank !== null).length, 2);
  h2.close();
});

test('移动过程中连续输入会被串行化，不丢步也不乱序', async () => {
  const h = await boot();
  h.app.move('left');
  h.app.move('up');
  h.app.move('right');
  h.app.move('down');
  await settle(h, 3000);
  await sleep(80);
  assert.ok(h.app.state.moves >= 1);
  assert.equal(h.$('#tiles').children.length, h.app.state.cells.filter(Boolean).length);
  h.close();
});
test('开场界面：品牌、统计、开始后收起并解锁棋盘', async () => {
  const h = await boot(undefined, undefined, undefined, { skipIntro: false });
  const intro = h.$('#intro');
  assert.equal(intro.hidden, false, '首屏应显示开场界面');
  assert.match(h.$('#intro-title').textContent ?? '', /疯狂水立方/);
  assert.match(h.$('.intro__eyebrow').textContent ?? '', /2048/);
  assert.match(h.$('#intro-start').textContent ?? '', /开始合成/);
  assert.match(h.$('.intro__chain').textContent ?? '', /OLD FIVE/);
  assert.equal(h.$('.intro__hook').textContent?.includes('记'), false, '开场不泄露真通关');
  assert.equal(h.$('.intro__hook').textContent?.includes('赢²'), false, '开场不泄露真通关');
  // 开场界面期间方向键不推动棋盘
  h.doc.dispatchEvent(new h.win.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  await sleep(180);
  assert.equal(h.app.state.moves, 0, '开场界面期间棋盘不响应');
  // 点开始
  h.$('#intro-start').dispatchEvent(new h.win.MouseEvent('click', { bubbles: true }));
  await sleep(450);
  assert.equal(intro.hidden, true, '进入游戏后开场界面应隐藏');
  // 现在可以操作
  const before = JSON.stringify(ranks(h));
  for (const key of ['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp']) {
    h.doc.dispatchEvent(new h.win.KeyboardEvent('keydown', { key, bubbles: true }));
    await settle(h);
    if (h.app.state.moves > 0 && JSON.stringify(ranks(h)) !== before) break;
  }
  assert.ok(h.app.state.moves >= 1, '进入游戏后棋盘应可移动');
  h.close();
});

test('开场界面：有存档时显示「继续游戏」与最高分', async () => {
  const h = await boot(
    saved([0, 0, ...EMPTY16.slice(2)], { score: 40, moves: 7 }),
    undefined,
    undefined,
    { skipIntro: false, best: 88 },
  );
  assert.equal(h.$('#intro-best').textContent, '88');
  assert.equal(h.$('#intro-codex').textContent, '0 条');
  assert.match(h.$('#intro-start').textContent ?? '', /继续游戏/);
  h.close();
});

test('开场界面：读档死局先不弹结束层，进入游戏后才弹', async () => {
  const dead = [0, 1, 2, 3, 1, 2, 3, 4, 2, 3, 4, 0, 3, 4, 0, 1];
  const h = await boot(saved(dead, { score: 88, moves: 42 }), undefined, undefined, {
    skipIntro: false,
  });
  await sleep(400);
  assert.equal(h.$('#intro').hidden, false);
  assert.equal(h.$('#overlay').hidden, true, '开场界面期间不弹结束层');
  h.$('#intro-start').dispatchEvent(new h.win.MouseEvent('click', { bubbles: true }));
  await sleep(80);
  assert.equal(h.$('#overlay').hidden, false);
  assert.match(h.$('#overlay-title').textContent ?? '', /无处可合/);
  h.close();
});

test('版本更新弹窗：老玩家升级后进入游戏弹一次，只显示版本号变动', async () => {
  // 有棋局存档但没有版本记录 = 从 2.2.2 升级上来的老玩家（启动时按 LEGACY_VERSION 算）
  const h = await boot(
    saved([0, 0, ...EMPTY16.slice(2)], { score: 12, moves: 3 }),
    undefined,
    undefined,
    { skipIntro: false, version: null },
  );
  // 开场界面阶段不弹
  await sleep(60);
  assert.equal(h.$('#overlay').hidden, true, '开场界面阶段不弹版本更新');
  h.$('#intro-start').dispatchEvent(new h.win.MouseEvent('click', { bubbles: true }));
  await sleep(60);
  assert.equal(h.$('#overlay').hidden, false, '进入游戏时应弹版本更新');
  assert.match(h.$('#overlay-eyebrow').textContent ?? '', /版本更新/);
  assert.match(h.$('#overlay-title').textContent ?? '', /版本已更新/);
  assert.equal(h.$('#overlay-text').textContent, `v2.2.2 → v${GAME_VERSION}`, '只显示版本号变动');
  // 弹层打开期间棋盘输入被忽略
  const before = JSON.stringify(ranks(h));
  h.app.move('left');
  assert.equal(h.app.state.moves, 3, '版本弹层打开时棋盘不应响应');
  // 关掉后进入正常游戏，并记下当前版本
  h.$('#overlay-actions .pill--primary').dispatchEvent(new h.win.MouseEvent('click', { bubbles: true }));
  await sleep(OVERLAY + 80);
  assert.equal(h.$('#overlay').hidden, true);
  assert.equal(h.win.localStorage.getItem('jun2048.version'), GAME_VERSION);
  assert.equal(JSON.stringify(ranks(h)), before, '关掉版本弹层不应改变棋盘');
  h.close();
});

test('版本更新弹窗：新玩家不弹，同一版本重开也不弹', async () => {
  const h = await boot(); // boot 默认已写入当前版本：视为看过
  await sleep(60);
  assert.equal(h.$('#overlay').hidden, true);
  assert.equal(h.win.localStorage.getItem('jun2048.version'), GAME_VERSION);
  h.close();

  // 全新玩家：没有任何存档 / 版本记录 → 不弹，但启动时记下当前版本
  const h2 = await boot(undefined, undefined, undefined, { version: null });
  await sleep(60);
  assert.equal(h2.$('#overlay').hidden, true, '全新玩家不应弹「从 2.2.2 更新」');
  assert.equal(h2.win.localStorage.getItem('jun2048.version'), GAME_VERSION);
  h2.close();
});

test('版本更新弹窗：关掉后接着弹读档死局', async () => {
  const dead = [0, 1, 2, 3, 1, 2, 3, 4, 2, 3, 4, 0, 3, 4, 0, 1];
  const h = await boot(saved(dead, { score: 88, moves: 42 }), undefined, undefined, {
    skipIntro: false,
    version: '2.2.2',
  });
  await sleep(60);
  h.$('#intro-start').dispatchEvent(new h.win.MouseEvent('click', { bubbles: true }));
  await sleep(60);
  assert.match(h.$('#overlay-title').textContent ?? '', /版本已更新/);
  h.$('#overlay-actions .pill--primary').dispatchEvent(new h.win.MouseEvent('click', { bubbles: true }));
  await sleep(OVERLAY + 120);
  assert.match(h.$('#overlay-title').textContent ?? '', /无处可合/, '版本弹层关掉后应接续结束层');
  h.close();
});

test('Li + Na → 李娜：特殊收录 + ×2/8步 增益；没有解释文案时不弹解释层', async () => {
  const h = await boot(
    saved([5, 5, ...EMPTY16.slice(2)], {
      variants: ['li', 'na', ...EMPTY16.slice(2).map(() => null)],
      won: true,
    }),
  );
  h.app.move('left');
  await settle(h);
  await sleep(60);
  assert.equal(h.app.state.score, 128);
  const tile = h.$('#tiles').querySelector('.tile[data-entry="lina"]');
  assert.ok(tile, '棋盘上应有李娜方块');
  assert.equal(tile.getAttribute('data-special'), '1');
  assert.equal(h.app.codex['lina'], 1);
  // v2.4 用户要求去掉李娜的解释：首次触发仍收录、挂增益，但不弹解释卡
  assert.equal(h.$('#overlay').hidden, true);
  assert.match(h.$('#buffs').textContent ?? '', /×2/);
  assert.match(h.$('#buffs').textContent ?? '', /8步/);
  h.close();
});

test('新增词条渲染：豆包AI 四字缩字号，Li/Na 稀有角标与自定色相', async () => {
  const variants = ['doubao', 'li', 'na', null, ...EMPTY16.slice(4).map(() => null)];
  const h = await boot(
    saved([5, 5, 5, null, ...EMPTY16.slice(4)], { variants, won: true }),
  );
  const doubao = h.$('#tiles').querySelector<HTMLElement>('.tile[data-entry="doubao"]');
  assert.ok(doubao);
  assert.equal(doubao.querySelector('.tile__label--codex')?.classList.contains('is-s3'), true);
  assert.equal(doubao.querySelector('.tile__rarity')?.textContent, '稀');
  const li = h.$('#tiles').querySelector<HTMLElement>('.tile[data-entry="li"]');
  assert.ok(li);
  assert.equal(li.style.getPropertyValue('--hue'), '306');
  assert.equal(li.style.getPropertyValue('--hue2'), '322');
  assert.equal(li.querySelector('.tile__rarity')?.textContent, '稀');
  const na = h.$('#tiles').querySelector<HTMLElement>('.tile[data-entry="na"]');
  assert.ok(na);
  assert.equal(na.style.getPropertyValue('--hue'), '46');
  h.close();
});

test('v2.2 新增词条：彪 / 会成 / 🌧️ 的稀有角标、色相与 emoji 字号', async () => {
  const variants = ['biao', 'huicheng', 'xiaoyu', null, ...EMPTY16.slice(4).map(() => null)];
  const h = await boot(
    saved([5, 5, 5, null, ...EMPTY16.slice(4)], { variants, won: true }),
    { biao: 1, huicheng: 1, xiaoyu: 1 },
  );
  const biao = h.$('#tiles').querySelector<HTMLElement>('.tile[data-entry="biao"]');
  assert.ok(biao, '棋盘上应有彪');
  assert.equal(biao.querySelector('.tile__label--codex')?.textContent, '彪');
  assert.equal(biao.querySelector('.tile__label--codex')?.classList.contains('is-s1'), true);
  assert.equal(biao.querySelector('.tile__rarity')?.textContent, '稀');
  assert.equal(biao.style.getPropertyValue('--hue'), '22');
  const huicheng = h.$('#tiles').querySelector<HTMLElement>('.tile[data-entry="huicheng"]');
  assert.ok(huicheng);
  assert.equal(huicheng.querySelector('.tile__label--codex')?.textContent, '会成');
  assert.equal(huicheng.querySelector('.tile__label--codex')?.classList.contains('is-s1'), true);
  const yu = h.$('#tiles').querySelector<HTMLElement>('.tile[data-entry="xiaoyu"]');
  assert.ok(yu, '棋盘上应有 🌧️');
  assert.equal(yu.querySelector('.tile__label--codex')?.textContent, '🌧️');
  assert.equal(yu.querySelector('.tile__label--codex')?.classList.contains('is-s1'), true);
  assert.equal(yu.style.getPropertyValue('--hue'), '250');

  // 图鉴卡片保留 🌧️ 解释里的换行（CSS white-space: pre-line）
  h.app.openGuide('codex');
  await sleep(30);
  const card = h.$('#codex').querySelector<HTMLElement>('.card[data-entry="xiaoyu"]');
  assert.ok(card, '图鉴里应有 🌧️ 卡片');
  assert.equal(card.querySelector('.card__desc')?.textContent, '这雨似乎不大\n这是小雨啊');
  h.close();
});

test('v2.3 新增词条：钢 / 威海 / 钉剑 / 君竹 的角标、色相与 +隋 提示', async () => {
  const variants = ['gang', 'weihai', 'dingjian', 'junzhu', ...EMPTY16.slice(4).map(() => null)];
  const h = await boot(
    saved([5, 5, 5, 5, ...EMPTY16.slice(4)], { variants, won: true }),
    { gang: 1, weihai: 1, dingjian: 1, junzhu: 1 },
  );
  const gang = h.$('#tiles').querySelector<HTMLElement>('.tile[data-entry="gang"]');
  assert.ok(gang, '棋盘上应有钢');
  assert.equal(gang.querySelector('.tile__label--codex')?.textContent, '钢');
  assert.equal(gang.querySelector('.tile__label--codex')?.classList.contains('is-s1'), true);
  assert.equal(gang.querySelector('.tile__rarity')?.textContent, '稀');
  assert.equal(gang.querySelector('.tile__recipe')?.textContent, '+隋');
  assert.equal(gang.style.getPropertyValue('--hue'), '206');
  assert.equal(gang.style.getPropertyValue('--hue2'), '194');

  const weihai = h.$('#tiles').querySelector<HTMLElement>('.tile[data-entry="weihai"]');
  assert.ok(weihai);
  assert.equal(weihai.querySelector('.tile__label--codex')?.textContent, '威海');
  assert.equal(weihai.style.getPropertyValue('--hue'), '190');
  const dingjian = h.$('#tiles').querySelector<HTMLElement>('.tile[data-entry="dingjian"]');
  assert.ok(dingjian);
  assert.equal(dingjian.querySelector('.tile__label--codex')?.textContent, '钉剑');
  assert.equal(dingjian.style.getPropertyValue('--hue'), '32');
  const junzhu = h.$('#tiles').querySelector<HTMLElement>('.tile[data-entry="junzhu"]');
  assert.ok(junzhu);
  assert.equal(junzhu.querySelector('.tile__label--codex')?.textContent, '君竹');
  assert.equal(junzhu.querySelector('.tile__rarity')?.textContent, '稀');

  // 图鉴卡片文案按用户原文
  h.app.openGuide('codex');
  await sleep(30);
  const card = h.$('#codex').querySelector<HTMLElement>('.card[data-entry="dingjian"]');
  assert.ok(card, '图鉴里应有钉剑卡片');
  assert.equal(card.querySelector('.card__desc')?.textContent, '钉子怎么能做剑？');
  h.close();
});

test('v2.5 新增词条：左轮 / 鱼籽 / 何思 的稀有角标与色相', async () => {
  const variants = ['zuolun', 'yu-zi', 'he-si', null, ...EMPTY16.slice(4).map(() => null)];
  const h = await boot(
    saved([5, 5, 5, null, ...EMPTY16.slice(4)], { variants, won: true }),
    { zuolun: 1, 'yu-zi': 1, 'he-si': 1 },
  );
  const zuolun = h.$('#tiles').querySelector<HTMLElement>('.tile[data-entry="zuolun"]');
  assert.ok(zuolun, '棋盘上应有左轮');
  assert.equal(zuolun.querySelector('.tile__label--codex')?.textContent, '左轮');
  assert.equal(zuolun.querySelector('.tile__rarity')?.textContent, '稀');
  assert.equal(zuolun.style.getPropertyValue('--hue'), '218');
  const yuZi = h.$('#tiles').querySelector<HTMLElement>('.tile[data-entry="yu-zi"]');
  assert.ok(yuZi, '棋盘上应有鱼籽');
  assert.equal(yuZi.querySelector('.tile__label--codex')?.textContent, '鱼籽');
  assert.equal(yuZi.style.getPropertyValue('--hue'), '16');
  const heSi = h.$('#tiles').querySelector<HTMLElement>('.tile[data-entry="he-si"]');
  assert.ok(heSi, '棋盘上应有何思');
  assert.equal(heSi.querySelector('.tile__label--codex')?.textContent, '何思');
  assert.equal(heSi.style.getPropertyValue('--hue'), '248');

  // 图鉴卡片文案按用户原文
  h.app.openGuide('codex');
  await sleep(30);
  const card = h.$('#codex').querySelector<HTMLElement>('.card[data-entry="yu-zi"]');
  assert.ok(card, '图鉴里应有鱼籽卡片');
  assert.equal(card.querySelector('.card__desc')?.textContent, '似乎很适合做酱');
  h.close();
});

test('隋 + 钢 → 水缸：特殊收录 + 解释弹层 + ×2/8步 增益', async () => {
  const h = await boot(
    saved([5, 5, ...EMPTY16.slice(2)], {
      variants: ['sui', 'gang', ...EMPTY16.slice(2).map(() => null)],
      won: true,
    }),
  );
  h.app.move('left');
  await settle(h);
  await sleep(60);
  assert.equal(h.app.state.score, 128);
  const tile = h.$('#tiles').querySelector('.tile[data-entry="shui-gang"]');
  assert.ok(tile, '棋盘上应有水缸方块');
  assert.equal(tile.getAttribute('data-special'), '1');
  assert.equal(tile.querySelector('.tile__rarity')?.textContent, '特');
  assert.equal(h.app.codex['shui-gang'], 1);
  assert.equal(h.$('#overlay').hidden, false);
  assert.match(h.$('#overlay-eyebrow').textContent ?? '', /特殊合成/);
  assert.match(h.$('#overlay-title').textContent ?? '', /水缸/);
  assert.match(h.$('#overlay-text').textContent ?? '', /一种容器/);
  assert.match(h.$('#buffs').textContent ?? '', /×2/);
  assert.match(h.$('#buffs').textContent ?? '', /8步/);
  h.close();
});

test('声音开关：默认开启，点击静音并持久化，重开恢复', async () => {
  const h = await boot();
  const btn = h.$<HTMLButtonElement>('#btn-sound');
  assert.equal(btn.getAttribute('aria-pressed'), 'true');
  assert.equal(btn.textContent, '🔊');
  assert.equal(btn.classList.contains('is-off'), false);
  btn.dispatchEvent(new h.win.MouseEvent('click', { bubbles: true }));
  assert.equal(btn.getAttribute('aria-pressed'), 'false');
  assert.equal(btn.textContent, '🔇');
  assert.equal(btn.classList.contains('is-off'), true);
  assert.equal(h.win.localStorage.getItem('jun2048.sound'), 'off');
  assert.match(btn.getAttribute('aria-label') ?? '', /音效：关/);
  h.close();

  const h2 = await boot(undefined, undefined, undefined, { sound: 'off' });
  const btn2 = h2.$<HTMLButtonElement>('#btn-sound');
  assert.equal(btn2.getAttribute('aria-pressed'), 'false');
  assert.equal(btn2.textContent, '🔇');
  btn2.dispatchEvent(new h2.win.MouseEvent('click', { bubbles: true }));
  assert.equal(h2.win.localStorage.getItem('jun2048.sound'), 'on');
  h2.close();
});

test('网站图标：三个水滴正三角 favicon，SVG + PNG 都是内联 data URI', async () => {
  const h = await boot();
  const links = Array.from(h.doc.querySelectorAll<HTMLLinkElement>('link[rel="icon"]'));
  assert.equal(links.length, 2, '应有 SVG 主图标 + PNG 兜底');
  assert.ok(links.some((link) => link.getAttribute('href')?.startsWith('data:image/svg+xml;base64,')));
  assert.ok(links.some((link) => link.getAttribute('href')?.startsWith('data:image/png;base64,')));
  for (const link of links) {
    const href = link.getAttribute('href') ?? '';
    assert.equal(href.startsWith('data:'), true, 'favicon 必须是内联 data URI');
    assert.equal(href.includes('http'), false, 'favicon 不能引外部资源');
  }
  h.close();
});

test('v2.4 新增词条：成龙 / 霸天 / 能 / 赵一鸣 / 塑料袋 的角标、色相与文案', async () => {
  const variants = ['chenglong', 'batian', 'neng', 'zhaoyiming', 'sudailiao', ...EMPTY16.slice(5).map(() => null)];
  const h = await boot(
    saved([5, 5, 5, 5, 5, null, ...EMPTY16.slice(6)], { variants, won: true }),
    { chenglong: 1, batian: 1, neng: 1, zhaoyiming: 1, sudailiao: 1 },
  );
  const checks: [string, string, string][] = [
    ['chenglong', '成龙', '2'],
    ['batian', '霸天', '280'],
    ['neng', '能', '170'],
    ['zhaoyiming', '赵一鸣', '38'],
    ['sudailiao', '塑料袋', '216'],
  ];
  for (const [id, name, hue] of checks) {
    const tile = h.$('#tiles').querySelector<HTMLElement>(`.tile[data-entry="${id}"]`);
    assert.ok(tile, `棋盘上应有 ${name}`);
    assert.equal(tile.querySelector('.tile__label--codex')?.textContent, name);
    assert.equal(tile.querySelector('.tile__rarity')?.textContent, '稀');
    assert.equal(tile.style.getPropertyValue('--hue'), hue);
    assert.ok(tile.querySelector('.tile__aura--rare'), '稀有词条应带流光');
  }
  // 彪 现在带「+水³」配方提示
  const hb = await boot(saved([5, ...EMPTY16.slice(1)], { variants: ['biao', ...EMPTY16.slice(1).map(() => null)], won: true }));
  const biao = hb.$('#tiles').querySelector('.tile[data-entry="biao"]');
  assert.equal(biao?.querySelector('.tile__recipe')?.textContent, '+水³');
  hb.close();
  h.close();
});

test('彪 + 水³ → 妙：传说收录、+128、×2/10步、解释卡、爱心粒子', async () => {
  const h = await boot(
    saved([5, 2, ...EMPTY16.slice(2)], {
      variants: ['biao', null, ...EMPTY16.slice(2).map(() => null)],
      won: true,
    }),
  );
  h.app.move('left');
  await settle(h);
  await sleep(80);
  assert.equal(h.app.state.score, 128);
  const tile = h.$('#tiles').querySelector('.tile[data-entry="miao"]');
  assert.ok(tile, '棋盘上应有妙方块');
  assert.equal(tile.getAttribute('data-special'), '1');
  assert.equal(tile.querySelector('.tile__rarity')?.textContent, '特');
  assert.ok(tile.querySelector('.tile__aura--legend'), '妙是传说级，应带光晕');
  assert.equal(h.app.codex['miao'], 1);
  // 首次触发弹解释卡（用户原文）
  assert.equal(h.$('#overlay').hidden, false);
  assert.match(h.$('#overlay-eyebrow').textContent ?? '', /特殊合成/);
  assert.match(h.$('#overlay-title').textContent ?? '', /妙/);
  assert.equal(h.$('#overlay-text').textContent, '庄宗受而藏之于庙');
  assert.match(h.$('#overlay-stats').textContent ?? '', /×2 · 10步/);
  assert.match(h.$('#buffs').textContent ?? '', /×2/);
  assert.match(h.$('#buffs').textContent ?? '', /10步/);
  // 关掉解释卡后走一步：妙增益期间应飘爱心粒子
  h.$('#overlay-actions .pill--primary').dispatchEvent(new h.win.MouseEvent('click', { bubbles: true }));
  await sleep(OVERLAY + 40);
  const movesBefore = h.app.state.moves;
  for (const dir of ['down', 'right', 'up', 'left'] as const) {
    h.app.move(dir);
    await settle(h);
    if (h.app.state.moves > movesBefore) break;
  }
  assert.ok(h.app.state.moves > movesBefore, '需要一步有效移动');
  const hearts = h.$('#fx').querySelectorAll<HTMLElement>('.heart');
  assert.ok(hearts.length > 0, '增益期间每次移动都应飘爱心');
  // v2.4：爱心从「妙」所在格生成（跟随妙移动），不再随机铺满棋盘
  const miaoIndex = h.app.state.cells.findIndex((tile) => tile?.variant === 'miao');
  assert.ok(miaoIndex >= 0, '棋盘上应还有妙');
  for (const heart of hearts) {
    assert.equal(heart.style.getPropertyValue('--r'), String(Math.floor(miaoIndex / 4)));
    assert.equal(heart.style.getPropertyValue('--c'), String(miaoIndex % 4));
    assert.ok(heart.querySelector('.heart__glyph'), '爱心应有glyph');
  }
  h.close();
});

test('记赢赢 + 会成 → 记会成：传说收录、+256、×2/10步、解释卡', async () => {
  const h = await boot(
    saved([5, 5, ...EMPTY16.slice(2)], {
      variants: ['ji-ying-ying', 'huicheng', ...EMPTY16.slice(2).map(() => null)],
      won: true,
      trueWon: true,
    }),
    { 'ji-ying-ying': 1 },
  );
  h.app.move('left');
  await settle(h);
  await sleep(80);
  assert.equal(h.app.state.score, 256);
  const tile = h.$('#tiles').querySelector('.tile[data-entry="ji-hui-cheng"]');
  assert.ok(tile, '棋盘上应有记会成方块');
  assert.equal(tile.getAttribute('data-special'), '1');
  assert.equal(h.app.codex['ji-hui-cheng'], 1);
  assert.equal(h.app.state.trueWon, true);
  assert.match(h.$('#buffs').textContent ?? '', /×2/);
  assert.match(h.$('#buffs').textContent ?? '', /10步/);
  assert.equal(h.$('#overlay').hidden, false);
  assert.match(h.$('#overlay-eyebrow').textContent ?? '', /特殊合成/);
  assert.equal(h.$('#overlay-title').textContent, '记会成');
  assert.equal(h.$('#overlay-text').textContent, '记了就会成');
  assert.match(h.$('#overlay-stats').textContent ?? '', /×2 · 10步/);
  h.close();
});

test('v3.0 传奇渲染：rank 6、奇角标、金虹光效；记赢赢使用 OLD FIVE 同款金虹', async () => {
  const ranks = [6, 5, 6, null, ...EMPTY16.slice(4).map(() => null)];
  const variants = ['meihui', 'ji-ying-ying', 'zhaojun', null, ...EMPTY16.slice(4).map(() => null)];
  const h = await boot(saved(ranks, { variants, won: true, trueWon: true }));
  const meihui = h.$('#tiles').querySelector<HTMLElement>('.tile[data-entry="meihui"]');
  assert.ok(meihui, '棋盘上应有传奇「煤灰」');
  assert.equal(meihui.dataset.rank, '6');
  assert.equal(meihui.querySelector('.tile__label--codex')?.textContent, '煤灰');
  assert.equal(meihui.querySelector('.tile__rarity')?.textContent, '奇');
  assert.equal(meihui.querySelector('.tile__rarity')?.getAttribute('data-rarity'), 'myth');
  assert.ok(meihui.querySelector('.tile__aura--myth'), '传奇应有专属金色光晕');
  assert.equal(meihui.classList.contains('tile--myth'), true);
  const zhaojun = h.$('#tiles').querySelector<HTMLElement>('.tile[data-entry="zhaojun"]');
  assert.ok(zhaojun);
  assert.equal(zhaojun.querySelector('.tile__rarity')?.textContent, '奇');

  const jyy = h.$('#tiles').querySelector<HTMLElement>('.tile[data-entry="ji-ying-ying"]');
  assert.ok(jyy, '棋盘上应有记赢赢');
  assert.equal(jyy.dataset.mythic, '1', '记赢赢应使用金虹材质');
  assert.ok(jyy.querySelector('.tile__aura--myth'), '记赢赢应带金色光晕');
  assert.equal(jyy.querySelector('.tile__rarity')?.textContent, '特');
  h.close();
});

test('记赢赢 × 记赢赢 → 传奇现世：全屏弹层放大词条名、+512、写入图鉴', async () => {
  const ranks = [null, 5, 5, null, ...EMPTY16.slice(4).map(() => null)];
  const variants = [null, 'ji-ying-ying', 'ji-ying-ying', null, ...EMPTY16.slice(4).map(() => null)];
  const h = await boot(
    saved(ranks, { variants, won: true, trueWon: true, moves: 8 }),
    { 'ji-ying-ying': 2 },
    undefined,
    { rng: () => 0 },
  );
  h.app.move('left');
  await settle(h);
  await sleep(80);
  assert.equal(h.app.state.score, 512);
  assert.equal(h.app.codex['meihui'], 1);
  const tile = h.$('#tiles').querySelector('.tile[data-entry="meihui"]');
  assert.ok(tile, '棋盘上应出现传奇方块');
  assert.equal(tile.getAttribute('data-rank'), '6');
  // 合成后直接弹出词条名
  assert.equal(h.$('#overlay').hidden, false, '传奇应弹全屏揭示层');
  assert.equal(h.$('#overlay').getAttribute('data-kind'), 'myth');
  assert.equal(h.$('#overlay-title').textContent, '煤灰');
  assert.equal(h.$('#overlay-title').classList.contains('panel__title--myth'), true);
  assert.equal(h.$('#overlay-text').textContent, '煤炭的灰');
  assert.match(h.$('#overlay-eyebrow').textContent ?? '', /传奇/);
  assert.ok(h.$('#burst').children.length > 0, '传奇应有大礼花');
  // 关闭后正常继续
  h.$('#overlay-actions .pill--primary').dispatchEvent(new h.win.MouseEvent('click', { bubbles: true }));
  await sleep(OVERLAY + 60);
  assert.equal(h.$('#overlay').hidden, true);
  h.close();
});

test('图鉴传奇单独分区：传奇卡片与记赢赢金虹卡片，未集齐不显示总数', async () => {
  const h = await boot(undefined, { meihui: 1, '666': 2, 'ji-ying-ying': 1 });
  h.app.openGuide('codex');
  await sleep(30);
  const section = h.$('#codex').querySelector<HTMLElement>('.codex__section--myth');
  assert.ok(section, '图鉴应有传奇分区');
  assert.match(section.textContent ?? '', /传奇/);
  assert.match(section.textContent ?? '', /最高等级/);
  const mythCards = section.querySelectorAll('.card');
  assert.equal(mythCards.length, 2, '已收录的传奇应单独排在本区');
  const meihui = section.querySelector<HTMLElement>('.card[data-entry="meihui"]');
  assert.ok(meihui);
  assert.equal(meihui.dataset.rarity, 'myth');
  assert.equal(meihui.querySelector('.card__name')?.textContent, '煤灰');
  assert.match(meihui.querySelector('.card__rarity')?.textContent ?? '', /传奇/);
  assert.equal(meihui.querySelector('.card__desc')?.textContent, '煤炭的灰');
  const times = section.querySelector<HTMLElement>('.card[data-entry="666"]');
  assert.ok(times);
  assert.equal(times.querySelector('.card__name')?.textContent, '666');
  assert.match(times.querySelector('.card__times')?.textContent ?? '', /×2/);

  // 记赢赢在普通分区里，但卡片是金虹材质
  const jyy = h.$('#codex').querySelector<HTMLElement>('.card[data-entry="ji-ying-ying"]');
  assert.ok(jyy, '记赢赢应正常收录');
  assert.equal(jyy.dataset.mythic, '1');
  assert.equal(jyy.querySelector('.card__meta .card__rarity')?.textContent, '特殊合成');

  const text = h.$('#codex').textContent ?? '';
  assert.equal(text.includes('48'), false, '未集齐时不显示总数');
  assert.equal(/\d+\s*\/\s*\d+/.test(text), false);
  h.close();
});

test('隋 / 李娜没有解释：首次收录不弹解释卡，图鉴卡片不显示说明', async () => {
  // rng=0 会抽到权重最高的「隋」
  const h = await boot(saved([4, 4, ...EMPTY16.slice(2)], { won: true }), undefined, undefined, {
    rng: () => 0,
  });
  h.app.move('left');
  await settle(h);
  await sleep(100);
  assert.equal(h.app.codex['sui'], 1, '隋仍会正常收录');
  assert.equal(h.$('#overlay').hidden, true, '没有解释文案时不弹解释卡');
  h.app.openGuide('codex');
  await sleep(30);
  const card = h.$('#codex').querySelector('.card[data-entry="sui"]');
  assert.ok(card, '图鉴里仍应有隋卡片');
  assert.equal(card.querySelector('.card__desc'), null, '不显示解释区');
  assert.match(card.textContent ?? '', /隋/);
  h.close();
});

test('图鉴收集进度条：未集齐只给比例，集齐后显示总数 + 未完待续', async () => {
  // 部分收录：进度条 1/48 ≈ 2%，但不显示 x/y 总数
  const partial = await boot(undefined, { sui: 1 });
  partial.app.openGuide('codex');
  await sleep(30);
  const bar = partial.$('#codex').querySelector<HTMLElement>('.codex__bar');
  assert.ok(bar, '应有进度条');
  assert.equal(bar.getAttribute('aria-valuenow'), '1');
  assert.equal(partial.$('#codex').querySelector<HTMLElement>('.codex__bar-fill')?.style.width, '2%');
  const partialText = partial.$('#codex').textContent ?? '';
  assert.equal(partialText.includes('48'), false, '未集齐时不显示总数');
  assert.equal(/\d+\s*\/\s*\d+/.test(partialText), false);
  assert.equal(partial.$('#codex').querySelectorAll('.card').length, 1);
  assert.equal(partial.$('#codex').querySelectorAll('.mystery').length, 2, '普通词条 + 传奇分区各一张问号卡');
  partial.close();

  // 全部收录：进度条满、标题显示共 48 条、底部「未完待续」、传奇单独分区
  const full = await boot(undefined, ALL_CODEX);
  full.app.openGuide('codex');
  await sleep(30);
  const fill = full.$('#codex').querySelector<HTMLElement>('.codex__bar-fill');
  assert.equal(fill?.style.width, '100%');
  const fullText = full.$('#codex').textContent ?? '';
  assert.match(fullText, /全部收录 · 共 48 条/);
  assert.match(fullText, /未完待续/);
  assert.match(fullText, /传奇/);
  assert.equal(full.$('#codex').querySelectorAll('.card').length, 48);
  assert.equal(full.$('#codex').querySelectorAll('.codex__grid--myth .card').length, 12);
  assert.equal(full.$('#codex').querySelectorAll('.mystery').length, 0);
  full.close();
});
