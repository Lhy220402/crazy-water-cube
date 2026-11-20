# 2048 · 军 → 赢² → 水³ → Lec → 刘 No.5

一个给同学玩的 2048。手机浏览器打开就能玩，没有框架、没有网络请求、没有多余资源。

## 怎么玩

- 手指在棋盘上滑（上/下/左/右），或按键盘方向键 / WASD。
- 两枚同级相碰就合成下一级，合成加分。
- 合成链：

| 材料 | 产物 | 得分 |
| --- | --- | --- |
| 军 ×2 | 赢² | +4 |
| 赢² ×2 | 水³ | +8 |
| 水³ ×2 | Lec | +16 |
| Lec ×2 | 刘 No.5 | +32 |

- **刘 No.5 是终点**：合出来就通关（有礼花），之后还能继续刷分，但两块刘 No.5 不会再合并。
- 顶部「图鉴」里能看到完整合成链。
- 撤销最多 20 步；最高分和当前局面自动存在浏览器本地，关掉再打开能接着玩。
- 键盘：方向键 / WASD 移动，`Z` 撤销，`Esc` 关弹窗。

## 文件

- `2048-军合成-Lec-刘No5.html` —— **单文件版**，微信发给同学，下载后点开就能玩（也可以当附件、发群里、丢进网盘）。
- `2048-source.tar.gz` —— 完整源码，解压后 `npm install && npm run build`。
- `玩法说明.md` —— 本文件。

## 源码结构

```
src/
  game/
    config.ts   合成体系配置（等级表、生成概率、终点、撤销上限）
    engine.ts   纯函数规则引擎：移动/合成/判负/判胜/存档序列化
  ui/
    app.ts      DOM 渲染、CSS transform 动画编排、手势、弹窗
    storage.ts  localStorage 封装（不可用时退回内存）
  styles/
    main.css    Apple 风格视觉：玻璃材质、圆角、明暗外观、动效
  main.ts       入口
index.html      页面骨架（含内联占位）
scripts/
  build.mjs     打包成单文件（内联 JS+CSS）
  dev.mjs       本地预览（构建监听 + 静态服务器）
  verify-dist.mjs  发布前自检（无外链、移动端就绪）
  pack.mjs      发布到 /sdcard/Download/DSH-Go/
tests/
  engine.test.ts  规则引擎单测 + 随机对局不变量测试
  ui.test.ts      在 jsdom 里跑真实页面（渲染/合成/通关/存档/撤销）
```

常用命令：

```bash
npm install
npm run build     # → dist/2048.html
npm run dev       # 本地预览，手机同网络可访问
npm run verify    # 类型检查 + 测试 + 单文件自检
npm run pack      # 发布到 /sdcard/Download/DSH-Go/
```

## 以后想加新等级

只改 `src/game/config.ts` 里的 `TIERS` 数组，追加一项即可，其余全部自动跟随：

```ts
export const TIERS: readonly Tier[] = [
  { id: 'jun', label: '军', name: '军', points: 2 },
  { id: 'win', label: '赢', sup: '²', name: '赢²', points: 4 },
  { id: 'water', label: '水', sup: '³', name: '水³', points: 8 },
  { id: 'lec', label: 'Lec', name: 'Lec', points: 16, latin: true },
  { id: 'liu', label: '刘', sup: 'No.5', name: '刘 No.5', points: 32 },
  // 在这里继续加，例如：
  // { id: 'next', label: '新', sup: '⁶', name: '新⁶', points: 64 },
];
```

- 数组最后一项自动成为「终点」和通关条件（`winRank` 默认取 `tiers.length - 1`），
  所以加一级之后「刘 No.5」就变成可继续合成的普通等级。
- 面板上的合成链、图鉴、无障碍文本、棋盘尺寸都由这份配置生成，不用改 UI 代码。
- 新等级默认沿用第 5 级的金色材质。想给它单独配色，在 `src/styles/main.css` 里加一段：

```css
.tile[data-rank="5"] .tile__face { --tint: ...; --hi: ...; --ink-rgb: ...; --glow: ...; }
.mini[data-rank="5"] .mini__face { /* 图鉴小方块同色 */ }
```

- 生成概率（`spawn`）也可以改，比如让新局偶尔直接出现「水³」。
- 存档带等级签名（`tiersSignature`）：改了等级表之后旧存档会自动作废，不会错位。
