import type { WeaponCategory } from '../shared/types';

class SoundEngine {
  private ctx: AudioContext | null = null;
  public muted = false;

  private ensureContext(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => undefined);
    }
    return this.ctx;
  }

  public setMuted(mute: boolean) {
    this.muted = mute;
  }

  public playShoot(category: WeaponCategory) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;

    if (category === 'melee') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(420, now);
      osc.frequency.exponentialRampToValueAtTime(110, now + 0.14);
      gain.gain.setValueAtTime(0.16, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.15);
      return;
    }

    // Filtered noise burst for ballistic snap
    const dur = category === 'sniper' ? 0.28 : category === 'shotgun' ? 0.24 : category === 'special' ? 0.32 : 0.11;
    const bufferSize = Math.floor(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.28));
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(
      category === 'sniper' ? 750 : category === 'shotgun' ? 520 : category === 'smg' ? 1600 : 1150,
      now
    );
    filter.Q.value = 1.2;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(category === 'sniper' ? 0.34 : 0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    noise.connect(filter).connect(gain).connect(ctx.destination);
    noise.start(now);

    // Low punch oscillator
    const punch = ctx.createOscillator();
    const pGain = ctx.createGain();
    punch.type = 'triangle';
    punch.frequency.setValueAtTime(category === 'sniper' ? 160 : 120, now);
    punch.frequency.exponentialRampToValueAtTime(38, now + 0.09);
    pGain.gain.setValueAtTime(0.24, now);
    pGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    punch.connect(pGain).connect(ctx.destination);
    punch.start(now);
    punch.stop(now + 0.1);
  }

  public playHit(headshot = false) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = headshot ? 'sine' : 'triangle';
    osc.frequency.setValueAtTime(headshot ? 1280 : 620, now);
    osc.frequency.exponentialRampToValueAtTime(headshot ? 1860 : 320, now + 0.08);
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.09);
  }

  public playReload() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    [0, 0.14].forEach((offset, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(idx === 0 ? 320 : 540, now + offset);
      gain.gain.setValueAtTime(0.08, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.06);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.06);
    });
  }

  public playPickup() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.12);
    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.14);
  }

  public playExplosion() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const bufferSize = Math.floor(ctx.sampleRate * 0.45);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.35));
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(340, now);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.36, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(now);
  }

  public playVictory() {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    [440, 554.37, 659.25, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + i * 0.09);
      gain.gain.setValueAtTime(0.14, now + i * 0.09);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.09 + 0.35);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.09);
      osc.stop(now + i * 0.09 + 0.36);
    });
  }
}

export const soundEngine = new SoundEngine();
