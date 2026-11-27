/**
 * Sound: one looping battle track and a handful of one-shots, mixed through a
 * limiter so stacked hits never clip. Nothing plays before the first gesture.
 */
const FILES = { music: "audio/music.mp3", hit: "audio/hit.mp3", shot: "audio/shot.mp3", levelup: "audio/levelup.mp3", roar: "audio/roar.mp3", dash: "audio/dash.mp3" };
/** Sounds without their own file reuse one, re-pitched. [file, rate, gain] */
const ALIAS = { hurt: ["hit", 0.55, 1.2], ult: ["levelup", 0.6, 1], boom: ["hit", 0.45, 1.3], pick: ["dash", 1.6, 0.6] };
const MIN_GAP = { hit: 0.06, shot: 0.07, hurt: 0.15, boom: 0.12 };

export class Sound {
  constructor() {
    this.on = true;
    this.ctx = null;
    this.buf = {};
    this.last = {};
    this.musicNode = null;
    this.wantMusic = false;
  }

  /** Call from a user gesture. Safe to call repeatedly. */
  async unlock() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const limiter = this.ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 4;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.15;
    this.master = this.ctx.createGain();
    this.master.gain.value = this.on ? 1 : 0;
    this.master.connect(limiter);
    limiter.connect(this.ctx.destination);
    await Promise.all(Object.entries(FILES).map(([name, url]) => this.load(name, url)));
    if (this.wantMusic) this.music(true);
  }

  async load(name, url) {
    try {
      const data = await (await fetch(url)).arrayBuffer();
      this.buf[name] = await new Promise((res, rej) => this.ctx.decodeAudioData(data, res, rej));
    } catch {
      /* a missing sound is silence, never a broken game */
    }
  }

  setOn(on) {
    this.on = on;
    if (this.master) this.master.gain.value = on ? 1 : 0;
  }

  play(name, vol = 1, rate = 1) {
    if (!this.ctx || !this.on) return;
    const now = this.ctx.currentTime;
    const gap = MIN_GAP[name] || 0;
    if (gap && now - (this.last[name] || 0) < gap) return;
    this.last[name] = now;
    const alias = ALIAS[name];
    const buffer = this.buf[alias ? alias[0] : name];
    if (!buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate * (alias ? alias[1] : 1);
    const gain = this.ctx.createGain();
    gain.gain.value = vol * (alias ? alias[2] : 1);
    src.connect(gain);
    gain.connect(this.master);
    src.start();
  }

  music(on) {
    this.wantMusic = on;
    if (!this.ctx) return;
    if (!on) {
      if (this.musicNode) {
        const { src, gain } = this.musicNode;
        gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
        src.stop(this.ctx.currentTime + 1.5);
        this.musicNode = null;
      }
      return;
    }
    if (this.musicNode || !this.buf.music) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buf.music;
    src.loop = true;
    // Skip the encoder padding at both ends so the loop point stays tight.
    src.loopStart = 0.06;
    src.loopEnd = Math.max(1, src.buffer.duration - 0.08);
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(0.55, this.ctx.currentTime, 0.8);
    src.connect(gain);
    gain.connect(this.master);
    src.start(0, 0.06);
    this.musicNode = { src, gain };
  }
}
