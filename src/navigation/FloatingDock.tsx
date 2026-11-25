import { SECTIONS, type SectionId, getSection } from '@/lib/sections';
import { getModuleToken } from '@/design-system/tokens';
import { LayoutGrid } from 'lucide-react';
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

export function FloatingDock({
  active,
  onChange,
  onOpenFolders,
  moreOpen = false,
}: FloatingDockProps) {
  const isPrimaryActive = active !== 'services' && PRIMARY_SECTION_IDS.includes(active);
  const resolvedSectionId: SectionId = active === 'services' ? 'dashboard' : active;
  const activeSection = getSection(resolvedSectionId);
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
            const Icon = section.icon;
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
                  <Icon size={20} strokeWidth={isActive ? 2.4 : 2} />
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
            <activeSection.icon size={20} strokeWidth={2.3} style={{ color: activeToken.primary }} />
          ) : (
            <LayoutGrid size={20} strokeWidth={2.2} />
          )}
          <span className="text-[10px] font-bold mt-0.5 leading-none truncate max-w-[44px]">
            {!isPrimaryActive ? activeSection.label : 'بخش‌ها'}
          </span>
        </button>
      </div>
    </nav>
  );
}
