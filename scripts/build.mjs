#!/usr/bin/env node
/**
 * 构建：
 *   node scripts/build.mjs          → dist/2048.html（单文件，可直接微信发送）
 *   node scripts/build.mjs --watch  → 监听并持续重建（配合 scripts/dev.mjs）
 *
 * 单文件版把 JS / CSS 全部内联，不依赖网络、不依赖 file:// 之外的任何资源，
 * 所以同学下载后用浏览器打开就能玩。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, context } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = resolve(root, 'dist');
const outFile = resolve(distDir, '2048.html');

const JS_TARGET = ['chrome80', 'safari14.1', 'firefox78', 'edge88'];

async function bundleJs({ minify }) {
  const result = await build({
    entryPoints: [resolve(root, 'src/main.ts')],
    bundle: true,
    format: 'iife',
    target: JS_TARGET,
    minify,
    write: false,
    legalComments: 'none',
    sourcemap: false,
    charset: 'utf8',
    logLevel: 'warning',
  });
  return result.outputFiles[0].text;
}

async function bundleCss({ minify }) {
  const css = await readFile(resolve(root, 'src/styles/main.css'), 'utf8');
  const result = await build({
    stdin: {
      contents: css,
      loader: 'css',
      resolveDir: resolve(root, 'src/styles'),
      sourcefile: 'main.css',
    },
    bundle: true,
    minify,
    write: false,
    target: ['chrome80', 'safari14.1', 'firefox78'],
    logLevel: 'warning',
  });
  return result.outputFiles[0].text;
}

function assemble(template, { css, js }) {
  let html = template;
  const linkTag = /<link\s+rel="stylesheet"[^>]*>/i;

  // 注意：替换内容里可能出现 $& / $' 这类序列（压缩后的 JS 里很常见），
  // 所以必须用函数形式，避免被 String.replace 当成特殊替换模式。
  html = html.replace(linkTag, () => `<style>\n${css}\n</style>`);
  // 只保留一个 <script>：内联的经典脚本（不是 module，file:// 下也能跑）
  html = html.replace('<!-- INLINE_SCRIPT -->', () => `<script>\n${js}\n</script>`);
  html = html.replace(
    '</head>',
    () => [
      '    <meta name="description" content="2048 主题版：两个「军」合成「赢²」，一路合到「刘 No.5」。手机浏览器直接玩。" />',
      '    <meta property="og:title" content="2048 · 军 → 赢² → 水³ → Lec → 刘 No.5" />',
      '    <meta property="og:description" content="滑动合成，看看谁先合出刘 No.5。" />',
      '    <meta property="og:type" content="website" />',
      '    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 64 64%27%3E%3Crect width=%2764%27 height=%2764%27 rx=%2718%27 fill=%27%234aa6ff%27/%3E%3Ctext x=%2732%27 y=%2742%27 font-size=%2728%27 font-family=%27sans-serif%27 font-weight=%27700%27 fill=%27white%27 text-anchor=%27middle%27%3E%E5%90%88%3C/text%3E%3C/svg%3E" />',
      '</head>',
    ].join('\n'),
  );
  return html;
}

export async function buildOnce({ minify = true, quiet = false } = {}) {
  await mkdir(distDir, { recursive: true });
  const [template, css, js] = await Promise.all([
    readFile(resolve(root, 'index.html'), 'utf8'),
    bundleCss({ minify }),
    bundleJs({ minify }),
  ]);
  if (!template.includes('<!-- INLINE_SCRIPT -->') || !/<link\s+rel="stylesheet"/i.test(template)) {
    throw new Error('index.html 缺少内联占位（INLINE_SCRIPT / stylesheet link）');
  }
  const html = assemble(template, { css, js });
  await writeFile(outFile, html, 'utf8');
  if (!quiet) {
    const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
    console.log(`✓ dist/2048.html  ${kb} KB（JS ${(js.length / 1024).toFixed(1)} KB / CSS ${(css.length / 1024).toFixed(1)} KB）`);
  }
  return { html, js, css };
}

const watchFlag = process.argv.includes('--watch');
if (watchFlag) {
  await buildOnce({ minify: false, quiet: true });
  console.log('✓ 首轮构建完成，监听源码变化…');
  const ctx = await context({
    entryPoints: [resolve(root, 'src/main.ts')],
    bundle: true,
    format: 'iife',
    target: JS_TARGET,
    write: false,
    logLevel: 'silent',
  });
  let timer = null;
  const rebuild = async () => {
    try {
      await buildOnce({ minify: false });
    } catch (error) {
      console.error('构建失败：', error.message);
    }
  };
  await ctx.watch();
  // esbuild 的 watch 只负责触发；这里用轮询 mtime 统一重建 HTML
  const { watch } = await import('node:fs');
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(rebuild, 60);
  };
  for (const target of ['src', 'index.html']) {
    watch(resolve(root, target), { recursive: true }, schedule);
  }
} else {
  await buildOnce();
}
