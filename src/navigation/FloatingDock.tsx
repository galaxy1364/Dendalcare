import { SECTIONS, type SectionId, getSection } from '@/lib/sections';
import { getModuleToken } from '@/design-system/tokens';
import { ModuleDuotoneIcon } from '@/design-system/icons/DentalDuotoneIcons';
import { PlatformHapticAdapter } from '@/platform/haptics';
import type { AppRouteId } from '@/lib/navigationStack';
import type { ClinicUserRole } from '@/lib/cloudSyncEngine';
import { canAccessRoute, type EffectiveClinicRole } from '@/services/permissions/accessControl';

interface FloatingDockProps {
  active: AppRouteId;
  onChange: (id: AppRouteId) => void;
  /** Direct standalone button action — FIX 04 navigates directly to `'services'` */
  onOpenServices?: () => void;
  userRole?: ClinicUserRole | EffectiveClinicRole;
}

/**
 * FIX 04 — Exact QBank Floating Pill Dock:
 * - Strictly 4 primary destinations inside the pill: خانه، نوبت‌ها، بیماران، مالی
 * - Treatments ('درمان') removed from the bottom dock (remains accessible in All Services & the app)
 * - Active destination renders an inner pill capsule containing BOTH icon + label
 * - Detached round All-Services button navigates DIRECTLY to `'services'` (zero intermediate overlay)
 */
export const QBANK_DOCK_PRIMARY_IDS: readonly SectionId[] = [
  'dashboard',
  'appointments',
  'patients',
  'finance',
];

const CLINICAL_ROLE_FALLBACK_TAB: SectionId = 'calendar';

/**
 * Role-aware QBank dock resolver:
 * Preserves 4-destination capsule geometry while removing/substituting unauthorized routes
 * (e.g., never exposing `'finance'` to `'dentist'`, `'assistant'`, or `'unauthorized'` roles).
 */
export function getRoleAdaptedDockIds(
  role: ClinicUserRole | EffectiveClinicRole | string | undefined
): SectionId[] {
  const resolved: SectionId[] = [];
  for (const id of QBANK_DOCK_PRIMARY_IDS) {
    if (canAccessRoute(role, id)) {
      resolved.push(id);
    } else if (
      id === 'finance' &&
      canAccessRoute(role, CLINICAL_ROLE_FALLBACK_TAB) &&
      !resolved.includes(CLINICAL_ROLE_FALLBACK_TAB)
    ) {
      resolved.push(CLINICAL_ROLE_FALLBACK_TAB);
    }
  }
  return resolved;
}

const DOCK_SHORT_LABELS: Record<SectionId, string> = {
  dashboard: 'خانه',
  appointments: 'نوبت‌ها',
  patients: 'بیماران',
  finance: 'مالی',
  calendar: 'تقویم',
  treatments: 'درمان',
  lab: 'لابراتوار',
  implants: 'ایمپلنت',
  inventory: 'انبار',
  reminders: 'یادآوری',
  staff: 'پرسنل',
  messages: 'پیام‌ها',
  settings: 'تنظیمات',
};

function resolveDockSection(route: AppRouteId): { sectionId: SectionId; label: string } {
  if (route === 'services' || route === 'customize_services') return { sectionId: 'dashboard', label: 'خدمات' };
  if (route === 'reports') return { sectionId: 'finance', label: 'گزارش' };
  if (route === 'patient_form') return { sectionId: 'patients', label: 'بیماران' };
  if (route === 'appointment_form') return { sectionId: 'appointments', label: 'نوبت‌ها' };
  if (route === 'treatment_form') return { sectionId: 'treatments', label: 'درمان' };
  return { sectionId: route, label: DOCK_SHORT_LABELS[route] || getSection(route).label };
}

export function FloatingDock({
  active,
  onChange,
  onOpenServices,
  userRole = 'assistant',
}: FloatingDockProps) {
  const visibleDockIds = getRoleAdaptedDockIds(userRole);
  const canOpenServices = canAccessRoute(userRole, 'services');
  if (visibleDockIds.length === 0 && !canOpenServices) return null;

  const isPrimaryActive = visibleDockIds.includes(active as SectionId);
  const { sectionId: resolvedSectionId, label: resolvedLabel } = resolveDockSection(active);
  const activeToken = getModuleToken(resolvedSectionId);
  const isServicesActive = active === 'services' || active === 'customize_services';

  return (
    <nav
      aria-label="ناوبری اصلی پایین"
      data-testid="floating_bottom_dock"
      className="shrink-0 z-30 md:hidden px-2.5 pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
    >
      <div className="max-w-xl mx-auto flex items-center gap-2" dir="rtl">
        {/* Main 4-Destination Role-Aware QBank Pill Bar */}
        {visibleDockIds.length > 0 && (
          <div
            className="bottom-dock flex-1 min-h-[58px] rounded-full flex items-center justify-between px-1.5 py-1 gap-1"
            data-testid="qbank_primary_pill_bar"
          >
            {visibleDockIds.map((id) => {
              const section = SECTIONS.find((s) => s.id === id) ?? getSection(id);
              const tok = getModuleToken(id);
              const isActive = active === id;
              const shortLabel = DOCK_SHORT_LABELS[id] || section.label;

              return (
                <button
                  key={section.id}
                  type="button"
                  data-testid={`dock_tab_${section.id}`}
                  onClick={() => {
                    PlatformHapticAdapter.selection();
                    onChange(section.id);
                  }}
                  aria-label={shortLabel}
                  aria-current={isActive ? 'page' : undefined}
                  className={`min-h-[48px] rounded-full flex items-center justify-center transition-all duration-200 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087C76] ${
                    isActive
                      ? 'flex-[1.55] px-3 gap-1.5 shadow-sm'
                      : 'flex-1 px-1.5 gap-1'
                  }`}
                  style={
                    isActive
                      ? {
                          background: tok.surfaceTintEnd,
                          border: `1.5px solid ${tok.surfaceBorder}`,
                          color: tok.primaryDark,
                        }
                      : {
                          background: 'transparent',
                          border: '1px solid transparent',
                          color: '#526779',
                        }
                  }
                >
                  <span className="shrink-0 flex items-center justify-center">
                    <ModuleDuotoneIcon
                      id={id}
                      size={isActive ? 22 : 21}
                      primaryColor={isActive ? tok.primaryDark : '#526779'}
                      secondaryColor={isActive ? tok.primary : '#94A3B8'}
                    />
                  </span>
                  <span
                    className={`leading-none whitespace-nowrap transition-all ${
                      isActive
                        ? 'text-[12.5px] font-black'
                        : 'text-[11.5px] font-bold opacity-90 dark:text-[#9FB1C1]'
                    }`}
                    style={isActive ? { color: tok.primaryDark } : undefined}
                  >
                    {shortLabel}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Standalone Detached Round All-Services Button (Direct Navigation to 'services') */}
        {canOpenServices && (
          <button
            type="button"
            onClick={() => {
              PlatformHapticAdapter.selection();
              if (onOpenServices) {
                onOpenServices();
              } else {
                onChange('services');
              }
            }}
            aria-label="همه خدمات کلینیک"
            data-testid="dock_more_button"
            className="w-[58px] h-[58px] rounded-full shrink-0 flex flex-col items-center justify-center transition-transform active:scale-92 bg-white dark:bg-[#11202E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#087C76]"
            style={{
              background: !isPrimaryActive
                ? `linear-gradient(155deg, ${activeToken.surfaceTintStart}, ${activeToken.surfaceTintEnd})`
                : undefined,
              border: !isPrimaryActive || isServicesActive
                ? `1.5px solid ${activeToken.surfaceBorder}`
                : '1px solid var(--md-border)',
              color: !isPrimaryActive ? activeToken.primaryDark : 'var(--md-text)',
              boxShadow: '0 6px 18px rgba(20, 46, 67, 0.10)',
            }}
          >
            <ModuleDuotoneIcon
              id={!isPrimaryActive ? active : 'services'}
              size={22}
              primaryColor={!isPrimaryActive ? activeToken.primaryDark : '#142E43'}
              secondaryColor={!isPrimaryActive ? activeToken.primary : '#087C76'}
            />
            <span className="text-[10.5px] font-extrabold mt-0.5 leading-none truncate max-w-[48px] dark:text-[#E2E8F0]">
              {!isPrimaryActive ? resolvedLabel : 'خدمات'}
            </span>
          </button>
        )}
      </div>
    </nav>
  );
}
