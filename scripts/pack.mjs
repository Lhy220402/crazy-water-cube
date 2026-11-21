#!/usr/bin/env node
/** 打包发布件：把单文件版和源码一起放到 /sdcard/Download/DSH-Go/（可用参数覆盖目标目录）。 */
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOnce } from './build.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] ?? '/sdcard/Download/DSH-Go';
const out = resolve(target);

await buildOnce({ quiet: false });
await mkdir(out, { recursive: true });

// 1) 单文件版：微信里直接发这个
const single = resolve(root, 'dist/2048.html');
const singleName = '疯狂水立方.html';
await copyFile(single, resolve(out, singleName));

// 2) 源码：tar.gz，不包含 node_modules / dist
const srcName = '疯狂水立方-source.tar.gz';
const srcPath = resolve(out, srcName);
await rm(srcPath, { force: true });
const { spawnSync } = await import('node:child_process');
const files = ['src', 'scripts', 'tests', 'docs', 'index.html', 'package.json', 'tsconfig.json', 'tsconfig.test.json', 'README.md'];
const tar = spawnSync('tar', ['-czf', srcPath, '-C', root, ...files], { encoding: 'utf8' });
if (tar.status !== 0) throw new Error(`打包源码失败：${tar.stderr}`);

// 3) 玩法说明 + 交接文档
const readme = await readFile(resolve(root, 'README.md'), 'utf8');
await writeFile(resolve(out, '玩法说明.md'), readme, 'utf8');
await copyFile(resolve(root, 'docs/交接文档.md'), resolve(out, '疯狂水立方-交接文档.md'));
await copyFile(resolve(root, 'docs/新对话提示词.md'), resolve(out, '疯狂水立方-新对话提示词.md'));

const size = async (file) => ((await stat(file)).size / 1024).toFixed(1);
console.log(`\n✓ 已发布到 ${out}`);
console.log(`  单文件：${singleName}  ${await size(resolve(out, singleName))} KB  （微信发给同学，点开即玩）`);
console.log(`  源码：  ${srcName}  ${await size(srcPath)} KB`);
console.log(`  说明：  玩法说明.md / 疯狂水立方-交接文档.md / 疯狂水立方-新对话提示词.md`);
