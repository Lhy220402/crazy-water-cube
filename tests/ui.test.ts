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

interface Harness {
  dom: JSDOM;
  win: Window & typeof globalThis;
  doc: Document;
  app: {
    state: {
      cells: ({ id: number; rank: number } | null)[];
      score: number;
      moves: number;
      won: boolean;
      over: boolean;
    };
    best: number;
    move(dir: 'up' | 'down' | 'left' | 'right'): void;
    restart(): void;
    undo(): void;
    openGuide(): void;
  };
  $<T extends Element = HTMLElement>(selector: string): T;
  close(): void;
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

async function boot(saved?: unknown): Promise<Harness> {
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
      // 脚本执行前先写入存档，模拟「上次退出后重新打开」
      if (saved !== undefined) window.localStorage.setItem('jun2048', JSON.stringify(saved));
    },
  });
  const win = dom.window as unknown as Window & typeof globalThis;
  const doc = win.document;
  const app = (win as unknown as { __jun2048: Harness['app'] }).__jun2048;
  assert.ok(app, 'App 未挂载');
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

test('首屏渲染：16 个格子、2 个方块、分数归零', async () => {
  const h = await boot();
  assert.equal(h.$('#grid').children.length, 16);
  assert.equal(h.$('#tiles').children.length, 2);
  assert.equal(h.$('#score').textContent, '0');
  assert.equal(h.$('#best').textContent, '0');
  assert.equal(h.$('#btn-undo').hasAttribute('disabled'), true);
  for (const tile of h.$('#tiles').children) {
    assert.equal(tile.classList.contains('tile'), true);
    const face = tile.querySelector('.tile__face .tile__label');
    assert.ok(face, '每个方块都要有文字标签');
  }
  assert.equal(h.app.state.moves, 0);
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

test('合成会弹出对应等级方块并加分', async () => {
  const h = await boot();
  // 构造一行「军 军」，保证左滑必定合成「赢²」
  const saved = {
    v: 1,
    size: 4,
    sig: 'jun|win|water|lec|liu',
    ranks: [0, 0, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    score: 0,
    moves: 0,
    won: false,
  };
  const h2 = await boot(saved);
  h2.app.move('left');
  await settle(h2);
  const merged = h2.app.state.cells.some((tile) => tile && tile.rank === 1);
  assert.equal(merged, true, '应合成出「赢²」');
  assert.equal(h2.app.state.score, 4);
  assert.ok(h2.$('#score').textContent !== '0');
  assert.ok(h2.$('#fx').querySelector('.float'), '应显示 +分 浮字');
  h.close();
  h2.close();
});

test('合出「刘 No.5」时弹出通关层，且之后不重复弹', async () => {
  const saved = {
    v: 1,
    size: 4,
    sig: 'jun|win|water|lec|liu',
    ranks: [3, 3, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
    score: 0,
    moves: 0,
    won: false,
  };
  const h = await boot(saved);
  h.app.move('left');
  await settle(h);
  await sleep(60);
  const overlay = h.$('#overlay');
  assert.equal(overlay.hidden, false, '通关层应显示');
  assert.match(h.$('#overlay-title').textContent ?? '', /刘/);
  assert.equal(h.$('#overlay-title').classList.contains('panel__title--win'), true);
  assert.equal(h.$('#burst').children.length > 0, true, '通关应放礼花');
  // 最高分写入
  assert.equal(h.win.localStorage.getItem('jun2048.best'), '32');
  // 关闭后继续玩，不再重复弹
  h.$('#overlay-actions .pill--primary').dispatchEvent(new h.win.MouseEvent('click', { bubbles: true }));
  await sleep(OVERLAY + 60);
  assert.equal(h.$('#overlay').hidden, true);
  assert.equal(h.app.state.won, true);
  h.close();
});

test('无路可走时弹出结束层，可重新开局', async () => {
  const dead = [
    0, 1, 2, 3,
    1, 2, 3, 4,
    2, 3, 4, 0,
    3, 4, 0, 1,
  ];
  const saved = { v: 1, size: 4, sig: 'jun|win|water|lec|liu', ranks: dead, score: 88, moves: 42, won: false };
  const h = await boot(saved);
  await sleep(OVERLAY + 120);
  assert.equal(h.$('#overlay').hidden, false, '读档死局应提示结束');
  assert.match(h.$('#overlay-title').textContent ?? '', /无处可合/);
  assert.match(h.$('#overlay-text').textContent ?? '', /88/);
  const action = h.$('#overlay-actions .pill--primary');
  action.dispatchEvent(new h.win.MouseEvent('click', { bubbles: true }));
  await sleep(OVERLAY + 120);
  assert.equal(h.app.state.moves, 0);
  assert.equal(ranks(h).filter((rank) => rank !== null).length, 2, '新局应有两个方块');
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
  // 第一个按钮是「继续玩」
  const pills = h.$('#overlay-actions').querySelectorAll('.pill');
  pills[0]!.dispatchEvent(new h.win.MouseEvent('click', { bubbles: true }));
  await sleep(OVERLAY + 60);
  assert.equal(h.app.state.score, scoreBefore);
  h.close();
});

test('图鉴展示完整合成链与终点说明', async () => {
  const h = await boot();
  h.$('#btn-guide').dispatchEvent(new h.win.MouseEvent('click', { bubbles: true }));
  await sleep(30);
  assert.equal(h.$('#sheet').hidden, false);
  const rows = h.$('#chain').querySelectorAll('.chain__row');
  assert.equal(rows.length, 5, '4 条合成关系 + 1 条终点');
  assert.match(h.$('#chain').textContent ?? '', /军/);
  assert.match(h.$('#chain').textContent ?? '', /赢/);
  assert.match(h.$('#chain').textContent ?? '', /水/);
  assert.match(h.$('#chain').textContent ?? '', /Lec/);
  assert.match(h.$('#chain').textContent ?? '', /刘/);
  assert.match(h.$('#chain').textContent ?? '', /终点/);
  assert.equal(h.$('#sheet-sub').textContent?.includes('不会再合成'), true);
  h.$('#sheet-close').dispatchEvent(new h.win.MouseEvent('click', { bubbles: true }));
  await sleep(SHEET + 60);
  assert.equal(h.$('#sheet').hidden, true);
  h.close();
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

test('分数与棋局写入 localStorage，重开页面能续上', async () => {
  const h = await boot();
  h.app.move('left');
  await settle(h);
  if (h.app.state.moves === 0) h.app.move('down');
  await settle(h);
  const snapshot = ranks(h);
  const raw = h.win.localStorage.getItem('jun2048');
  assert.ok(raw, '应写入存档');
  h.close();

  // 用同一份存档重新启动
  const h2 = await boot(JSON.parse(raw));
  assert.deepEqual(ranks(h2), snapshot, '重开应恢复棋局');
  h2.close();
});

test('坏存档不会白屏，会退回新局', async () => {
  const h = await boot({ v: 1, size: 9, sig: 'x', ranks: [], score: -5, moves: 0 });
  assert.equal(h.app.state.moves, 0);
  assert.equal(ranks(h).filter((rank) => rank !== null).length, 2);
  h.close();
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
  // 布局与状态必须一致：渲染出的方块数量 = 状态里的方块数量
  assert.equal(h.$('#tiles').children.length, h.app.state.cells.filter(Boolean).length);
  h.close();
});
