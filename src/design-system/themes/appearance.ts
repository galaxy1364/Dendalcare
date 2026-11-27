import { useEffect, useState } from 'react';
import { CORE_PALETTE, DARK_PALETTE } from '@/design-system/tokens/colors';
import { resolveSurfaceTokens } from '@/design-system/tokens/surfaces';
import { detectPlatformFromUA } from '@/platform/capabilities';

export type ThemeMode = 'light' | 'dark' | 'system';
export type FontScaleMode = 'compact' | 'default' | 'large' | 'xlarge' | 'double';
export type MotionMode = 'system' | 'reduce' | 'full';
export type AuroraBackdropMode = 'live' | 'low_power' | 'static';
export type DensityMode = 'compact' | 'comfortable' | 'spacious';
export type PlatformDesignLanguage = 'auto' | 'apple' | 'material' | 'fluent';
export type ResolvedPlatformDesign = 'apple' | 'material' | 'fluent';

export interface AppearanceSettings {
  themeMode: ThemeMode;
  resolvedTheme: 'light' | 'dark';
  fontScale: FontScaleMode;
  motionMode: MotionMode;
  resolvedReduceMotion: boolean;
  auroraMode: AuroraBackdropMode;
  resolvedAuroraMode: AuroraBackdropMode;
  density: DensityMode;
  platformDesign: PlatformDesignLanguage;
  resolvedPlatformDesign: ResolvedPlatformDesign;
  isLargeText: boolean;
}

const THEME_KEY = 'minadental_appearance_theme_v2';
const FONT_SCALE_KEY = 'minadental_appearance_font_scale_v2';
const MOTION_KEY = 'minadental_appearance_motion_v2';
const AURORA_KEY = 'minadental_appearance_aurora_v2';
const DENSITY_KEY = 'minadental_appearance_density_v1';
const PLATFORM_DESIGN_KEY = 'minadental_appearance_platform_design_v1';
const APPEARANCE_EVENT = 'minadental-appearance-changed';

const FONT_SCALE_PX: Record<FontScaleMode, string> = {
  compact: '14.5px',
  default: '16px',
  large: '18px',
  xlarge: '20px',
  double: '32px',
};

const DENSITY_TOKENS: Record<
  DensityMode,
  { cardPad: string; sectionGap: string; rowGap: string; touchMin: string }
> = {
  compact: { cardPad: '10px', sectionGap: '8px', rowGap: '6px', touchMin: '44px' },
  comfortable: { cardPad: '14px', sectionGap: '12px', rowGap: '10px', touchMin: '44px' },
  spacious: { cardPad: '18px', sectionGap: '16px', rowGap: '14px', touchMin: '48px' },
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
    if (
      val === 'compact' ||
      val === 'default' ||
      val === 'large' ||
      val === 'xlarge' ||
      val === 'double'
    ) {
      return val;
    }
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

export function getAuroraBackdropMode(): AuroraBackdropMode {
  if (typeof window === 'undefined') return 'live';
  try {
    const val = localStorage.getItem(AURORA_KEY);
    if (val === 'live' || val === 'low_power' || val === 'static') return val;
  } catch {
    // ignore
  }
  return 'live';
}

export function getDensityMode(): DensityMode {
  if (typeof window === 'undefined') return 'comfortable';
  try {
    const val = localStorage.getItem(DENSITY_KEY);
    if (val === 'compact' || val === 'comfortable' || val === 'spacious') return val;
  } catch {
    // ignore
  }
  return 'comfortable';
}

export function getPlatformDesignLanguage(): PlatformDesignLanguage {
  if (typeof window === 'undefined') return 'auto';
  try {
    const val = localStorage.getItem(PLATFORM_DESIGN_KEY);
    if (val === 'auto' || val === 'apple' || val === 'material' || val === 'fluent') return val;
  } catch {
    // ignore
  }
  return 'auto';
}

export function resolvePlatformDesign(
  mode: PlatformDesignLanguage,
  userAgent?: string
): ResolvedPlatformDesign {
  if (mode !== 'auto') return mode;
  const ua = userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '');
  const info = detectPlatformFromUA(ua, {
    viewportWidth: typeof window !== 'undefined' ? window.innerWidth : 390,
  });
  if (info.platform === 'ios' || info.platform === 'ipad' || info.platform === 'macos') return 'apple';
  if (info.platform === 'android') return 'material';
  if (info.platform === 'windows') return 'fluent';
  return 'apple';
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

export function resolveEffectiveAuroraMode(
  auroraMode: AuroraBackdropMode,
  reduceMotion: boolean
): AuroraBackdropMode {
  if (reduceMotion || auroraMode === 'static') return 'static';
  if (auroraMode === 'low_power') return 'low_power';
  if (typeof navigator !== 'undefined') {
    const conn = (navigator as unknown as { connection?: { saveData?: boolean } }).connection;
    if (conn?.saveData) return 'low_power';
  }
  return 'live';
}

export function getAppearanceSettings(): AppearanceSettings {
  const themeMode = getThemeMode();
  const fontScale = getFontScaleMode();
  const motionMode = getMotionMode();
  const resolvedReduceMotion = resolveReduceMotion(motionMode);
  const auroraMode = getAuroraBackdropMode();
  const density = getDensityMode();
  const platformDesign = getPlatformDesignLanguage();

  return {
    themeMode,
    resolvedTheme: resolveTheme(themeMode),
    fontScale,
    motionMode,
    resolvedReduceMotion,
    auroraMode,
    resolvedAuroraMode: resolveEffectiveAuroraMode(auroraMode, resolvedReduceMotion),
    density,
    platformDesign,
    resolvedPlatformDesign: resolvePlatformDesign(platformDesign),
    isLargeText: fontScale === 'large' || fontScale === 'xlarge' || fontScale === 'double',
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
  root.setAttribute('data-text-scale-200', settings.fontScale === 'double' ? 'true' : 'false');
  root.setAttribute('data-reduce-motion', settings.resolvedReduceMotion ? 'true' : 'false');
  root.setAttribute('data-aurora-mode', settings.resolvedAuroraMode);
  root.setAttribute('data-density', settings.density);
  root.setAttribute('data-platform-design', settings.resolvedPlatformDesign);
  root.style.fontSize = FONT_SCALE_PX[settings.fontScale] || '16px';

  const densityTok = DENSITY_TOKENS[settings.density] ?? DENSITY_TOKENS.comfortable;
  root.style.setProperty('--md-density-card-pad', densityTok.cardPad);
  root.style.setProperty('--md-density-section-gap', densityTok.sectionGap);
  root.style.setProperty('--md-density-row-gap', densityTok.rowGap);
  root.style.setProperty('--md-touch-min', densityTok.touchMin);

  const surfaceTok = resolveSurfaceTokens(settings.resolvedPlatformDesign, settings.resolvedTheme);
  root.style.setProperty('--surface-glass-bg', surfaceTok.glassBg);
  root.style.setProperty('--surface-glass-elevated', surfaceTok.glassElevated);
  root.style.setProperty('--surface-glass-border', surfaceTok.glassBorder);
  root.style.setProperty('--surface-specular', surfaceTok.specularHighlight);
  root.style.setProperty('--surface-blur', surfaceTok.blurRadius);
  root.style.setProperty('--surface-shadow', surfaceTok.elevationShadow);
  root.style.setProperty('--surface-header-bg', surfaceTok.headerBg);
  root.style.setProperty('--surface-dock-bg', surfaceTok.dockBg);
  root.style.setProperty('--radius-card', surfaceTok.cardRadius);
  root.style.setProperty('--radius-btn', surfaceTok.controlRadius);

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
  root.style.setProperty('--md-muted-surface', palette.mutedSurface);
  root.style.setProperty('--md-on-primary', settings.resolvedTheme === 'dark' ? DARK_PALETTE.background : CORE_PALETTE.surface);
  root.style.setProperty('--md-on-critical', settings.resolvedTheme === 'dark' ? DARK_PALETTE.background : CORE_PALETTE.surface);
  root.style.setProperty('--md-on-navy', CORE_PALETTE.surface);

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

export function setAuroraBackdropMode(mode: AuroraBackdropMode): void {
  try {
    if (typeof window !== 'undefined') localStorage.setItem(AURORA_KEY, mode);
  } catch {
    // ignore
  }
  notifyAppearanceChanged();
}

export function setDensityMode(mode: DensityMode): void {
  try {
    if (typeof window !== 'undefined') localStorage.setItem(DENSITY_KEY, mode);
  } catch {
    // ignore
  }
  notifyAppearanceChanged();
}

export function setPlatformDesignLanguage(mode: PlatformDesignLanguage): void {
  try {
    if (typeof window !== 'undefined') localStorage.setItem(PLATFORM_DESIGN_KEY, mode);
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
