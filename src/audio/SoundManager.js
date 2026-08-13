/**
 * Procedural sound via Web Audio API — no external audio files, matching
 * the rest of the game's zero-asset-pipeline approach. Engine notes and
 * crash noise are synthesized on the fly.
 */
export class SoundManager {
  constructor() {
    this.ctx = null;
    this.engines = new Map(); // car -> { osc, gain }
    this.masterGain = null;
  }

  /** Must be called from a user-gesture handler (browser autoplay policy). */
  unlock() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.35;
    this.masterGain.connect(this.ctx.destination);
  }

  /** Starts a continuous engine oscillator for a car; call once per race per car. */
  startEngine(car) {
    if (!this.ctx || this.engines.has(car)) return;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 60;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain).connect(this.masterGain);
    osc.start();
    this.engines.set(car, { osc, gain });
  }

  stopEngine(car) {
    const e = this.engines.get(car);
    if (!e) return;
    e.osc.stop();
    this.engines.delete(car);
  }

  stopAllEngines() {
    for (const car of [...this.engines.keys()]) this.stopEngine(car);
  }

  /** Call every frame with the car's current speed (m/s). */
  updateEngine(car, speed, eliminated) {
    const e = this.engines.get(car);
    if (!e || !this.ctx) return;
    const now = this.ctx.currentTime;
    const targetFreq = 60 + Math.min(speed, 25) * 9;
    e.osc.frequency.setTargetAtTime(targetFreq, now, 0.08);
    const targetGain = eliminated ? 0 : 0.08 + Math.min(speed, 25) * 0.004;
    e.gain.gain.setTargetAtTime(targetGain, now, 0.1);
  }

  /** Short noise burst for a crash impact; louder for harder hits. */
  playCrash(intensity = 1) {
    if (!this.ctx) return;
    const dur = 0.25;
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * dur, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 800 + intensity * 400;

    const gain = this.ctx.createGain();
    gain.gain.value = Math.min(1, 0.3 + intensity * 0.5);

    noise.connect(filter).connect(gain).connect(this.masterGain);
    noise.start();
  }
}
