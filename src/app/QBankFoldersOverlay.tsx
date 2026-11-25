import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Anchor,
  ArrowUpLeft,
  BellRing,
  CalendarDays,
  ChevronRight,
  Cloud,
  CreditCard,
  Download,
  FileCheck,
  FlaskConical,
  LayoutGrid,
  PhoneIncoming,
  Search,
  Settings,
  Sparkles,
  UserCheck,
  X,
} from 'lucide-react';
import { SECTIONS, type SectionId } from '@/lib/sections';
import { getModuleToken } from '@/design-system/tokens';
import { ModuleDuotoneIcon } from '@/design-system/icons/DentalDuotoneIcons';
import { toJalaliStr } from '@/lib/jalali';
import { QBankTile } from '@/components/ui/QBankTile';
import { MascotTooth } from '@/components/ui/MascotTooth';
import { PlatformHapticAdapter } from '@/platform/haptics';
import { useNavigation } from '@/navigation/NavigationStack';
import { canAccessRoute } from '@/services/permissions/accessControl';
import type { AppRouteId } from '@/lib/navigationStack';
import type { DeepLinkPayload } from '@/navigation/DeepLinkHandler';
import { useClinicShell } from './AppProviders';

const PRIMARY_SECTION_IDS: SectionId[] = ['dashboard', 'patients', 'appointments', 'treatments', 'finance'];

const MORE_SUBTITLES: Record<string, string> = {
  dashboard: 'نمای کلی و KPI مطب',
  patients: 'پرونده و سابقه بیمار',
  appointments: 'نوبت‌دهی و صف یونیت',
  treatments: 'طرح درمان و چارت پالمر',
  finance: 'اقساط، چک و خزانه',
  calendar: 'شمسی • قمری • میلادی',
  lab: 'ارسال و دریافت پروتز',
  implants: 'جراحی، هیلینگ و روکش',
  inventory: 'موجودی مواد و آلارم',
  reminders: 'رادار هوشمند پیگیری',
  staff: 'پرسنل، پزشکان و سهم',
  messages: 'پیامک، نوبت و تبلیغات',
  settings: 'تعاریف، تعرفه و بک‌آپ',
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

export function QBankFoldersOverlay() {
  const {
    qbankMenuOpen,
    qbankFocusSearch,
    closeQBankMenu,
    currentUser,
    patients,
    appointments,
    checks,
    installments,
    labOrders,
    implants,
    reminders,
    triggerQuickAction,
  } = useClinicShell();
  const { activeRoute, canGoBack, goBack, navigate } = useNavigation();

  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (qbankMenuOpen && qbankFocusSearch) {
      requestAnimationFrame(() => searchInputRef.current?.focus());
    }
  }, [qbankMenuOpen, qbankFocusSearch]);

  const handleSelect = (id: AppRouteId, deepLink?: Omit<DeepLinkPayload, 'section'>) => {
    PlatformHapticAdapter.selection();
    navigate(id, deepLink);
    closeQBankMenu();
    setSearchQuery('');
  };

  const quickTools = useMemo(
    () => [
      {
        id: 'caller_id' as const,
        label: 'کالرآیدی تماس',
        color: '#087C76',
        bg: '#F2FBFA',
        border: '#B8E5E1',
        icon: PhoneIncoming,
        keywords: 'کالرآیدی تماس تلفن شماره نوبت فوری',
      },
      {
        id: 'reminder_popup' as const,
        label: 'پاپ‌آپ یادآور',
        color: '#AD293C',
        bg: '#FFF1F2',
        border: '#FECDD3',
        icon: BellRing,
        keywords: 'پاپ آپ یادآوری اعلان گوشی',
      },
      {
        id: 'sync' as const,
        label: 'بک‌آپ و درایو',
        color: '#0369A1',
        bg: '#EFF6FF',
        border: '#BFDBFE',
        icon: Cloud,
        keywords: 'بک آپ گوگل درایو کلود سینک ذخیره',
      },
      {
        id: 'install' as const,
        label: 'نصب ۴ پلتفرم',
        color: '#5B3CC4',
        bg: '#F7F5FF',
        border: '#D2C8FA',
        icon: Download,
        keywords: 'نصب آیفون اندروید آیپد ویندوز pwa apk',
      },
    ],
    []
  );

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const accessibleSections = useMemo(
    () => SECTIONS.filter((s) => canAccessRoute(currentUser.role, s.id)),
    [currentUser.role]
  );

  const moreSections = useMemo(
    () => accessibleSections.filter((s) => !PRIMARY_SECTION_IDS.includes(s.id)),
    [accessibleSections]
  );

  const patientNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of patients) {
      map.set(p.id, `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'بیمار');
    }
    return map;
  }, [patients]);

  const filteredSections = useMemo(() => {
    if (!normalizedQuery) return accessibleSections;
    return accessibleSections.filter((s) => {
      const hay = `${s.label} ${MORE_SUBTITLES[s.id] || ''} ${FOLDER_KEYWORDS[s.id] || ''}`.toLowerCase();
      return hay.includes(normalizedQuery);
    });
  }, [normalizedQuery, accessibleSections]);

  const filteredTools = useMemo(() => {
    if (!normalizedQuery) return quickTools;
    return quickTools.filter((t) => `${t.label} ${t.keywords}`.toLowerCase().includes(normalizedQuery));
  }, [normalizedQuery, quickTools]);

  const matchedPatients = useMemo(() => {
    if (!normalizedQuery || patients.length === 0 || !canAccessRoute(currentUser.role, 'patients')) {
      return [];
    }
    return patients
      .filter((p) => {
        const full = `${p.first_name || ''} ${p.last_name || ''} ${p.phone || ''} ${p.insurance_number || ''} ${p.national_id || ''}`.toLowerCase();
        return full.includes(normalizedQuery);
      })
      .slice(0, 5);
  }, [normalizedQuery, patients, currentUser.role]);

  const matchedRecords = useMemo(() => {
    if (!normalizedQuery) return [];
    const results: {
      id: string;
      badge: string;
      badgeColor: string;
      badgeBg: string;
      title: string;
      sub: string;
      section: SectionId;
      focus: Omit<DeepLinkPayload, 'section'>;
      icon: typeof FileCheck;
    }[] = [];

    if (canAccessRoute(currentUser.role, 'finance')) {
      for (const c of checks) {
        const pName = c.patient_id ? patientNameMap.get(c.patient_id) || '' : '';
        const hay = `${c.check_number || ''} ${c.bank_name || ''} ${pName} چک`.toLowerCase();
        if (hay.includes(normalizedQuery)) {
          results.push({
            id: `chk_${c.id}`,
            badge: 'چک صیادی',
            badgeColor: '#AD293C',
            badgeBg: '#FFF1F2',
            title: `چک ${c.check_number || 'صیادی'} • ${Number(c.amount || 0).toLocaleString('fa-IR')} ت`,
            sub: `${pName || 'بیمار'} • سررسید ${toJalaliStr(c.due_date)}`,
            section: 'finance',
            focus: { subTab: 'checks', query: c.check_number || pName, recordId: c.id },
            icon: FileCheck,
          });
        }
        if (results.length >= 8) break;
      }

      for (const inst of installments) {
        if (results.length >= 8) break;
        const pName = inst.patient_id ? patientNameMap.get(inst.patient_id) || '' : '';
        const hay = `${pName} قسط اقساط ${inst.monthly_amount}`.toLowerCase();
        if (hay.includes(normalizedQuery)) {
          results.push({
            id: `inst_${inst.id}`,
            badge: 'قسط',
            badgeColor: '#5B3CC4',
            badgeBg: '#F7F5FF',
            title: `قسط ${pName || 'بیمار'} • ${Number(inst.monthly_amount || 0).toLocaleString('fa-IR')} ت`,
            sub: inst.next_due_date ? `سررسید ${toJalaliStr(inst.next_due_date)}` : 'اقساط فعال',
            section: 'finance',
            focus: { subTab: 'installments', query: pName, recordId: inst.id },
            icon: CreditCard,
          });
        }
      }
    }

    if (canAccessRoute(currentUser.role, 'appointments')) {
      for (const apt of appointments) {
        if (results.length >= 8) break;
        const pName = apt.patient_id ? patientNameMap.get(apt.patient_id) || '' : '';
        const hay = `${apt.title || ''} ${pName} ${apt.room || ''} ${apt.type || ''} نوبت`.toLowerCase();
        if (hay.includes(normalizedQuery)) {
          results.push({
            id: `apt_${apt.id}`,
            badge: 'نوبت',
            badgeColor: '#92510C',
            badgeBg: '#FFFBEB',
            title: apt.title || `نوبت ${pName}`,
            sub: `${toJalaliStr(apt.appointment_date)} ساعت ${(apt.appointment_time || '').slice(0, 5)}`,
            section: 'appointments',
            focus: { date: apt.appointment_date, query: pName || apt.title || '', recordId: apt.id },
            icon: CalendarDays,
          });
        }
      }
    }

    if (canAccessRoute(currentUser.role, 'lab')) {
      for (const lab of labOrders) {
        if (results.length >= 8) break;
        const pName = lab.patient_id ? patientNameMap.get(lab.patient_id) || '' : '';
        const hay = `${lab.lab_name || ''} ${lab.tooth_numbers || ''} ${pName} لابراتوار`.toLowerCase();
        if (hay.includes(normalizedQuery)) {
          results.push({
            id: `lab_${lab.id}`,
            badge: 'لابراتوار',
            badgeColor: '#B02364',
            badgeBg: '#FFF5F9',
            title: `${lab.lab_name || 'سفارش لابراتوار'} (${lab.tooth_numbers || '—'})`,
            sub: pName || 'پروتز کلینیک',
            section: 'lab',
            focus: { query: pName || lab.lab_name || '', recordId: lab.id },
            icon: FlaskConical,
          });
        }
      }
    }

    if (canAccessRoute(currentUser.role, 'implants')) {
      for (const imp of implants) {
        if (results.length >= 8) break;
        const pName = imp.patient_id ? patientNameMap.get(imp.patient_id) || '' : '';
        const hay = `${imp.brand || ''} ${imp.tooth_number ?? ''} ${pName} ایمپلنت`.toLowerCase();
        if (hay.includes(normalizedQuery)) {
          results.push({
            id: `imp_${imp.id}`,
            badge: 'ایمپلنت',
            badgeColor: '#0E7490',
            badgeBg: '#F2FCFE',
            title: `${imp.brand || 'ایمپلنت'} • دندان ${imp.tooth_number ?? '—'}`,
            sub: pName || 'پرونده ایمپلنت',
            section: 'implants',
            focus: { query: pName || imp.brand || '', recordId: imp.id },
            icon: Anchor,
          });
        }
      }
    }

    for (const rem of reminders) {
      if (results.length >= 8) break;
      const pName = rem.patient_id ? patientNameMap.get(rem.patient_id) || '' : '';
      const hay = `${rem.title} ${pName} یادآوری`.toLowerCase();
      if (hay.includes(normalizedQuery)) {
        results.push({
          id: `rem_${rem.id}`,
          badge: 'یادآوری',
          badgeColor: '#AD293C',
          badgeBg: '#FFF1F2',
          title: rem.title,
          sub: `${pName ? `${pName} • ` : ''}${toJalaliStr(rem.reminder_date)}`,
          section: 'reminders',
          focus: { query: rem.title, recordId: rem.id },
          icon: BellRing,
        });
      }
    }

    return results;
  }, [normalizedQuery, currentUser.role, checks, installments, appointments, labOrders, implants, reminders, patientNameMap]);

  if (!qbankMenuOpen) return null;

  const handleMenuBack = () => {
    PlatformHapticAdapter.lightImpact();
    if (searchQuery.trim()) {
      setSearchQuery('');
      return;
    }
    closeQBankMenu();
    if (canGoBack) goBack();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center"
      onClick={closeQBankMenu}
      data-testid="qbank_all_folders_menu"
    >
      <div className="absolute inset-0 bg-[#142E43]/55 animate-fade-in" />
      <div
        className="relative w-full max-w-xl md:max-w-3xl h-[92vh] md:h-auto md:max-h-[88vh] flex flex-col bg-[#F4F7F9] dark:bg-[#0A141E] rounded-t-[28px] md:rounded-[28px] border border-[#D8E2EA] dark:border-[#25394D] shadow-2xl sheet-enter overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
      >
        <div className="px-4 pt-3 pb-2.5 bg-white dark:bg-[#11202E] border-b border-[#D8E2EA] dark:border-[#25394D] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <MascotTooth mood="happy" size={34} />
            <div>
              <h3 className="text-sm font-bold text-[#14283B] dark:text-[#F1F5F9]">
                خدمات کلینیک مینادنتال
              </h3>
              <p className="text-[11px] font-medium text-[#526779] dark:text-[#9FB1C1]">
                بخش‌ها، بیماران و جستجوی سریع
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => handleSelect('services')}
              data-testid="qbank_open_services_screen_btn"
              className="min-h-[40px] px-3 py-1.5 rounded-full bg-[#E2F5F3] dark:bg-[#162738] border border-[#B8E5E1] dark:border-[#25394D] text-[#087C76] dark:text-[#2DD4BF] text-[11px] font-bold flex items-center gap-1"
            >
              <LayoutGrid size={14} />
              <span>صفحه خدمات</span>
            </button>
            {canAccessRoute(currentUser.role, 'settings') && (
              <button
                type="button"
                onClick={() => handleSelect('settings')}
                aria-label="تنظیمات کلینیک"
                className="w-10 h-10 rounded-full bg-[#EEF3F7] dark:bg-[#162738] border border-[#D8E2EA] dark:border-[#25394D] flex items-center justify-center text-[#14283B] dark:text-[#F1F5F9]"
              >
                <Settings size={17} />
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                PlatformHapticAdapter.lightImpact();
                closeQBankMenu();
              }}
              aria-label="بستن"
              className="w-10 h-10 rounded-full bg-[#EEF3F7] dark:bg-[#162738] border border-[#D8E2EA] dark:border-[#25394D] flex items-center justify-center text-[#14283B] dark:text-[#F1F5F9]"
            >
              <X size={17} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3.5 py-3 space-y-4">
          {matchedPatients.length > 0 && (
            <div className="rounded-[20px] bg-white dark:bg-[#11202E] border border-[#B7E4CE] dark:border-[#25394D] p-2.5 space-y-1.5 shadow-sm" data-testid="global_search_patient_results">
              <p className="text-[11px] font-bold text-[#176B52] dark:text-[#34D399] flex items-center gap-1 px-1">
                <UserCheck size={14} /> بیماران ({matchedPatients.length.toLocaleString('fa-IR')})
              </p>
              {matchedPatients.map((pt) => {
                const fullName = `${pt.first_name || ''} ${pt.last_name || ''}`.trim();
                return (
                  <button
                    key={pt.id}
                    type="button"
                    onClick={() => handleSelect('patients', { query: fullName || pt.phone || '', recordId: pt.id })}
                    className="w-full min-h-[44px] flex items-center justify-between px-2.5 py-2 rounded-[12px] bg-[#F2FBF7] dark:bg-[#162738] border border-[#B7E4CE] dark:border-[#25394D] text-right"
                  >
                    <span className="text-xs font-bold text-[#14283B] dark:text-[#F1F5F9]">{fullName}</span>
                    <span className="text-[11px] font-mono font-bold text-[#176B52] dark:text-[#34D399] flex items-center gap-1" dir="ltr">
                      {pt.phone || `#${pt.insurance_number || 'پرونده'}`}
                      <ArrowUpLeft size={12} />
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {matchedRecords.length > 0 && (
            <div className="rounded-[20px] bg-white dark:bg-[#11202E] border border-[#D8E2EA] dark:border-[#25394D] p-2.5 space-y-1.5 shadow-sm" data-testid="global_search_record_results">
              <p className="text-[11px] font-bold text-[#087C76] dark:text-[#2DD4BF] flex items-center gap-1 px-1">
                <Search size={13} /> سوابق مالی و بالینی ({matchedRecords.length.toLocaleString('fa-IR')})
              </p>
              {matchedRecords.map((rec) => {
                const RIcon = rec.icon;
                return (
                  <button
                    key={rec.id}
                    type="button"
                    onClick={() => handleSelect(rec.section, rec.focus)}
                    className="w-full min-h-[48px] flex items-center justify-between gap-2 px-2.5 py-2 rounded-[12px] bg-[#F4F7F9] dark:bg-[#162738] border border-[#D8E2EA] dark:border-[#25394D] text-right"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0"
                        style={{ background: rec.badgeBg, color: rec.badgeColor }}
                      >
                        <RIcon size={15} />
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-[#14283B] dark:text-[#F1F5F9] truncate">{rec.title}</p>
                        <p className="text-[11px] font-medium text-[#526779] dark:text-[#9FB1C1] truncate">{rec.sub}</p>
                      </div>
                    </div>
                    <span
                      className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0"
                      style={{ background: rec.badgeBg, color: rec.badgeColor }}
                    >
                      {rec.badge}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {!normalizedQuery && (
            <div className="space-y-1.5">
              <p className="text-[11px] font-bold text-[#526779] dark:text-[#9FB1C1] px-1 flex items-center gap-1">
                <Sparkles size={13} className="text-[#087C76]" /> دسترسی سریع ویژه مطب
              </p>
              <div className="grid grid-cols-3 gap-2">
                {(['patients', 'finance', 'reminders'] as const)
                  .filter((fid) => canAccessRoute(currentUser.role, fid))
                  .map((fid) => {
                    const sec = accessibleSections.find((s) => s.id === fid);
                    if (!sec) return null;
                    const tok = getModuleToken(fid);
                    return (
                      <QBankTile
                        key={fid}
                        compact
                        color={tok.primary}
                        darkColor={tok.primaryDark}
                        surfaceBg={tok.surfaceTintStart}
                        surfaceBgEnd={tok.surfaceTintEnd}
                        borderColor={tok.surfaceBorder}
                        icon={
                          <ModuleDuotoneIcon
                            id={fid}
                            size={28}
                            primaryColor="#142E43"
                            secondaryColor={tok.primary}
                          />
                        }
                        label={sec.label}
                        selected={activeRoute === fid}
                        testId={`more_quick_tile_${fid}`}
                        onClick={() => handleSelect(fid)}
                      />
                    );
                  })}
              </div>
            </div>
          )}

          <div className="rounded-[20px] bg-white dark:bg-[#11202E] border border-[#D8E2EA] dark:border-[#25394D] p-3.5 shadow-sm">
            <div className="grid grid-cols-3 gap-x-2.5 gap-y-4">
              {filteredSections.map((sec) => {
                const tok = getModuleToken(sec.id);
                const isCurrent = activeRoute === sec.id;
                return (
                  <button
                    key={sec.id}
                    type="button"
                    data-testid={`more_tile_${sec.id}`}
                    onClick={() => handleSelect(sec.id)}
                    className="group flex flex-col items-center text-center gap-1.5 py-1 rounded-[16px] active:scale-95"
                  >
                    <div
                      className="w-12 h-12 rounded-[16px] flex items-center justify-center relative shadow-sm"
                      style={{
                        background: isCurrent ? tok.primary : tok.surfaceTintEnd,
                        color: isCurrent ? '#FFFFFF' : tok.primaryDark,
                        border: `1.5px solid ${isCurrent ? tok.primary : tok.surfaceBorder}`,
                      }}
                    >
                      <ModuleDuotoneIcon
                        id={sec.id}
                        size={28}
                        primaryColor={isCurrent ? '#FFFFFF' : '#142E43'}
                        secondaryColor={isCurrent ? '#CCFBF1' : tok.primary}
                      />
                      {isCurrent && (
                        <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-[#176B52] border-2 border-white" />
                      )}
                    </div>
                    <span className="text-[11px] font-bold text-[#14283B] dark:text-[#F1F5F9] leading-tight line-clamp-1">
                      {sec.label}
                    </span>
                    <span className="text-[10px] font-medium text-[#526779] dark:text-[#9FB1C1] leading-tight line-clamp-1">
                      {MORE_SUBTITLES[sec.id]}
                    </span>
                  </button>
                );
              })}

              {filteredTools.map((tool) => {
                const TIcon = tool.icon;
                return (
                  <button
                    key={tool.id}
                    type="button"
                    onClick={() => {
                      PlatformHapticAdapter.selection();
                      closeQBankMenu();
                      triggerQuickAction(tool.id);
                    }}
                    className="group flex flex-col items-center text-center gap-1.5 py-1 rounded-[16px] active:scale-95"
                  >
                    <div
                      className="w-12 h-12 rounded-[16px] flex items-center justify-center shadow-sm"
                      style={{
                        background: tool.bg,
                        color: tool.color,
                        border: `1.5px solid ${tool.border}`,
                      }}
                    >
                      <TIcon size={21} strokeWidth={2.2} />
                    </div>
                    <span className="text-[11px] font-bold text-[#14283B] dark:text-[#F1F5F9] leading-tight line-clamp-1">
                      {tool.label}
                    </span>
                    <span className="text-[10px] font-medium text-[#526779] dark:text-[#9FB1C1] leading-tight">
                      ابزار سریع مطب
                    </span>
                  </button>
                );
              })}
            </div>

            {filteredSections.length === 0 &&
              filteredTools.length === 0 &&
              matchedPatients.length === 0 &&
              matchedRecords.length === 0 && (
                <p className="text-center text-xs font-bold text-[#526779] py-6">
                  موردی با عبارت «{searchQuery}» یافت نشد
                </p>
              )}
          </div>

          {!normalizedQuery && moreSections.length > 0 && (
            <div className="space-y-1.5 pb-1">
              <p className="text-[11px] font-bold text-[#526779] dark:text-[#9FB1C1] px-1">
                دسترسی سریع
              </p>
              <div className="grid grid-cols-2 gap-2">
                {moreSections.slice(0, 4).map((sec) => {
                  const tok = getModuleToken(sec.id);
                  return (
                    <QBankTile
                      key={`card_${sec.id}`}
                      color={tok.primary}
                      darkColor={tok.primaryDark}
                      surfaceBg={tok.surfaceTintStart}
                      surfaceBgEnd={tok.surfaceTintEnd}
                      borderColor={tok.surfaceBorder}
                      icon={
                        <ModuleDuotoneIcon
                          id={sec.id}
                          size={28}
                          primaryColor="#142E43"
                          secondaryColor={tok.primary}
                        />
                      }
                      label={sec.label}
                      sub={MORE_SUBTITLES[sec.id]}
                      selected={activeRoute === sec.id}
                      onClick={() => handleSelect(sec.id)}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="px-3 py-2.5 bg-white dark:bg-[#11202E] border-t border-[#D8E2EA] dark:border-[#25394D] flex items-center gap-2 shrink-0 safe-bottom">
          <button
            type="button"
            data-testid="qbank_menu_back_btn"
            onClick={handleMenuBack}
            aria-label="بازگشت"
            title="بازگشت به صفحه قبل"
            className="w-12 h-12 rounded-full bg-[#EEF3F7] dark:bg-[#162738] border border-[#D8E2EA] dark:border-[#25394D] flex items-center justify-center text-[#14283B] dark:text-[#F1F5F9] shrink-0 active:scale-90"
          >
            <ChevronRight size={20} strokeWidth={2.5} />
          </button>

          <div className="flex-1 flex items-center gap-2 rounded-full bg-[#F4F7F9] dark:bg-[#162738] border border-[#D8E2EA] dark:border-[#25394D] focus-within:border-[#087C76] px-3.5 py-2.5 transition-colors">
            <Search size={16} className="text-[#526779] shrink-0" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              data-testid="qbank_global_search_input"
              placeholder="جستجو در پوشه‌ها، خدمات، بیماران، چک..."
              className="w-full bg-transparent text-xs font-bold text-[#14283B] dark:text-[#F1F5F9] placeholder:text-[#526779] focus:outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                aria-label="پاک کردن جستجو"
                onClick={() => setSearchQuery('')}
                className="w-6 h-6 rounded-full bg-[#D8E2EA] text-[#14283B] flex items-center justify-center shrink-0"
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
