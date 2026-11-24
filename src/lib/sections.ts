import {
  LayoutDashboard,
  Users,
  CalendarDays,
  CalendarRange,
  Stethoscope,
  FlaskConical,
  Anchor,
  Wallet,
  Package,
  BellRing,
  Settings,
  UserCog,
  MessageSquare,
  type LucideIcon,
} from 'lucide-react';
import { MODULE_COLOR_TOKENS, type ModuleTokenId } from './designTokens';

export type SectionId = ModuleTokenId;

export type SectionConfig = {
  id: SectionId;
  label: string;
  icon: LucideIcon;
  color: string;
  lightColor: string;
  darkColor: string;
  surfaceTintStart: string;
  surfaceTintEnd: string;
  surfaceBorder: string;
  orbSecondary: string;
  gradient: string;
  themeClass: string;
};

const SECTION_META: Array<{ id: SectionId; label: string; icon: LucideIcon; gradient: string }> = [
  { id: 'dashboard',    label: 'داشبورد',      icon: LayoutDashboard, gradient: 'from-blue-500 to-blue-700' },
  { id: 'patients',     label: 'بیماران',      icon: Users,           gradient: 'from-emerald-500 to-emerald-700' },
  { id: 'appointments', label: 'نوبت‌دهی',     icon: CalendarDays,    gradient: 'from-amber-500 to-amber-700' },
  { id: 'calendar',     label: 'تقویم فارسی',  icon: CalendarRange,   gradient: 'from-fuchsia-500 to-purple-700' },
  { id: 'treatments',   label: 'درمان‌ها',     icon: Stethoscope,     gradient: 'from-violet-500 to-violet-700' },
  { id: 'lab',          label: 'لابراتوار',    icon: FlaskConical,    gradient: 'from-pink-500 to-pink-700' },
  { id: 'implants',     label: 'ایمپلنت',      icon: Anchor,          gradient: 'from-cyan-500 to-cyan-700' },
  { id: 'finance',      label: 'مالی',         icon: Wallet,          gradient: 'from-green-500 to-green-700' },
  { id: 'inventory',    label: 'انبار',        icon: Package,         gradient: 'from-orange-500 to-orange-700' },
  { id: 'reminders',    label: 'یادآوری',      icon: BellRing,        gradient: 'from-rose-500 to-rose-700' },
  { id: 'staff',        label: 'پرسنل',        icon: UserCog,         gradient: 'from-indigo-500 to-indigo-700' },
  { id: 'messages',     label: 'پیام‌ها',      icon: MessageSquare,   gradient: 'from-sky-500 to-sky-700' },
  { id: 'settings',     label: 'تنظیمات',      icon: Settings,        gradient: 'from-slate-500 to-slate-700' },
];

export const SECTIONS: SectionConfig[] = SECTION_META.map((m) => {
  const tok = MODULE_COLOR_TOKENS[m.id];
  return {
    id: m.id,
    label: m.label,
    icon: m.icon,
    color: tok.primary,
    lightColor: tok.lightColor,
    darkColor: tok.primaryDark,
    surfaceTintStart: tok.surfaceTintStart,
    surfaceTintEnd: tok.surfaceTintEnd,
    surfaceBorder: tok.surfaceBorder,
    orbSecondary: tok.orbSecondary,
    gradient: m.gradient,
    themeClass: `theme-${m.id}`,
  };
});

export const getSection = (id: SectionId): SectionConfig =>
  SECTIONS.find((s) => s.id === id) ?? SECTIONS[0];
