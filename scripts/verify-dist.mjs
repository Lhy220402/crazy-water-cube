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
check(!/https?:\/\/(?!www\.w3\.org)/i.test(html.replace(/data:[^"')\s]+/g, '')), '存在 http(s) 外链资源');
check(html.includes('军') && html.includes('赢') && html.includes('Lec') && html.includes('No.5'), '缺少合成体系文案');
check(html.includes('viewport') && html.includes('user-scalable=no'), '缺少移动端 viewport');
check(html.includes('safe-area-inset'), '缺少安全区适配');
check(html.includes('prefers-reduced-motion'), '缺少减少动效适配');
check(html.includes('prefers-color-scheme'), '缺少明暗外观适配');
check(html.length > 20_000, '文件过小，疑似构建不完整');
check(/__jun2048/.test(html), '缺少 App 入口');

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
