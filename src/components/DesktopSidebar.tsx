import { SECTIONS, type SectionId } from '@/lib/sections';
import { MascotTooth, type MascotMood } from '@/components/ui/MascotTooth';
import { playTactileFeedback } from '@/lib/hapticsAudio';
import { FolderKanban, Keyboard, User, Monitor, Tablet, Search, BellRing, ChevronRight } from 'lucide-react';
import type { ClinicUserAccount } from '@/lib/cloudSyncEngine';
import { ROLE_LABELS } from '@/lib/cloudSyncEngine';
import type { PlatformInfo } from '@/lib/platformEngine';

interface DesktopSidebarProps {
  active: SectionId;
  onChange: (id: SectionId) => void;
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

/**
 * Adaptive RTL Navigation Rail (iPad 768px–1023px) & Full Sidebar (Windows/Mac >= 1024px)
 * Automatically hidden on handheld mobile (< 768px) where BottomDock serves 1-handed reach.
 */
export function DesktopSidebar({
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
}: DesktopSidebarProps) {
  const handleSelect = (id: SectionId) => {
    playTactileFeedback('dock');
    onChange(id);
  };

  return (
    <aside
      data-testid="adaptive_desktop_sidebar"
      aria-label="منوی اصلی دسکتاپ و آیپد"
      className="hidden md:flex fixed top-0 right-0 bottom-0 z-30 w-20 lg:w-64 flex-col bg-[#0F172A]/95 backdrop-blur-2xl border-l border-white/10 text-white safe-top safe-bottom shadow-2xl"
    >
      {/* Brand Header */}
      <div className="px-3 lg:px-4 pt-4 pb-3 border-b border-white/10 flex items-center justify-center lg:justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {canGoBack && onBack && (
            <button
              type="button"
              data-testid="sidebar_back_btn"
              onClick={() => {
                playTactileFeedback('soft');
                onBack();
              }}
              title="بازگشت به صفحه قبل"
              className="hidden lg:flex w-8 h-8 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10 items-center justify-center text-white shrink-0"
            >
              <ChevronRight size={16} />
            </button>
          )}
          <button
            type="button"
            onClick={() => handleSelect('dashboard')}
            className="flex items-center gap-2.5 min-w-0 text-right group"
          >
            <div className="shrink-0 transition-transform group-hover:scale-105">
              <MascotTooth mood={mascotMood} size={40} />
            </div>
            <div className="hidden lg:block min-w-0">
              <p className="text-sm font-black text-white leading-tight truncate">مینادنتال</p>
              <p className="text-[10px] text-slate-400 font-semibold flex items-center gap-1 mt-0.5">
                {platformInfo.formFactor === 'tablet' ? <Tablet size={10} /> : <Monitor size={10} />}
                <span>{platformInfo.labelFa}</span>
              </p>
            </div>
          </button>
        </div>

        <button
          type="button"
          onClick={() => {
            playTactileFeedback('soft');
            onOpenShortcuts();
          }}
          title="کلیدهای میانبر"
          data-testid="sidebar_shortcuts_btn"
          className="hidden lg:flex items-center gap-1 px-2 py-1 rounded-lg bg-white/8 hover:bg-white/15 border border-white/10 text-[10px] font-mono text-slate-300 transition-colors"
        >
          <Keyboard size={12} />
          <span>F1</span>
        </button>
      </div>

      {/* Global Search & Notifications Strip */}
      <div className="px-2 lg:px-3 pt-2.5 pb-1 space-y-1.5">
        <button
          type="button"
          onClick={() => {
            playTactileFeedback('tap');
            onOpenGlobalSearch();
          }}
          data-testid="sidebar_global_search_btn"
          title="جستجوی سراسری و پوشه‌ها (Ctrl+K)"
          className="w-full flex items-center justify-center lg:justify-between gap-2 px-2.5 py-2 rounded-2xl bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-400/30 text-indigo-100 transition-colors"
        >
          <span className="flex items-center gap-2">
            <Search size={16} className="shrink-0" />
            <span className="hidden lg:inline text-xs font-extrabold">جستجوی سراسری و پوشه</span>
          </span>
          <span className="hidden lg:inline text-[9px] font-mono bg-white/10 px-1.5 py-0.5 rounded">⌘K</span>
        </button>

        <button
          type="button"
          onClick={() => {
            playTactileFeedback('drawer');
            onOpenNotifications();
          }}
          data-testid="sidebar_notifications_btn"
          title="مرکز اعلان‌ها و یادآوری‌ها"
          className="w-full flex items-center justify-center lg:justify-between gap-2 px-2.5 py-2 rounded-2xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-400/25 text-rose-100 transition-colors relative"
        >
          <span className="flex items-center gap-2">
            <BellRing size={16} className={notifCount > 0 ? 'bell-swing shrink-0' : 'shrink-0'} />
            <span className="hidden lg:inline text-xs font-extrabold">مرکز اعلان‌ها</span>
          </span>
          {notifCount > 0 && (
            <span className="min-w-[18px] h-[18px] px-1.5 rounded-full bg-rose-600 text-white text-[9.5px] font-black flex items-center justify-center tabular-nums">
              {notifCount > 99 ? '99+' : notifCount.toLocaleString('fa-IR')}
            </span>
          )}
        </button>
      </div>

      {/* Scrollable Navigation Groups */}
      <nav className="flex-1 overflow-y-auto px-2 lg:px-3 py-2 space-y-4 desktop-scroll">
        {SECTION_GROUPS.map((group) => (
          <div key={group.title} className="space-y-1">
            <p className="hidden lg:block px-2.5 text-[10px] font-bold text-slate-400/90 tracking-tight mb-1.5">
              {group.title}
            </p>
            {group.ids.map((id) => {
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
                  className={`w-full flex items-center justify-center lg:justify-start gap-2.5 px-2.5 py-2.5 rounded-2xl transition-all duration-150 ${
                    isActive
                      ? 'bg-white/14 text-white shadow-md'
                      : 'text-slate-300 hover:bg-white/8 hover:text-white'
                  }`}
                  style={
                    isActive
                      ? {
                          boxShadow: `inset -3px 0 0 ${sec.color}, 0 4px 14px rgba(0,0,0,0.22)`,
                        }
                      : undefined
                  }
                >
                  <span
                    className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition-transform"
                    style={{
                      background: isActive ? `${sec.color}30` : 'rgba(255,255,255,0.05)',
                      color: isActive ? sec.color : '#CBD5E1',
                      border: isActive ? `1px solid ${sec.color}60` : '1px solid rgba(255,255,255,0.06)',
                    }}
                  >
                    <Icon size={17} strokeWidth={isActive ? 2.4 : 2} />
                  </span>
                  <span className="hidden lg:block text-xs font-extrabold truncate">
                    {sec.label}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Bottom Workspace Controls */}
      <div className="p-2.5 lg:p-3 border-t border-white/10 space-y-1.5">
        <button
          type="button"
          onClick={() => {
            playTactileFeedback('tap');
            onOpenProjectFolder();
          }}
          data-testid="sidebar_project_folder_btn"
          title="ابزارها و پوشه برنامه"
          className="w-full flex items-center justify-center lg:justify-start gap-2.5 px-2.5 py-2 rounded-2xl bg-amber-400/12 hover:bg-amber-400/20 border border-amber-300/25 text-amber-200 transition-colors"
        >
          <FolderKanban size={17} className="shrink-0" />
          <span className="hidden lg:block text-xs font-extrabold truncate">پوشه ابزارها و نصب</span>
        </button>

        <button
          type="button"
          onClick={() => {
            playTactileFeedback('tap');
            onOpenUserModal();
          }}
          data-testid="sidebar_user_profile_btn"
          title={currentUser?.fullName || 'دکتر مهدی امیری'}
          className="w-full flex items-center justify-center lg:justify-start gap-2.5 px-2.5 py-2 rounded-2xl bg-white/6 hover:bg-white/12 border border-white/10 transition-colors"
        >
          <span
            className="w-8 h-8 rounded-xl flex items-center justify-center text-white shrink-0 font-black text-xs"
            style={{ background: currentUser?.avatarColor || '#7C3AED' }}
          >
            <User size={15} />
          </span>
          <div className="hidden lg:block min-w-0 text-right">
            <p className="text-[11px] font-extrabold text-white truncate">
              {currentUser?.fullName || 'دکتر مهدی امیری'}
            </p>
            <p className="text-[9.5px] text-slate-400 truncate">
              {ROLE_LABELS[currentUser?.role || 'manager']}
            </p>
          </div>
        </button>
      </div>
    </aside>
  );
}
