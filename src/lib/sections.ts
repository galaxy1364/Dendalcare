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

export type SectionId =
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

export type SectionConfig = {
  id: SectionId;
  label: string;
  icon: LucideIcon;
  color: string;
  lightColor: string;
  darkColor: string;
  gradient: string;
  themeClass: string;
};

export const SECTIONS: SectionConfig[] = [
  { id: 'dashboard', label: 'داشبورد', icon: LayoutDashboard, color: '#3B82F6', lightColor: '#DBEAFE', darkColor: '#1E40AF', gradient: 'from-blue-400 to-blue-600', themeClass: 'theme-dashboard' },
  { id: 'patients', label: 'بیماران', icon: Users, color: '#10B981', lightColor: '#D1FAE5', darkColor: '#065F46', gradient: 'from-emerald-400 to-emerald-600', themeClass: 'theme-patients' },
  { id: 'appointments', label: 'نوبت‌دهی', icon: CalendarDays, color: '#F59E0B', lightColor: '#FEF3C7', darkColor: '#92400E', gradient: 'from-amber-400 to-amber-600', themeClass: 'theme-appointments' },
  { id: 'calendar', label: 'تقویم فارسی', icon: CalendarRange, color: '#D946EF', lightColor: '#FAE8FF', darkColor: '#86198F', gradient: 'from-fuchsia-500 to-purple-600', themeClass: 'theme-treatments' },
  { id: 'treatments', label: 'درمان‌ها', icon: Stethoscope, color: '#8B5CF6', lightColor: '#EDE9FE', darkColor: '#5B21B6', gradient: 'from-violet-400 to-violet-600', themeClass: 'theme-treatments' },
  { id: 'lab', label: 'لابراتوار', icon: FlaskConical, color: '#EC4899', lightColor: '#FCE7F3', darkColor: '#9F1239', gradient: 'from-pink-400 to-pink-600', themeClass: 'theme-lab' },
  { id: 'implants', label: 'ایمپلنت', icon: Anchor, color: '#06B6D4', lightColor: '#CFFAFE', darkColor: '#0E7490', gradient: 'from-cyan-400 to-cyan-600', themeClass: 'theme-implants' },
  { id: 'finance', label: 'مالی', icon: Wallet, color: '#22C55E', lightColor: '#DCFCE7', darkColor: '#15803D', gradient: 'from-green-400 to-green-600', themeClass: 'theme-finance' },
  { id: 'inventory', label: 'انبار', icon: Package, color: '#F97316', lightColor: '#FFEDD5', darkColor: '#9A3412', gradient: 'from-orange-400 to-orange-600', themeClass: 'theme-inventory' },
  { id: 'reminders', label: 'یادآوری', icon: BellRing, color: '#EF4444', lightColor: '#FEE2E2', darkColor: '#991B1B', gradient: 'from-red-400 to-red-600', themeClass: 'theme-reminders' },
  { id: 'staff', label: 'پرسنل', icon: UserCog, color: '#6366F1', lightColor: '#E0E7FF', darkColor: '#3730A3', gradient: 'from-indigo-400 to-indigo-600', themeClass: 'theme-staff' },
  { id: 'messages', label: 'پیام‌ها', icon: MessageSquare, color: '#0EA5E9', lightColor: '#E0F2FE', darkColor: '#075985', gradient: 'from-sky-400 to-sky-600', themeClass: 'theme-messages' },
  { id: 'settings', label: 'تنظیمات', icon: Settings, color: '#64748B', lightColor: '#F1F5F9', darkColor: '#334155', gradient: 'from-slate-400 to-slate-600', themeClass: 'theme-settings' },
];

export const getSection = (id: SectionId): SectionConfig =>
  SECTIONS.find((s) => s.id === id) ?? SECTIONS[0];
