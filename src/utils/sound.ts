// Synthesized acoustic chess sound effects using the Web Audio API (zero external asset failures)
class SoundFX {
  private ctx: AudioContext | null = null;
  public enabled = true;

  private getCtx(): AudioContext | null {
    if (!this.enabled || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private playTone(freq: number, duration: number, type: OscillatorType = 'triangle', gainVal = 0.14, delay = 0) {
    const ctx = this.getCtx();
    if (!ctx) return;
    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.55), now + duration);

    gain.gain.setValueAtTime(gainVal, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration);
  }

  move() {
    this.playTone(260, 0.065, 'triangle', 0.16);
  }

  capture() {
    this.playTone(185, 0.09, 'sawtooth', 0.15);
    this.playTone(320, 0.05, 'triangle', 0.1, 0.015);
  }

  castle() {
    this.playTone(250, 0.06, 'triangle', 0.14);
    this.playTone(300, 0.06, 'triangle', 0.14, 0.08);
  }

  check() {
    this.playTone(540, 0.12, 'sine', 0.16);
    this.playTone(680, 0.14, 'sine', 0.12, 0.05);
  }

  victory() {
    this.playTone(440, 0.12, 'triangle', 0.14, 0);
    this.playTone(554.37, 0.12, 'triangle', 0.14, 0.09);
    this.playTone(659.25, 0.22, 'triangle', 0.16, 0.18);
  }

  defeat() {
    this.playTone(330, 0.14, 'sine', 0.12, 0);
    this.playTone(260, 0.22, 'sine', 0.12, 0.11);
  }

  error() {
    this.playTone(160, 0.14, 'sawtooth', 0.12);
  }
}

export const soundFX = new SoundFX();
