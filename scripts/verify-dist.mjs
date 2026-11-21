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
// 无外部资源：只允许「关于」里指向 Gitee / GitHub / GitHub Pages 的导航链接（不是加载资源）
check(
  !/https?:\/\/(?!www\.w3\.org|gitee\.com|github\.com|lhy220402\.github\.io)/i.test(
    html.replace(/data:[^"')\s]+/g, ''),
  ),
  '存在 http(s) 外链资源（仓库 / 在线玩导航链接除外）',
);
check(html.includes('疯狂水立方') && html.includes('OLD FIVE'), '缺少品牌与合成体系文案');
check(html.includes('军') && html.includes('赢') && html.includes('Lec'), '缺少合成体系文案');
check(html.includes('真通关了吗') && html.includes('记赢赢'), '缺少假通关/真通关文案');
check(html.includes('李娜') && html.includes('豆包AI'), '缺少新增词条/配方文案');
check(html.includes('彪') && html.includes('会成') && html.includes('🌧️'), '缺少 v2.2 新增词条文案');
check(html.includes('id="intro"') && html.includes('id="intro-start"'), '缺少开场界面');
check(html.includes('viewport') && html.includes('user-scalable=no'), '缺少移动端 viewport');
check(html.includes('safe-area-inset'), '缺少安全区适配');
check(html.includes('prefers-reduced-motion'), '缺少减少动效适配');
check(html.includes('prefers-color-scheme'), '缺少明暗外观适配');
check(/data-theme=["']?dark/.test(html), '缺少手动深色模式覆盖');
check(html.length > 20_000, '文件过小，疑似构建不完整');
check(/__jun2048/.test(html), '缺少 App 入口');
// v2.2：合成音效必须内联（data URI + WebAudio 解码），不能引外部音频
check(/data:audio\/mpeg;base64,[A-Za-z0-9+/=]{5000,}/.test(html), '缺少内联的合成音效');
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
