import { useState, useEffect, useRef, useMemo } from 'react';
import { SECTIONS, type SectionId, getSection } from '@/lib/sections';
import { getModuleToken } from '@/lib/designTokens';
import {
  LayoutGrid,
  X,
  Search,
  ChevronRight,
  PhoneIncoming,
  Download,
  Cloud,
  BellRing,
  Settings,
  UserCheck,
  Sparkles,
} from 'lucide-react';
import { QBankTile } from '@/components/ui/QBankTile';
import { MascotTooth } from '@/components/ui/MascotTooth';
import { playTactileFeedback } from '@/lib/hapticsAudio';

export interface DockSearchPatient {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  insurance_number?: string | null;
}

type Props = {
  active: SectionId;
  onChange: (id: SectionId) => void;
  onBack?: () => void;
  canGoBack?: boolean;
  patients?: DockSearchPatient[];
  onQuickAction?: (action: 'caller_id' | 'install' | 'sync' | 'reminder_popup') => void;
};

// 5 core clinical modules for the primary QBank pill dock
const PRIMARY_SECTION_IDS: SectionId[] = ['dashboard', 'patients', 'appointments', 'treatments', 'finance'];

const MORE_SUBTITLES: Record<string, string> = {
  dashboard:    'نمای کلی و KPI مطب',
  patients:     'پرونده و سابقه بیمار',
  appointments: 'نوبت‌دهی و صف یونیت',
  treatments:   'طرح درمان و چارت پالمر',
  finance:      'اقساط، چک و خزانه',
  calendar:     'شمسی • قمری • میلادی',
  lab:          'ارسال و دریافت پروتز',
  implants:     'جراحی، هیلینگ و روکش',
  inventory:    'موجودی مواد و آلارم',
  reminders:    'رادار هوشمند پیگیری',
  staff:        'پرسنل، پزشکان و سهم',
  messages:     'پیامک، نوبت و تبلیغات',
  settings:     'تعاریف، تعرفه و بک‌آپ',
};

const FOLDER_KEYWORDS: Record<SectionId, string> = {
  dashboard: 'داشبورد خانه خلاصه آمار گزارش',
  patients: 'بیمار پرونده شماره پرونده سابقه تماس',
  appointments: 'نوبت ویزیت زمانبندی رزرو یونیت',
  treatments: 'درمان پالمر دندان عصب کشی ترمیم روکش',
  finance: 'مالی پول قسط اقساط چک صیادی سفته ضمانت بدهی',
  calendar: 'تقویم شمسی قمری میلادی تاریخ',
  lab: 'لابراتوار قالب پروتز تاج روکش رفت و برگشت',
  implants: 'ایمپلنت فیکسچر جراحی هیلینگ اباتمنت',
  inventory: 'انبار مواد مصرفی کمبود هشدار',
  reminders: 'یادآوری اعلان زنگوله پیگیری نوتیفیکیشن',
  staff: 'پرسنل پزشک منشی دستیار سهم درصد کارکرد',
  messages: 'پیامک اس ام اس تبلیغات اطلاع رسانی',
  settings: 'تنظیمات تعرفه بک آپ گوگل درایو کلود آپدیت',
};

export function BottomDock({
  active,
  onChange,
  onBack,
  canGoBack = false,
  patients = [],
  onQuickAction,
}: Props) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const isPrimaryActive = PRIMARY_SECTION_IDS.includes(active);
  const activeSection = getSection(active);
  const activeToken = getModuleToken(active);
  const moreSections = SECTIONS.filter((s) => !PRIMARY_SECTION_IDS.includes(s.id));

  // Global listener so Top Bar / Dashboard / Shortcuts can open the QBank Folders & Search Menu from anywhere
  useEffect(() => {
    const onOpenMenu = (ev: Event) => {
      const detail = (ev as CustomEvent)?.detail;
      setMoreOpen(true);
      if (detail?.focusSearch) {
        setTimeout(() => searchInputRef.current?.focus(), 140);
      }
    };
    window.addEventListener('minadental-open-qbank-menu', onOpenMenu);
    return () => window.removeEventListener('minadental-open-qbank-menu', onOpenMenu);
  }, []);

  const handleSelect = (id: SectionId) => {
    playTactileFeedback('dock');
    onChange(id);
    setMoreOpen(false);
    setSearchQuery('');
  };

  const quickTools = useMemo(
    () => [
      {
        id: 'caller_id' as const,
        label: 'کالرآیدی تماس',
        color: '#059669',
        bg: '#ECFDF5',
        border: '#A7F3D0',
        icon: PhoneIncoming,
        keywords: 'کالرآیدی تماس تلفن شماره نوبت فوری',
      },
      {
        id: 'reminder_popup' as const,
        label: 'پاپ‌آپ یادآور',
        color: '#E11D48',
        bg: '#FFF1F2',
        border: '#FECDD3',
        icon: BellRing,
        keywords: 'پاپ آپ یادآوری اعلان گوشی آیفونی',
      },
      {
        id: 'sync' as const,
        label: 'بک‌آپ و درایو',
        color: '#0284C7',
        bg: '#F0F9FF',
        border: '#BAE6FD',
        icon: Cloud,
        keywords: 'بک آپ گوگل درایو کلود سینک ذخیره',
      },
      {
        id: 'install' as const,
        label: 'نصب ۴ پلتفرم',
        color: '#7C3AED',
        bg: '#F5F3FF',
        border: '#DDD6FE',
        icon: Download,
        keywords: 'نصب آیفون اندروید آیپد ویندوز pwa apk',
      },
    ],
    []
  );

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const filteredSections = useMemo(() => {
    if (!normalizedQuery) return SECTIONS;
    return SECTIONS.filter((s) => {
      const hay = `${s.label} ${MORE_SUBTITLES[s.id] || ''} ${FOLDER_KEYWORDS[s.id] || ''}`.toLowerCase();
      return hay.includes(normalizedQuery);
    });
  }, [normalizedQuery]);

  const filteredTools = useMemo(() => {
    if (!normalizedQuery) return quickTools;
    return quickTools.filter((t) => `${t.label} ${t.keywords}`.toLowerCase().includes(normalizedQuery));
  }, [normalizedQuery, quickTools]);

  const matchedPatients = useMemo(() => {
    if (!normalizedQuery || patients.length === 0) return [];
    return patients
      .filter((p) => {
        const full = `${p.first_name || ''} ${p.last_name || ''} ${p.phone || ''} ${p.insurance_number || ''}`.toLowerCase();
        return full.includes(normalizedQuery);
      })
      .slice(0, 5);
  }, [normalizedQuery, patients]);

  const handleMenuBack = () => {
    playTactileFeedback('soft');
    if (searchQuery.trim()) {
      setSearchQuery('');
      return;
    }
    setMoreOpen(false);
    if (canGoBack && onBack) {
      onBack();
    }
  };

  return (
    <>
      {/* Authentic QBank Floating Bottom Navigation: Main Pill Dock + Detached 4-Square Menu Circle (Screenshots 3 & 5) */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 safe-bottom md:hidden bg-gradient-to-t from-[#F3F6FB] via-[#F3F6FB]/92 to-transparent">
        <div className="max-w-xl mx-auto px-2 pb-1.5 pt-1 flex items-center gap-1.5" dir="rtl">
          {/* Primary 5 Sections Pill Dock */}
          <div
            className="bottom-dock flex-1 rounded-full flex items-center justify-between px-1.5 py-1"
            style={{
              boxShadow: '0 8px 24px rgba(15,23,42,0.10), inset 0 1px 0 #FFFFFF',
            }}
          >
            {PRIMARY_SECTION_IDS.map((id) => {
              const section = getSection(id);
              const tok = getModuleToken(id);
              const Icon = section.icon;
              const isActive = active === id;
              return (
                <button
                  key={section.id}
                  onClick={() => handleSelect(section.id)}
                  className={`dock-item no-select ${isActive ? 'active' : ''}`}
                  style={{
                    color: isActive ? tok.primary : '#475569',
                    minWidth: '48px',
                    minHeight: '46px',
                  }}
                  aria-label={section.label}
                >
                  <div
                    className="dock-icon"
                    style={{
                      background: isActive ? tok.surfaceTintEnd : 'transparent',
                      border: isActive ? `1.5px solid ${tok.surfaceBorder}` : '1px solid transparent',
                      boxShadow: isActive
                        ? `0 2px 8px ${tok.primary}22`
                        : 'none',
                    }}
                  >
                    <Icon
                      size={isActive ? 20 : 19}
                      strokeWidth={isActive ? 2.5 : 2}
                    />
                  </div>
                  <span
                    className="dock-label"
                    style={{
                      color: isActive ? tok.primaryDark : '#475569',
                      fontWeight: isActive ? 800 : 700,
                    }}
                  >
                    {section.label}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Detached Circular 4-Square QBank All-Folders Menu Button (Exact Screenshot 3 & 5 silhouette) */}
          <button
            onClick={() => {
              playTactileFeedback('dock');
              setMoreOpen(!moreOpen);
            }}
            aria-label="پوشه و منوی کل بخش‌ها"
            data-testid="dock_more_button"
            className="w-[52px] h-[52px] rounded-full shrink-0 flex flex-col items-center justify-center transition-all active:scale-90"
            style={{
              background: !isPrimaryActive
                ? activeToken.surfaceTintEnd
                : moreOpen
                ? '#EEF2FF'
                : 'rgba(255, 255, 255, 0.97)',
              border: !isPrimaryActive
                ? `2px solid ${activeToken.primary}`
                : '1px solid #CBD5E1',
              color: !isPrimaryActive ? activeToken.primaryDark : '#0F172A',
              boxShadow: '0 8px 22px rgba(15, 23, 42, 0.12), inset 0 1px 0 #FFFFFF',
            }}
          >
            {!isPrimaryActive ? (
              <activeSection.icon size={20} strokeWidth={2.4} style={{ color: activeToken.primary }} />
            ) : (
              <LayoutGrid size={20} strokeWidth={2.3} />
            )}
            <span className="text-[8.5px] font-black mt-0.5 leading-none truncate max-w-[44px]">
              {!isPrimaryActive ? activeSection.label : 'پوشه‌ها'}
            </span>
          </button>
        </div>
      </nav>

      {/* Authentic Full-Screen QBank All-Folders Menu, Quick Tiles & Bottom Search/Back Bar (Screenshots 1, 6, 7) */}
      {moreOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end md:items-center justify-center"
          onClick={() => setMoreOpen(false)}
          data-testid="qbank_all_folders_menu"
        >
          <div className="absolute inset-0 bg-slate-900/55 backdrop-blur-sm animate-fade-in" />
          <div
            className="relative w-full max-w-xl md:max-w-3xl h-[92vh] md:h-auto md:max-h-[88vh] flex flex-col bg-[#F5F7FB] rounded-t-[32px] md:rounded-[32px] border-t border-white shadow-2xl sheet-enter overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            dir="rtl"
          >
            {/* Top Bar inside QBank Menu (Matches Screenshot 6 Top: Brand on Right, X + Settings on Left) */}
            <div className="px-4 pt-3 pb-2.5 bg-white border-b border-slate-200 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <MascotTooth mood="happy" size={34} />
                <div>
                  <h3 className="text-sm font-black text-slate-900 flex items-center gap-1.5">
                    <span>پوشه جامع خدمات مینادنتال</span>
                    <span className="text-[9.5px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-800 border border-indigo-200 font-extrabold">
                      ۱۳ بخش فعال
                    </span>
                  </h3>
                  <p className="text-[10px] font-semibold text-slate-500">
                    دسترسی مستقیم به پوشه‌ها، بیماران، سرچ و ابزارهای سریع
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handleSelect('settings')}
                  aria-label="تنظیمات کلینیک"
                  className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 border border-slate-200 flex items-center justify-center text-slate-700 transition-all"
                >
                  <Settings size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    playTactileFeedback('soft');
                    setMoreOpen(false);
                  }}
                  aria-label="بستن"
                  className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 border border-slate-200 flex items-center justify-center text-slate-700 transition-all"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Scrollable Interior: 3-Column Quick Curved Tiles (Screenshot 1) + 3-Column Icon Folder Grid (Screenshot 6) */}
            <div className="flex-1 overflow-y-auto px-3.5 py-3 space-y-4">
              {/* Live Patient Search Results (when typing in Search Capsule) */}
              {matchedPatients.length > 0 && (
                <div className="rounded-2xl bg-white border border-emerald-200 p-2.5 space-y-1.5 shadow-sm">
                  <p className="text-[10.5px] font-black text-emerald-800 flex items-center gap-1 px-1">
                    <UserCheck size={13} /> بیماران یافت‌شده در پرونده کلینیک:
                  </p>
                  {matchedPatients.map((pt) => (
                    <button
                      key={pt.id}
                      type="button"
                      onClick={() => handleSelect('patients')}
                      className="w-full flex items-center justify-between px-2.5 py-2 rounded-xl bg-emerald-50/70 hover:bg-emerald-100/70 border border-emerald-200/70 text-right transition-all"
                    >
                      <span className="text-xs font-black text-slate-900">
                        {pt.first_name} {pt.last_name}
                      </span>
                      <span className="text-[10.5px] font-mono font-bold text-emerald-800" dir="ltr">
                        {pt.phone || `#${pt.insurance_number || 'پرونده'}`}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {/* 1. Compact 3-Column Highlight Tiles (Exact Screenshot 1 & 7 Proportions: بیماران • مالی • یادآوری) */}
              {!normalizedQuery && (
                <div className="space-y-1.5">
                  <p className="text-[10.5px] font-extrabold text-slate-600 px-1 flex items-center gap-1">
                    <Sparkles size={12} className="text-indigo-600" /> دسترسی سریع ویژه مطب
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {(['patients', 'finance', 'reminders'] as const).map((fid) => {
                      const sec = getSection(fid);
                      const tok = getModuleToken(fid);
                      const FIcon = sec.icon;
                      return (
                        <QBankTile
                          key={fid}
                          compact
                          color={tok.primary}
                          darkColor={tok.primaryDark}
                          surfaceBg={tok.surfaceTintStart}
                          surfaceBgEnd={tok.surfaceTintEnd}
                          borderColor={tok.surfaceBorder}
                          icon={<FIcon size={17} strokeWidth={2.3} />}
                          label={sec.label}
                          selected={active === fid}
                          testId={`more_quick_tile_${fid}`}
                          onClick={() => handleSelect(fid)}
                        />
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 2. Authentic QBank 3-Column Rounded-Square Folders Icon Grid (Exact Screenshot 6 Visual Design) */}
              <div className="rounded-[26px] bg-white border border-slate-200/90 p-3.5 shadow-sm">
                <div className="grid grid-cols-3 gap-x-2.5 gap-y-4">
                  {filteredSections.map((sec) => {
                    const Icon = sec.icon;
                    const tok = getModuleToken(sec.id);
                    const isCurrent = active === sec.id;
                    return (
                      <button
                        key={sec.id}
                        type="button"
                        data-testid={`more_tile_${sec.id}`}
                        onClick={() => handleSelect(sec.id)}
                        className="group flex flex-col items-center text-center gap-1.5 py-1 rounded-2xl transition-all active:scale-95"
                      >
                        <div
                          className="w-12 h-12 rounded-[16px] flex items-center justify-center relative transition-transform group-hover:-translate-y-0.5 shadow-sm"
                          style={{
                            background: isCurrent ? tok.primary : tok.surfaceTintEnd,
                            color: isCurrent ? '#FFFFFF' : tok.primaryDark,
                            border: `1.5px solid ${isCurrent ? tok.primary : tok.surfaceBorder}`,
                            boxShadow: isCurrent
                              ? `0 6px 16px ${tok.primary}38`
                              : '0 3px 10px rgba(15, 23, 42, 0.05)',
                          }}
                        >
                          <Icon size={22} strokeWidth={2.2} />
                          {isCurrent && (
                            <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-emerald-500 border-2 border-white" />
                          )}
                        </div>
                        <span className="text-[11px] font-black text-slate-900 leading-tight line-clamp-1">
                          {sec.label}
                        </span>
                        <span className="text-[9px] font-semibold text-slate-500 leading-tight line-clamp-1">
                          {MORE_SUBTITLES[sec.id]}
                        </span>
                      </button>
                    );
                  })}

                  {/* Quick Clinic Utility Folders inside Same 3-Column QBank Grid */}
                  {filteredTools.map((tool) => {
                    const TIcon = tool.icon;
                    return (
                      <button
                        key={tool.id}
                        type="button"
                        onClick={() => {
                          playTactileFeedback('tap');
                          setMoreOpen(false);
                          onQuickAction?.(tool.id);
                        }}
                        className="group flex flex-col items-center text-center gap-1.5 py-1 rounded-2xl transition-all active:scale-95"
                      >
                        <div
                          className="w-12 h-12 rounded-[16px] flex items-center justify-center transition-transform group-hover:-translate-y-0.5 shadow-sm"
                          style={{
                            background: tool.bg,
                            color: tool.color,
                            border: `1.5px solid ${tool.border}`,
                          }}
                        >
                          <TIcon size={21} strokeWidth={2.2} />
                        </div>
                        <span className="text-[11px] font-black text-slate-900 leading-tight line-clamp-1">
                          {tool.label}
                        </span>
                        <span className="text-[9px] font-semibold text-slate-500 leading-tight">
                          ابزار سریع مطب
                        </span>
                      </button>
                    );
                  })}
                </div>

                {filteredSections.length === 0 && filteredTools.length === 0 && matchedPatients.length === 0 && (
                  <p className="text-center text-xs font-bold text-slate-500 py-6">
                    موردی با عبارت «{searchQuery}» یافت نشد
                  </p>
                )}
              </div>

              {/* Curved-Notch Specialized Overflow Tiles for Quick Visual Comparison */}
              {!normalizedQuery && (
                <div className="space-y-1.5 pb-1">
                  <p className="text-[10.5px] font-extrabold text-slate-600 px-1">
                    کاشی‌های تخصصی کیوبانک
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {moreSections.slice(0, 4).map((sec) => {
                      const Icon = sec.icon;
                      const tok = getModuleToken(sec.id);
                      return (
                        <QBankTile
                          key={`card_${sec.id}`}
                          color={tok.primary}
                          darkColor={tok.primaryDark}
                          surfaceBg={tok.surfaceTintStart}
                          surfaceBgEnd={tok.surfaceTintEnd}
                          borderColor={tok.surfaceBorder}
                          icon={<Icon size={18} strokeWidth={2.3} />}
                          label={sec.label}
                          sub={MORE_SUBTITLES[sec.id]}
                          selected={active === sec.id}
                          onClick={() => handleSelect(sec.id)}
                        />
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Bottom Floating Capsule Bar: Search Pill + Circular Back Button (Exact Screenshot 6 Bottom) */}
            <div className="px-3 py-2.5 bg-white border-t border-slate-200 flex items-center gap-2 shrink-0 safe-bottom">
              {/* Circular Back Button (RTL Start) */}
              <button
                type="button"
                data-testid="qbank_menu_back_btn"
                onClick={handleMenuBack}
                aria-label="بازگشت"
                title="بازگشت به صفحه قبل"
                className="w-11 h-11 rounded-full bg-slate-100 hover:bg-slate-200 border border-slate-300 flex items-center justify-center text-slate-900 shrink-0 shadow-sm active:scale-90 transition-all"
              >
                <ChevronRight size={20} strokeWidth={2.5} />
              </button>

              {/* Global Search Capsule Input (Exact QBank Bottom Search Pill) */}
              <div className="flex-1 flex items-center gap-2 rounded-full bg-slate-100 focus-within:bg-white border border-slate-300 focus-within:border-indigo-500 px-3.5 py-2 shadow-inner transition-all">
                <Search size={16} className="text-slate-500 shrink-0" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  data-testid="qbank_global_search_input"
                  placeholder="جستجو در پوشه‌ها، خدمات، بیماران، چک..."
                  className="w-full bg-transparent text-xs font-bold text-slate-900 placeholder:text-slate-500 focus:outline-none"
                />
                {searchQuery && (
                  <button
                    type="button"
                    aria-label="پاک کردن جستجو"
                    onClick={() => setSearchQuery('')}
                    className="w-5 h-5 rounded-full bg-slate-300 hover:bg-slate-400 text-slate-900 flex items-center justify-center shrink-0"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
