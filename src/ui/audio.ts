/**
 * 音频接口（v2.1 预留，当前为空实现）
 *
 * 背景音乐 / 每步音效以后要做时，只需要实现这个文件里的方法，不用改游戏逻辑：
 *   - 资源：单文件契约要求「无外部资源」，音频要么内联成 data URI，要么用 WebAudio 现场合成；
 *     注意体积（微信里点开要快），太长建议只做 8-bit / 合成 loop。
 *   - 自动播放：浏览器要求先有一次用户手势。app.ts 在玩家点「开始合成 / 继续游戏」时
 *     调用 audio.unlock()，在这里创建 / 恢复 AudioContext。
 *   - 开关持久化：目前存档契约只有 jun2048 / .best / .codex / .theme 四个 key。
 *     如果音乐开关要记住，建议先更新 docs/交接文档.md 的存档契约，再注入 KV 存第 5 个 key；
 *     不打算加 key 的话就只在本次会话里生效。
 *   - UI：底栏已经有一个 ◐ 按钮；以后可以再加一个 ♪ 静音按钮，
 *     点击时调用 audio.setEnabled(!audio.enabled) / startMusic() / stopMusic()。
 *
 * 现在所有方法都是安全 no-op：不创建 AudioContext、不加载任何资源、不写 localStorage。
 * app.ts 里已经埋好每个动作的播放点（见 AudioCue 注释），实现时按 cue 查表即可。
 */
import type { KV } from './storage.ts';

/** 每一个游戏动作对应的声音事件；以后按这个表做「每步特殊音效」 */
export type AudioCue =
  | 'start' // 从开场界面进入游戏
  | 'move' // 有效移动（无合成）
  | 'merge' // 普通合成
  | 'special' // 特殊配方产物
  | 'collect' // 首次收录新词条
  | 'invalid' // 无效移动（棋盘抖动）
  | 'undo' // 撤销
  | 'restart' // 重新开局
  | 'win' // 假通关
  | 'truewin' // 真通关
  | 'over'; // 无路可走

export type AudioDirection = 'up' | 'down' | 'left' | 'right';

/** 播放时附带的上下文：以后想做「按方向变调 / 按连击数加音」时直接取用 */
export interface AudioEvent {
  readonly cue: AudioCue;
  readonly direction?: AudioDirection;
  /** 本步合并数量 */
  readonly merges?: number;
  /** 本步得分（已乘增益） */
  readonly gained?: number;
  /** 本步产出的词条 / 特殊产物 id，按出现顺序 */
  readonly variants?: readonly string[];
}

export interface AudioEngine {
  readonly enabled: boolean;
  readonly volume: number;
  readonly musicPlaying: boolean;
  /** 首次用户手势后调用：以后在这里创建 / 恢复 AudioContext */
  unlock(): void;
  /** 播放一个音效；enabled=false 或还没 unlock 时直接忽略 */
  play(event: AudioCue | AudioEvent): void;
  setEnabled(on: boolean): void;
  setVolume(value: number): void;
  startMusic(): void;
  stopMusic(): void;
  destroy(): void;
}

export interface AudioOptions {
  w: Window | null;
  /** 预留：音乐开关要持久化时注入；默认不读写任何 key */
  kv?: KV;
  storageKey?: string;
}

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return 0.7;
  return Math.min(1, Math.max(0, value));
}

export function createAudio(_options: AudioOptions): AudioEngine {
  let enabled = true;
  let volume = 0.7;
  let music = false;
  let unlocked = false;

  return {
    get enabled() {
      return enabled;
    },
    get volume() {
      return volume;
    },
    get musicPlaying() {
      return music;
    },
    unlock() {
      // 以后：在这里创建 AudioContext / 解锁 WebAudio，恢复用户手势前的暂停状态
      unlocked = true;
    },
    play(_event: AudioCue | AudioEvent) {
      if (!enabled || !unlocked) return;
      // 以后：const { cue, direction, merges, gained, variants } = typeof event === 'string' ? { cue: event } : event;
      //       按 cue 查音效表，direction / merges 可用于变调与叠音
    },
    setEnabled(on: boolean) {
      enabled = on;
      if (!on) music = false;
    },
    setVolume(value: number) {
      volume = clampVolume(value);
    },
    startMusic() {
      // 以后：开始循环播放背景音乐（enabled=false 时不启动）
      music = enabled;
    },
    stopMusic() {
      music = false;
    },
    destroy() {
      music = false;
      unlocked = false;
    },
  };
}
