import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import { playTactileFeedback } from '@/lib/hapticsAudio';

export interface QBankTileProps {
  /** Module accent color (hex) */
  color: string;
  /** Soft pastel surface background fill */
  surfaceBg: string;
  /** Secondary pastel stop for subtle luxury gradient */
  surfaceBgEnd?: string;
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
 * Faithful to QBank's signature card geometry:
 * - Smooth concave inner fillet notch carved cleanly out of the bottom-left corner (zero sharp edges)
 * - Standalone rounded-square `<` chevron pocket button nestled inside the carved cutout
 * - Calming soft milky-pastel surface per module's unique color (never confusing or harsh)
 * - iOS 27 tactile haptics + soft acoustic click + mechanical key depression on tap
 */
export function QBankTile({
  color,
  surfaceBg,
  surfaceBgEnd,
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
      style={{ minHeight: '116px' }}
    >
      {/* Authentic QBank Curved-Notch SVG Surface (Smooth Concave Bottom-Left Cutout in RTL) */}
      <svg
        viewBox="0 0 220 120"
        preserveAspectRatio="none"
        aria-hidden="true"
        className="absolute inset-0 w-full h-full pointer-events-none qbank-notch-svg"
        style={{
          filter: selected
            ? `drop-shadow(0 0 0 2px ${color}) drop-shadow(0 8px 18px ${color}30)`
            : 'drop-shadow(0 6px 14px rgba(15, 23, 42, 0.08)) drop-shadow(0 1px 2px rgba(15, 23, 42, 0.05))',
        }}
      >
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={surfaceBg} />
            <stop offset="100%" stopColor={surfaceBgEnd || surfaceBg} />
          </linearGradient>
        </defs>
        {/*
          Smooth QBank Silhouette (220x120):
          - Top-left rounded (r=20)
          - Top-right rounded (r=20)
          - Bottom-right rounded (r=20)
          - Bottom edge travels left to x=68, curves smoothly UP (outer r=16) to y=88,
            curves smoothly LEFT (concave inner fillet r=16) into the pocket roof at y=74,
            curves smoothly UP along the left edge (r=18) — ZERO sharp corners!
        */}
        <path
          d="M 20,1 H 200 A 19,19 0 0 1 219,20 V 100 A 19,19 0 0 1 200,119 H 68 A 15,15 0 0 1 53,104 V 90 A 15,15 0 0 0 38,75 H 20 A 19,19 0 0 1 1,56 V 20 A 19,19 0 0 1 20,1 Z"
          fill={`url(#${gradId})`}
          stroke={selected ? color : 'rgba(255,255,255,0.92)'}
          strokeWidth={selected ? '2.2' : '1.4'}
        />
      </svg>

      {/* Card Inner Content (RTL: Icon top-right, Title & Value cleanly positioned with zero overlap) */}
      <div className="relative z-10 flex flex-col justify-between h-full p-3.5" style={{ minHeight: '116px' }}>
        <div className="flex items-start justify-between gap-2">
          {/* Top-Right (RTL Start): Clean Crisp Icon Box */}
          <div
            className="w-10 h-10 rounded-[14px] flex items-center justify-center shrink-0 shadow-sm transition-transform duration-200 group-active:scale-90"
            style={{
              background: '#FFFFFF',
              color,
              boxShadow: `0 3px 10px ${color}1F, inset 0 1px 0 #FFFFFF`,
              border: `1px solid ${color}24`,
            }}
          >
            {icon}
          </div>

          {/* Top-Left (RTL End): Live Value or Badge (never overlapping icon) */}
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
                className="text-[9px] font-extrabold px-2 py-0.5 rounded-full mt-0.5"
                style={{ background: `${color}1C`, color }}
              >
                {badge}
              </span>
            )}
            {alert && (
              <span
                className="inline-block w-2 h-2 rounded-full animate-breathe mt-1"
                style={{ background: color, boxShadow: `0 0 6px ${color}` }}
              />
            )}
          </div>
        </div>

        {/* Bottom-Right Area (padded away from bottom-left cutout pocket) */}
        <div className="mt-2.5 pl-[54px] text-right">
          <p className="text-[13px] font-black text-slate-800 leading-snug truncate">
            {label}
          </p>
          {sub && (
            <p className="text-[10px] font-semibold text-slate-500 mt-0.5 truncate">
              {sub}
            </p>
          )}
        </div>
      </div>

      {/* Standalone QBank Rounded-Square Chevron Button inside the Bottom-Left Cutout Pocket */}
      <div
        aria-hidden="true"
        className="qbank-pocket-btn absolute bottom-[2px] left-[2px] z-10 w-[40px] h-[36px] rounded-[13px] flex items-center justify-center transition-all duration-150"
        style={{
          background: '#FFFFFF',
          color,
          border: `1px solid ${color}28`,
          boxShadow: `0 3px 8px rgba(15, 23, 42, 0.08), 0 2px 0 ${color}22`,
        }}
      >
        <ChevronLeft size={17} strokeWidth={2.6} />
      </div>
    </div>
  );
}
