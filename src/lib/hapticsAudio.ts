/**
 * MinaDental iOS 27 Tactile Haptics & Soft Acoustic Click Engine
 * Trace ID: TRC-MINA-QBANK-9008-H
 *
 * Provides subtle, zero-asset iOS-inspired Taptic click sound (Web Audio API)
 * and real device vibration feedback (Vibration API) for 1-handed interactions.
 */

export type TactileKind = 'tap' | 'soft' | 'dock' | 'drawer' | 'success' | 'warning';

const HAPTICS_KEY = 'minadental_ios27_haptics_enabled';
const SOUND_KEY = 'minadental_ios27_sound_enabled';

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!sharedAudioCtx) {
      sharedAudioCtx = new AudioCtx();
    }
    if (sharedAudioCtx.state === 'suspended') {
      sharedAudioCtx.resume().catch(() => {});
    }
    return sharedAudioCtx;
  } catch {
    return null;
  }
}

export function isHapticsEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const val = localStorage.getItem(HAPTICS_KEY);
    return val === null ? true : val === 'true';
  } catch {
    return true;
  }
}

export function setHapticsEnabled(enabled: boolean): void {
  try {
    if (typeof window !== 'undefined') {
      localStorage.setItem(HAPTICS_KEY, String(enabled));
    }
  } catch {
    // ignore storage errors
  }
}

export function isSoundEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const val = localStorage.getItem(SOUND_KEY);
    return val === null ? true : val === 'true';
  } catch {
    return true;
  }
}

export function setSoundEnabled(enabled: boolean): void {
  try {
    if (typeof window !== 'undefined') {
      localStorage.setItem(SOUND_KEY, String(enabled));
    }
  } catch {
    // ignore storage errors
  }
}

function triggerVibration(kind: TactileKind): void {
  if (!isHapticsEnabled()) return;
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try {
    switch (kind) {
      case 'soft':
        navigator.vibrate(6);
        break;
      case 'tap':
      case 'dock':
        navigator.vibrate(10);
        break;
      case 'drawer':
        navigator.vibrate([8, 22, 8]);
        break;
      case 'success':
        navigator.vibrate([10, 28, 14]);
        break;
      case 'warning':
        navigator.vibrate([20, 35, 20]);
        break;
    }
  } catch {
    // ignore unsupported device errors
  }
}

function triggerSoftAcoustic(kind: TactileKind): void {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    filter.type = 'bandpass';

    if (kind === 'success') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(660, now);
      osc.frequency.exponentialRampToValueAtTime(990, now + 0.065);
      filter.frequency.setValueAtTime(1400, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.045, now + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.085);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.09);
      return;
    }

    if (kind === 'warning') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(340, now);
      osc.frequency.exponentialRampToValueAtTime(240, now + 0.07);
      filter.frequency.setValueAtTime(600, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.05, now + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.085);
      return;
    }

    // Crisp iOS Taptic micro-click for tap / dock / soft / drawer
    const startFreq = kind === 'dock' ? 920 : kind === 'drawer' ? 760 : kind === 'soft' ? 680 : 840;
    const peakGain = kind === 'soft' ? 0.025 : 0.036;
    const duration = kind === 'drawer' ? 0.024 : 0.016;

    osc.type = 'sine';
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(220, now + duration);

    filter.frequency.setValueAtTime(1250, now);
    filter.Q.setValueAtTime(1.1, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(peakGain, now + 0.0025);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.005);
  } catch {
    // ignore Web Audio restriction before first gesture
  }
}

export function playTactileFeedback(kind: TactileKind = 'tap'): void {
  triggerVibration(kind);
  triggerSoftAcoustic(kind);
}
