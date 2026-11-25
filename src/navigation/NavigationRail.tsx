import { SECTIONS, type SectionId } from '@/lib/sections';
import type { AppRouteId } from '@/lib/navigationStack';
import { MascotTooth, type MascotMood } from '@/components/ui/MascotTooth';
import { PlatformHapticAdapter } from '@/platform/haptics';
import {
  FolderKanban,
  Keyboard,
  User,
  Monitor,
  Tablet,
  Search,
  BellRing,
  ChevronRight,
} from 'lucide-react';
import type { ClinicUserAccount } from '@/lib/cloudSyncEngine';
import { ROLE_LABELS } from '@/lib/cloudSyncEngine';
import type { PlatformInfo } from '@/platform/capabilities';
import { canAccessRoute } from '@/services/permissions/accessControl';
import { ModuleDuotoneIcon } from '@/design-system/icons/DentalDuotoneIcons';

interface NavigationRailProps {
  active: AppRouteId;
  onChange: (id: AppRouteId) => void;
  onBack?: () => void;
  canGoBack?: boolean;
  mascotMood: MascotMood;
  currentUser: ClinicUserAccount;
  platformInfo: PlatformInfo;
  notifCount?: number;
  onOpenUserModal: () => void;
  onOpenProjectFolder: () => void;
  onOpenShortcuts: () => void;
  onOpenGlobalSearch: () => void;
  onOpenNotifications: () => void;
}

const SECTION_GROUPS: { title: string; ids: SectionId[] }[] = [
  { title: 'کارتابل روزانه', ids: ['dashboard', 'patients', 'appointments', 'treatments', 'finance'] },
  { title: 'بخش‌های بالینی و پیگیری', ids: ['calendar', 'lab', 'implants', 'inventory', 'reminders'] },
  { title: 'مدیریت کلینیک', ids: ['staff', 'messages', 'settings'] },
];

export function NavigationRail({
  active,
  onChange,
  onBack,
  canGoBack = false,
  mascotMood,
  currentUser,
  platformInfo,
  notifCount = 0,
  onOpenUserModal,
  onOpenProjectFolder,
  onOpenShortcuts,
  onOpenGlobalSearch,
  onOpenNotifications,
}: NavigationRailProps) {
  const handleSelect = (id: AppRouteId) => {
    PlatformHapticAdapter.selection();
    onChange(id);
  };

  return (
    <aside
      data-testid="adaptive_desktop_sidebar"
      aria-label="منوی اصلی دسکتاپ و تبلت"
      className="hidden md:flex shrink-0 w-20 lg:w-64 h-full flex-col bg-[#142E43] border-l border-white/10 text-white z-30 shadow-xl"
    >
      {/* Brand Header */}
      <div className="px-3 lg:px-4 pt-4 pb-3 border-b border-white/10 flex items-center justify-center lg:justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {canGoBack && onBack && (
            <button
              type="button"
              data-testid="sidebar_back_btn"
              onClick={() => {
                PlatformHapticAdapter.selection();
                onBack();
              }}
              title="بازگشت به صفحه قبل"
              className="hidden lg:flex w-10 h-10 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10 items-center justify-center text-white shrink-0"
            >
              <ChevronRight size={18} />
            </button>
          )}
          <button
            type="button"
            onClick={() => handleSelect('dashboard')}
            className="flex items-center gap-2.5 min-w-0 text-right group min-h-[44px]"
          >
            <div className="shrink-0">
              <MascotTooth mood={mascotMood} size={38} />
            </div>
            <div className="hidden lg:block min-w-0">
              <p className="text-sm font-bold text-white leading-tight truncate">مینادنتال</p>
              <p className="text-[11px] text-slate-300 font-medium flex items-center gap-1 mt-0.5">
                {platformInfo.formFactor === 'tablet' ? <Tablet size={11} /> : <Monitor size={11} />}
                <span>{platformInfo.labelFa}</span>
              </p>
            </div>
          </button>
        </div>

        <button
          type="button"
          onClick={() => {
            PlatformHapticAdapter.lightImpact();
            onOpenShortcuts();
          }}
          title="کلیدهای میانبر"
          data-testid="sidebar_shortcuts_btn"
          className="hidden lg:flex items-center gap-1 px-2 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 border border-white/10 text-[11px] font-mono text-slate-200 min-h-[36px]"
        >
          <Keyboard size={13} />
          <span>F1</span>
        </button>
      </div>

      {/* Global Search & Notifications Strip */}
      <div className="px-2 lg:px-3 pt-2.5 pb-1 space-y-1.5">
        <button
          type="button"
          onClick={() => {
            PlatformHapticAdapter.lightImpact();
            onOpenGlobalSearch();
          }}
          data-testid="sidebar_global_search_btn"
          title="جستجوی سراسری و پوشه‌ها (Ctrl+K)"
          className="w-full flex items-center justify-center lg:justify-between gap-2 px-2.5 py-2 rounded-btn bg-[#087C76]/30 hover:bg-[#087C76]/45 border border-teal-400/30 text-white min-h-[44px]"
        >
          <span className="flex items-center gap-2">
            <Search size={17} className="shrink-0" />
            <span className="hidden lg:inline text-xs font-bold">جستجوی سراسری</span>
          </span>
          <span className="hidden lg:inline text-[10px] font-mono bg-white/10 px-1.5 py-0.5 rounded">⌘K</span>
        </button>

        <button
          type="button"
          onClick={() => {
            PlatformHapticAdapter.impact('medium');
            onOpenNotifications();
          }}
          data-testid="sidebar_notifications_btn"
          title="مرکز اعلان‌ها و یادآوری‌ها"
          className="w-full flex items-center justify-center lg:justify-between gap-2 px-2.5 py-2 rounded-btn bg-rose-500/20 hover:bg-rose-500/30 border border-rose-400/30 text-rose-100 min-h-[44px]"
        >
          <span className="flex items-center gap-2">
            <BellRing size={17} className="shrink-0" />
            <span className="hidden lg:inline text-xs font-bold">مرکز اعلان‌ها</span>
          </span>
          {notifCount > 0 && (
            <span className="min-w-[20px] h-[20px] px-1.5 rounded-full bg-[#AD293C] text-white text-[11px] font-bold flex items-center justify-center tabular-nums">
              {notifCount > 99 ? '99+' : notifCount.toLocaleString('fa-IR')}
            </span>
          )}
        </button>
      </div>

      {/* Scrollable Navigation Groups */}
      <nav className="flex-1 overflow-y-auto px-2 lg:px-3 py-2 space-y-4 desktop-scroll">
        <button
          type="button"
          onClick={() => handleSelect('services')}
          data-testid="sidebar_nav_services"
          className={`w-full flex items-center justify-center lg:justify-start gap-2.5 px-2.5 py-2 rounded-btn min-h-[44px] transition-colors ${
            active === 'services'
              ? 'bg-white/15 text-white'
              : 'text-slate-200 hover:bg-white/10 hover:text-white'
          }`}
        >
          <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-teal-500/25 text-teal-200 border border-teal-400/35">
            <ModuleDuotoneIcon id="services" size={20} primaryColor="#FFFFFF" secondaryColor="#2DD4BF" />
          </span>
          <span className="hidden lg:block text-xs font-bold truncate">همه خدمات و گزارش نوبت</span>
        </button>

        {canAccessRoute(currentUser?.role, 'reports') && (
          <button
            type="button"
            onClick={() => handleSelect('reports')}
            data-testid="sidebar_nav_reports"
            className={`w-full flex items-center justify-center lg:justify-start gap-2.5 px-2.5 py-2 rounded-btn min-h-[44px] transition-colors ${
              active === 'reports'
                ? 'bg-white/15 text-white'
                : 'text-slate-200 hover:bg-white/10 hover:text-white'
            }`}
          >
            <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-indigo-500/25 text-indigo-200 border border-indigo-400/35">
              <ModuleDuotoneIcon id="reports" size={20} primaryColor="#FFFFFF" secondaryColor="#A5B4FC" />
            </span>
            <span className="hidden lg:block text-xs font-bold truncate">گزارش مالی و عملکرد</span>
          </button>
        )}

        {SECTION_GROUPS.map((group) => {
          const visibleIds = group.ids.filter((id) => canAccessRoute(currentUser?.role, id));
          if (visibleIds.length === 0) return null;
          return (
            <div key={group.title} className="space-y-1">
              <p className="hidden lg:block px-2.5 text-[11px] font-semibold text-slate-300 mb-1">
                {group.title}
              </p>
              {visibleIds.map((id) => {
                const sec = SECTIONS.find((s) => s.id === id);
                if (!sec) return null;
                const Icon = sec.icon;
                const isActive = active === id;
                return (
                  <button
                    key={sec.id}
                    type="button"
                    onClick={() => handleSelect(sec.id)}
                    title={sec.label}
                    data-testid={`sidebar_nav_${sec.id}`}
                    className={`w-full flex items-center justify-center lg:justify-start gap-2.5 px-2.5 py-2 rounded-btn min-h-[44px] transition-colors ${
                      isActive
                        ? 'bg-white/15 text-white'
                        : 'text-slate-200 hover:bg-white/10 hover:text-white'
                    }`}
                    style={
                      isActive
                        ? { boxShadow: `inset -3px 0 0 ${sec.color}` }
                        : undefined
                    }
                  >
                    <span
                      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                      style={{
                        background: isActive ? `${sec.color}35` : 'rgba(255,255,255,0.06)',
                        color: isActive ? '#FFFFFF' : '#CBD5E1',
                        border: isActive ? `1px solid ${sec.color}` : '1px solid rgba(255,255,255,0.08)',
                      }}
                    >
                      <Icon size={18} strokeWidth={isActive ? 2.3 : 2} />
                    </span>
                    <span className="hidden lg:block text-xs font-bold truncate">
                      {sec.label}
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/* Bottom Workspace Controls */}
      <div className="p-2.5 lg:p-3 border-t border-white/10 space-y-1.5">
        <button
          type="button"
          onClick={() => {
            PlatformHapticAdapter.lightImpact();
            onOpenProjectFolder();
          }}
          data-testid="sidebar_project_folder_btn"
          title="ابزارها و پوشه برنامه"
          className="w-full flex items-center justify-center lg:justify-start gap-2.5 px-2.5 py-2 rounded-btn min-h-[44px] bg-amber-400/15 hover:bg-amber-400/25 border border-amber-300/25 text-amber-100 transition-colors"
        >
          <FolderKanban size={18} className="shrink-0" />
          <span className="hidden lg:block text-xs font-bold truncate">ابزارها و نصب</span>
        </button>

        <button
          type="button"
          onClick={() => {
            PlatformHapticAdapter.lightImpact();
            onOpenUserModal();
          }}
          data-testid="sidebar_user_profile_btn"
          title={currentUser?.fullName || 'دکتر مهدی امیری'}
          className="w-full flex items-center justify-center lg:justify-start gap-2.5 px-2.5 py-2 rounded-btn min-h-[44px] bg-white/8 hover:bg-white/15 border border-white/10 transition-colors"
        >
          <span
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0 font-bold text-xs"
            style={{ background: currentUser?.avatarColor || '#087C76' }}
          >
            <User size={16} />
          </span>
          <div className="hidden lg:block min-w-0 text-right">
            <p className="text-xs font-bold text-white truncate">
              {currentUser?.fullName || 'دکتر مهدی امیری'}
            </p>
            <p className="text-[11px] text-slate-300 truncate">
              {ROLE_LABELS[currentUser?.role || 'manager']}
            </p>
          </div>
        </button>
      </div>
    </aside>
  );
}
