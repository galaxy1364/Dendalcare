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
  /** Optional test ID */
  testId?: string;
  onClick: () => void;
}

/**
 * 100% Authentic QBank Curved-Notch Folder Tile (RTL)
 * Trace ID: TRC-MINA-QBANK-9008-H
 *
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
  testId,
  onClick,
}: QBankTileProps) {
  const gradId = `qbt-${label.replace(/[^a-zA-Z0-9\u0600-\u06FF]/g, '')}-${color.replace('#', '')}`;
  const effectiveDark = darkColor || color;
  const effectiveBorder = borderColor || `${color}45`;

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
      style={{ minHeight: '122px' }}
    >
      {/* Authentic QBank Curved-Notch SVG Surface (Smooth Concave Bottom-Left Cutout in RTL) */}
      <svg
        viewBox="0 0 220 120"
        preserveAspectRatio="none"
        aria-hidden="true"
        className="absolute inset-0 w-full h-full pointer-events-none qbank-notch-svg"
        style={{
          filter: selected
            ? `drop-shadow(0 0 0 2px ${color}) drop-shadow(0 10px 22px ${color}33)`
            : 'drop-shadow(0 6px 14px rgba(15, 23, 42, 0.06)) drop-shadow(0 1px 3px rgba(15, 23, 42, 0.04))',
        }}
      >
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={surfaceBg} />
            <stop offset="100%" stopColor={surfaceBgEnd || surfaceBg} />
          </linearGradient>
        </defs>
        <path
          d="M 20,1 H 200 A 19,19 0 0 1 219,20 V 100 A 19,19 0 0 1 200,119 H 68 A 15,15 0 0 1 53,104 V 90 A 15,15 0 0 0 38,75 H 20 A 19,19 0 0 1 1,56 V 20 A 19,19 0 0 1 20,1 Z"
          fill={`url(#${gradId})`}
          stroke={selected ? color : effectiveBorder}
          strokeWidth={selected ? '2.4' : '1.5'}
        />
      </svg>

      {/* Card Inner Content (RTL: Icon top-right, Title & Value cleanly positioned with zero overlap) */}
      <div className="relative z-10 flex flex-col justify-between h-full p-3.5" style={{ minHeight: '122px' }}>
        <div className="flex items-start justify-between gap-2">
          {/* Top-Right (RTL Start): Clean Crisp Icon Box */}
          <div
            className="w-10 h-10 rounded-[14px] flex items-center justify-center shrink-0 shadow-sm transition-transform duration-200 group-active:scale-90"
            style={{
              background: '#FFFFFF',
              color,
              boxShadow: `0 4px 10px ${color}24, inset 0 1px 0 #FFFFFF`,
              border: `1.5px solid ${effectiveBorder}`,
            }}
          >
            {icon}
          </div>

          {/* Top-Left (RTL End): High-Contrast Value or Badge (never overlapping icon) */}
          <div className="flex flex-col items-end min-w-0">
            {value !== undefined && (
              <span
                className="text-lg font-black tracking-tight leading-none tabular-nums"
                style={{ color: '#0F172A' }}
              >
                {typeof value === 'number' ? value.toLocaleString('fa-IR') : value}
              </span>
            )}
            {badge && (
              <span
                className="text-[9.5px] font-extrabold px-2 py-0.5 rounded-full mt-0.5"
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
                className="inline-block w-2.5 h-2.5 rounded-full animate-breathe mt-1"
                style={{ background: color, boxShadow: `0 0 8px ${color}` }}
              />
            )}
          </div>
        </div>

        {/* Bottom-Right Area (padded away from bottom-left cutout pocket) */}
        <div className="mt-2.5 pl-[54px] text-right">
          <p className="text-[13px] font-black text-slate-900 leading-snug truncate">
            {label}
          </p>
          {sub && (
            <p className="text-[10.5px] font-semibold text-slate-600 mt-0.5 truncate">
              {sub}
            </p>
          )}
        </div>
      </div>

      {/* Standalone Colored QBank Spring Pocket Chevron inside Bottom-Left Cutout Pocket */}
      <div
        aria-hidden="true"
        className="qbank-pocket-btn absolute bottom-[2px] left-[2px] z-10 w-[40px] h-[36px] rounded-[13px] flex items-center justify-center transition-all duration-150"
        style={{
          background: `linear-gradient(135deg, ${color}, ${effectiveDark})`,
          color: '#FFFFFF',
          border: '1px solid rgba(255,255,255,0.65)',
          boxShadow: `0 4px 10px ${color}3D, 0 2px 0 ${effectiveDark}`,
        }}
      >
        <ChevronLeft size={17} strokeWidth={2.7} className="qbank-spring-arrow" />
      </div>
    </div>
  );
}
