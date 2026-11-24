/**
 * 品牌与「关于」配置 —— 改游戏名、简介、仓库链接，只改这一个文件。
 *
 * 仓库（2026-11-23 用户改了用户名与仓库名，两个平台都迁移到 idealismo10）：
 *   Gitee  https://gitee.com/idealismo10/crazy-water-cube   显示名「疯狂水立方」
 *   GitHub https://github.com/idealismo10/crazy-water-cube
 *   GitHub Pages https://idealismo10.github.io/crazy-water-cube/
 *   （GitHub 不支持中文仓库名，所以 slug 用 crazy-water-cube，中文名写在仓库简介里。）
 *
 * v2.4：玩家发出去的已经是 GitHub Pages 在线版，「关于」里不再放「在线玩」按钮，
 *       只保留两个仓库入口（入口位置也移到了图鉴抽屉底部，避免误触）。
 *
 * ★ 简介注意：不要写「记 + 赢²」这个真通关配方（隐藏契约）。
 */

export const GAME_NAME = '疯狂水立方';
export const GAME_VERSION = '3.3.0';

/**
 * 启用「版本更新弹窗」记录（`jun2048.version`）之前的最后一个已发布版本。
 * 只用于给「有存档痕迹、但还没有版本记录」的老玩家算升级提示（v2.2.2 → 新版本）；
 * 之后的版本变化都看存档里的版本号，不再用这个常量。
 */
export const LEGACY_VERSION = '2.2.2';

export const GAME_TAGLINE = '军 → 赢² → 水³ → Lec → OLD FIVE';

export const ABOUT_TEXT = [
  '疯狂水立方是一款水主题的 2048 合成小游戏：在 4×4 棋盘上上下左右滑动（手机直接滑，电脑用方向键或 WASD），两枚相同的方块相碰就合成更高一级，从「军」一路合到 OLD FIVE，每次合成都加分。',
  '合出 OLD FIVE 只是假通关——词条之间还藏着特殊组合，真正的结局等你自己试出来。词条级方块可以互相合成，触发图鉴收录；稀有度（稀有 / 传说 / 传奇）只影响出现概率与光效，不限制配对，特殊组合还会带来限时得分加成，多个加成乘算叠加。',
  '图鉴收录跨局累积，重新开局不会清空；收集进度、剩下的悬念都放在图鉴里。最多可撤销 20 步；棋局、最高分和外观偏好都保存在本机。',
  '整个游戏是一个单文件网页，断网也能玩，微信里点开即开。',
].join('\n\n');

export interface RepoLink {
  readonly label: string;
  readonly url: string;
}

/** 「关于」里的入口：只保留两个仓库（在线玩已经是 GitHub Pages，不再重复放按钮） */
export const REPO_LINKS: readonly RepoLink[] = [
  { label: 'Gitee 仓库', url: 'https://gitee.com/idealismo10/crazy-water-cube' },
  { label: 'GitHub 仓库', url: 'https://github.com/idealismo10/crazy-water-cube' },
];
