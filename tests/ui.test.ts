import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

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
  options: { skipIntro?: boolean; best?: number; sound?: 'on' | 'off' } = {},
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

test('隋 + 军 → 隋军：特殊收录 + 解释弹层 + ×2/8步 增益', async () => {
  const h = await boot(
    saved([5, 0, ...EMPTY16.slice(2)], { variants: ['sui', null, ...EMPTY16.slice(2).map(() => null)], won: true }),
  );
  h.app.move('left');
  await settle(h);
  await sleep(60);
  assert.equal(h.app.state.score, 64);
  const tile = h.$('#tiles').querySelector('.tile[data-entry="sui-jun"]');
  assert.ok(tile, '棋盘上应有隋军方块');
  assert.equal(tile.getAttribute('data-special'), '1');
  assert.equal(h.app.codex['sui-jun'], 1);
  assert.equal(h.$('#overlay').hidden, false);
  assert.match(h.$('#overlay-eyebrow').textContent ?? '', /特殊合成/);
  assert.match(h.$('#overlay-title').textContent ?? '', /隋军/);
  assert.match(h.$('#buffs').textContent ?? '', /×2/);
  assert.match(h.$('#buffs').textContent ?? '', /8步/);
  h.close();
});

test('首次抽到词条：弹解释卡、写入图鉴，名字此刻才可见', async () => {
  const h = await boot(saved([4, 4, ...EMPTY16.slice(2)], { won: true }));
  h.app.move('left');
  await settle(h);
  await sleep(80);
  assert.equal(h.$('#overlay').hidden, false, '抽到新词条应弹解释层');
  assert.equal(h.$('#overlay-title').classList.contains('panel__title--codex'), true);
  const title = h.$('#overlay-title').textContent ?? '';
  assert.ok(
    [
      '隋',
      '隋·环',
      '鳄鱼鳍',
      '鳄食菌',
      '记',
      '八一',
      '红梅',
      '金山',
      '浮力',
      'Li',
      'Na',
      '小明',
      '燕子',
      '豆包AI',
      '彪',
      '会成',
      '🌧️',
    ].includes(title),
    `解释标题应是词条名，实际：${title}`,
  );
  assert.match(h.$('#overlay-eyebrow').textContent ?? '', /图鉴收录/);
  assert.ok((h.$('#overlay-text').textContent ?? '').length > 0, '解释文案不能为空（框架占位也算）');

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
  const all = {
    sui: 1, 'eyu-qi': 1, 'sui-ring': 1, 'eyu-shi-jun': 1, ji: 1,
    'sui-jun': 1, 'sui-jun-ring': 1, 'ji-ying-ying': 1, lina: 1,
    bayi: 1, hongmei: 1, jinshan: 1, fuli: 1, li: 1, na: 1, xiaoming: 1, yanzi: 1, doubao: 1,
    biao: 1, huicheng: 1, xiaoyu: 1,
  };
  const h = await boot(saved([4, 4, ...EMPTY16.slice(2)], { won: true }), all);
  assert.equal(Object.keys(h.app.codex).length, 21, '读档应恢复全部收录（含特殊产物）');
  h.app.move('left');
  await settle(h);
  await sleep(120);
  assert.equal(h.$('#overlay').hidden, true, '重复词条不弹解释层');
  const counts = Object.values(h.app.codex).reduce((sum, n) => sum + n, 0);
  assert.equal(counts, 22, '重复抽到也要累加出现次数');
  assert.equal(Object.keys(h.app.codex).length, 21);
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
  assert.equal(h.$('#codex').querySelectorAll('.mystery').length, 1);
  for (const name of [
    '隋',
    '鳄鱼鳍',
    '鳄食菌',
    '记',
    '隋军',
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
  ]) {
    assert.equal(text.includes(name), false, `不能剧透「${name}」`);
  }
  assert.equal(/\d+\s*\/\s*\d+/.test(text), false, '未集齐时不能显示 x/y 总数');
  assert.equal(h.$('#tab-codex-count').textContent, '');
  h.close();
});

test('图鉴合成链页：固定链 + 词条入口 + 特殊配方（产物未触发前打码）', async () => {
  const h = await boot();
  h.$('#btn-guide').dispatchEvent(new h.win.MouseEvent('click', { bubbles: true }));
  await sleep(30);
  assert.equal(h.$('#sheet').hidden, false);
  const rows = h.$('#chain').querySelectorAll('.chain__row');
  assert.equal(rows.length, 8, '4 固定 + 1 词条入口 + 3 可见特殊配方（真通关配方隐藏）');
  const text = h.$('#chain').textContent ?? '';
  for (const name of ['军', '赢', '水', 'Lec', 'OLD FIVE', '随机词条']) {
    assert.ok(text.includes(name), `合成链应包含 ${name}`);
  }
  // Li / Na 作为配方材料公开（玩法需要），但产物李娜未触发前打码
  assert.ok(text.includes('Li'), 'Li + Na 配方材料应公开');
  assert.ok(text.includes('Na'), 'Li + Na 配方材料应公开');
  assert.equal(text.includes('李娜'), false, '李娜未触发前不剧透');
  assert.equal(h.$('#chain').querySelectorAll('.chain__row--recipe').length, 3);
  assert.equal(h.$('#chain').querySelectorAll('.mini--mystery').length, 4, '词条入口 + 3 个未触发产物都打码');
  assert.equal(text.includes('隋军'), false, '特殊产物未触发前不剧透');
  assert.equal(text.includes('记'), false, '真通关配方行首次触发前完全隐藏');
  assert.equal(text.includes('记赢赢'), false);
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
  assert.ok(text.includes('隋军'), '已触发的特殊产物应揭示名字');
  assert.match(text, /×2\/8步/);
  assert.ok(text.includes('？？？'), '未触发的产物仍打码');
  assert.equal(text.includes('记赢赢'), false, '真通关配方触发前仍隐藏');
  assert.equal(h.$('#chain').querySelectorAll('.chain__row').length, 8);
  h.close();

  // 李娜触发之后揭示产物与增益
  const hl = await boot(undefined, { lina: 1 });
  hl.app.openGuide('chain');
  await sleep(30);
  const textLina = hl.$('#chain').textContent ?? '';
  assert.ok(textLina.includes('李娜'), '已触发的李娜应揭示名字');
  assert.match(textLina, /×2\/8步/);
  assert.equal(hl.$('#chain').querySelectorAll('.chain__row').length, 8);
  assert.equal(hl.$('#chain').querySelectorAll('.mini--mystery').length, 3);
  hl.close();

  // 真通关触发之后才揭示整行配方
  const h2 = await boot(undefined, { 'ji-ying-ying': 1 });
  h2.app.openGuide('chain');
  await sleep(30);
  const text2 = h2.$('#chain').textContent ?? '';
  assert.ok(text2.includes('记赢赢'), '真通关后应揭示记赢赢');
  assert.match(text2, /真通关/);
  assert.equal(h2.$('#chain').querySelectorAll('.chain__row').length, 9);
  h2.close();
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

test('词条方块可视化：稀有度角标、配方提示、圈隋圆环', async () => {
  const variants = ['sui', 'sui-ring', 'ji', null, ...EMPTY16.slice(4).map(() => null)];
  const h = await boot(saved([5, 5, 5, null, ...EMPTY16.slice(4)], { variants, won: true }));
  const sui = h.$('#tiles').querySelector('.tile[data-entry="sui"]');
  assert.ok(sui);
  assert.equal(sui.querySelector('.tile__rarity')?.textContent, '普');
  assert.equal(sui.querySelector('.tile__recipe')?.textContent, '+军');
  const ring = h.$('#tiles').querySelector('.tile[data-entry="sui-ring"]');
  assert.ok(ring);
  assert.equal(ring.querySelector('.tile__rarity')?.textContent, '稀');
  assert.ok(ring.querySelector('.tile__main--ring'), '圈隋应带圆环');
  const ji = h.$('#tiles').querySelector('.tile[data-entry="ji"]');
  assert.ok(ji);
  assert.equal(ji.querySelector('.tile__rarity')?.textContent, '传');
  assert.equal(ji.querySelector('.tile__recipe'), null, '记不显示配方提示（真通关隐藏）');
  h.close();
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

test('关于：简介 + 在线玩/Gitee/GitHub 链接（新窗口打开）', async () => {
  const h = await boot();
  h.$('#btn-about').dispatchEvent(new h.win.MouseEvent('click', { bubbles: true }));
  await sleep(30);
  assert.equal(h.$('#overlay').hidden, false);
  assert.match(h.$('#overlay-title').textContent ?? '', /疯狂水立方/);
  assert.match(h.$('#overlay-eyebrow').textContent ?? '', /关于/);
  const aboutText = h.$('#overlay-text').textContent ?? '';
  assert.ok(aboutText.length > 20, '应有简介');
  assert.match(aboutText, /4×4/, '简介要写基本玩法');
  assert.match(aboutText, /滑动/);
  assert.match(aboutText, /图鉴/);
  assert.equal(aboutText.includes('记'), false, '关于不泄露真通关');
  assert.equal(aboutText.includes('记赢赢'), false, '关于不泄露真通关配方');
  assert.equal(aboutText.includes('赢²'), false, '关于不泄露真通关配方');
  const links = h.$('#overlay-actions').querySelectorAll('a.pill');
  assert.equal(links.length, 3, '在线玩 + 两个仓库');
  assert.match(links[0]!.getAttribute('href') ?? '', /lhy220402\.github\.io/);
  assert.match(links[1]!.getAttribute('href') ?? '', /gitee\.com/);
  assert.match(links[2]!.getAttribute('href') ?? '', /github\.com/);
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

test('Li + Na → 李娜：特殊收录 + 解释层 + ×2/8步 增益', async () => {
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
  assert.equal(h.$('#overlay').hidden, false);
  assert.match(h.$('#overlay-eyebrow').textContent ?? '', /特殊合成/);
  assert.match(h.$('#overlay-title').textContent ?? '', /李娜/);
  assert.match(h.$('#overlay-text').textContent ?? '', /Li 和 Na/);
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
  assert.equal(li.style.getPropertyValue('--hue'), '318');
  assert.equal(li.style.getPropertyValue('--hue2'), '346');
  assert.equal(li.querySelector('.tile__rarity')?.textContent, '稀');
  const na = h.$('#tiles').querySelector<HTMLElement>('.tile[data-entry="na"]');
  assert.ok(na);
  assert.equal(na.style.getPropertyValue('--hue'), '58');
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
  assert.equal(biao.style.getPropertyValue('--hue'), '24');
  const huicheng = h.$('#tiles').querySelector<HTMLElement>('.tile[data-entry="huicheng"]');
  assert.ok(huicheng);
  assert.equal(huicheng.querySelector('.tile__label--codex')?.textContent, '会成');
  assert.equal(huicheng.querySelector('.tile__label--codex')?.classList.contains('is-s1'), true);
  const yu = h.$('#tiles').querySelector<HTMLElement>('.tile[data-entry="xiaoyu"]');
  assert.ok(yu, '棋盘上应有 🌧️');
  assert.equal(yu.querySelector('.tile__label--codex')?.textContent, '🌧️');
  assert.equal(yu.querySelector('.tile__label--codex')?.classList.contains('is-s1'), true);
  assert.equal(yu.style.getPropertyValue('--hue'), '252');

  // 图鉴卡片保留 🌧️ 解释里的换行（CSS white-space: pre-line）
  h.app.openGuide('codex');
  await sleep(30);
  const card = h.$('#codex').querySelector<HTMLElement>('.card[data-entry="xiaoyu"]');
  assert.ok(card, '图鉴里应有 🌧️ 卡片');
  assert.equal(card.querySelector('.card__desc')?.textContent, '这雨似乎不大\n这是小雨啊');
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
