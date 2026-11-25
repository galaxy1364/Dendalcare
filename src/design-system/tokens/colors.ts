// Single Source of Truth Color Tokens (Phase 06 — Design System)
// Primary: #087C76 | Navy: #142E43 | Background: #F4F7F9 | Surface: #FFFFFF
// Text: #14283B | Secondary: #526779 | Critical: #AD293C | Warning: #92510C | Success: #176B52

export const CORE_PALETTE = Object.freeze({
  primary: '#087C76',
  navy: '#142E43',
  background: '#F4F7F9',
  surface: '#FFFFFF',
  text: '#14283B',
  secondary: '#526779',
  critical: '#AD293C',
  warning: '#92510C',
  success: '#176B52',
  border: '#D8E2EA',
  borderSubtle: '#E6EEF4',
  mutedSurface: '#EEF3F7',
});

export const DARK_PALETTE = Object.freeze({
  primary: '#2DD4BF',
  navy: '#0D1B2A',
  background: '#0A141E',
  surface: '#11202E',
  text: '#F1F5F9',
  secondary: '#9FB1C1',
  critical: '#FB7185',
  warning: '#FBBF24',
  success: '#34D399',
  border: '#25394D',
  borderSubtle: '#1B2D3E',
  mutedSurface: '#162738',
});

export type ModuleTokenId =
  | 'dashboard'
  | 'patients'
  | 'appointments'
  | 'calendar'
  | 'treatments'
  | 'lab'
  | 'implants'
  | 'finance'
  | 'inventory'
  | 'reminders'
  | 'staff'
  | 'messages'
  | 'settings';

export interface ModuleColorToken {
  id: ModuleTokenId;
  /** Restricted accent color for active badges/icons only (13 strictly unique hues) */
  primary: string;
  primaryDark: string;
  surfaceTintStart: string;
  surfaceTintEnd: string;
  surfaceBorder: string;
  lightColor: string;
  orbSecondary: string;
}

export interface SemanticStatusToken {
  bg: string;
  border: string;
  text: string;
  accent: string;
}

export const DAYLIGHT_SURFACE_TOKENS = Object.freeze({
  canvasBg: CORE_PALETTE.background,
  cardBg: CORE_PALETTE.surface,
  cardGlassBg: 'rgba(255, 255, 255, 0.96)',
  cardMutedBg: CORE_PALETTE.mutedSurface,
  borderSubtle: CORE_PALETTE.borderSubtle,
  borderStrong: CORE_PALETTE.border,
  textPrimary: CORE_PALETTE.text,
  textSecondary: CORE_PALETTE.navy,
  textMuted: CORE_PALETTE.secondary,
});

export const SEMANTIC_STATUS_TOKENS: Record<
  'success' | 'warning' | 'danger' | 'info',
  SemanticStatusToken
> = Object.freeze({
  success: {
    bg: '#ECFDF5',
    border: '#A7F3D0',
    text: CORE_PALETTE.success,
    accent: CORE_PALETTE.success,
  },
  warning: {
    bg: '#FFFBEB',
    border: '#FDE68A',
    text: CORE_PALETTE.warning,
    accent: CORE_PALETTE.warning,
  },
  danger: {
    bg: '#FFF1F2',
    border: '#FECDD3',
    text: CORE_PALETTE.critical,
    accent: CORE_PALETTE.critical,
  },
  info: {
    bg: '#EFF6FF',
    border: '#BFDBFE',
    text: CORE_PALETTE.navy,
    accent: CORE_PALETTE.primary,
  },
});

export const NOTIFICATION_SURFACE_TOKENS = Object.freeze({
  drawerBg: CORE_PALETTE.background,
  cardBg: CORE_PALETTE.surface,
  headerBg: CORE_PALETTE.surface,
  border: CORE_PALETTE.border,
  titleColor: CORE_PALETTE.text,
  bodyColor: CORE_PALETTE.secondary,
  scrimColor: 'rgba(20, 46, 67, 0.52)',
  urgency: {
    critical: {
      accent: CORE_PALETTE.critical,
      bg: '#FFF1F2',
      border: '#FDA4AF',
      text: CORE_PALETTE.critical,
    },
    today: {
      accent: CORE_PALETTE.warning,
      bg: '#FFFBEB',
      border: '#FCD34D',
      text: CORE_PALETTE.warning,
    },
    upcoming: {
      accent: CORE_PALETTE.primary,
      bg: '#F0FDFA',
      border: '#99F6E4',
      text: '#0F524E',
    },
    normal: {
      accent: CORE_PALETTE.navy,
      bg: '#F4F7F9',
      border: CORE_PALETTE.border,
      text: CORE_PALETTE.navy,
    },
  } as Record<'critical' | 'today' | 'upcoming' | 'normal', SemanticStatusToken>,
});

// Module hues kept strictly distinct and used only as constrained accent chips/borders
export const MODULE_COLOR_TOKENS: Record<ModuleTokenId, ModuleColorToken> = Object.freeze({
  dashboard: {
    id: 'dashboard',
    primary: '#087C76',
    primaryDark: '#065A56',
    surfaceTintStart: '#F2FBFA',
    surfaceTintEnd: '#E2F5F3',
    surfaceBorder: '#B8E5E1',
    lightColor: '#CCFBF1',
    orbSecondary: '#14B8A6',
  },
  patients: {
    id: 'patients',
    primary: '#176B52',
    primaryDark: '#0F4B39',
    surfaceTintStart: '#F2FBF7',
    surfaceTintEnd: '#DFF5EA',
    surfaceBorder: '#B7E4CE',
    lightColor: '#D1FAE5',
    orbSecondary: '#34D399',
  },
  appointments: {
    id: 'appointments',
    primary: '#92510C',
    primaryDark: '#6B3B08',
    surfaceTintStart: '#FFFDF5',
    surfaceTintEnd: '#FEF1D6',
    surfaceBorder: '#FDE0A6',
    lightColor: '#FEF3C7',
    orbSecondary: '#F59E0B',
  },
  calendar: {
    id: 'calendar',
    primary: '#8E24AA',
    primaryDark: '#64167A',
    surfaceTintStart: '#FCF5FF',
    surfaceTintEnd: '#F4E4FC',
    surfaceBorder: '#E5BDF7',
    lightColor: '#F3E8FF',
    orbSecondary: '#C084FC',
  },
  treatments: {
    id: 'treatments',
    primary: '#5B3CC4',
    primaryDark: '#3E278E',
    surfaceTintStart: '#F7F5FF',
    surfaceTintEnd: '#EBE6FD',
    surfaceBorder: '#D2C8FA',
    lightColor: '#EDE9FE',
    orbSecondary: '#8B5CF6',
  },
  lab: {
    id: 'lab',
    primary: '#B02364',
    primaryDark: '#7C1645',
    surfaceTintStart: '#FFF5F9',
    surfaceTintEnd: '#FCE3EE',
    surfaceBorder: '#F7C2DA',
    lightColor: '#FCE7F3',
    orbSecondary: '#F472B6',
  },
  implants: {
    id: 'implants',
    primary: '#0E7490',
    primaryDark: '#0A5164',
    surfaceTintStart: '#F2FCFE',
    surfaceTintEnd: '#DCF4FA',
    surfaceBorder: '#B0E3F0',
    lightColor: '#CFFAFE',
    orbSecondary: '#22D3EE',
  },
  finance: {
    id: 'finance',
    primary: '#15803D',
    primaryDark: '#0F592A',
    surfaceTintStart: '#F3FCF6',
    surfaceTintEnd: '#DFF7E7',
    surfaceBorder: '#B9EAC9',
    lightColor: '#DCFCE7',
    orbSecondary: '#4ADE80',
  },
  inventory: {
    id: 'inventory',
    primary: '#B45309',
    primaryDark: '#7D3906',
    surfaceTintStart: '#FFF9F2',
    surfaceTintEnd: '#FDEBD6',
    surfaceBorder: '#F9D3A7',
    lightColor: '#FFEDD5',
    orbSecondary: '#FB923C',
  },
  reminders: {
    id: 'reminders',
    primary: '#AD293C',
    primaryDark: '#7B1A28',
    surfaceTintStart: '#FFF5F6',
    surfaceTintEnd: '#FDE3E7',
    surfaceBorder: '#F8C1C9',
    lightColor: '#FFE4E6',
    orbSecondary: '#FB7185',
  },
  staff: {
    id: 'staff',
    primary: '#3B4DB8',
    primaryDark: '#283584',
    surfaceTintStart: '#F4F6FF',
    surfaceTintEnd: '#E3E7FC',
    surfaceBorder: '#C4CCF8',
    lightColor: '#E0E7FF',
    orbSecondary: '#818CF8',
  },
  messages: {
    id: 'messages',
    primary: '#0369A1',
    primaryDark: '#024B73',
    surfaceTintStart: '#F2FAFF',
    surfaceTintEnd: '#DFEFFC',
    surfaceBorder: '#B5DBF7',
    lightColor: '#E0F2FE',
    orbSecondary: '#38BDF8',
  },
  settings: {
    id: 'settings',
    primary: '#142E43',
    primaryDark: '#0C1E2D',
    surfaceTintStart: '#F4F7F9',
    surfaceTintEnd: '#E6EDF2',
    surfaceBorder: '#CAD6E0',
    lightColor: '#E2E8F0',
    orbSecondary: '#64748B',
  },
});

export function getModuleToken(id: ModuleTokenId): ModuleColorToken {
  return MODULE_COLOR_TOKENS[id] ?? MODULE_COLOR_TOKENS.dashboard;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '').trim();
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const num = parseInt(full, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

export function getRelativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function computeWcagContrastRatio(fgHex: string, bgHex: string): number {
  const l1 = getRelativeLuminance(fgHex);
  const l2 = getRelativeLuminance(bgHex);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return Number(((lighter + 0.05) / (darker + 0.05)).toFixed(2));
}
