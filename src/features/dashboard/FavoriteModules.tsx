import { useRef } from 'react';
import { Eye, GripVertical, LayoutGrid } from 'lucide-react';
import { getSection, type SectionId } from '@/lib/sections';
import { getModuleToken } from '@/design-system/tokens';
import { ModuleDuotoneIcon } from '@/design-system/icons/DentalDuotoneIcons';
import { QBankTile } from '@/components/ui/QBankTile';
import { ContextMenuTrigger } from '@/components/ui/ContextMenu';
import { PlatformHapticAdapter } from '@/platform/haptics';
import { HOME_SERVICES_LIMIT, HOME_SERVICES_PAGE_SIZE, type AppRouteId } from '@/lib/navigationStack';
import { canAccessRoute, type EffectiveClinicRole } from '@/services/permissions/accessControl';

interface FavoriteModulesProps {
  userRole: EffectiveClinicRole;
  selectedServices: SectionId[];
  serviceValues: Record<SectionId, number | string>;
  draggingIndex: number | null;
  onDragStart: (idx: number) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (idx: number) => void;
  onDragEnd: () => void;
  onMoveToFirst: (idx: number) => void;
  onNavigate: (route: AppRouteId) => void;
}

export function FavoriteModules({
  userRole,
  selectedServices,
  serviceValues,
  draggingIndex,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onMoveToFirst,
  onNavigate,
}: FavoriteModulesProps) {
  const railRef = useRef<HTMLDivElement>(null);
  const visible = selectedServices.slice(0, HOME_SERVICES_LIMIT).map((secId, idx) => ({ secId, idx })).filter(({ secId }) => canAccessRoute(userRole, secId));
  const pages = Array.from({ length: Math.ceil(visible.length / HOME_SERVICES_PAGE_SIZE) }, (_, i) => visible.slice(i * HOME_SERVICES_PAGE_SIZE, (i + 1) * HOME_SERVICES_PAGE_SIZE));
  if (!canAccessRoute(userRole, 'services')) return null;
  return (
    <section className="space-y-1.5" data-testid="dashboard_selected_services">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-1.5">
          <GripVertical size={13} className="text-[#526779] dark:text-[#9FB1C1]" />
          <h2 className="text-xs font-bold text-[#14283B] dark:text-[#F1F5F9]">
            خدمات منتخب مطب
          </h2>
        </div>

        <button
          type="button"
          data-testid="home_open_all_services_btn"
          onClick={() => {
            PlatformHapticAdapter.selection();
            onNavigate('services');
          }}
          className="min-h-[48px] px-3 py-1 rounded-[12px] bg-[#E2F5F3] dark:bg-[#162738] hover:bg-[#CCFBF1] border border-[#B8E5E1] dark:border-[#25394D] text-[#087C76] dark:text-[#2DD4BF] text-[11px] font-bold flex items-center gap-1.5 active:scale-95 transition-transform"
        >
          <LayoutGrid size={13} />
          <span>بیشتر</span>
        </button>
      </div>

      {pages.length > 1 && (
        <div className="flex items-center gap-1" aria-label="صفحه خدمات منتخب">
          {pages.map((_, i) => (
            <button key={i} type="button" className="min-h-[44px] min-w-[48px] rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold focus-visible:ring-2 focus-visible:ring-teal-600" onClick={() => railRef.current?.children[i]?.scrollIntoView({ block: 'nearest', inline: 'start', behavior: 'instant' })} aria-label={`صفحه ${i + 1} خدمات منتخب`}>{(i + 1).toLocaleString('fa-IR')}</button>
          ))}
        </div>
      )}
      <div ref={railRef} dir="rtl" data-testid="home_favorites_rail" className="flex w-full min-w-0 overflow-x-auto snap-x snap-mandatory gap-2 pb-1" aria-label="خدمات منتخب، پیمایش افقی">
        {pages.map((page, pageIndex) => (
          <div key={pageIndex} data-testid={`home_favorites_page_${pageIndex + 1}`} className="w-full min-w-0 flex-none snap-start grid grid-cols-4 gap-1.5 items-stretch">
        {page.map(({ secId, idx }) => {
          const sec = getSection(secId);
          const tok = getModuleToken(secId);
          const liveVal = serviceValues[secId];
          return (
            <div
              key={secId}
              draggable
              onDragStart={() => {
                onDragStart(idx);
                PlatformHapticAdapter.lightImpact();
              }}
              onDragOver={onDragOver}
              onDrop={() => onDrop(idx)}
              onDragEnd={onDragEnd}
              className={`min-w-0 ${draggingIndex === idx ? 'opacity-60' : ''}`}
            >
              <ContextMenuTrigger
                title={sec.label}
                testId={`home_service_ctx_${secId}`}
                items={[
                  {
                    id: 'open',
                    label: `باز کردن ${sec.label}`,
                    icon: <Eye size={14} />,
                    onSelect: () => onNavigate(secId),
                  },
                  {
                    id: 'move_first',
                    label: 'انتقال به جایگاه اول',
                    icon: <GripVertical size={14} />,
                    onSelect: () => onMoveToFirst(idx),
                  },
                  {
                    id: 'customize',
                    label: 'تنظیم خدمات منتخب',
                    icon: <LayoutGrid size={14} />,
                    onSelect: () => onNavigate('customize_services'),
                  },
                ]}
              >
                <QBankTile
                  homeDense
                  compact
                  color={tok.primary}
                  darkColor={tok.primaryDark}
                  surfaceBg={tok.surfaceTintStart}
                  surfaceBgEnd={tok.surfaceTintEnd}
                  borderColor={tok.surfaceBorder}
                  icon={
                    <ModuleDuotoneIcon
                      id={secId}
                      size={23}
                      primaryColor="#142E43"
                      secondaryColor={tok.primary}
                    />
                  }
                  label={sec.label}
                  value={liveVal}
                  testId={`dashboard_tile_${secId}`}
                  onClick={() => onNavigate(secId)}
                />
              </ContextMenuTrigger>
            </div>
          );
        })}
          </div>
        ))}
      </div>
    </section>
  );
}
