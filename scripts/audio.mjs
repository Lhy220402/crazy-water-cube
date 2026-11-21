#!/usr/bin/env node
/**
 * 生成合成音效：截取源音频的指定区间 → 降噪 → 归一化 → 单声道 mp3 → 内联 TS。
 *
 * 用法：node scripts/audio.mjs <源音频路径> [起始秒] [结束秒]
 * 当前项目用的源：/sdcard/Download/WeiXin/语音 010_W_20261102_092315.m4a（三声猫叫）
 * 当前区间：1.15s–2.05s（第二声猫叫）；默认值即此区间。
 *
 * 需要系统里有 ffmpeg / ffprobe（本机用 apt-get install ffmpeg 安装）。
 * 产物：src/ui/merge-sfx.ts（提交进仓库，构建时内联进单文件）。
 * 单文件契约：不要改成外链；重新生成后重跑 npm run verify。
 */
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { statSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceArg = process.argv[2];
if (!sourceArg) {
  console.error('用法：node scripts/audio.mjs <源音频路径> [起始秒] [结束秒]');
  process.exit(1);
}
const source = resolve(sourceArg);
/** 第二声猫叫的默认区间（见 docs/交接文档.md 的音频说明） */
const CLIP_START = process.argv[3] !== undefined ? Number(process.argv[3]) : 1.15;
const CLIP_END = process.argv[4] !== undefined ? Number(process.argv[4]) : 2.05;

function ffmpeg(args) {
  return execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    encoding: 'utf8',
  });
}

function probeDuration(file) {
  const out = execFileSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file],
    { encoding: 'utf8' },
  );
  return Number.parseFloat(out.trim());
}

const duration = probeDuration(source);
if (!Number.isFinite(duration) || duration <= 0) throw new Error('读不到音频时长');
const start = CLIP_START;
const end = CLIP_END;
if (!(start >= 0 && end > start && end <= duration + 0.01)) {
  throw new Error(`裁剪区间 ${start}-${end}s 超出音频范围 0-${duration.toFixed(2)}s`);
}
const clip = end - start;

const tmp = resolve('/tmp/jun2048-merge-sfx.mp3');
// 降噪 + 高通去掉低频轰鸣 + 响度归一化 + 首尾淡入淡出防爆音
const filters = [
  'highpass=f=80',
  'afftdn=nr=20:nf=-32',
  'loudnorm=I=-18:TP=-1.5:LRA=11',
  'afade=t=in:st=0:d=0.012',
  `afade=t=out:st=${Math.max(0, clip - 0.035).toFixed(3)}:d=0.035`,
].join(',');

ffmpeg([
  '-ss', start.toFixed(3),
  '-t', clip.toFixed(3),
  '-i', source,
  '-af', filters,
  '-ac', '1',
  '-ar', '44100',
  '-c:a', 'libmp3lame',
  '-b:a', '64k',
  tmp,
]);

const bytes = await readFile(tmp);
const base64 = bytes.toString('base64');
const sizeKb = (statSync(tmp).size / 1024).toFixed(1);

const content = `/**
 * 合成音效（自动生成，不要手改）
 *
 * 来源：用户提供的微信语音「语音 010_W_20261102_092315.m4a」第二声猫叫
 * （${start.toFixed(2)}s–${end.toFixed(2)}s，共 ${clip.toFixed(2)} 秒），
 * 已用 ffmpeg 做降噪（afftdn）、高通、响度归一化，转成单声道 mp3。
 * 重新生成：node scripts/audio.mjs <源音频路径>
 *
 * 单文件契约：音频必须内联，不能引用外部资源，所以直接存 data URI。
 */
export const MERGE_SFX_DATA_URI = 'data:audio/mpeg;base64,${base64}';
`;

await writeFile(resolve(root, 'src/ui/merge-sfx.ts'), content, 'utf8');
console.log(`✓ 已生成 src/ui/merge-sfx.ts（${sizeKb} KB mp3，base64 ${(base64.length / 1024).toFixed(1)} KB）`);
