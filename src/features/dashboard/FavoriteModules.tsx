import { Eye, GripVertical, LayoutGrid } from 'lucide-react';
import { getSection, type SectionId } from '@/lib/sections';
import { getModuleToken } from '@/design-system/tokens';
import { ModuleDuotoneIcon } from '@/design-system/icons/DentalDuotoneIcons';
import { QBankTile } from '@/components/ui/QBankTile';
import { ContextMenuTrigger } from '@/components/ui/ContextMenu';
import { PlatformHapticAdapter } from '@/platform/haptics';
import type { AppRouteId } from '@/lib/navigationStack';

interface FavoriteModulesProps {
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
          className="min-h-[38px] px-3 py-1 rounded-[12px] bg-[#E2F5F3] dark:bg-[#162738] hover:bg-[#CCFBF1] border border-[#B8E5E1] dark:border-[#25394D] text-[#087C76] dark:text-[#2DD4BF] text-[11px] font-bold flex items-center gap-1.5 active:scale-95 transition-transform"
        >
          <LayoutGrid size={13} />
          <span>همه خدمات</span>
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {selectedServices.slice(0, 4).map((secId, idx) => {
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
              className={draggingIndex === idx ? 'opacity-60 scale-95 transition-transform' : ''}
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
                    label: 'تنظیم ۴ خدمت منتخب',
                    icon: <LayoutGrid size={14} />,
                    onSelect: () => onNavigate('services'),
                  },
                ]}
              >
                <QBankTile
                  compact
                  color={tok.primary}
                  darkColor={tok.primaryDark}
                  surfaceBg={tok.surfaceTintStart}
                  surfaceBgEnd={tok.surfaceTintEnd}
                  borderColor={tok.surfaceBorder}
                  icon={
                    <ModuleDuotoneIcon
                      id={secId}
                      size={28}
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
    </section>
  );
}
