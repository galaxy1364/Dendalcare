import { useEffect, useState } from 'react';
import { Check, GripVertical, Star } from 'lucide-react';
import { SECTIONS, type SectionId } from '@/lib/sections';
import { getModuleToken } from '@/design-system/tokens';
import { ModuleDuotoneIcon } from '@/design-system/icons/DentalDuotoneIcons';
import { canAccessRoute } from '@/services/permissions/accessControl';
import { useClinicShell } from '@/app/AppProviders';
import { useNavigation } from '@/navigation/NavigationStack';
import { HapticEngine } from '@/platform/haptics';
import {
  HOME_SERVICES_LIMIT,
  loadSelectedHomeServices,
  reorderSelectedHomeServices,
  saveSelectedHomeServices,
  subscribeHomeServicesChange,
} from '@/lib/navigationStack';

/**
 * FIX 05 — Dedicated Full-Screen Home Favorite Services Customizer Route ('customize_services')
 * Allows choosing and drag-and-drop reordering up to 8 home shortcuts shown on the Home screen.
 */
export function CustomizeServicesPage() {
  const { effectiveRole } = useClinicShell();
  const { goBack } = useNavigation();
  const [selectedHome, setSelectedHome] = useState<SectionId[]>(() => loadSelectedHomeServices());
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  useEffect(() => subscribeHomeServicesChange(setSelectedHome), []);

  const availableSections = SECTIONS.filter(
    (s) => s.id !== 'dashboard' && canAccessRoute(effectiveRole, s.id)
  );

  const visibleSelected = selectedHome.map((id, idx) => ({ id, idx })).filter(({ id }) => canAccessRoute(effectiveRole, id));

  const toggleHomeFavorite = (secId: SectionId) => {
    if (!canAccessRoute(effectiveRole, secId)) return;
    HapticEngine.selection();
    let next: SectionId[];
    if (selectedHome.includes(secId)) {
      if (visibleSelected.length <= 1) return;
      next = selectedHome.filter((id) => id !== secId);
    } else {
      if (selectedHome.length >= HOME_SERVICES_LIMIT) return;
      next = [...selectedHome, secId];
    }
    setSelectedHome(saveSelectedHomeServices(next));
  };

  return (
    <div className="space-y-3 pb-6 animate-fade-in-up" data-testid="customize_services_page">
      <div className="rounded-[22px] p-4 bg-white dark:bg-[#11202E] border border-[#D8E2EA] dark:border-[#25394D] shadow-sm space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Star size={17} className="text-amber-500 shrink-0" />
            <div>
              <h2 className="text-sm font-black text-[#14283B] dark:text-[#F1F5F9]">
                تنظیم ۸ خدمت منتخب صفحه خانه
              </h2>
              <p className="text-[11px] font-semibold text-[#526779] dark:text-[#9FB1C1]">
                ترتیب خدمات را با دکمه انتقال به ابتدا یا کشیدن و رها کردن تغییر دهید.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={goBack}
            className="min-h-[40px] px-3.5 py-1.5 rounded-[12px] bg-[#087C76] text-white text-xs font-bold flex items-center gap-1 shrink-0 active:scale-95"
          >
            <Check size={14} />
            <span>ذخیره و بازگشت</span>
          </button>
        </div>

        {/* Authorized selected slots */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" data-testid="services_home_customizer">
          {visibleSelected.map(({ id, idx }) => {
            const sec = SECTIONS.find((item) => item.id === id) ?? SECTIONS[1];
            const tok = getModuleToken(sec.id);
            return (
              <div
                key={sec.id}
                draggable
                onDragStart={() => setDragIdx(idx)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragIdx === null || dragIdx === idx) return;
                  const reordered = reorderSelectedHomeServices(selectedHome, dragIdx, idx);
                  setSelectedHome(saveSelectedHomeServices(reordered));
                  setDragIdx(null);
                  HapticEngine.selection();
                }}
                onDragEnd={() => setDragIdx(null)}
                className="flex items-center justify-between gap-1.5 px-3 py-2.5 rounded-2xl border cursor-grab active:cursor-grabbing bg-white dark:bg-[#162738]"
                style={{
                  borderColor: tok.surfaceBorder,
                }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <GripVertical size={14} className="text-[#526779] dark:text-[#9FB1C1] shrink-0" />
                  <ModuleDuotoneIcon id={sec.id} size={22} secondaryColor={tok.primary} />
                  <span className="text-xs font-black text-[#14283B] dark:text-[#F1F5F9] truncate">
                    {sec.label}
                  </span>
                </div>
                <button type="button" className="min-h-[44px] min-w-[44px] rounded-lg text-xs font-bold focus-visible:ring-2 focus-visible:ring-teal-600" aria-label={`انتقال ${sec.label} به ابتدا`} onClick={() => setSelectedHome(saveSelectedHomeServices(reorderSelectedHomeServices(selectedHome, idx, 0)))}>{(idx + 1).toLocaleString('fa-IR')} ↥</button>
              </div>
            );
          })}
        </div>
      </div>

      {/* All Authorized Services Picker */}
      <div className="rounded-[22px] p-4 bg-white dark:bg-[#11202E] border border-[#D8E2EA] dark:border-[#25394D] shadow-sm space-y-2.5">
        <p className="text-xs font-black text-[#14283B] dark:text-[#F1F5F9]">
          انتخاب خدمات مجاز برای نمایش در صفحه اصلی (حداکثر ۸ مورد)
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {availableSections.map((sec) => {
            const tok = getModuleToken(sec.id);
            const isPinned = selectedHome.includes(sec.id);
            return (
              <button
                key={sec.id}
                type="button"
                data-testid={`customize_toggle_${sec.id}`}
                aria-pressed={isPinned}
                disabled={!isPinned && selectedHome.length >= HOME_SERVICES_LIMIT}
                onClick={() => toggleHomeFavorite(sec.id)}
                className={`min-h-[56px] px-3 py-2 rounded-[16px] border flex items-center justify-between gap-2 text-right transition-all active:scale-97 disabled:opacity-50 ${
                  isPinned
                    ? 'bg-[#F0FDFA] dark:bg-[#153133] border-[#087C76]'
                    : 'bg-[#F4F7F9] dark:bg-[#162738] border-[#D8E2EA] dark:border-[#25394D]'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <ModuleDuotoneIcon id={sec.id} size={24} secondaryColor={tok.primary} />
                  <span className="text-xs font-bold text-[#14283B] dark:text-[#F1F5F9] truncate">
                    {sec.label}
                  </span>
                </div>
                <span
                  className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                    isPinned
                      ? 'bg-[#087C76] text-white'
                      : 'bg-white dark:bg-[#0D1B2A] border border-[#D8E2EA] dark:border-[#25394D] text-transparent'
                  }`}
                >
                  <Check size={13} />
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
