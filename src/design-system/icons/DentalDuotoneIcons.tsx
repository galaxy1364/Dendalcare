import type { ReactNode } from 'react';
import type { SectionId } from '@/lib/sections';
import type { AppRouteId } from '@/lib/navigationStack';

export interface DuotoneIconProps {
  size?: number;
  primaryColor?: string;
  secondaryColor?: string;
  className?: string;
}

/**
 * FIX 03 — Custom Filled Duotone SVG Icon Library for MinaDental
 *
 * Crisp dark-body + vibrant-accent Filled Duotone SVGs (28px–32px target)
 * matching QBank visual density while staying 100% dental-clinic specific.
 */

export function DuotoneDashboardIcon({
  size = 28,
  primaryColor = '#142E43',
  secondaryColor = '#14B8A6',
  className = '',
}: DuotoneIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <rect x="4" y="4" width="11" height="13" rx="4" fill={primaryColor} />
      <rect x="17" y="4" width="11" height="9" rx="4" fill={secondaryColor} />
      <rect x="4" y="19" width="11" height="9" rx="4" fill={secondaryColor} opacity="0.9" />
      <rect x="17" y="15" width="11" height="13" rx="4" fill={primaryColor} />
      <circle cx="22.5" cy="21.5" r="2.2" fill="#FFFFFF" />
    </svg>
  );
}

export function DuotonePatientsIcon({
  size = 28,
  primaryColor = '#142E43',
  secondaryColor = '#34D399',
  className = '',
}: DuotoneIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <rect x="4" y="6" width="24" height="20" rx="6" fill={primaryColor} />
      <circle cx="20.5" cy="13.5" r="3.4" fill={secondaryColor} />
      <path d="M14.5 23c.6-3 2.8-4.6 6-4.6s5.4 1.6 6 4.6" fill={secondaryColor} />
      <rect x="7.5" y="11.5" width="6.5" height="2.4" rx="1.2" fill="#FFFFFF" opacity="0.9" />
      <rect x="7.5" y="16" width="5" height="2.4" rx="1.2" fill={secondaryColor} />
    </svg>
  );
}

export function DuotoneAppointmentsIcon({
  size = 28,
  primaryColor = '#142E43',
  secondaryColor = '#F59E0B',
  className = '',
}: DuotoneIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <rect x="4" y="6.5" width="24" height="20.5" rx="6" fill={primaryColor} />
      <rect x="4" y="6.5" width="24" height="6.5" rx="4" fill={secondaryColor} />
      <rect x="9" y="3.5" width="3" height="5.5" rx="1.5" fill={primaryColor} />
      <rect x="20" y="3.5" width="3" height="5.5" rx="1.5" fill={primaryColor} />
      <circle cx="16" cy="20" r="5" fill={secondaryColor} />
      <path d="M16 17.5V20.2L17.8 21.4" stroke={primaryColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function DuotoneCalendarIcon({
  size = 28,
  primaryColor = '#142E43',
  secondaryColor = '#C084FC',
  className = '',
}: DuotoneIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <rect x="4" y="6" width="24" height="21" rx="6" fill={primaryColor} />
      <path d="M4 11.5C4 8.46 6.46 6 9.5 6H22.5C25.54 6 28 8.46 28 11.5V13H4V11.5Z" fill={secondaryColor} />
      <rect x="9.5" y="3.5" width="2.8" height="5" rx="1.4" fill={primaryColor} />
      <rect x="19.7" y="3.5" width="2.8" height="5" rx="1.4" fill={primaryColor} />
      <rect x="8.5" y="16" width="4" height="3.5" rx="1.2" fill="#FFFFFF" opacity="0.92" />
      <rect x="14" y="16" width="4" height="3.5" rx="1.2" fill={secondaryColor} />
      <rect x="19.5" y="16" width="4" height="3.5" rx="1.2" fill="#FFFFFF" opacity="0.92" />
      <rect x="8.5" y="21" width="4" height="3.5" rx="1.2" fill={secondaryColor} />
      <rect x="14" y="21" width="4" height="3.5" rx="1.2" fill="#FFFFFF" opacity="0.92" />
    </svg>
  );
}

export function DuotoneTreatmentsIcon({
  size = 28,
  primaryColor = '#142E43',
  secondaryColor = '#8B5CF6',
  className = '',
}: DuotoneIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <path
        d="M9.8 6.5C7 6.5 5 9 5.3 12.4c.3 3.4 1.7 5.5 2.3 9.2.5 3.1 1.4 4.9 3 4.9 1.3 0 1.9-1.7 2.8-4.2.5-1.3 1.4-2 2.6-2s2.1.7 2.6 2c.9 2.5 1.5 4.2 2.8 4.2 1.6 0 2.5-1.8 3-4.9.6-3.7 2-5.8 2.3-9.2.3-3.4-1.7-5.9-4.5-5.9-2.2 0-3.7 1.1-6.2 1.1s-4-1.1-6.2-1.1Z"
        fill={primaryColor}
      />
      <circle cx="23.5" cy="23.5" r="5.5" fill={secondaryColor} />
      <path d="M23.5 21V26M21 23.5H26" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" />
      <path d="M11 11.5c1.5 0 2.3.5 3 .5" stroke={secondaryColor} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function DuotoneLabIcon({
  size = 28,
  primaryColor = '#142E43',
  secondaryColor = '#F472B6',
  className = '',
}: DuotoneIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <path d="M11.5 5H20.5V7.5H19V13L25.5 22.8C26.7 24.6 25.4 27 23.2 27H8.8C6.6 27 5.3 24.6 6.5 22.8L13 13V7.5H11.5V5Z" fill={primaryColor} />
      <path d="M9.6 20.5H22.4L24.1 23.1C24.7 24 24.1 25.2 23 25.2H9C7.9 25.2 7.3 24 7.9 23.1L9.6 20.5Z" fill={secondaryColor} />
      <circle cx="15" cy="16.5" r="1.5" fill={secondaryColor} />
      <circle cx="18.2" cy="18.2" r="1.1" fill="#FFFFFF" />
    </svg>
  );
}

export function DuotoneImplantsIcon({
  size = 28,
  primaryColor = '#142E43',
  secondaryColor = '#22D3EE',
  className = '',
}: DuotoneIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      {/* Prosthetic crown cap */}
      <path d="M9 5.5C9 4.4 9.9 3.5 11 3.5H21C22.1 3.5 23 4.4 23 5.5V9.5C23 11 21.8 12 20.5 12H11.5C10.2 12 9 11 9 9.5V5.5Z" fill={secondaryColor} />
      {/* Abutment collar */}
      <rect x="12" y="13.2" width="8" height="2.6" rx="1.3" fill={primaryColor} />
      {/* Titanium threaded fixture */}
      <path d="M11 17.5H21L20.3 20H11.7L11 17.5Z" fill={primaryColor} />
      <path d="M11.8 21.3H20.2L19.5 23.8H12.5L11.8 21.3Z" fill={primaryColor} />
      <path d="M12.9 25.1H19.1L17.4 28.5H14.6L12.9 25.1Z" fill={secondaryColor} />
    </svg>
  );
}

export function DuotoneFinanceIcon({
  size = 28,
  primaryColor = '#142E43',
  secondaryColor = '#4ADE80',
  className = '',
}: DuotoneIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <rect x="5" y="5" width="20" height="12" rx="4" fill={secondaryColor} />
      <rect x="4" y="9" width="24" height="18" rx="5.5" fill={primaryColor} />
      <rect x="19" y="15" width="10" height="6" rx="3" fill={secondaryColor} />
      <circle cx="22.5" cy="18" r="1.5" fill={primaryColor} />
      <rect x="8.5" y="14" width="7.5" height="2.2" rx="1.1" fill="#FFFFFF" opacity="0.85" />
    </svg>
  );
}

export function DuotoneInventoryIcon({
  size = 28,
  primaryColor = '#142E43',
  secondaryColor = '#FB923C',
  className = '',
}: DuotoneIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <path d="M5 10L16 4.5L27 10V22L16 27.5L5 22V10Z" fill={primaryColor} />
      <path d="M5 10L16 15.5L27 10L16 4.5L5 10Z" fill={secondaryColor} />
      <rect x="14.5" y="17.5" width="3" height="6.5" rx="1" fill="#FFFFFF" opacity="0.9" />
      <rect x="12.8" y="19.2" width="6.5" height="3" rx="1" fill={secondaryColor} />
    </svg>
  );
}

export function DuotoneRemindersIcon({
  size = 28,
  primaryColor = '#142E43',
  secondaryColor = '#FB7185',
  className = '',
}: DuotoneIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <path d="M16 5C11.3 5 8 8.4 8 13V18.5L5.8 21.8C5.3 22.6 5.9 23.6 6.8 23.6H25.2C26.1 23.6 26.7 22.6 26.2 21.8L24 18.5V13C24 8.4 20.7 5 16 5Z" fill={primaryColor} />
      <path d="M13.2 25C13.7 26.5 14.8 27.4 16 27.4C17.2 27.4 18.3 26.5 18.8 25H13.2Z" fill={secondaryColor} />
      <circle cx="24" cy="8.5" r="4" fill={secondaryColor} />
    </svg>
  );
}

export function DuotoneStaffIcon({
  size = 28,
  primaryColor = '#142E43',
  secondaryColor = '#818CF8',
  className = '',
}: DuotoneIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <circle cx="13" cy="10.5" r="4.5" fill={primaryColor} />
      <path d="M5 25.5C5.6 20.4 8.8 17.5 13 17.5C17.2 17.5 20.4 20.4 21 25.5H5Z" fill={primaryColor} />
      <circle cx="22.5" cy="12" r="3.5" fill={secondaryColor} />
      <path d="M20.5 18.5C24 18.8 26.4 21.2 27 25.5H22.2" fill={secondaryColor} />
    </svg>
  );
}

export function DuotoneMessagesIcon({
  size = 28,
  primaryColor = '#142E43',
  secondaryColor = '#38BDF8',
  className = '',
}: DuotoneIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <rect x="4" y="6" width="24" height="17" rx="6" fill={primaryColor} />
      <path d="M10 22.5V27.5L15.8 22.5H10Z" fill={primaryColor} />
      <rect x="8.5" y="11" width="15" height="2.6" rx="1.3" fill={secondaryColor} />
      <rect x="8.5" y="15.5" width="10" height="2.6" rx="1.3" fill="#FFFFFF" opacity="0.9" />
    </svg>
  );
}

export function DuotoneSettingsIcon({
  size = 28,
  primaryColor = '#142E43',
  secondaryColor = '#64748B',
  className = '',
}: DuotoneIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <rect x="5" y="7" width="22" height="5" rx="2.5" fill={primaryColor} />
      <circle cx="20.5" cy="9.5" r="3.5" fill={secondaryColor} />
      <rect x="5" y="14.5" width="22" height="5" rx="2.5" fill={primaryColor} />
      <circle cx="11.5" cy="17" r="3.5" fill={secondaryColor} />
      <rect x="5" y="22" width="22" height="5" rx="2.5" fill={primaryColor} />
      <circle cx="21" cy="24.5" r="3.5" fill={secondaryColor} />
    </svg>
  );
}

export function DuotoneServicesGridIcon({
  size = 28,
  primaryColor = '#142E43',
  secondaryColor = '#14B8A6',
  className = '',
}: DuotoneIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <rect x="5" y="5" width="9.5" height="9.5" rx="3.5" fill={primaryColor} />
      <rect x="17.5" y="5" width="9.5" height="9.5" rx="3.5" fill={secondaryColor} />
      <rect x="5" y="17.5" width="9.5" height="9.5" rx="3.5" fill={secondaryColor} />
      <rect x="17.5" y="17.5" width="9.5" height="9.5" rx="3.5" fill={primaryColor} />
    </svg>
  );
}

export function DuotoneReportsIcon({
  size = 28,
  primaryColor = '#142E43',
  secondaryColor = '#6366F1',
  className = '',
}: DuotoneIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <rect x="4" y="5" width="24" height="22" rx="6" fill={primaryColor} />
      <rect x="8.5" y="16" width="3.8" height="7" rx="1.5" fill={secondaryColor} />
      <rect x="14.1" y="12" width="3.8" height="11" rx="1.5" fill="#FFFFFF" />
      <rect x="19.7" y="9" width="3.8" height="14" rx="1.5" fill={secondaryColor} />
    </svg>
  );
}

export function DuotoneCallerIdIcon({
  size = 28,
  primaryColor = '#142E43',
  secondaryColor = '#10B981',
  className = '',
}: DuotoneIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <path
        d="M8.5 6.5C7.4 6.5 6.5 7.4 6.5 8.5C6.5 18.4 13.6 25.5 23.5 25.5C24.6 25.5 25.5 24.6 25.5 23.5V19.6C25.5 18.6 24.8 17.8 23.8 17.6L20.1 17C19.2 16.8 18.3 17.2 17.8 18L16.8 19.6C14.1 18.3 13.7 17.9 12.4 15.2L14 14.2C14.8 13.7 15.2 12.8 15 11.9L14.4 8.2C14.2 7.2 13.4 6.5 12.4 6.5H8.5Z"
        fill={primaryColor}
      />
      <path d="M19 7C22.3 7 25 9.7 25 13" stroke={secondaryColor} strokeWidth="2.4" strokeLinecap="round" />
      <path d="M19 10.6C20.3 10.6 21.4 11.7 21.4 13" stroke={secondaryColor} strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

const DUOTONE_ICON_MAP: Record<AppRouteId, (p: DuotoneIconProps) => ReactNode> = {
  dashboard: (p) => <DuotoneDashboardIcon {...p} />,
  patients: (p) => <DuotonePatientsIcon {...p} />,
  appointments: (p) => <DuotoneAppointmentsIcon {...p} />,
  calendar: (p) => <DuotoneCalendarIcon {...p} />,
  treatments: (p) => <DuotoneTreatmentsIcon {...p} />,
  lab: (p) => <DuotoneLabIcon {...p} />,
  implants: (p) => <DuotoneImplantsIcon {...p} />,
  finance: (p) => <DuotoneFinanceIcon {...p} />,
  inventory: (p) => <DuotoneInventoryIcon {...p} />,
  reminders: (p) => <DuotoneRemindersIcon {...p} />,
  staff: (p) => <DuotoneStaffIcon {...p} />,
  messages: (p) => <DuotoneMessagesIcon {...p} />,
  settings: (p) => <DuotoneSettingsIcon {...p} />,
  services: (p) => <DuotoneServicesGridIcon {...p} />,
  customize_services: (p) => <DuotoneServicesGridIcon {...p} />,
  reports: (p) => <DuotoneReportsIcon {...p} />,
  patient_form: (p) => <DuotonePatientsIcon {...p} />,
  appointment_form: (p) => <DuotoneAppointmentsIcon {...p} />,
  treatment_form: (p) => <DuotoneTreatmentsIcon {...p} />,
};

export function ModuleDuotoneIcon({
  id,
  size = 28,
  primaryColor,
  secondaryColor,
  className,
}: {
  id: AppRouteId;
  size?: number;
  primaryColor?: string;
  secondaryColor?: string;
  className?: string;
}) {
  const renderer = DUOTONE_ICON_MAP[id] || DUOTONE_ICON_MAP.dashboard;
  return <>{renderer({ size, primaryColor, secondaryColor, className })}</>;
}
