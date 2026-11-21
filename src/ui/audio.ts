/**
 * 音频引擎：每次合成后播放一段内联音效（v2.2 实现）
 *
 * 设计：
 *   - 音源内联在 merge-sfx.ts（data URI），单文件契约不引外部资源、不写存档。
 *   - 浏览器自动播放策略要求先有用户手势：app.ts 在点「开始合成 / 继续游戏」时
 *     调用 unlock()，这里才创建 AudioContext 并解码音效。
 *   - 只对「合成」发声：merge / special / win / truewin；普通移动 / 无效移动 / 撤销
 *     保持安静，避免每步都响。用 playbackRate 让特殊合成与通关的音高更高一点。
 *   - 没有 AudioContext（旧浏览器、jsdom、测试）时全部安全降级为 no-op。
 *   - 声音开关持久化在 `${storageKey}.sound`（'on' / 'off'，缺省 = 开），
 *     这是第 5 个 localStorage key；不存音量。
 *
 * 以后要做背景音乐：在 unlock() 里加载 loop 资源，startMusic/stopMusic 控制即可；
 * 若要持久化音乐开关，先更新 docs/交接文档.md 的存档契约再加第 5 个 key。
 */
import type { KV } from './storage.ts';
import { MERGE_SFX_DATA_URI } from './merge-sfx.ts';

/** 每一个游戏动作对应的声音事件；只有合成类 cue 会实际发声 */
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
  /** 首次用户手势后调用：创建 / 恢复 AudioContext，并开始解码内联音效 */
  unlock(): void;
  /** 播放一个音效；enabled=false、还没 unlock 或环境不支持时直接忽略 */
  play(event: AudioCue | AudioEvent): void;
  setEnabled(on: boolean): void;
  setVolume(value: number): void;
  startMusic(): void;
  stopMusic(): void;
  destroy(): void;
}

export interface AudioOptions {
  w: Window | null;
  /** 预留：音乐开关要持久化时注入；当前实现不读写任何 key */
  kv?: KV;
  storageKey?: string;
}

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return 0.7;
  return Math.min(1, Math.max(0, value));
}

type AudioContextCtor = new () => AudioContext;

function audioCtorOf(w: Window | null): AudioContextCtor | null {
  if (!w) return null;
  const win = w as Window & {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return win.AudioContext ?? win.webkitAudioContext ?? null;
}

export function createAudio(options: AudioOptions): AudioEngine {
  const w = options.w;
  const kv = options.kv ?? null;
  const soundKey = options.storageKey ? `${options.storageKey}.sound` : null;
  let enabled = true;
  if (kv && soundKey) {
    try {
      if (kv.get(soundKey) === 'off') enabled = false;
    } catch {
      /* 读不到就当开启 */
    }
  }
  let volume = 0.7;
  let music = false;
  let unlocked = false;
  let destroyed = false;
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let sfx: AudioBuffer | null = null;
  let decoding = false;

  function decodeSfx(): void {
    if (!ctx || sfx || decoding) return;
    const win = w;
    if (!win) return;
    decoding = true;
    try {
      const comma = MERGE_SFX_DATA_URI.indexOf(',');
      const base64 = comma >= 0 ? MERGE_SFX_DATA_URI.slice(comma + 1) : '';
      const binary = win.atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      // 用回调式 decodeAudioData：Safari 14.1 也支持，promise 式在旧 Safari 上不保证
      ctx.decodeAudioData(
        bytes.buffer,
        (decoded) => {
          sfx = decoded;
          decoding = false;
        },
        () => {
          decoding = false;
        },
      );
    } catch {
      decoding = false;
    }
  }

  function ensureContext(): AudioContext | null {
    if (destroyed) return null;
    if (ctx) return ctx;
    const Ctor = audioCtorOf(w);
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(ctx.destination);
      decodeSfx();
    } catch {
      ctx = null;
      master = null;
    }
    return ctx;
  }

  function playSfx(rate: number, gain: number): void {
    const context = ensureContext();
    if (!context || !master || !sfx) return;
    try {
      const source = context.createBufferSource();
      source.buffer = sfx;
      source.playbackRate.value = rate;
      const envelope = context.createGain();
      envelope.gain.value = Math.max(0, Math.min(1, gain));
      source.connect(envelope);
      envelope.connect(master);
      source.start();
    } catch {
      /* 音频播放失败不影响游戏 */
    }
  }

  function persistEnabled(): void {
    if (!kv || !soundKey) return;
    try {
      kv.set(soundKey, enabled ? 'on' : 'off');
    } catch {
      /* 存不了就只在本次会话生效 */
    }
  }

  function handleCue(cue: AudioCue): void {
    switch (cue) {
      // 普通合成：原声
      case 'merge':
        playSfx(1, 0.85);
        break;
      // 特殊合成：升半音多一点，听得出「这次不一样」
      case 'special':
        playSfx(1.12, 1);
        break;
      case 'win':
        playSfx(1.22, 1);
        break;
      case 'truewin':
        playSfx(1.32, 1);
        break;
      // move / invalid / undo / restart / collect / start / over 不发声
      default:
        break;
    }
  }

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
      if (destroyed || unlocked) return;
      unlocked = true;
      const context = ensureContext();
      if (context && context.state === 'suspended') {
        void context.resume().catch(() => {
          /* 被策略拦下就等下一次用户手势 */
        });
      }
    },
    play(event: AudioCue | AudioEvent) {
      if (!enabled || !unlocked || destroyed) return;
      handleCue(typeof event === 'string' ? event : event.cue);
    },
    setEnabled(on: boolean) {
      enabled = on;
      if (!on) music = false;
      if (master) master.gain.value = enabled ? volume : 0;
      persistEnabled();
    },
    setVolume(value: number) {
      volume = clampVolume(value);
      if (master) master.gain.value = enabled ? volume : 0;
    },
    startMusic() {
      // 当前没有背景音乐：只记录状态，避免 enterGame 时突然循环播放语音
      music = enabled;
    },
    stopMusic() {
      music = false;
    },
    destroy() {
      destroyed = true;
      music = false;
      unlocked = false;
      sfx = null;
      master = null;
      if (ctx) {
        try {
          void ctx.close();
        } catch {
          /* 已经关闭就算了 */
        }
        ctx = null;
      }
    },
  };
}
