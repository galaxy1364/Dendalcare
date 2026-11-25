import { useEffect, useState } from 'react';
import { CORE_PALETTE, DARK_PALETTE } from '@/design-system/tokens/colors';

export type ThemeMode = 'light' | 'dark' | 'system';
export type FontScaleMode = 'compact' | 'default' | 'large' | 'xlarge';
export type MotionMode = 'system' | 'reduce' | 'full';

export interface AppearanceSettings {
  themeMode: ThemeMode;
  resolvedTheme: 'light' | 'dark';
  fontScale: FontScaleMode;
  motionMode: MotionMode;
  resolvedReduceMotion: boolean;
  isLargeText: boolean;
}

const THEME_KEY = 'minadental_appearance_theme_v2';
const FONT_SCALE_KEY = 'minadental_appearance_font_scale_v2';
const MOTION_KEY = 'minadental_appearance_motion_v2';
const APPEARANCE_EVENT = 'minadental-appearance-changed';

const FONT_SCALE_PX: Record<FontScaleMode, string> = {
  compact: '14.5px',
  default: '16px',
  large: '18px',
  xlarge: '20px',
};

export function getThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'system';
  try {
    const val = localStorage.getItem(THEME_KEY);
    if (val === 'light' || val === 'dark' || val === 'system') return val;
  } catch {
    // ignore storage access failure
  }
  return 'light';
}

export function getFontScaleMode(): FontScaleMode {
  if (typeof window === 'undefined') return 'default';
  try {
    const val = localStorage.getItem(FONT_SCALE_KEY);
    if (val === 'compact' || val === 'default' || val === 'large' || val === 'xlarge') return val;
  } catch {
    // ignore
  }
  return 'default';
}

export function getMotionMode(): MotionMode {
  if (typeof window === 'undefined') return 'system';
  try {
    const val = localStorage.getItem(MOTION_KEY);
    if (val === 'system' || val === 'reduce' || val === 'full') return val;
  } catch {
    // ignore
  }
  return 'system';
}

export function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'dark') return 'dark';
  if (mode === 'light') return 'light';
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

export function resolveReduceMotion(mode: MotionMode): boolean {
  if (mode === 'reduce') return true;
  if (mode === 'full') return false;
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  return false;
}

export function getAppearanceSettings(): AppearanceSettings {
  const themeMode = getThemeMode();
  const fontScale = getFontScaleMode();
  const motionMode = getMotionMode();
  return {
    themeMode,
    resolvedTheme: resolveTheme(themeMode),
    fontScale,
    motionMode,
    resolvedReduceMotion: resolveReduceMotion(motionMode),
    isLargeText: fontScale === 'large' || fontScale === 'xlarge',
  };
}

export function applyAppearanceToDocument(
  settings: AppearanceSettings = getAppearanceSettings()
): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.setAttribute('data-theme', settings.resolvedTheme);
  root.setAttribute('data-theme-mode', settings.themeMode);
  root.setAttribute('data-font-scale', settings.fontScale);
  root.setAttribute('data-large-text', settings.isLargeText ? 'true' : 'false');
  root.setAttribute('data-reduce-motion', settings.resolvedReduceMotion ? 'true' : 'false');
  root.style.fontSize = FONT_SCALE_PX[settings.fontScale] || '16px';

  const palette = settings.resolvedTheme === 'dark' ? DARK_PALETTE : CORE_PALETTE;
  root.style.setProperty('--md-primary', palette.primary);
  root.style.setProperty('--md-navy', palette.navy);
  root.style.setProperty('--md-bg', palette.background);
  root.style.setProperty('--md-surface', palette.surface);
  root.style.setProperty('--md-text', palette.text);
  root.style.setProperty('--md-secondary', palette.secondary);
  root.style.setProperty('--md-critical', palette.critical);
  root.style.setProperty('--md-warning', palette.warning);
  root.style.setProperty('--md-success', palette.success);
  root.style.setProperty('--md-border', palette.border);

  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.setAttribute(
      'content',
      settings.resolvedTheme === 'dark' ? DARK_PALETTE.background : CORE_PALETTE.background
    );
  }
}

function notifyAppearanceChanged(): void {
  const next = getAppearanceSettings();
  applyAppearanceToDocument(next);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(APPEARANCE_EVENT, { detail: next }));
  }
}

export function setThemeMode(mode: ThemeMode): void {
  try {
    if (typeof window !== 'undefined') localStorage.setItem(THEME_KEY, mode);
  } catch {
    // ignore
  }
  notifyAppearanceChanged();
}

export function setFontScaleMode(scale: FontScaleMode): void {
  try {
    if (typeof window !== 'undefined') localStorage.setItem(FONT_SCALE_KEY, scale);
  } catch {
    // ignore
  }
  notifyAppearanceChanged();
}

export function setMotionMode(mode: MotionMode): void {
  try {
    if (typeof window !== 'undefined') localStorage.setItem(MOTION_KEY, mode);
  } catch {
    // ignore
  }
  notifyAppearanceChanged();
}

let initialized = false;

export function initAppearanceEngine(): () => void {
  const settings = getAppearanceSettings();
  applyAppearanceToDocument(settings);

  if (typeof window === 'undefined' || initialized) {
    return () => {};
  }
  initialized = true;

  const darkMq = window.matchMedia?.('(prefers-color-scheme: dark)');
  const motionMq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const onSystemChange = () => notifyAppearanceChanged();

  darkMq?.addEventListener?.('change', onSystemChange);
  motionMq?.addEventListener?.('change', onSystemChange);

  return () => {
    darkMq?.removeEventListener?.('change', onSystemChange);
    motionMq?.removeEventListener?.('change', onSystemChange);
    initialized = false;
  };
}

export function useAppearanceSettings(): AppearanceSettings {
  const [state, setState] = useState<AppearanceSettings>(() => getAppearanceSettings());

  useEffect(() => {
    applyAppearanceToDocument(state);
    const onChanged = (e: Event) => {
      const detail = (e as CustomEvent<AppearanceSettings>)?.detail;
      setState(detail || getAppearanceSettings());
    };
    window.addEventListener(APPEARANCE_EVENT, onChanged);
    return () => window.removeEventListener(APPEARANCE_EVENT, onChanged);
  }, []);

  return state;
}
