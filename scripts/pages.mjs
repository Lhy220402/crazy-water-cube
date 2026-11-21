#!/usr/bin/env node
/**
 * 把构建后的单文件版发布到 GitHub Pages（gh-pages 分支）。
 *
 * 用法：npm run pages
 * 前提：仓库已开启 Pages（Settings → Pages → Source: Deploy from a branch → gh-pages / root）。
 * 首次开启可以用 GitHub API：
 *   POST /repos/{owner}/{repo}/pages  {"source":{"branch":"gh-pages","path":"/"}}
 *
 * 只在临时目录里初始化一个干净仓库并 force-push gh-pages，不碰 main 工作区。
 * 想换目标仓库可用环境变量 PAGES_REPO 覆盖。
 */
import { execFileSync } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOnce } from './build.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoUrl = process.env.PAGES_REPO ?? 'git@github.com:Lhy220402/crazy-water-cube.git';
const branch = process.env.PAGES_BRANCH ?? 'gh-pages';
const siteUrl = process.env.PAGES_URL ?? 'https://lhy220402.github.io/crazy-water-cube/';
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));

await buildOnce({ quiet: false });

const dir = await mkdtemp(join(tmpdir(), 'jun2048-pages-'));
const git = (...args) =>
  execFileSync('git', args, {
    cwd: dir,
    stdio: 'pipe',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'dsh',
      GIT_AUTHOR_EMAIL: 'dsh@localhost',
      GIT_COMMITTER_NAME: 'dsh',
      GIT_COMMITTER_EMAIL: 'dsh@localhost',
    },
  });

try {
  await copyFile(resolve(root, 'dist/2048.html'), join(dir, 'index.html'));
  // 不让 GitHub 用 Jekyll 处理静态文件
  await writeFile(join(dir, '.nojekyll'), '');
  git('init', '-q');
  git('checkout', '-q', '-B', branch);
  git('add', '-A');
  git('commit', '-q', '-m', `deploy: v${pkg.version} 单文件版`);
  git('remote', 'add', 'origin', repoUrl);
  git('push', '-q', '--force', 'origin', `${branch}:${branch}`);
  console.log(`✓ 已推送 ${branch} 分支到 ${repoUrl}`);
  console.log(`  在线地址：${siteUrl}`);
  console.log('  （首次发布需在仓库 Settings → Pages 里选 gh-pages 分支；之后每次 push 自动更新）');
} finally {
  await rm(dir, { recursive: true, force: true });
}
