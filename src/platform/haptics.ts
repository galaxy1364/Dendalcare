/**
 * Platform Haptic Adapter (Phase 07 — iOS-Inspired Interaction & Honest Capabilities)
 * - Selection, Light Impact, Medium/Heavy Impact, Success, Warning, Error
 * - Automatic deduplication/throttling to avoid double haptics
 * - Synthetic click audio is OFF by default
 * - Uses native Android View bridge on APK, WKWebView messageHandler on native iOS host,
 *   and standard navigator.vibrate fallback on supported browsers.
 *   Never falsely claims Taptic Engine / CoreHaptics inside iOS Safari PWA.
 */

export type TactileKind = 'tap' | 'soft' | 'dock' | 'drawer' | 'success' | 'warning' | 'error';
export type HapticImpactStyle = 'light' | 'medium' | 'heavy';
export type HapticPattern =
  | 'selection'
  | 'impact_light'
  | 'impact_medium'
  | 'impact_heavy'
  | 'success'
  | 'warning'
  | 'error';

const HAPTICS_KEY = 'minadental_ios27_haptics_enabled';
const SOUND_KEY = 'minadental_ios27_sound_enabled';
const MIN_HAPTIC_GAP_MS = 55;

let sharedAudioCtx: AudioContext | null = null;
let lastHapticTimestamp = 0;
let lastHapticPattern: HapticPattern | null = null;

interface NativeHostWindow extends Window {
  AndroidBridge?: {
    performHaptic?: (kind: string) => void;
  };
  webkit?: {
    messageHandlers?: {
      minaHaptics?: {
        postMessage: (payload: { pattern: HapticPattern }) => void;
      };
    };
  };
}

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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
    // ignore
  }
}

/** Synthetic sound effects are strictly OFF by default per Phase 07 */
export function isSoundEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(SOUND_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setSoundEnabled(enabled: boolean): void {
  try {
    if (typeof window !== 'undefined') {
      localStorage.setItem(SOUND_KEY, String(enabled));
    }
  } catch {
    // ignore
  }
}

function shouldDeduplicate(pattern: HapticPattern, nowMs: number): boolean {
  if (nowMs - lastHapticTimestamp < MIN_HAPTIC_GAP_MS) {
    if (lastHapticPattern === pattern || (pattern !== 'success' && pattern !== 'error')) {
      return true;
    }
  }
  lastHapticTimestamp = nowMs;
  lastHapticPattern = pattern;
  return false;
}

function triggerAndroidNativeHaptic(pattern: HapticPattern): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const bridge = (window as NativeHostWindow).AndroidBridge;
    if (bridge && typeof bridge.performHaptic === 'function') {
      bridge.performHaptic(pattern);
      return true;
    }
  } catch {
    // ignore bridge errors
  }
  return false;
}

function triggerIosNativeHaptic(pattern: HapticPattern): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const handler = (window as NativeHostWindow).webkit?.messageHandlers?.minaHaptics;
    if (handler && typeof handler.postMessage === 'function') {
      handler.postMessage({ pattern });
      return true;
    }
  } catch {
    // ignore WKWebView handler errors
  }
  return false;
}

function triggerVibration(pattern: HapticPattern): void {
  if (!isHapticsEnabled()) return;
  if (triggerAndroidNativeHaptic(pattern)) return;
  if (triggerIosNativeHaptic(pattern)) return;

  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try {
    switch (pattern) {
      case 'selection':
      case 'impact_light':
        navigator.vibrate(6);
        break;
      case 'impact_medium':
        navigator.vibrate(11);
        break;
      case 'impact_heavy':
        navigator.vibrate(18);
        break;
      case 'success':
        navigator.vibrate([10, 28, 14]);
        break;
      case 'warning':
        navigator.vibrate([20, 35, 20]);
        break;
      case 'error':
        navigator.vibrate([28, 30, 28, 30, 36]);
        break;
    }
  } catch {
    // ignore unsupported browsers
  }
}

function triggerSoftAcoustic(pattern: HapticPattern): void {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';

    if (pattern === 'success') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(660, now);
      osc.frequency.exponentialRampToValueAtTime(990, now + 0.065);
      filter.frequency.setValueAtTime(1400, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.04, now + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.085);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.09);
      return;
    }

    if (pattern === 'warning' || pattern === 'error') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(pattern === 'error' ? 280 : 340, now);
      osc.frequency.exponentialRampToValueAtTime(pattern === 'error' ? 160 : 240, now + 0.085);
      filter.frequency.setValueAtTime(560, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.05, now + 0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.095);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.1);
      return;
    }

    const startFreq =
      pattern === 'impact_heavy'
        ? 620
        : pattern === 'impact_medium'
        ? 780
        : pattern === 'selection'
        ? 900
        : 700;
    const peakGain = pattern === 'impact_light' || pattern === 'selection' ? 0.02 : 0.03;
    const duration = pattern === 'impact_heavy' ? 0.022 : 0.015;

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
    // ignore
  }
}

function dispatchPattern(pattern: HapticPattern): void {
  if (shouldDeduplicate(pattern, Date.now())) return;
  triggerVibration(pattern);
  triggerSoftAcoustic(pattern);
}

export const PlatformHapticAdapter = {
  selection(): void {
    dispatchPattern('selection');
  },
  lightImpact(): void {
    dispatchPattern('impact_light');
  },
  impact(style: HapticImpactStyle = 'light'): void {
    const pattern: HapticPattern =
      style === 'heavy' ? 'impact_heavy' : style === 'medium' ? 'impact_medium' : 'impact_light';
    dispatchPattern(pattern);
  },
  success(): void {
    dispatchPattern('success');
  },
  warning(): void {
    dispatchPattern('warning');
  },
  error(): void {
    dispatchPattern('error');
  },
};

export const HapticEngine = PlatformHapticAdapter;

export function playTactileFeedback(kind: TactileKind = 'tap'): void {
  switch (kind) {
    case 'soft':
      HapticEngine.impact('light');
      break;
    case 'dock':
      HapticEngine.selection();
      break;
    case 'drawer':
      HapticEngine.impact('heavy');
      break;
    case 'success':
      HapticEngine.success();
      break;
    case 'warning':
      HapticEngine.warning();
      break;
    case 'error':
      HapticEngine.error();
      break;
    case 'tap':
    default:
      HapticEngine.impact('light');
      break;
  }
}
