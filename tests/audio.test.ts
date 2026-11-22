import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudio } from '../src/ui/audio.ts';
import type { KV } from '../src/ui/storage.ts';

/**
 * 音频引擎单元测试：
 *  - jsdom / 旧浏览器没有 AudioContext 时必须安全降级（游戏不能因此报错）
 *  - 有 AudioContext 时，合成类 cue 与失败 cue 播放各自音源，且受 enabled / unlock 控制
 * 用结构相同的假 AudioContext 跑真实播放路径，不依赖浏览器。
 */
test('音频引擎：没有 AudioContext 时全部安全降级', () => {
  const audio = createAudio({ w: null });
  audio.unlock();
  for (const cue of ['start', 'move', 'merge', 'special', 'win', 'truewin', 'invalid', 'undo', 'over'] as const) {
    audio.play(cue);
  }
  audio.play({ cue: 'merge', direction: 'left', merges: 2, gained: 16, variants: ['sui'] });
  audio.startMusic();
  assert.equal(audio.musicPlaying, true);
  audio.stopMusic();
  assert.equal(audio.musicPlaying, false);
  audio.setVolume(3);
  assert.equal(audio.volume, 1, '音量应被夹到 0..1');
  audio.setVolume(Number.NaN);
  assert.equal(audio.volume, 0.7);
  audio.setEnabled(false);
  assert.equal(audio.enabled, false);
  audio.setEnabled(true);
  audio.destroy();
  assert.equal(audio.musicPlaying, false);
});

test('音频引擎：合成 cue 与失败 cue 各播各的音源，enabled=false 静音', () => {
  let created = 0;
  let started = 0;
  let decoded = 0;
  const startedDurations: number[] = [];
  const gain = () => ({ gain: { value: 0 }, connect() {} });
  const source = () => ({
    buffer: null as unknown,
    playbackRate: { value: 1 },
    connect() {},
    start() {
      started += 1;
      startedDurations.push((this.buffer as { duration?: number } | null)?.duration ?? -1);
    },
    stop() {},
  });
  class FakeAudioContext {
    state = 'running';
    destination = {};
    constructor() {
      created += 1;
    }
    createGain() {
      return gain();
    }
    createBufferSource() {
      return source();
    }
    decodeAudioData(_buffer: ArrayBuffer, ok: (buffer: unknown) => void, _bad?: (error: unknown) => void) {
      // 同步回调，模拟解码完成；用递增 duration 区分合成 / 失败两段音源
      decoded += 1;
      ok({ duration: decoded });
    }
    resume() {
      return Promise.resolve();
    }
    close() {
      return Promise.resolve();
    }
  }
  const fakeWindow = {
    AudioContext: FakeAudioContext,
    atob: (value: string) => globalThis.atob(value),
  } as unknown as Window;

  const audio = createAudio({ w: fakeWindow });
  // 未 unlock 前不创建 AudioContext，也不播放（自动播放策略）
  audio.play('merge');
  assert.equal(created, 0);
  assert.equal(started, 0);

  audio.unlock();
  assert.equal(created, 1, 'unlock 后才创建 AudioContext');
  assert.equal(decoded, 2, 'unlock 时应同时解码合成音效与失败音效');

  audio.play('move');
  audio.play('invalid');
  audio.play('undo');
  assert.equal(started, 0, '普通移动 / 无效移动 / 撤销不发声');

  audio.play('merge');
  assert.equal(started, 1, '普通合成播放一次');
  audio.play('special');
  assert.equal(started, 2, '特殊合成播放一次');
  audio.play('win');
  assert.equal(started, 3);
  audio.play('truewin');
  assert.equal(started, 4);
  audio.play('over');
  assert.equal(started, 5, '本局结束播放一次失败音效');
  assert.equal(startedDurations.at(-1), 2, '失败 cue 应使用独立的失败音源');

  audio.setEnabled(false);
  audio.play('merge');
  audio.play('over');
  assert.equal(started, 5, '关闭音效后不再启动音源');
  audio.setEnabled(true);
  audio.play({ cue: 'merge', merges: 1, gained: 8 });
  assert.equal(started, 6);
  assert.equal(startedDurations.at(-1), 1, '合成 cue 仍使用合成音源');

  audio.destroy();
});

test('声音开关持久化：写入 jun2048.sound，新实例能恢复', () => {
  const map = new Map<string, string>();
  const kv: KV = {
    get: (key) => map.get(key) ?? null,
    set: (key, value) => {
      map.set(key, value);
    },
    remove: (key) => {
      map.delete(key);
    },
  };
  const first = createAudio({ w: null, kv, storageKey: 'jun2048' });
  assert.equal(first.enabled, true, '没有存档时默认开启');
  first.setEnabled(false);
  assert.equal(map.get('jun2048.sound'), 'off');

  const second = createAudio({ w: null, kv, storageKey: 'jun2048' });
  assert.equal(second.enabled, false, '重开后应恢复静音');
  second.setEnabled(true);
  assert.equal(map.get('jun2048.sound'), 'on');
});
