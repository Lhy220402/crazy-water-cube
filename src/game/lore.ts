/**
 * 词条解释文案 —— 首次抽到词条 / 首次触发特殊合成时弹出，图鉴卡片也显示。
 *
 * ★ 想改文案，只改这一个文件。
 *   key = 词条/产物 id（见 codex.ts 与 recipes.ts），值 = 一段纯文本（不要写 Markdown 星号）。
 *   没有文案的词条（当前是「隋」「李娜」）不弹解释卡、图鉴卡片也不显示说明；
 *   名字、稀有度、出现次数照常保留。
 *   带增益的特殊产物，解释里可以顺便说明增益；弹层右侧的「增益」数值会自动显示。
 */

export const LORE: Readonly<Record<string, string>> = {
  // 随机词条
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
  biao: '彪！',
  huicheng: '会成吗？',
  // 🌧️ 的解释是两行，弹层与图鉴卡片都保留换行（CSS white-space: pre-line）
  xiaoyu: '这雨似乎不大\n这是小雨啊',
  // v2.3 新增 4 条（用户原文）
  gang: '一种金属',
  weihai: '一个地名',
  dingjian: '钉子怎么能做剑？',
  junzhu: '竹子中的皇帝是吗',
  // v2.4 新增 5 条（用户原文）
  chenglong: '香港著名演艺明星',
  batian: '所有人给我站一边！',
  neng: '大黑能是谁',
  zhaoyiming: '好想来购物袋怎么说',
  sudailiao: '赵一鸣他家怎么说',
  // v2.5 新增 3 条（用户原文）
  zuolun: '很优秀的武器',
  'yu-zi': '似乎很适合做酱',
  'he-si': '牛何之？',
  // 特殊合成产物
  'sui-jun': '水里的军队',
  'sui-jun-ring': '666 一家齐上了',
  'shui-gang': '一种容器',
  'ji-ying-ying': '记才会赢！',
  miao: '庄宗受而藏之于庙',
  'ji-hui-cheng': '记了就会成',
  // 隋 / 李娜：用户要求去掉解释，故不写 key（loreOf 返回空串）
};

/** 没有文案时返回空串：UI 不弹解释卡，图鉴卡片也不显示说明 */
export function loreOf(id: string): string {
  const text = LORE[id];
  return text && text.trim().length > 0 ? text : '';
}
