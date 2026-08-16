/**
 * 打印完成提示音：移植自安卓参考版 PrintSoundSynth。
 * 离线合成 PCM（22050 Hz 单声道 Float32），经 WebAudio 播放；
 * 12 种内置音效 + 随机内置 + 生成式旋律，与参考版同一套音符表。
 */

export const SAMPLE_RATE = 22050;

type Wave = 'sine' | 'triangle' | 'square' | 'noise';

interface Note {
  frequency: number;
  durationMs: number;
  volume?: number;      // 默认 0.55
  wave?: Wave;          // 默认 sine
  endFrequency?: number; // 默认 = frequency（扫频效果）
  gapMs?: number;        // 默认 12
}

export interface SoundOption { id: string; label: string; hint: string }

/** 设置页音效选项（off = 静音，random/generative 为特殊项） */
export const SOUND_OPTIONS: SoundOption[] = [
  { id: 'off', label: '静音', hint: '发送时不播放声音' },
  { id: 'paperTick', label: '纸张轻点', hint: '短促、克制的纸张点击' },
  { id: 'cleanChime', label: '清澈提示', hint: '两音确认铃' },
  { id: 'bubblePop', label: '气泡弹出', hint: '柔软上扬的气泡声' },
  { id: 'laserPulse', label: '激光脉冲', hint: '快速电子扫频' },
  { id: 'woodBlock', label: '木鱼轻敲', hint: '温和木质敲击' },
  { id: 'receiptRun', label: '小票出纸', hint: '模拟热敏机启动节奏' },
  { id: 'sparkle', label: '星光闪烁', hint: '三音轻盈琶音' },
  { id: 'waterDrop', label: '水滴确认', hint: '清亮下落音' },
  { id: 'successFanfare', label: '完成短曲', hint: '明快的成功提示' },
  { id: 'retroBeep', label: '复古终端', hint: '8-bit 双音提示' },
  { id: 'mechanical', label: '机械咔哒', hint: '打印机构件的短促节拍' },
  { id: 'bell', label: '桌面小铃', hint: '圆润单铃确认' },
  { id: 'random', label: '随机内置', hint: '每次从 12 种内置声音随机选择' },
  { id: 'generative', label: '随机生成', hint: '每次按本地算法生成不同旋律' },
];

const BUILTIN_IDS = SOUND_OPTIONS.filter((s) => !['off', 'random', 'generative'].includes(s.id)).map((s) => s.id);

function notesFor(id: string): Note[] {
  switch (id) {
    case 'paperTick': return [{ frequency: 1250, durationMs: 46, volume: 0.32, wave: 'noise', gapMs: 0 }];
    case 'cleanChime': return [
      { frequency: 659.25, durationMs: 110, volume: 0.48 },
      { frequency: 987.77, durationMs: 170, volume: 0.42, gapMs: 0 },
    ];
    case 'bubblePop': return [{ frequency: 330, durationMs: 150, volume: 0.5, endFrequency: 880, gapMs: 0 }];
    case 'laserPulse': return [{ frequency: 1600, durationMs: 170, volume: 0.34, wave: 'square', endFrequency: 240, gapMs: 0 }];
    case 'woodBlock': return [{ frequency: 230, durationMs: 68, volume: 0.55, wave: 'triangle', endFrequency: 170, gapMs: 0 }];
    case 'receiptRun': return [
      { frequency: 150, durationMs: 45, volume: 0.26, wave: 'square', gapMs: 18 },
      { frequency: 180, durationMs: 45, volume: 0.28, wave: 'square', gapMs: 18 },
      { frequency: 210, durationMs: 45, volume: 0.3, wave: 'square', gapMs: 8 },
      { frequency: 920, durationMs: 62, volume: 0.3, gapMs: 0 },
    ];
    case 'sparkle': return [
      { frequency: 784, durationMs: 70, volume: 0.34 },
      { frequency: 1046.5, durationMs: 80, volume: 0.36 },
      { frequency: 1568, durationMs: 130, volume: 0.3, gapMs: 0 },
    ];
    case 'waterDrop': return [{ frequency: 1180, durationMs: 190, volume: 0.42, endFrequency: 420, gapMs: 0 }];
    case 'successFanfare': return [
      { frequency: 523.25, durationMs: 90, volume: 0.4 },
      { frequency: 659.25, durationMs: 90, volume: 0.4 },
      { frequency: 783.99, durationMs: 190, volume: 0.44, gapMs: 0 },
    ];
    case 'retroBeep': return [
      { frequency: 440, durationMs: 75, volume: 0.3, wave: 'square' },
      { frequency: 880, durationMs: 105, volume: 0.28, wave: 'square', gapMs: 0 },
    ];
    case 'mechanical': return [
      { frequency: 105, durationMs: 38, volume: 0.42, wave: 'noise', gapMs: 22 },
      { frequency: 160, durationMs: 45, volume: 0.38, wave: 'square', gapMs: 20 },
      { frequency: 95, durationMs: 55, volume: 0.4, wave: 'noise', gapMs: 0 },
    ];
    case 'bell': return [{ frequency: 880, durationMs: 330, volume: 0.4, endFrequency: 872, gapMs: 0 }];
    default: return [];
  }
}

function generative(): Note[] {
  const scale = [392, 440, 493.88, 523.25, 587.33, 659.25, 783.99];
  const count = 3 + Math.floor(Math.random() * 3);
  const notes: Note[] = [];
  for (let i = 0; i < count; i++) {
    const base = scale[Math.floor(Math.random() * scale.length)] * (i === count - 1 ? 1.25 : 1);
    notes.push({
      frequency: base,
      durationMs: 55 + Math.floor(Math.random() * 85),
      volume: 0.34 + Math.random() * 0.25,
      wave: Math.random() < 0.5 ? 'sine' : 'triangle',
      endFrequency: base * (0.97 + Math.random() * 0.08),
      gapMs: 8 + Math.floor(Math.random() * 18),
    });
  }
  return notes;
}

/** 合成 PCM（与参考版同一算法：起音/释音包络 + 方波软化） */
export function synthesize(requestedId: string, sampleRate = SAMPLE_RATE): Float32Array {
  if (!requestedId || requestedId === 'off') return new Float32Array(0);
  const id = requestedId === 'random'
    ? BUILTIN_IDS[Math.floor(Math.random() * BUILTIN_IDS.length)]
    : requestedId;
  const notes = id === 'generative' ? generative() : notesFor(id);
  if (!notes.length) return new Float32Array(0);

  const total = Math.min(
    Math.max(notes.reduce((s, n) => s + Math.round(((n.durationMs + (n.gapMs ?? 12)) * sampleRate) / 1000), 0), 1),
    sampleRate * 2,
  );
  const output = new Float32Array(total);
  let cursor = 0;
  notes.forEach((note, noteIndex) => {
    const count = Math.max(1, Math.round((note.durationMs * sampleRate) / 1000));
    const attack = Math.max(1, Math.round(count * 0.08));
    const release = Math.max(1, Math.round(count * 0.28));
    const wave = note.wave ?? 'sine';
    const end = note.endFrequency ?? note.frequency;
    const volume = note.volume ?? 0.55;
    for (let i = 0; i < count; i++) {
      if (cursor + i >= output.length) break;
      const progress = i / count;
      const frequency = note.frequency + (end - note.frequency) * progress;
      const phase = (2 * Math.PI * frequency * i) / sampleRate;
      let osc: number;
      switch (wave) {
        case 'triangle': osc = (2 / Math.PI) * Math.asin(Math.sin(phase)); break;
        case 'square': osc = Math.sin(phase) >= 0 ? 1 : -1; break;
        case 'noise': osc = Math.random() * 2 - 1; break;
        default: osc = Math.sin(phase);
      }
      let envelope = 1;
      if (i < attack) envelope = i / attack;
      else if (i > count - release) envelope = (count - i) / release;
      envelope = Math.min(1, Math.max(0, envelope));
      const softened = wave === 'square' ? osc * 0.62 + Math.sin(phase) * 0.38 : osc;
      output[cursor + i] = softened * envelope * volume;
    }
    cursor += count + Math.round(((note.gapMs ?? 12) * sampleRate) / 1000);
    if (noteIndex === notes.length - 1) cursor = output.length;
  });
  return output;
}

let audioCtx: AudioContext | null = null;

/** 播放打印提示音（失败静默，不影响打印流程） */
export function playPrintSound(id: string): void {
  try {
    const samples = synthesize(id);
    if (!samples.length) return;
    audioCtx ??= new AudioContext();
    if (audioCtx.state === 'suspended') void audioCtx.resume();
    const buffer = audioCtx.createBuffer(1, samples.length, SAMPLE_RATE);
    buffer.copyToChannel(samples, 0);
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    source.start();
  } catch { /* 音频不可用时忽略 */ }
}
