// Web Audio で合成する効果音。ユーザー操作（はじめるボタン）のあとに start() する。
// 告知動画の書き出しに対応するため、どの音も render(ctx, name, args, when) を通して鳴らす。
//  - 'level' : 滑走音・スイープ音（鳴りっぱなしの音）の音量を変える [speed, sweep]
//  - 'hit'   : ストーン同士の衝突 [power]
//  - 'throw' : 投げ出す音
//  - 'chime' : エンド終了の音 [good]

interface Loops {
  slide: GainNode;
  sweep: GainNode;
}

const loopsOf = new WeakMap<BaseAudioContext, Loops>();

function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function makeLoop(ctx: BaseAudioContext, buf: AudioBuffer, freq: number, q: number, type: BiquadFilterType, when: number): GainNode {
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.value = 0;
  src.connect(f).connect(g).connect(ctx.destination);
  src.start(when);
  return g;
}

function loops(ctx: BaseAudioContext, when: number): Loops {
  let l = loopsOf.get(ctx);
  if (!l) {
    const buf = noiseBuffer(ctx);
    // 滑走のゴロゴロ音（低い帯域）とスイープのシャッシャッ音（高い帯域）
    l = { slide: makeLoop(ctx, buf, 220, 0.9, 'lowpass', when), sweep: makeLoop(ctx, buf, 2600, 1.2, 'bandpass', when) };
    loopsOf.set(ctx, l);
  }
  return l;
}

export function renderSfx(ctx: BaseAudioContext, name: string, args: unknown[], when: number): void {
  if (name === 'level') {
    const [speed, sweep] = args as [number, number];
    const l = loops(ctx, when);
    l.slide.gain.setTargetAtTime(Math.min(0.5, speed * 0.18), when, 0.08);
    l.sweep.gain.setTargetAtTime(sweep * 0.22, when, 0.04);
  } else if (name === 'hit') {
    const [power] = args as [number];
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(900, when);
    o.frequency.exponentialRampToValueAtTime(260, when + 0.08);
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.min(0.6, 0.12 + power * 0.25), when);
    g.gain.exponentialRampToValueAtTime(0.001, when + 0.18);
    o.connect(g).connect(ctx.destination);
    o.start(when);
    o.stop(when + 0.2);
  } else if (name === 'throw') {
    // 押し出すときの「スーッ」
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(500, when);
    f.frequency.exponentialRampToValueAtTime(1500, when + 0.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.25, when + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.4);
    src.connect(f).connect(g).connect(ctx.destination);
    src.start(when);
    src.stop(when + 0.45);
  } else if (name === 'chime') {
    const [good] = args as [boolean];
    const notes = good ? [660, 880, 1320] : [440, 330];
    notes.forEach((fr, i) => {
      const t = when + i * 0.1;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = fr;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.4);
    });
  }
}

export class Sfx {
  private ctx: AudioContext | null = null;
  muted = false;
  /** 告知動画の撮影中は鳴らさずに記録する */
  capturing = false;
  private queue: { name: string; args: unknown[] }[] = [];
  private lastLevel = [-1, -1];

  start(): void {
    if (this.capturing) return;
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
    } catch {
      this.ctx = null;
    }
  }

  private play(name: string, args: unknown[]): void {
    if (this.capturing) {
      this.queue.push({ name, args });
      return;
    }
    if (!this.ctx || this.muted) return;
    renderSfx(this.ctx, name, args, this.ctx.currentTime);
  }

  /** speed: 動いている石の速さの合計（m/s）、sweep: 0〜1。変わったときだけ鳴らし直す */
  update(speed: number, sweep: number): void {
    const s = Math.round(speed * 50) / 50;
    const w = Math.round(sweep * 50) / 50;
    if (s === this.lastLevel[0] && w === this.lastLevel[1]) return;
    this.lastLevel = [s, w];
    this.play('level', [s, w]);
  }

  hit(power: number): void {
    this.play('hit', [power]);
  }

  throwSound(): void {
    this.play('throw', []);
  }

  chime(good: boolean): void {
    this.play('chime', [good]);
  }

  capture(on: boolean): void {
    this.capturing = on;
    this.queue = [];
    this.lastLevel = [-1, -1];
  }

  drain(): { name: string; args: unknown[] }[] {
    const q = this.queue;
    this.queue = [];
    return q;
  }
}
