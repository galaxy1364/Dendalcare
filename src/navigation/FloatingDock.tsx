import { SECTIONS, type SectionId, getSection } from '@/lib/sections';
import { getModuleToken } from '@/design-system/tokens';
import { ModuleDuotoneIcon } from '@/design-system/icons/DentalDuotoneIcons';
import { PlatformHapticAdapter } from '@/platform/haptics';
import type { AppRouteId } from '@/lib/navigationStack';

interface FloatingDockProps {
  active: AppRouteId;
  onChange: (id: AppRouteId) => void;
  onOpenFolders: () => void;
  moreOpen?: boolean;
}

const PRIMARY_SECTION_IDS: SectionId[] = [
  'dashboard',
  'patients',
  'appointments',
  'treatments',
  'finance',
];

function resolveDockSection(route: AppRouteId): { sectionId: SectionId; label: string } {
  if (route === 'services') return { sectionId: 'dashboard', label: 'خدمات' };
  if (route === 'reports') return { sectionId: 'finance', label: 'گزارش‌ها' };
  if (route === 'patient_form') return { sectionId: 'patients', label: 'بیمار جدید' };
  if (route === 'appointment_form') return { sectionId: 'appointments', label: 'نوبت جدید' };
  if (route === 'treatment_form') return { sectionId: 'treatments', label: 'درمان جدید' };
  return { sectionId: route, label: getSection(route).label };
}

export function FloatingDock({
  active,
  onChange,
  onOpenFolders,
  moreOpen = false,
}: FloatingDockProps) {
  const isPrimaryActive = PRIMARY_SECTION_IDS.includes(active as SectionId);
  const { sectionId: resolvedSectionId, label: resolvedLabel } = resolveDockSection(active);
  const activeToken = getModuleToken(resolvedSectionId);

  return (
    <nav
      aria-label="ناوبری اصلی پایین"
      data-testid="floating_bottom_dock"
      className="shrink-0 z-30 md:hidden px-2 pt-1 pb-1.5"
    >
      <div className="max-w-xl mx-auto flex items-center gap-1.5" dir="rtl">
        <div className="bottom-dock flex-1 rounded-full flex items-center justify-between px-1.5 py-1">
          {PRIMARY_SECTION_IDS.map((id) => {
            const section = SECTIONS.find((s) => s.id === id) ?? getSection(id);
            const tok = getModuleToken(id);
            const isActive = active === id;
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => {
                  PlatformHapticAdapter.selection();
                  onChange(section.id);
                }}
                className={`dock-item ${isActive ? 'active' : ''}`}
                style={{
                  color: isActive ? tok.primary : '#526779',
                }}
                aria-label={section.label}
                aria-current={isActive ? 'page' : undefined}
              >
                <div
                  className="dock-icon"
                  style={{
                    background: isActive ? tok.surfaceTintEnd : 'transparent',
                    border: isActive ? `1.5px solid ${tok.surfaceBorder}` : '1px solid transparent',
                  }}
                >
                  <ModuleDuotoneIcon
                    id={id}
                    size={22}
                    primaryColor={isActive ? tok.primaryDark : '#526779'}
                    secondaryColor={isActive ? tok.primary : '#94A3B8'}
                  />
                </div>
                <span
                  className="dock-label"
                  style={{
                    color: isActive ? tok.primaryDark : '#526779',
                    fontWeight: isActive ? 700 : 600,
                  }}
                >
                  {section.label}
                </span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => {
            PlatformHapticAdapter.selection();
            onOpenFolders();
          }}
          aria-label="پوشه و منوی کل بخش‌ها"
          data-testid="dock_more_button"
          className="w-[52px] h-[52px] rounded-full shrink-0 flex flex-col items-center justify-center transition-transform active:scale-95"
          style={{
            background: !isPrimaryActive
              ? activeToken.surfaceTintEnd
              : moreOpen
              ? '#E2F5F3'
              : '#FFFFFF',
            border: !isPrimaryActive
              ? `2px solid ${activeToken.primary}`
              : '1px solid #D8E2EA',
            color: !isPrimaryActive ? activeToken.primaryDark : '#14283B',
            boxShadow: '0 6px 18px rgba(20, 46, 67, 0.12)',
          }}
        >
          {!isPrimaryActive ? (
            <ModuleDuotoneIcon
              id={active}
              size={22}
              primaryColor={activeToken.primaryDark}
              secondaryColor={activeToken.primary}
            />
          ) : (
            <ModuleDuotoneIcon id="services" size={22} primaryColor="#14283B" secondaryColor="#087C76" />
          )}
          <span className="text-[10px] font-bold mt-0.5 leading-none truncate max-w-[44px]">
            {!isPrimaryActive ? resolvedLabel : 'بخش‌ها'}
          </span>
        </button>
      </div>
    </nav>
  );
}
