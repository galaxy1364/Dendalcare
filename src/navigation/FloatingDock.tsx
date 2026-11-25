import { SECTIONS, type SectionId, getSection } from '@/lib/sections';
import { getModuleToken } from '@/design-system/tokens';
import { ModuleDuotoneIcon } from '@/design-system/icons/DentalDuotoneIcons';
import { PlatformHapticAdapter } from '@/platform/haptics';
import type { AppRouteId } from '@/lib/navigationStack';

interface FloatingDockProps {
  active: AppRouteId;
  onChange: (id: AppRouteId) => void;
  /** Direct standalone button action — FIX 04 navigates directly to `'services'` */
  onOpenServices?: () => void;
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

export function FloatingDock({ active, onChange, onOpenServices }: FloatingDockProps) {
  const isPrimaryActive = QBANK_DOCK_PRIMARY_IDS.includes(active as SectionId);
  const { sectionId: resolvedSectionId, label: resolvedLabel } = resolveDockSection(active);
  const activeToken = getModuleToken(resolvedSectionId);
  const isServicesActive = active === 'services' || active === 'customize_services';

  return (
    <nav
      aria-label="ناوبری اصلی پایین"
      data-testid="floating_bottom_dock"
      className="shrink-0 z-30 md:hidden px-2.5 pt-1 pb-2"
    >
      <div className="max-w-xl mx-auto flex items-center gap-2" dir="rtl">
        {/* Main 4-Destination QBank Pill Bar */}
        <div
          className="bottom-dock flex-1 rounded-full flex items-center justify-between px-1.5 py-1 gap-1"
          data-testid="qbank_primary_pill_bar"
        >
          {QBANK_DOCK_PRIMARY_IDS.map((id) => {
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
                className={`min-h-[46px] rounded-full flex items-center justify-center transition-all duration-200 active:scale-95 ${
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
                      : 'text-[10.5px] font-bold opacity-85 dark:text-[#9FB1C1]'
                  }`}
                  style={isActive ? { color: tok.primaryDark } : undefined}
                >
                  {shortLabel}
                </span>
              </button>
            );
          })}
        </div>

        {/* Standalone Detached Round All-Services Button (Direct Navigation to 'services') */}
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
          className="w-[54px] h-[54px] rounded-full shrink-0 flex flex-col items-center justify-center transition-transform active:scale-92 bg-white dark:bg-[#11202E]"
          style={{
            background: !isPrimaryActive
              ? activeToken.surfaceTintEnd
              : undefined,
            border: !isPrimaryActive || isServicesActive
              ? `2px solid ${activeToken.primary}`
              : '1px solid var(--md-border)',
            color: !isPrimaryActive ? activeToken.primaryDark : 'var(--md-text)',
            boxShadow: '0 8px 20px rgba(20, 46, 67, 0.14)',
          }}
        >
          <ModuleDuotoneIcon
            id={!isPrimaryActive ? active : 'services'}
            size={23}
            primaryColor={!isPrimaryActive ? activeToken.primaryDark : '#142E43'}
            secondaryColor={!isPrimaryActive ? activeToken.primary : '#087C76'}
          />
          <span className="text-[9.5px] font-extrabold mt-0.5 leading-none truncate max-w-[44px] dark:text-[#E2E8F0]">
            {!isPrimaryActive ? resolvedLabel : 'خدمات'}
          </span>
        </button>
      </div>
    </nav>
  );
}
