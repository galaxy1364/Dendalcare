import {
  BarChart3,
  CalendarDays,
  CalendarPlus,
  Stethoscope,
  UserPlus,
} from 'lucide-react';
import { getSection, type SectionConfig } from '@/lib/sections';
import type { AppRouteId } from '@/lib/navigationStack';
import { PlatformHapticAdapter } from '@/platform/haptics';
import { canAccessRoute, type EffectiveClinicRole } from '@/services/permissions/accessControl';
import type { ContextualActionItem } from '@/design-system/primitives/AdaptiveLayout';

export type ShellSectionMeta = Omit<SectionConfig, 'id'> & { id: AppRouteId };

export function resolveShellSection(activeRoute: AppRouteId): ShellSectionMeta {
  switch (activeRoute) {
    case 'services':
      return { ...getSection('dashboard'), id: 'services', label: 'همه خدمات کلینیک' };
    case 'customize_services':
      return { ...getSection('dashboard'), id: 'customize_services', label: 'تنظیم ۴ خدمت منتخب' };
    case 'reports':
      return { ...getSection('finance'), id: 'reports', label: 'گزارش جامع کلینیک' };
    case 'patient_form':
      return { ...getSection('patients'), id: 'patient_form', label: 'ثبت بیمار جدید' };
    case 'appointment_form':
      return { ...getSection('appointments'), id: 'appointment_form', label: 'ثبت نوبت جدید' };
    case 'treatment_form':
      return { ...getSection('treatments'), id: 'treatment_form', label: 'ثبت طرح درمان' };
    default:
      return getSection(activeRoute);
  }
}

export function buildShellContextualActions(
  activeRoute: AppRouteId,
  effectiveRole: EffectiveClinicRole,
  navigate: (route: AppRouteId) => void
): ContextualActionItem[] {
  if (activeRoute === 'dashboard') return [];
  const items: ContextualActionItem[] = [];

  if (canAccessRoute(effectiveRole, 'patient_form')) {
    items.push({
      id: 'new_patient',
      label: 'بیمار جدید',
      icon: <UserPlus size={13} />,
      accent: '#087C76',
      onClick: () => {
        PlatformHapticAdapter.selection();
        navigate('patient_form');
      },
    });
  }
  if (canAccessRoute(effectiveRole, 'appointment_form')) {
    items.push({
      id: 'new_appointment',
      label: 'نوبت جدید',
      icon: <CalendarPlus size={13} />,
      accent: '#0369A1',
      onClick: () => {
        PlatformHapticAdapter.selection();
        navigate('appointment_form');
      },
    });
  }
  if (activeRoute !== 'treatments' && canAccessRoute(effectiveRole, 'treatment_form')) {
    items.push({
      id: 'new_treatment',
      label: 'طرح درمان',
      icon: <Stethoscope size={13} />,
      accent: '#5B3CC4',
      onClick: () => {
        PlatformHapticAdapter.selection();
        navigate('treatment_form');
      },
    });
  }
  if (activeRoute !== 'calendar' && canAccessRoute(effectiveRole, 'calendar')) {
    items.push({
      id: 'open_calendar',
      label: 'تقویم شمسی',
      icon: <CalendarDays size={13} />,
      accent: '#92510C',
      onClick: () => {
        PlatformHapticAdapter.selection();
        navigate('calendar');
      },
    });
  }
  if (activeRoute !== 'reports' && canAccessRoute(effectiveRole, 'reports')) {
    items.push({
      id: 'open_reports',
      label: 'گزارش جامع',
      icon: <BarChart3 size={13} />,
      accent: '#176B52',
      onClick: () => {
        PlatformHapticAdapter.selection();
        navigate('reports');
      },
    });
  }

  return items.slice(0, 4);
}
