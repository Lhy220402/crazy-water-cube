#!/usr/bin/env node
/** 发布前静态自检：单文件版必须自包含、无外链、能从 file:// 直接打开。 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const file = resolve(root, 'dist/2048.html');
const html = await readFile(file, 'utf8');
const problems = [];
const warnings = [];

const check = (ok, message) => {
  if (!ok) problems.push(message);
};

check(/<style>/.test(html), '缺少内联 <style>');
check(/<script>/.test(html) && !/<script[^>]+type="module"/.test(html), '脚本必须是内联经典脚本');
check(!/<link\s+rel="stylesheet"/i.test(html), '仍存在外链样式表');
check(!/<script[^>]+src=/i.test(html), '仍存在外链脚本');
// 无外部资源：只允许「关于」里指向 Gitee / GitHub 的导航链接（不是加载资源）
// v2.4 起「关于」不再放 GitHub Pages 在线玩按钮（发给同学的已经是 Pages），允许名单同步收紧
check(
  !/https?:\/\/(?!www\.w3\.org|gitee\.com|github\.com)/i.test(
    html.replace(/data:[^"')\s]+/g, ''),
  ),
  '存在 http(s) 外链资源（仓库导航链接除外）',
);
check(html.includes('疯狂水立方') && html.includes('OLD FIVE'), '缺少品牌与合成体系文案');
check(html.includes('军') && html.includes('赢') && html.includes('Lec'), '缺少合成体系文案');
check(html.includes('真通关了吗') && html.includes('记赢赢'), '缺少假通关/真通关文案');
check(html.includes('李娜') && html.includes('豆包AI'), '缺少新增词条/配方文案');
check(html.includes('彪') && html.includes('会成') && html.includes('🌧️'), '缺少 v2.2 新增词条文案');
// v2.3：水军（原隋军改名）/ 水缸配方 / 四条新词条
check(
  html.includes('水军') && html.includes('水缸'),
  '缺少 v2.3 的水军改名 / 水缸配方文案',
);
check(
  html.includes('钢') && html.includes('威海') && html.includes('钉剑') && html.includes('君竹'),
  '缺少 v2.3 新增词条（钢 / 威海 / 钉剑 / 君竹）',
);
// v2.4：5 条新词条 + 彪 + 水³ → 妙 + 图鉴进度条/未完待续 + 稀有度光效/爱心粒子
check(
  html.includes('成龙') &&
    html.includes('霸天') &&
    html.includes('赵一鸣') &&
    html.includes('塑料袋'),
  '缺少 v2.4 新增词条（成龙 / 霸天 / 能 / 赵一鸣 / 塑料袋）',
);
check(
  html.includes('妙') && html.includes('庄宗受而藏之于庙'),
  '缺少 v2.4 的「彪 + 水³ → 妙」配方文案',
);
check(
  html.includes('隋圆') && html.includes('隋军隋圆'),
  '缺少圆环词条/特殊产物的新显示名（隋圆 / 隋军隋圆）',
);
check(
  html.includes('codex__bar') && html.includes('未完待续'),
  '缺少图鉴收集进度条 / 未完待续',
);
// v2.5：左轮 / 鱼籽 / 何思 + 记赢赢 + 会成 → 记会成（隐藏延伸配方）
check(
  html.includes('左轮') && html.includes('鱼籽') && html.includes('何思'),
  '缺少 v2.5 新增词条（左轮 / 鱼籽 / 何思）',
);
check(
  html.includes('记会成') && html.includes('记了就会成'),
  '缺少 v2.5 的「记赢赢 + 会成 → 记会成」配方文案',
);
// v3.0：12 条传奇词条 + 记赢赢金虹 + 全屏现世弹层 + 图鉴传奇分区
check(
  ['煤灰', '昭君', '象郡', '小风', '🍒', '假生', '666', '红鹰', '王雪地', '种树', '国晶', '春橙'].every(
    (name) => html.includes(name),
  ),
  '缺少 v3.0 传奇词条（12 条）',
);
check(
  html.includes('tile__aura--myth') &&
    html.includes('panel__title--myth') &&
    html.includes('codex__section--myth'),
  '缺少传奇金虹光效 / 全屏现世弹层 / 图鉴传奇分区',
);
check(
  html.includes('传奇词条 · 随机抽取') && html.includes('传奇 · 现世'),
  '缺少传奇抽取配方 / 现世文案',
);
check(html.includes('3.0.0'), '缺少 v3.0.0 版本号');
check(
  html.includes('tile__aura') && html.includes('heart-rise'),
  '缺少稀有度光效 / 爱心粒子',
);
check(html.includes('版本已更新') && html.includes('.version'), '缺少版本更新弹窗（jun2048.version）');
// v2.4：关于里不再有在线玩按钮（GitHub Pages 已经是对外的正式入口）
check(!html.includes('github.io'), '关于里不应再有 GitHub Pages 在线玩链接');
check(html.includes('id="intro"') && html.includes('id="intro-start"'), '缺少开场界面');
check(html.includes('id="btn-sound"'), '缺少声音开关');
// favicon：三滴水滴正三角，SVG 主 + PNG 兜底，都必须是 data URI（无外部图标）
check(
  /<link[^>]+rel="icon"[^>]+type="image\/svg\+xml"[^>]+href="data:image\/svg\+xml;base64,/.test(html),
  '缺少内联 SVG favicon',
);
check(
  /<link[^>]+rel="icon"[^>]+type="image\/png"[^>]+href="data:image\/png;base64,/.test(html),
  '缺少内联 PNG favicon 兜底',
);
check(!/<link[^>]+rel="icon"[^>]+href="https?:/.test(html), 'favicon 不能引外部资源');
check(html.includes('viewport') && html.includes('user-scalable=no'), '缺少移动端 viewport');
check(html.includes('safe-area-inset'), '缺少安全区适配');
check(html.includes('prefers-reduced-motion'), '缺少减少动效适配');
check(html.includes('prefers-color-scheme'), '缺少明暗外观适配');
check(/data-theme=["']?dark/.test(html), '缺少手动深色模式覆盖');
check(html.length > 20_000, '文件过小，疑似构建不完整');
check(/__jun2048/.test(html), '缺少 App 入口');
// 音效必须内联（data URI + WebAudio 解码），不能引外部音频
// v2.3 曾尝试三段猫叫剪辑，用户听完不满意，已完整回滚到 v2.2.2 的单声猫叫
// v2.4.1：新增本局失败音效，合成音效 + 失败音效两段 data URI
const inlineAudio = html.match(/data:audio\/mpeg;base64,[A-Za-z0-9+/=]{5000,}/g) ?? [];
check(inlineAudio.length >= 2, '缺少内联的合成音效 / 失败音效（应有两段 data URI）');
check(html.includes('decodeAudioData'), '音频应通过 WebAudio 解码内联音效');

const kb = Buffer.byteLength(html, 'utf8') / 1024;
if (kb > 320) warnings.push(`单文件 ${kb.toFixed(1)} KB，偏大，微信里打开可能略慢`);

const tileStyle = /\.tile\s*\{[^}]*transition:[^;}]*transform/.test(html);
check(tileStyle, '方块滑动应使用 transform transition');
check(/backdrop-filter/.test(html), '缺少玻璃材质（backdrop-filter）');
check(/role="dialog"/.test(html), '缺少无障碍对话框标签');
check(/aria-live/.test(html), '缺少 aria-live 状态播报');

console.log(`单文件：dist/2048.html，${kb.toFixed(1)} KB`);
for (const warning of warnings) console.log(`⚠ ${warning}`);
if (problems.length) {
  for (const problem of problems) console.error(`✗ ${problem}`);
  process.exit(1);
}
console.log('✓ 单文件自检通过：无外链、移动端就绪、可从 file:// 打开');
