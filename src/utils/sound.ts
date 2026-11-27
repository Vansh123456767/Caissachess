import { SoundThemeId } from '../types/chess';

// Synthesized acoustic chess sound effects + Voice Move Announcer (zero external asset failures)
class SoundFX {
  private ctx: AudioContext | null = null;
  public enabled = true;
  public theme: SoundThemeId = 'standard';

  private getCtx(): AudioContext | null {
    if (!this.enabled || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private playTone(
    freq: number,
    duration: number,
    type: OscillatorType = 'triangle',
    gainVal = 0.14,
    delay = 0
  ) {
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
    if (this.theme === 'wood') {
      this.playTone(170, 0.055, 'sine', 0.22);
      this.playTone(115, 0.04, 'triangle', 0.14, 0.008);
    } else if (this.theme === 'futuristic') {
      this.playTone(520, 0.06, 'sine', 0.12);
    } else if (this.theme === 'retro') {
      this.playTone(330, 0.045, 'square', 0.09);
      this.playTone(440, 0.035, 'square', 0.07, 0.025);
    } else if (this.theme === 'shogi') {
      this.playTone(135, 0.035, 'triangle', 0.24);
      this.playTone(95, 0.055, 'sine', 0.2, 0.006);
    } else {
      this.playTone(260, 0.065, 'triangle', 0.16);
    }
  }

  capture() {
    if (this.theme === 'wood') {
      this.playTone(140, 0.08, 'triangle', 0.25);
      this.playTone(220, 0.045, 'sine', 0.14, 0.01);
    } else if (this.theme === 'futuristic') {
      this.playTone(680, 0.05, 'sawtooth', 0.11);
      this.playTone(340, 0.08, 'sine', 0.13, 0.02);
    } else if (this.theme === 'retro') {
      this.playTone(520, 0.05, 'square', 0.1);
      this.playTone(220, 0.07, 'square', 0.09, 0.03);
    } else if (this.theme === 'shogi') {
      this.playTone(110, 0.045, 'triangle', 0.28);
      this.playTone(290, 0.03, 'sine', 0.15, 0.008);
    } else {
      this.playTone(185, 0.09, 'sawtooth', 0.15);
      this.playTone(320, 0.05, 'triangle', 0.1, 0.015);
    }
  }

  castle() {
    if (this.theme === 'wood') {
      this.playTone(165, 0.05, 'sine', 0.2);
      this.playTone(195, 0.05, 'sine', 0.2, 0.075);
    } else if (this.theme === 'futuristic') {
      this.playTone(460, 0.05, 'sine', 0.12);
      this.playTone(620, 0.07, 'sine', 0.12, 0.07);
    } else if (this.theme === 'retro') {
      this.playTone(392, 0.04, 'square', 0.08);
      this.playTone(523, 0.05, 'square', 0.08, 0.055);
    } else if (this.theme === 'shogi') {
      this.playTone(140, 0.04, 'triangle', 0.22);
      this.playTone(170, 0.04, 'triangle', 0.22, 0.07);
    } else {
      this.playTone(250, 0.06, 'triangle', 0.14);
      this.playTone(300, 0.06, 'triangle', 0.14, 0.08);
    }
  }

  check() {
    if (this.theme === 'futuristic') {
      this.playTone(760, 0.1, 'sine', 0.14);
      this.playTone(980, 0.12, 'sine', 0.11, 0.045);
    } else if (this.theme === 'retro') {
      this.playTone(660, 0.07, 'square', 0.1);
      this.playTone(880, 0.09, 'square', 0.09, 0.06);
    } else if (this.theme === 'shogi') {
      this.playTone(480, 0.09, 'triangle', 0.2);
      this.playTone(640, 0.1, 'sine', 0.14, 0.04);
    } else {
      this.playTone(540, 0.12, 'sine', 0.16);
      this.playTone(680, 0.14, 'sine', 0.12, 0.05);
    }
  }

  clockTick() {
    this.playTone(380, 0.035, 'triangle', 0.11);
  }

  lowTime() {
    this.playTone(720, 0.09, 'sine', 0.14);
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

export function sanToSpoken(san: string): string {
  if (!san) return '';
  let text = san;
  if (text.startsWith('O-O-O')) {
    text = text.replace('O-O-O', 'Castles queenside');
  } else if (text.startsWith('O-O')) {
    text = text.replace('O-O', 'Castles kingside');
  } else {
    text = text
      .replace(/^K/, 'King ')
      .replace(/^Q/, 'Queen ')
      .replace(/^R/, 'Rook ')
      .replace(/^B/, 'Bishop ')
      .replace(/^N/, 'Knight ')
      .replace(/x/g, ' takes ')
      .replace(/=Q/g, ' promotes to Queen')
      .replace(/=R/g, ' promotes to Rook')
      .replace(/=B/g, ' promotes to Bishop')
      .replace(/=N/g, ' promotes to Knight');
  }
  text = text.replace(/\+/g, ', check').replace(/#/g, ', checkmate');
  return text.trim();
}

export function announceMove(san: string, enabled?: boolean) {
  if (!enabled || !san || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(sanToSpoken(san));
    utter.rate = 1.15;
    utter.volume = 0.85;
    window.speechSynthesis.speak(utter);
  } catch {
    // Ignore speech synthesis restrictions
  }
}
