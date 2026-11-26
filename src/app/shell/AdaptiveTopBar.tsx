import { Bell, ChevronRight, FolderKanban, Search, User } from 'lucide-react';
import { ROLE_LABELS, type ClinicUserAccount } from '@/lib/cloudSyncEngine';
import type { AppRouteId } from '@/lib/navigationStack';
import { PlatformHapticAdapter } from '@/platform/haptics';
import type { EffectiveClinicRole } from '@/services/permissions/accessControl';
import { MascotTooth, type MascotMood } from '@/components/ui/MascotTooth';
import type { ShellSectionMeta } from './shellMetadata';

interface AdaptiveTopBarProps {
  activeRoute: AppRouteId;
  section: ShellSectionMeta;
  canGoBack: boolean;
  mascotMood: MascotMood;
  currentUser: ClinicUserAccount;
  effectiveRole: EffectiveClinicRole;
  branchName: string;
  onlinePeersCount: number;
  notifCount: number;
  syncPulse: boolean;
  onGoBack: () => void;
  onGoHome: () => void;
  onOpenSearch: () => void;
  onOpenNotifications: () => void;
  onOpenUserModal: () => void;
  onOpenProjectFolder: () => void;
}

/**
 * GE-0005 Modular Adaptive Header Bar (320px–1920px):
 * Combines Phase 06 #F4F7F9 daylight gutter with Apple Liquid Glass / Material 3 / Fluent 2 layered bar,
 * accessible 44px+ touch targets, dynamic RTL typography, and zero-overlap spacing.
 */
export function AdaptiveTopBar({
  activeRoute,
  section,
  canGoBack,
  mascotMood,
  currentUser,
  effectiveRole,
  branchName,
  onlinePeersCount,
  notifCount,
  syncPulse,
  onGoBack,
  onGoHome,
  onOpenSearch,
  onOpenNotifications,
  onOpenUserModal,
  onOpenProjectFolder,
}: AdaptiveTopBarProps) {
  return (
    <header className="shrink-0 z-20 bg-[#F4F7F9]/95 dark:bg-[#0A141E]/95 liquid-glass-header border-b border-[#D8E2EA]/80 dark:border-[#25394D]/80 px-1.5 sm:px-2.5 md:px-4 py-1">
      <div className="adaptive-shell-container">
        <div className="liquid-glass-bar rounded-[18px] md:rounded-[20px] px-2 sm:px-3 py-1 flex items-center justify-between gap-1.5 sm:gap-2 text-[#14283B] dark:text-[#F1F5F9]">
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1">
            {canGoBack && (
              <button
                type="button"
                data-testid="topbar_back_button"
                onClick={onGoBack}
                aria-label="بازگشت به صفحه قبل"
                title="بازگشت"
                className="w-10 h-10 rounded-[12px] bg-[#EEF3F7] dark:bg-[#162738] border border-[#D8E2EA] dark:border-[#25394D] flex items-center justify-center text-[#14283B] dark:text-[#F1F5F9] shrink-0 active:scale-95"
              >
                <ChevronRight size={18} strokeWidth={2.5} />
              </button>
            )}

            <button
              type="button"
              data-testid="topbar_brand_logo_button"
              className="inline-flex items-center justify-center w-[46px] h-[46px] shrink-0 bg-transparent cursor-pointer active:scale-95 md:hidden"
              onClick={onGoHome}
              aria-label="مینادنتال - صفحه اصلی"
            >
              <MascotTooth mood={mascotMood} size={46} interactive={false} />
            </button>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <h1 className="text-[clamp(13.5px,3.6vw,16.5px)] font-black leading-tight text-[#14283B] dark:text-[#F1F5F9] whitespace-nowrap truncate">
                  <span className="md:hidden">
                    {activeRoute === 'dashboard' ? 'مینادنتال' : section.label}
                  </span>
                  <span className="hidden md:inline">{section.label}</span>
                </h1>
                <span
                  className="hidden lg:inline-flex text-[10px] font-bold px-2 py-0.5 rounded-md text-white truncate max-w-[160px]"
                  style={{ background: section.color }}
                >
                  {currentUser.fullName || currentUser.name}
                </span>
              </div>
              <p className="text-[10.5px] font-medium text-[#526779] dark:text-[#9FB1C1] leading-tight truncate mt-0.5">
                <span>{branchName}</span>
                <span className="hidden md:inline"> • {onlinePeersCount.toLocaleString('fa-IR')} کاربر آنلاین</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
            <button
              type="button"
              className="topbar-btn bg-[#F2FAFF] dark:bg-[#162738] border border-[#B5DBF7] dark:border-[#25394D]"
              onClick={() => {
                PlatformHapticAdapter.selection();
                onOpenSearch();
              }}
              aria-label="جستجوی سراسری و پوشه‌ها"
              title="جستجوی سراسری (Ctrl+K)"
              data-testid="topbar_global_search_button"
            >
              <Search size={17} className="text-[#0369A1] dark:text-[#38BDF8]" />
            </button>

            <button
              type="button"
              className="topbar-btn bg-[#FFF5F7] dark:bg-[#162738] border border-[#FECDD3] dark:border-[#25394D] flex"
              onClick={() => {
                PlatformHapticAdapter.selection();
                onOpenNotifications();
              }}
              aria-label="مرکز اعلان‌ها و یادآوری‌ها"
              title="اعلان‌ها و یادآوری‌ها"
              data-testid="topbar_notifications_button"
            >
              <Bell size={17} className="text-[#AD293C] dark:text-[#FDA4AF]" />
              {notifCount > 0 && (
                <span className="notif-dot">
                  {notifCount > 99 ? '99+' : notifCount.toLocaleString('fa-IR')}
                </span>
              )}
            </button>

            <button
              type="button"
              className="topbar-btn bg-[#EEF3F7] dark:bg-[#162738] border border-[#D8E2EA] dark:border-[#25394D]"
              onClick={() => {
                PlatformHapticAdapter.selection();
                onOpenUserModal();
              }}
              aria-label="حساب کاربری و مدیریت دسترسی"
              title={`${currentUser.fullName || 'مدیر'} (${effectiveRole === 'unauthorized' ? 'فاقد عضویت فعال' : ROLE_LABELS[effectiveRole]})`}
              data-testid="topbar_user_avatar_button"
            >
              <User size={18} className="text-[#087C76] dark:text-[#2DD4BF]" />
              <span
                className="absolute bottom-1.5 right-1.5 w-2 h-2 rounded-full border border-white"
                style={{ background: currentUser.avatarColor || '#087C76' }}
              />
            </button>

            <button
              type="button"
              className="topbar-btn bg-[#FFFDF5] dark:bg-[#162738] border border-[#FDE0A6] dark:border-[#25394D]"
              onClick={() => {
                PlatformHapticAdapter.selection();
                onOpenProjectFolder();
              }}
              aria-label="پوشه پروژه مینادنتال"
              title="ابزارها، کالرآیدی، نصب و همگام‌سازی"
              data-testid="topbar_project_folder_button"
            >
              <FolderKanban size={18} className="text-[#92510C] dark:text-[#FBBF24]" />
              {syncPulse && (
                <span className="absolute bottom-1.5 right-1.5 w-2 h-2 rounded-full bg-[#176B52] border border-white" />
              )}
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
