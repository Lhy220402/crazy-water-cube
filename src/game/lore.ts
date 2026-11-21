/**
 * 词条解释文案 —— 首次抽到词条 / 首次触发特殊合成时弹出，图鉴卡片也显示。
 *
 * ★ 想改文案，只改这一个文件。
 *   key = 词条/产物 id（见 codex.ts 与 recipes.ts），值 = 一段纯文本（不要写 Markdown 星号）。
 *   留空或缺失时会显示兜底句。
 *   带增益的特殊产物，解释里可以顺便说明增益；弹层右侧的「增益」数值会自动显示。
 */

export const LORE: Readonly<Record<string, string>> = {
  // 随机词条
  sui: '水立方里最常见的一个字，也是隋系组合的起点。',
  'eyu-qi': '鳄鱼怎么会有鳍呢',
  'sui-ring': '圆和隋是什么意思',
  'eyu-shi-jun': '鳄鱼怎么会食菌呢',
  ji: '记下来！',
  bayi: '军旗升起的日子',
  hongmei: '唯有梅花扑鼻香',
  jinshan: '似乎很富有',
  fuli: '重要的物理知识点',
  li: '一种元素',
  na: '一种元素',
  xiaoming: '我在数学题里总看见你',
  yanzi: '可曾拍过什么全城热恋',
  doubao: '我代码可不是用豆包写的嗷',
  // 特殊合成产物
  'sui-jun': '隋和军组队出征：接下来 8 步，所有合成得分 ×2。',
  'sui-jun-ring': '666 一家齐上了',
  'ji-ying-ying': '记才会赢！',
  lina: 'Li 和 Na 拼在一起，就是冠军的名字：接下来 8 步，所有合成得分 ×2。',
};

export const LORE_FALLBACK = '这条词条的故事还在整理中，先把它收进图鉴。';

export function loreOf(id: string): string {
  const text = LORE[id];
  return text && text.trim().length > 0 ? text : LORE_FALLBACK;
}
