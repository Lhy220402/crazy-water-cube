#!/usr/bin/env node
/**
 * 生成内联音效：截取源音频的指定区间 → 降噪 → 归一化 → 单声道 mp3 → 内联 TS。
 *
 * 用法：
 *   node scripts/audio.mjs [merge|over] <源音频路径> [起始秒] [结束秒]
 *   省略 kind 时默认生成合成音效（merge），保持旧命令兼容。
 *
 * 两类音效：
 *   merge（合成）：源 /sdcard/Download/WeiXin/语音 010_W_20261102_092315.m4a
 *                  第二声猫叫，默认 1.15s–2.05s
 *   over（失败）：源「标准录音 1.mp3」（用户提供，副本见 release/audio-src/，不进仓库）
 *                 默认 0.56s–2.80s（去掉开头约 0.56s 的录音底噪/静音）
 *
 * 处理流程：先解码成无损 wav（绕开源文件首帧损坏），再裁剪 + 高通/低通 + afftdn 降噪 +
 * loudnorm 归一化 + 首尾淡入淡出，最后转 44.1kHz 单声道 64kbps mp3。
 * 需要系统里有 ffmpeg / ffprobe（本机用 apt-get install ffmpeg 安装）。
 *
 * 产物：src/ui/merge-sfx.ts / src/ui/over-sfx.ts（提交进仓库，构建时内联进单文件）。
 * 单文件契约：不要改成外链；重新生成后重跑 npm run verify。
 */
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { statSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PRESETS = {
  merge: {
    out: 'src/ui/merge-sfx.ts',
    exportName: 'MERGE_SFX_DATA_URI',
    start: 1.15,
    end: 2.05,
    sourceLabel: '用户提供的微信语音「语音 010_W_20261102_092315.m4a」第二声猫叫',
    regen: 'node scripts/audio.mjs <源音频路径>',
    /** 降噪 + 高通去掉低频轰鸣 + 响度归一化 + 首尾淡入淡出防爆音 */
    filters: (clip) =>
      [
        'highpass=f=80',
        'afftdn=nr=20:nf=-32',
        'loudnorm=I=-18:TP=-1.5:LRA=11',
        'afade=t=in:st=0:d=0.012',
        `afade=t=out:st=${Math.max(0, clip - 0.035).toFixed(3)}:d=0.035`,
      ].join(','),
    processing: '已用 ffmpeg 做降噪（afftdn）、高通、响度归一化，转成单声道 mp3。',
  },
  over: {
    out: 'src/ui/over-sfx.ts',
    exportName: 'OVER_SFX_DATA_URI',
    start: 0.56,
    end: 2.8,
    sourceLabel: '用户提供的「标准录音 1.mp3」',
    regen: 'node scripts/audio.mjs over <源音频路径>',
    /** 高通保留下沉的基频 / 低通压掉高频底噪 / afftdn 降噪 / 归一化 / 稍长的淡入淡出 */
    filters: (clip) =>
      [
        'highpass=f=70',
        'lowpass=f=14000',
        'afftdn=nr=14:nf=-42:tn=1',
        // 失败音效要比合成猫叫更突出：归一化到 -14 LUFS（比合成音效的 -18 响约 4 dB）
        'loudnorm=I=-14:TP=-1.0:LRA=11',
        'afade=t=in:st=0:d=0.02',
        `afade=t=out:st=${Math.max(0, clip - 0.12).toFixed(3)}:d=0.12`,
      ].join(','),
    processing:
      '已用 ffmpeg 去掉开头静音、高通 70Hz + 低通 14kHz、降噪（afftdn）、响度归一化到 -14 LUFS（比合成音效更响），转成单声道 mp3。',
  },
};

const rawArgs = process.argv.slice(2);
if (rawArgs.length === 0 || rawArgs[0] === '--help' || rawArgs[0] === '-h') {
  console.error('用法：node scripts/audio.mjs [merge|over] <源音频路径> [起始秒] [结束秒]');
  process.exit(1);
}
const kind = rawArgs[0] === 'merge' || rawArgs[0] === 'over' ? rawArgs.shift() : 'merge';
const preset = PRESETS[kind];
const sourceArg = rawArgs[0];
if (!sourceArg) {
  console.error('用法：node scripts/audio.mjs [merge|over] <源音频路径> [起始秒] [结束秒]');
  process.exit(1);
}
const source = resolve(sourceArg);
const start = rawArgs[1] !== undefined ? Number(rawArgs[1]) : preset.start;
const end = rawArgs[2] !== undefined ? Number(rawArgs[2]) : preset.end;
const clip = end - start;

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
if (!(start >= 0 && end > start && end <= duration + 0.01)) {
  throw new Error(`裁剪区间 ${start}-${end}s 超出音频范围 0-${duration.toFixed(2)}s`);
}

// 1) 先解码成无损单声道 wav：部分录音/微信语音的容器首帧可能损坏，
//    先修复成 PCM 再处理，避免降噪/裁剪踩到坏帧。
const decoded = resolve(`/tmp/jun2048-${kind}-full.wav`);
ffmpeg(['-i', source, '-vn', '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', decoded]);

// 2) 裁剪 + 降噪 + 归一化 + 淡入淡出，输出单声道 64k mp3
const tmp = resolve(`/tmp/jun2048-${kind}-sfx.mp3`);
ffmpeg([
  '-i', decoded,
  '-ss', start.toFixed(3),
  '-t', clip.toFixed(3),
  '-af', preset.filters(clip),
  '-ac', '1',
  '-ar', '44100',
  '-map_metadata', '-1',
  '-c:a', 'libmp3lame',
  '-b:a', '64k',
  tmp,
]);

const bytes = await readFile(tmp);
const base64 = bytes.toString('base64');
const sizeKb = (statSync(tmp).size / 1024).toFixed(1);

const content = `/**
 * ${kind === 'merge' ? '合成音效' : '失败音效'}（自动生成，不要手改）
 *
 * 来源：${preset.sourceLabel}
 * （${start.toFixed(2)}s–${end.toFixed(2)}s，共 ${clip.toFixed(2)} 秒），
 * ${preset.processing}
 * 重新生成：${preset.regen}
 *
 * 单文件契约：音频必须内联，不能引用外部资源，所以直接存 data URI。
 */
export const ${preset.exportName} = 'data:audio/mpeg;base64,${base64}';
`;

const outPath = resolve(root, preset.out);
await writeFile(outPath, content, 'utf8');
console.log(
  `✓ 已生成 ${preset.out}（${sizeKb} KB mp3，base64 ${(base64.length / 1024).toFixed(1)} KB）`,
);
