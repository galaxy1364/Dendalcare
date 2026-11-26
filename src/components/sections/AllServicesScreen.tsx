import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Search, SlidersHorizontal, X } from 'lucide-react';
import { SECTIONS, type SectionId } from '@/lib/sections';
import { getModuleToken } from '@/design-system/tokens';
import { ModuleDuotoneIcon } from '@/design-system/icons/DentalDuotoneIcons';
import { PlatformHapticAdapter } from '@/platform/haptics';
import { canAccessRoute } from '@/services/permissions/accessControl';
import { useClinicShell } from '@/app/AppProviders';
import { useNavigation } from '@/navigation/NavigationStack';
import type { AppRouteId } from '@/lib/navigationStack';

interface AllServicesScreenProps {
  onNavigate: (id: AppRouteId) => void;
  onQuickAction?: (action: 'caller_id' | 'install' | 'sync' | 'reminder_popup') => void;
}

interface LauncherServiceItem {
  id: AppRouteId;
  label: string;
  color: string;
  surfaceBg: string;
  surfaceBorder: string;
  keywords: string;
}

const SERVICE_KEYWORDS: Partial<Record<AppRouteId, string>> = {
  patients: 'بیمار پرونده سابقه تماس',
  appointments: 'نوبت ویزیت رزرو یونیت',
  calendar: 'تقویم شمسی قمری میلادی تاریخ',
  treatments: 'درمان پالمر دندان عصب کشی ترمیم',
  lab: 'لابراتوار پروتز روکش قالب ارسال',
  implants: 'ایمپلنت فیکسچر جراحی هیلینگ',
  finance: 'مالی قسط اقساط چک سفته حسابداری',
  inventory: 'انبار مواد مصرفی موجودی',
  reminders: 'یادآوری اعلان زنگوله پیگیری',
  staff: 'پرسنل پزشک منشی سهم کارکرد',
  messages: 'پیام پیامک تبلیغات',
  settings: 'تنظیمات تعرفه بک آپ',
  reports: 'گزارش سود جریان نقد عملکرد هادل',
};

/**
 * FIX 05 — Pure QBank-Style Service Launcher ('services')
 *
 * - Clean 3-column grid of large Filled Duotone icons + readable Persian titles
 * - Strictly filtered by user's verified RBAC role (`canAccessRoute`)
 * - Removes swipeable banner, KPI/goal bar, Morning Huddle (moved to ReportsPage),
 *   and inline customizer (moved to dedicated `customize_services` route)
 * - Sticky bottom QBank search bar + circular Back button matching reference screenshots
 */
export function AllServicesScreen({ onNavigate }: AllServicesScreenProps) {
  const { effectiveRole } = useClinicShell();
  const { goBack, activeParams } = useNavigation();
  const [query, setQuery] = useState(activeParams.query || '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (activeParams.subTab === 'search') {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [activeParams.subTab]);

  const authorizedServices = useMemo<LauncherServiceItem[]>(() => {
    const baseModules: LauncherServiceItem[] = SECTIONS.filter(
      (sec) => sec.id !== 'dashboard' && canAccessRoute(effectiveRole, sec.id)
    ).map((sec) => {
      const tok = getModuleToken(sec.id as SectionId);
      return {
        id: sec.id,
        label: sec.label,
        color: tok.primary,
        surfaceBg: tok.surfaceTintStart,
        surfaceBorder: tok.surfaceBorder,
        keywords: SERVICE_KEYWORDS[sec.id] || sec.label,
      };
    });

    if (canAccessRoute(effectiveRole, 'reports')) {
      baseModules.push({
        id: 'reports',
        label: 'گزارش‌ها',
        color: '#4F46E5',
        surfaceBg: '#F5F3FF',
        surfaceBorder: '#C7D2FE',
        keywords: SERVICE_KEYWORDS.reports || 'گزارش',
      });
    }

    return baseModules;
  }, [effectiveRole]);

  const filteredServices = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return authorizedServices;
    return authorizedServices.filter((item) =>
      `${item.label} ${item.keywords}`.toLowerCase().includes(q)
    );
  }, [authorizedServices, query]);

  return (
    <div
      className="flex flex-col min-h-[calc(100dvh-146px)] justify-between gap-3 pb-2 animate-fade-in-up"
      data-testid="all_services_screen"
    >
      <div className="space-y-3">
        {/* Clean Minimal Launcher Top Row */}
        <div className="flex items-center justify-between px-1">
          <div>
            <h2 className="text-sm font-black text-[#14283B] dark:text-[#F1F5F9]">
              همه خدمات
            </h2>
            <p className="text-[11px] font-semibold text-[#526779] dark:text-[#9FB1C1] mt-0.5">
              {authorizedServices.length.toLocaleString('fa-IR')} بخش فعال
            </p>
          </div>

          <button
            type="button"
            data-testid="services_open_customizer_btn"
            onClick={() => {
              PlatformHapticAdapter.selection();
              onNavigate('customize_services');
            }}
            className="min-h-[40px] px-3 py-1.5 rounded-[14px] bg-white dark:bg-[#11202E] border border-[#D8E2EA] dark:border-[#25394D] text-[#14283B] dark:text-[#F1F5F9] text-[11px] font-bold flex items-center gap-1.5 shadow-sm active:scale-95 transition-transform"
          >
            <SlidersHorizontal size={14} className="text-[#087C76] dark:text-[#2DD4BF]" />
            <span>چیدمان خانه</span>
          </button>
        </div>

        {/* Pure QBank 3-Column Icon Launcher Grid */}
        <div
          data-testid="services_launcher_grid"
          className="rounded-[26px] bg-white/95 dark:bg-[#11202E]/95 border border-[#D8E2EA] dark:border-[#25394D] p-4 shadow-sm"
        >
          {filteredServices.length > 0 ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-x-3 gap-y-5">
              {filteredServices.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  data-testid={`services_tile_${item.id}`}
                  onClick={() => {
                    PlatformHapticAdapter.selection();
                    onNavigate(item.id);
                  }}
                  className="group flex flex-col items-center text-center gap-2 py-1 rounded-2xl min-h-[84px] transition-transform active:scale-95"
                >
                  <div
                    className="w-[58px] h-[58px] rounded-[20px] flex items-center justify-center shadow-sm transition-transform duration-150 group-hover:-translate-y-0.5 bg-white dark:bg-[#162738]"
                    style={{
                      background: `linear-gradient(145deg, #FFFFFF 0%, ${item.surfaceBg} 100%)`,
                      border: `1.5px solid ${item.surfaceBorder}`,
                      boxShadow: `0 6px 14px ${item.color}1A`,
                    }}
                  >
                    <ModuleDuotoneIcon
                      id={item.id}
                      size={32}
                      primaryColor="#142E43"
                      secondaryColor={item.color}
                    />
                  </div>
                  <span className="text-[12.5px] font-extrabold text-[#14283B] dark:text-[#F1F5F9] leading-tight line-clamp-2 max-w-[92px]">
                    {item.label}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="py-10 text-center space-y-1.5">
              <p className="text-xs font-black text-[#14283B] dark:text-[#F1F5F9]">
                خدمتی با عبارت «{query}» یافت نشد
              </p>
              <button
                type="button"
                onClick={() => setQuery('')}
                className="text-[11px] font-bold text-[#087C76] dark:text-[#2DD4BF]"
              >
                نمایش همه خدمات
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Sticky QBank Search Capsule + Circular Back Button */}
      <div
        data-testid="services_bottom_search_bar"
        className="sticky bottom-1 z-20 pt-2"
      >
        <div className="rounded-full bg-white/95 dark:bg-[#11202E]/95 border border-[#D8E2EA] dark:border-[#25394D] p-1.5 shadow-lg flex items-center gap-2 backdrop-blur-md">
          <button
            type="button"
            data-testid="services_bottom_back_btn"
            onClick={() => {
              PlatformHapticAdapter.selection();
              if (query.trim()) {
                setQuery('');
              } else {
                goBack();
              }
            }}
            aria-label="بازگشت"
            className="w-11 h-11 rounded-full bg-[#EEF3F7] dark:bg-[#162738] border border-[#D8E2EA] dark:border-[#25394D] flex items-center justify-center text-[#14283B] dark:text-[#F1F5F9] shrink-0 active:scale-92 transition-transform"
          >
            <ChevronRight size={20} strokeWidth={2.5} />
          </button>

          <div className="flex-1 flex items-center gap-2 rounded-full bg-[#F4F7F9] dark:bg-[#0D1B2A] focus-within:bg-white dark:focus-within:bg-[#162738] border border-transparent focus-within:border-[#087C76] px-3.5 py-2.5 transition-colors">
            <Search size={17} className="text-[#526779] dark:text-[#9FB1C1] shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              data-testid="services_search_input"
              placeholder="جستجوی خدمت (نوبت، بیمار، لابراتوار، مالی...)"
              className="w-full bg-transparent text-xs font-bold text-[#14283B] dark:text-[#F1F5F9] placeholder:text-[#526779] dark:placeholder:text-[#9FB1C1] focus:outline-none"
            />
            {query && (
              <button
                type="button"
                aria-label="پاک کردن جستجو"
                onClick={() => setQuery('')}
                className="w-6 h-6 rounded-full bg-[#D8E2EA] dark:bg-[#25394D] text-[#14283B] dark:text-[#F1F5F9] flex items-center justify-center shrink-0"
              >
                <X size={13} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
