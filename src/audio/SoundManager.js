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
    this.ambient = null; // { nodes... } for the current track's ambient bed
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

  /** Rising pitch sweep for a boost-pad trigger. */
  playBoost() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.3);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc.connect(gain).connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.35);
  }

  /** Deeper, longer noise burst than a regular crash — used on elimination. */
  playExplosion() {
    if (!this.ctx) return;
    const dur = 0.6;
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate * dur, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 0.6;
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(500, this.ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(120, this.ctx.currentTime + dur);
    const gain = this.ctx.createGain();
    gain.gain.value = 0.9;
    noise.connect(filter).connect(gain).connect(this.masterGain);
    noise.start();
  }

  /**
   * Continuous low-volume filtered-noise bed, tuned per theme category so
   * each track has a distinct atmosphere under the engine/crash SFX. Only
   * one ambient bed plays at a time — starting a new one stops the last.
   */
  startAmbient(theme) {
    if (!this.ctx) return;
    this.stopAmbient();

    const PRESETS = {
      desert_canyon: { freq: 700, gain: 0.05, hum: null },
      volcano: { freq: 300, gain: 0.07, hum: 55 },
      ice_glacier: { freq: 1200, gain: 0.045, hum: null },
      neon_city: { freq: 500, gain: 0.05, hum: 110 },
      junkyard: { freq: 650, gain: 0.05, hum: null },
      jungle_ruins: { freq: 900, gain: 0.05, hum: null },
      construction_site: { freq: 550, gain: 0.05, hum: 80 },
      space_station: { freq: 1500, gain: 0.035, hum: 60 },
      storm_coast: { freq: 400, gain: 0.08, hum: null },
      haunted_circuit: { freq: 850, gain: 0.045, hum: 40 },
    };
    const p = PRESETS[theme] ?? { freq: 700, gain: 0.05, hum: null };

    const bufferSize = this.ctx.sampleRate * 2;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = p.freq;

    const gain = this.ctx.createGain();
    gain.gain.value = p.gain;

    noise.connect(filter).connect(gain).connect(this.masterGain);
    noise.start();

    let hum = null;
    if (p.hum) {
      hum = this.ctx.createOscillator();
      hum.type = 'sine';
      hum.frequency.value = p.hum;
      const humGain = this.ctx.createGain();
      humGain.gain.value = p.gain * 0.4;
      hum.connect(humGain).connect(this.masterGain);
      hum.start();
      hum._gain = humGain;
    }

    this.ambient = { noise, hum };
  }

  stopAmbient() {
    if (!this.ambient) return;
    this.ambient.noise.stop();
    this.ambient.hum?.stop();
    this.ambient = null;
  }
}
