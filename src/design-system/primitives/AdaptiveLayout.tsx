import type { ReactNode } from 'react';
import {
  Cloud,
  CloudOff,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  UploadCloud,
} from 'lucide-react';
import { MascotTooth, type MascotMood } from '@/components/ui/MascotTooth';
import { handleRovingToolbarKeyDown } from '@/platform/focusEngine';
import { CardSurface, TouchButton } from './Surface';

export interface AdaptiveGridProps {
  children: ReactNode;
  className?: string;
  /** Responsive columns across compact/medium/expanded viewports */
  columns?: '1-2-3' | '2-2-4' | '1-2-2' | '2-3-4';
  testId?: string;
}

const GRID_CLASS_MAP: Record<NonNullable<AdaptiveGridProps['columns']>, string> = {
  '1-2-3': 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3',
  '2-2-4': 'grid-cols-2 md:grid-cols-2 xl:grid-cols-4',
  '1-2-2': 'grid-cols-1 lg:grid-cols-2',
  '2-3-4': 'grid-cols-2 md:grid-cols-3 xl:grid-cols-4',
};

/**
 * Density-aware responsive grid primitive (Compact / Medium / Expanded / Wide).
 */
export function AdaptiveGrid({
  children,
  className = '',
  columns = '1-2-3',
  testId,
}: AdaptiveGridProps) {
  return (
    <div
      data-testid={testId}
      className={`grid min-w-0 ${GRID_CLASS_MAP[columns]} gap-[var(--md-density-row-gap,10px)] ${className}`}
    >
      {children}
    </div>
  );
}

export interface AdaptiveSplitViewProps {
  primary: ReactNode;
  detail?: ReactNode;
  hasDetail?: boolean;
  className?: string;
  testId?: string;
}

/**
 * Canonical Adaptive Split View:
 * - On Expanded/Wide screens (>=1024px): side-by-side master + detail panes
 * - On Compact/Medium screens: single focused pane without horizontal squeeze
 */
export function AdaptiveSplitView({
  primary,
  detail,
  hasDetail = Boolean(detail),
  className = '',
  testId,
}: AdaptiveSplitViewProps) {
  return (
    <div
      data-testid={testId}
      className={`grid min-w-0 grid-cols-1 ${
        hasDetail ? 'lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]' : ''
      } gap-[var(--md-density-section-gap,12px)] items-start ${className}`}
    >
      <div className="min-w-0">{primary}</div>
      {hasDetail && detail && (
        <aside className="min-w-0 lg:sticky lg:top-2 rounded-[var(--radius-card,20px)] bg-[var(--md-surface)] border border-[var(--md-border)] p-[var(--md-density-card-pad,14px)] shadow-sm">
          {detail}
        </aside>
      )}
    </div>
  );
}

export type UnifiedStateKind = 'loading' | 'empty' | 'error' | 'offline' | 'unauthorized';

export interface UnifiedStateViewProps {
  kind: UnifiedStateKind;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  testId?: string;
}

const STATE_MASCOT_MOOD: Record<UnifiedStateKind, MascotMood> = {
  loading: 'thinking',
  empty: 'happy',
  error: 'sad',
  offline: 'offline',
  unauthorized: 'neutral',
};

/**
 * GE-0003 Unified Loading / Empty / Error / Offline / Unauthorized State Panel
 * with Duolingo-style emotional iridescent tooth mascot & WCAG 2.2 AA contrast.
 */
export function UnifiedStateView({
  kind,
  title,
  subtitle,
  actionLabel,
  onAction,
  testId,
}: UnifiedStateViewProps) {
  return (
    <CardSurface
      data-testid={testId || `unified_state_${kind}`}
      role={kind === 'error' || kind === 'unauthorized' ? 'alert' : 'status'}
      className="flex flex-col items-center justify-center text-center py-8 px-5 motion-safe:animate-fade-in"
    >
      <div className="mb-3">
        <MascotTooth mood={STATE_MASCOT_MOOD[kind]} size={56} interactive={false} />
      </div>

      <div className="flex items-center justify-center gap-1.5 mb-1">
        {kind === 'loading' && <Loader2 size={16} className="animate-spin text-indigo-600 dark:text-indigo-400" />}
        {kind === 'error' && <ShieldAlert size={16} className="text-rose-600 dark:text-rose-400" />}
        {kind === 'offline' && <CloudOff size={16} className="text-amber-600 dark:text-amber-400" />}
        <h3 className="text-base font-bold text-[var(--md-text)]">{title}</h3>
      </div>

      {subtitle && (
        <p className="text-sm font-medium text-[var(--md-secondary)] max-w-sm leading-relaxed break-words">
          {subtitle}
        </p>
      )}

      {actionLabel && onAction && (
        <TouchButton
          onClick={onAction}
          className="mt-4 text-sm"
        >
          <RefreshCw size={14} />
          <span>{actionLabel}</span>
        </TouchButton>
      )}
    </CardSurface>
  );
}

export interface ContextualActionItem {
  id: string;
  label: string;
  icon: ReactNode;
  accent?: string;
  onClick: () => void;
}

export interface ContextualToolbarProps {
  sectionLabel: string;
  isOnline: boolean;
  syncPulse: boolean;
  offlineQueueCount: number;
  actions: ContextualActionItem[];
  onOpenSyncStatus?: () => void;
}

/**
 * GE-0003 Smart Contextual Toolbar + Unified Online/Offline/Sync Status Strip
 * - RTL roving arrow-key navigation
 * - Zero clipping or horizontal overflow across 360px mobile to 1440px desktop
 */
export function ContextualToolbar({
  sectionLabel,
  isOnline,
  syncPulse,
  offlineQueueCount,
  actions,
  onOpenSyncStatus,
}: ContextualToolbarProps) {
  if (actions.length === 0) return null;

  return (
    <div
      role="toolbar"
      aria-label={`ابزارهای سریع ${sectionLabel}`}
      data-testid="smart_contextual_toolbar"
      onKeyDown={(e) => handleRovingToolbarKeyDown(e)}
      className="rounded-[var(--radius-card,20px)] bg-[var(--md-surface)] border border-[var(--md-border)] px-2.5 py-1.5 flex items-center justify-between gap-2 min-w-0 shadow-sm"
    >
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar min-w-0 py-0.5">
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            data-testid={`contextual_action_${action.id}`}
            onClick={action.onClick}
            className="min-h-[48px] px-2.5 py-1 rounded-[var(--radius-btn,12px)] bg-[var(--md-muted-surface)] border border-[var(--md-border)] text-[var(--md-text)] text-xs font-extrabold whitespace-nowrap inline-flex items-center gap-1.5 shrink-0 transition-colors active:scale-95"
          >
            <span
              className="w-5 h-5 rounded-lg flex items-center justify-center shrink-0"
              style={{
                background: action.accent ? `${action.accent}18` : 'rgba(8,124,118,0.12)',
                color: action.accent || '#087C76',
              }}
            >
              {action.icon}
            </span>
            <span>{action.label}</span>
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onOpenSyncStatus}
        data-testid="unified_sync_status_pill"
        aria-label={
          !isOnline
            ? 'وضعیت آفلاین'
            : offlineQueueCount > 0
            ? `${offlineQueueCount} مورد در صف همگام‌سازی`
            : 'همگام‌سازی ابری متصل'
        }
        className={`min-h-[48px] px-2.5 py-1 rounded-full text-[10px] font-black inline-flex items-center gap-1 shrink-0 border transition-colors ${
          !isOnline
            ? 'bg-amber-50 dark:bg-amber-950/60 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-300'
            : offlineQueueCount > 0
            ? 'bg-indigo-50 dark:bg-indigo-950/60 border-indigo-300 dark:border-indigo-700 text-indigo-800 dark:text-indigo-300'
            : 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
        }`}
      >
        {!isOnline ? (
          <>
            <CloudOff size={12} />
            <span className="hidden sm:inline">آفلاین</span>
          </>
        ) : offlineQueueCount > 0 ? (
          <>
            <UploadCloud size={12} />
            <span className="tabular-nums">{offlineQueueCount.toLocaleString('fa-IR')}</span>
          </>
        ) : syncPulse ? (
          <>
            <Sparkles size={12} className="animate-pulse" />
            <span className="hidden sm:inline">در حال همگام‌سازی</span>
          </>
        ) : (
          <>
            <Cloud size={12} />
            <span className="hidden sm:inline">متصل</span>
          </>
        )}
      </button>
    </div>
  );
}
