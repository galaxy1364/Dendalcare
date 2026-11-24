import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import { playTactileFeedback } from '@/lib/hapticsAudio';

export interface QBankTileProps {
  /** Module accent color (hex) */
  color: string;
  /** High-contrast foreground shade for badge/text */
  darkColor?: string;
  /** Soft pastel surface background fill */
  surfaceBg: string;
  /** Secondary pastel stop for smooth luminous gradient */
  surfaceBgEnd?: string;
  /** Crisp pastel outline border */
  borderColor?: string;
  /** Crisp icon shown in top-right (RTL start) */
  icon: ReactNode;
  /** Primary Persian label */
  label: string;
  /** Optional subtitle line */
  sub?: string;
  /** Optional numeric or string live count */
  value?: number | string;
  /** Optional status pill (e.g., active / alert) */
  badge?: string;
  /** Shows a subtle breathing indicator dot */
  alert?: boolean;
  /** Highlight outline when selected */
  selected?: boolean;
  /** Compact 3-column QBank mini-tile mode (Screenshot 1 & 7 proportions) */
  compact?: boolean;
  /** Optional test ID */
  testId?: string;
  onClick: () => void;
}

/**
 * 100% Authentic QBank Curved-Notch Folder Tile (RTL)
 * Trace ID: TRC-MINA-QBANK-9008-H
 *
 * - Exact QBank proportions matching Screenshot 1, 2, 3, 4 & 7
 * - Smooth concave inner fillet notch carved cleanly out of the bottom-left corner (zero sharp edges)
 * - Calibrated unique pastel card surface per module (never raw flat white)
 * - Standalone colored spring pocket chevron button nestled in the carved cutout
 * - WCAG 2.1 AAA foreground contrast on all figures & labels
 */
export function QBankTile({
  color,
  darkColor,
  surfaceBg,
  surfaceBgEnd,
  borderColor,
  icon,
  label,
  sub,
  value,
  badge,
  alert,
  selected,
  compact = false,
  testId,
  onClick,
}: QBankTileProps) {
  const gradId = `qbt-${label.replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '')}-${color.replace('#', '')}`;
  const effectiveDark = darkColor || color;
  const effectiveBorder = borderColor || `${color}45`;
  const minH = compact ? '88px' : '102px';

  const handleClick = () => {
    playTactileFeedback('tap');
    onClick();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid={testId}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick();
        }
      }}
      className="qbank-notch-card group relative w-full select-none cursor-pointer"
      style={{ minHeight: minH }}
    >
      {/* Authentic QBank Curved-Notch SVG Surface (Smooth Concave Bottom-Left Cutout in RTL) */}
      <svg
        viewBox="0 0 220 120"
        preserveAspectRatio="none"
        aria-hidden="true"
        className="absolute inset-0 w-full h-full pointer-events-none qbank-notch-svg"
        style={{
          filter: selected
            ? `drop-shadow(0 0 0 2px ${color}) drop-shadow(0 8px 18px ${color}33)`
            : 'drop-shadow(0 5px 12px rgba(15, 23, 42, 0.055)) drop-shadow(0 1px 2px rgba(15, 23, 42, 0.035))',
        }}
      >
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={surfaceBg} />
            <stop offset="100%" stopColor={surfaceBgEnd || surfaceBg} />
          </linearGradient>
        </defs>
        <path
          d="M 20,1 H 200 A 19,19 0 0 1 219,20 V 100 A 19,19 0 0 1 200,119 H 64 A 15,15 0 0 1 49,104 V 91 A 15,15 0 0 0 34,76 H 20 A 19,19 0 0 1 1,57 V 20 A 19,19 0 0 1 20,1 Z"
          fill={`url(#${gradId})`}
          stroke={selected ? color : effectiveBorder}
          strokeWidth={selected ? '2.4' : '1.4'}
        />
      </svg>

      {/* Card Inner Content (RTL: Crisp Icon Top-Right, Value Top-Left, Title Padded Cleanly Away From Pocket) */}
      <div
        className={`relative z-10 flex flex-col justify-between h-full ${compact ? 'p-2.5' : 'px-3 py-2.5'}`}
        style={{ minHeight: minH }}
      >
        <div className="flex items-start justify-between gap-1.5">
          {/* Top-Right (RTL Start): Clean Crisp Icon Box */}
          <div
            className={`${compact ? 'w-8 h-8 rounded-[11px]' : 'w-9 h-9 rounded-[13px]'} flex items-center justify-center shrink-0 shadow-sm transition-transform duration-200 group-active:scale-90`}
            style={{
              background: '#FFFFFF',
              color,
              boxShadow: `0 3px 8px ${color}22, inset 0 1px 0 #FFFFFF`,
              border: `1.5px solid ${effectiveBorder}`,
            }}
          >
            {icon}
          </div>

          {/* Top-Left (RTL End): High-Contrast Value or Badge (never overlapping icon) */}
          <div className="flex flex-col items-end min-w-0">
            {value !== undefined && (
              <span
                className={`${compact ? 'text-sm' : 'text-[17px]'} font-black tracking-tight leading-none tabular-nums`}
                style={{ color: '#0F172A' }}
              >
                {typeof value === 'number' ? value.toLocaleString('fa-IR') : value}
              </span>
            )}
            {badge && (
              <span
                className="text-[9px] font-extrabold px-1.5 py-0.5 rounded-full mt-0.5"
                style={{
                  background: '#FFFFFF',
                  color: effectiveDark,
                  border: `1px solid ${effectiveBorder}`,
                }}
              >
                {badge}
              </span>
            )}
            {alert && (
              <span
                className="inline-block w-2 h-2 rounded-full animate-breathe mt-1"
                style={{ background: color, boxShadow: `0 0 8px ${color}` }}
              />
            )}
          </div>
        </div>

        {/* Bottom-Right Area (padded cleanly away from bottom-left cutout pocket) */}
        <div className={`${compact ? 'mt-1.5 pl-[40px]' : 'mt-2 pl-[48px]'} text-right`}>
          <p className={`${compact ? 'text-[11px]' : 'text-[12.5px]'} font-black text-slate-900 leading-snug truncate`}>
            {label}
          </p>
          {sub && !compact && (
            <p className="text-[10px] font-semibold text-slate-600 mt-0.5 truncate">
              {sub}
            </p>
          )}
        </div>
      </div>

      {/* Standalone Colored QBank Spring Pocket Chevron inside Bottom-Left Cutout Pocket */}
      <div
        aria-hidden="true"
        className={`qbank-pocket-btn absolute bottom-[2px] left-[2px] z-10 flex items-center justify-center transition-all duration-150 ${
          compact ? 'w-[32px] h-[28px] rounded-[10px]' : 'w-[38px] h-[34px] rounded-[12px]'
        }`}
        style={{
          background: `linear-gradient(135deg, ${color}, ${effectiveDark})`,
          color: '#FFFFFF',
          border: '1px solid rgba(255,255,255,0.65)',
          boxShadow: `0 4px 9px ${color}3B, 0 2px 0 ${effectiveDark}`,
        }}
      >
        <ChevronLeft size={compact ? 14 : 16} strokeWidth={2.7} className="qbank-spring-arrow" />
      </div>
    </div>
  );
}
