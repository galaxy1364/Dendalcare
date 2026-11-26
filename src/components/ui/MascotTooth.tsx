import React, { useId, useState } from 'react';

export type MascotMood =
  | 'happy'
  | 'concerned'
  | 'sad'
  | 'celebrating'
  | 'thinking'
  | 'offline'
  | 'neutral'
  | 'pro'
  | 'ai'
  | 'celebrate';

type CanonicalMascotMood =
  | 'happy'
  | 'concerned'
  | 'sad'
  | 'celebrating'
  | 'thinking'
  | 'offline'
  | 'neutral';

interface MascotToothProps {
  mood?: MascotMood;
  /** Adaptive mascot size in CSS px (recommended 44–56px across app shell & notifications) */
  size?: number;
  className?: string;
  showSparkles?: boolean;
  interactive?: boolean;
  /** Deprecated: GE-0008 enforces frameless transparent 3D mascot inside the app */
  framed?: boolean;
  onClick?: () => void;
}

function resolveCanonicalMood(mood: MascotMood): CanonicalMascotMood {
  switch (mood) {
    case 'celebrate':
    case 'celebrating':
      return 'celebrating';
    case 'ai':
    case 'thinking':
      return 'thinking';
    case 'pro':
    case 'happy':
      return 'happy';
    case 'concerned':
      return 'concerned';
    case 'sad':
      return 'sad';
    case 'offline':
      return 'offline';
    case 'neutral':
    default:
      return 'neutral';
  }
}

const MOOD_ACCESSIBLE_LABELS: Record<CanonicalMascotMood, string> = {
  happy: 'مینادنتال — همه کارهای تأییدشده کلینیک کامل و مرتب است',
  concerned: 'مینادنتال — کارهای در انتظار پیگیری وجود دارد',
  sad: 'مینادنتال — موارد معوق یا فوری نیازمند رسیدگی است',
  celebrating: 'مینادنتال — کار با موفقیت تکمیل شد',
  thinking: 'مینادنتال — در حال پردازش و همگام‌سازی',
  offline: 'مینادنتال — حالت آفلاین فعال است',
  neutral: 'مینادنتال — وضعیت کلینیک در حال بررسی است',
};

/**
 * GE-0008 Frameless Sculpted 3D Emotional Tooth Mascot
 * - Transparent background everywhere inside the app (no dark square/squircle frame).
 * - Sculpted 3D anatomical molar geometry with multi-layer lighting, subsurface violet/pink/cyan
 *   aurora refraction, glossy enamel specular dome, and ambient contact depth.
 * - Deterministic 7-state emotional engine driven strictly by real authorized clinic tasks
 *   (happy, concerned, sad, celebrating, thinking, offline, neutral) with zero patient PHI.
 * - Battery-efficient GPU-composited motion that respects prefers-reduced-motion & data-reduce-motion.
 */
export const MascotTooth: React.FC<MascotToothProps> = ({
  mood = 'happy',
  size = 48,
  className = '',
  showSparkles = true,
  interactive = true,
  onClick,
}) => {
  const [isReacting, setIsReacting] = useState(false);
  const uid = useId().replace(/:/g, '');
  const canonicalMood = resolveCanonicalMood(mood);
  const accessibleLabel = MOOD_ACCESSIBLE_LABELS[canonicalMood];

  const handleInteract = () => {
    if (!interactive && !onClick) return;
    setIsReacting(true);
    window.setTimeout(() => setIsReacting(false), 420);
    if (onClick) onClick();
  };

  // Multi-stop sculptural 3D body tones tuned per emotional state (preserving #1B0B47 / #C084FC / #38BDF8 aurora DNA)
  const palette = {
    happy: {
      top: '#F5F3FF',
      mid: '#C084FC',
      warm: '#F472B6',
      base: '#38BDF8',
      cheek: '#FB7185',
      shadow: '#1B0B47',
    },
    concerned: {
      top: '#FEF9C3',
      mid: '#C084FC',
      warm: '#F59E0B',
      base: '#38BDF8',
      cheek: '#FDBA74',
      shadow: '#1B0B47',
    },
    sad: {
      top: '#EDE9FE',
      mid: '#A78BFA',
      warm: '#FB7185',
      base: '#60A5FA',
      cheek: '#FDA4AF',
      shadow: '#1B0B47',
    },
    celebrating: {
      top: '#FFFBEB',
      mid: '#E879F9',
      warm: '#F472B6',
      base: '#38BDF8',
      cheek: '#FB7185',
      shadow: '#1B0B47',
    },
    thinking: {
      top: '#E0F2FE',
      mid: '#818CF8',
      warm: '#C084FC',
      base: '#22D3EE',
      cheek: '#F472B6',
      shadow: '#1B0B47',
    },
    offline: {
      top: '#F1F5F9',
      mid: '#CBD5E1',
      warm: '#94A3B8',
      base: '#64748B',
      cheek: '#CBD5E1',
      shadow: '#1E293B',
    },
    neutral: {
      top: '#F8FAFC',
      mid: '#DDD6FE',
      warm: '#C084FC',
      base: '#7DD3FC',
      cheek: '#F9A8D4',
      shadow: '#1B0B47',
    },
  }[canonicalMood];

  return (
    <div
      data-testid="minadental_mascot_tooth"
      data-mascot-mood={canonicalMood}
      data-mascot-frameless="true"
      role="img"
      aria-label={accessibleLabel}
      title={accessibleLabel}
      onClick={handleInteract}
      className={`relative inline-flex items-center justify-center bg-transparent select-none transition-transform duration-200 ease-out ${
        interactive ? 'cursor-pointer hover:scale-108 active:scale-92' : ''
      } ${isReacting ? 'mascot-touch-pop' : ''} ${className}`}
      style={{ width: size, height: size }}
    >
      {/* Purely Transparent Frameless 3D Sculpted Crystal Tooth SVG */}
      <svg
        viewBox="0 0 112 118"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full overflow-visible mascot-breathe"
        aria-hidden="true"
      >
        <defs>
          {/* Sculpted 3D Volumetric Enamel + Crystal Body Gradient */}
          <radialGradient id={`${uid}_vol`} cx="34%" cy="24%" r="76%" fx="28%" fy="20%">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="22%" stopColor={palette.top} />
            <stop offset="56%" stopColor={palette.mid} />
            <stop offset="82%" stopColor={palette.warm} />
            <stop offset="100%" stopColor={palette.base} />
          </radialGradient>

          {/* Deep Subsurface Scattering Core */}
          <radialGradient id={`${uid}_core`} cx="64%" cy="58%" r="52%">
            <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.65" />
            <stop offset="50%" stopColor="#E879F9" stopOpacity="0.42" />
            <stop offset="100%" stopColor="#1B0B47" stopOpacity="0.16" />
          </radialGradient>

          {/* 3D Root Occlusion Depth Shading */}
          <linearGradient id={`${uid}_depth`} x1="56" y1="68" x2="56" y2="110" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#1B0B47" stopOpacity="0" />
            <stop offset="100%" stopColor={palette.shadow} stopOpacity="0.34" />
          </linearGradient>

          {/* Crisp Pearlescent Rim Light */}
          <linearGradient id={`${uid}_rim`} x1="16" y1="12" x2="96" y2="104" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.98" />
            <stop offset="46%" stopColor="#F5D0FE" stopOpacity="0.92" />
            <stop offset="100%" stopColor="#7DD3FC" stopOpacity="0.92" />
          </linearGradient>

          {/* Wet Glass Top-Left Specular Dome */}
          <linearGradient id={`${uid}_spec`} x1="22" y1="14" x2="52" y2="58" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.95" />
            <stop offset="65%" stopColor="#FFFFFF" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
          </linearGradient>

          {/* Floating Ground Shadow for True 3D Depth */}
          <radialGradient id={`${uid}_ground`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={palette.shadow} stopOpacity="0.28" />
            <stop offset="70%" stopColor={palette.shadow} stopOpacity="0.08" />
            <stop offset="100%" stopColor={palette.shadow} stopOpacity="0" />
          </radialGradient>

          <filter id={`${uid}_softDrop`} x="-18%" y="-18%" width="136%" height="140%">
            <feDropShadow dx="0" dy="5" stdDeviation="3.4" floodColor="#1B0B47" floodOpacity="0.24" />
          </filter>
        </defs>

        {/* Soft Ambient Ground Shadow (Floating 3D Presence) */}
        <ellipse cx="56" cy="111" rx="28" ry="5.2" fill={`url(#${uid}_ground)`} />

        {/* Thinking Orbit Dots (Processing State) */}
        {canonicalMood === 'thinking' && (
          <g className="mascot-sparkle">
            <circle cx="88" cy="20" r="4.2" fill="#38BDF8" stroke="#FFFFFF" strokeWidth="1.4" />
            <circle cx="98" cy="12" r="3" fill="#C084FC" stroke="#FFFFFF" strokeWidth="1.2" />
            <circle cx="79" cy="28" r="2.4" fill="#F472B6" />
          </g>
        )}

        {/* Sculpted 3D Anatomical Tooth Body */}
        <path
          d="M 33,15
             C 17,15 11,34 15,54
             C 18,70 26,91 36,104
             C 42,110 49,108 52,97
             C 54.5,88 57.5,88 60,97
             C 63,108 70,110 76,104
             C 86,91 94,70 97,54
             C 101,34 95,15 79,15
             C 68,15 62.5,22.5 56,22.5
             C 49.5,22.5 44,15 33,15 Z"
          fill={`url(#${uid}_vol)`}
          stroke={`url(#${uid}_rim)`}
          strokeWidth="2.4"
          strokeLinejoin="round"
          filter={`url(#${uid}_softDrop)`}
        />

        {/* Subsurface Iridescent Core Refraction */}
        <path
          d="M 33,15
             C 17,15 11,34 15,54
             C 18,70 26,91 36,104
             C 42,110 49,108 52,97
             C 54.5,88 57.5,88 60,97
             C 63,108 70,110 76,104
             C 86,91 94,70 97,54
             C 101,34 95,15 79,15
             C 68,15 62.5,22.5 56,22.5
             C 49.5,22.5 44,15 33,15 Z"
          fill={`url(#${uid}_core)`}
        />

        {/* Sculpted Lower Root Ambient Occlusion */}
        <path
          d="M 18,62 C 22,78 29,94 37,104 C 42,109 49,107 52,97 C 54.5,88 57.5,88 60,97 C 63,107 70,109 75,104 C 83,94 90,78 94,62 C 84,78 72,82 56,82 C 40,82 28,78 18,62 Z"
          fill={`url(#${uid}_depth)`}
        />

        {/* Crown Cusp 3D Specular Highlights */}
        <path
          d="M 31,21 C 22,23 19,35 21,49 C 22,56 25,63 28,69 C 27,51 31,37 40,30 C 44,26 48,26 51,27 C 44,21 37,20 31,21 Z"
          fill={`url(#${uid}_spec)`}
        />
        <ellipse cx="30" cy="29" rx="6.5" ry="3.2" transform="rotate(-32 30 29)" fill="#FFFFFF" opacity="0.92" />
        <ellipse cx="81" cy="29" rx="4.5" ry="2.2" transform="rotate(28 81 29)" fill="#FFFFFF" opacity="0.56" />

        {/* Soft Dimensional Cheek Blush */}
        <ellipse
          cx="30"
          cy="63"
          rx="6.6"
          ry="3.6"
          fill={palette.cheek}
          opacity={canonicalMood === 'offline' ? 0.28 : 0.72}
        />
        <ellipse
          cx="82"
          cy="63"
          rx="6.6"
          ry="3.6"
          fill={palette.cheek}
          opacity={canonicalMood === 'offline' ? 0.28 : 0.72}
        />

        {/* ===== EXPRESSIVE 3D EYES & EYEBROWS ===== */}
        {(canonicalMood === 'happy' || canonicalMood === 'celebrating') && (
          <g className="mascot-eyes">
            <path d="M 33,39 Q 40,34.5 47,38" stroke="#1E1B4B" strokeWidth="2.6" strokeLinecap="round" fill="none" />
            <path d="M 65,38 Q 72,34.5 79,39" stroke="#1E1B4B" strokeWidth="2.6" strokeLinecap="round" fill="none" />

            <circle cx="40.5" cy="52" r="8.8" fill="#FFFFFF" />
            <circle cx="41" cy="52" r="6.6" fill="#1E1B4B" />
            <circle cx="38.2" cy="49" r="2.6" fill="#FFFFFF" />
            <circle cx="43.8" cy="54.8" r="1.3" fill="#7DD3FC" />
            {canonicalMood === 'celebrating' && (
              <path d="M 41,47.5 L 42.2,50.5 L 45.2,51.7 L 42.2,52.9 L 41,55.9 L 39.8,52.9 L 36.8,51.7 L 39.8,50.5 Z" fill="#FDE047" />
            )}

            <circle cx="71.5" cy="52" r="8.8" fill="#FFFFFF" />
            <circle cx="71" cy="52" r="6.6" fill="#1E1B4B" />
            <circle cx="68.2" cy="49" r="2.6" fill="#FFFFFF" />
            <circle cx="73.8" cy="54.8" r="1.3" fill="#7DD3FC" />
            {canonicalMood === 'celebrating' && (
              <path d="M 71,47.5 L 72.2,50.5 L 75.2,51.7 L 72.2,52.9 L 71,55.9 L 69.8,52.9 L 66.8,51.7 L 69.8,50.5 Z" fill="#FDE047" />
            )}
          </g>
        )}

        {canonicalMood === 'concerned' && (
          <g className="mascot-eyes">
            {/* Gently Tilted Attentive Eyebrows */}
            <path d="M 33,40 Q 40,38.5 47,36.5" stroke="#1E1B4B" strokeWidth="2.6" strokeLinecap="round" fill="none" />
            <path d="M 79,40 Q 72,38.5 65,36.5" stroke="#1E1B4B" strokeWidth="2.6" strokeLinecap="round" fill="none" />

            <circle cx="40.5" cy="52.5" r="8.5" fill="#FFFFFF" />
            <circle cx="41.5" cy="52.5" r="6.2" fill="#1E1B4B" />
            <circle cx="38.8" cy="49.8" r="2.5" fill="#FFFFFF" />
            <circle cx="44" cy="55" r="1.2" fill="#FDE68A" />

            <circle cx="71.5" cy="52.5" r="8.5" fill="#FFFFFF" />
            <circle cx="70.5" cy="52.5" r="6.2" fill="#1E1B4B" />
            <circle cx="68" cy="49.8" r="2.5" fill="#FFFFFF" />
            <circle cx="73.2" cy="55" r="1.2" fill="#FDE68A" />
          </g>
        )}

        {canonicalMood === 'sad' && (
          <g className="mascot-eyes">
            <path d="M 33,42 Q 39.5,39.5 47,36" stroke="#1E1B4B" strokeWidth="2.7" strokeLinecap="round" fill="none" />
            <path d="M 79,42 Q 72.5,39.5 65,36" stroke="#1E1B4B" strokeWidth="2.7" strokeLinecap="round" fill="none" />

            <circle cx="40.5" cy="53" r="8.4" fill="#FFFFFF" />
            <circle cx="41" cy="53.6" r="6.1" fill="#1E1B4B" />
            <circle cx="38.5" cy="50.8" r="2.6" fill="#FFFFFF" />
            <circle cx="43.5" cy="56.2" r="1.2" fill="#BAE6FD" />

            <circle cx="71.5" cy="53" r="8.4" fill="#FFFFFF" />
            <circle cx="71" cy="53.6" r="6.1" fill="#1E1B4B" />
            <circle cx="68.5" cy="50.8" r="2.6" fill="#FFFFFF" />
            <circle cx="73.5" cy="56.2" r="1.2" fill="#BAE6FD" />

            {/* Crystal Teardrop */}
            <path
              d="M 81,61 C 81,61 86.5,68.5 82.6,73 C 79.4,75.8 75.5,72.4 77.9,67 Z"
              fill="#38BDF8"
              stroke="#FFFFFF"
              strokeWidth="1.2"
            />
          </g>
        )}

        {canonicalMood === 'thinking' && (
          <g className="mascot-eyes">
            <path d="M 33,38.5 Q 40,35.5 47,37.5" stroke="#1E1B4B" strokeWidth="2.5" strokeLinecap="round" fill="none" />
            <path d="M 65,36.5 Q 72,33.5 79,37" stroke="#1E1B4B" strokeWidth="2.5" strokeLinecap="round" fill="none" />

            {/* Upward-Right Focused Thinking Gaze */}
            <circle cx="40.5" cy="52" r="8.5" fill="#FFFFFF" />
            <circle cx="42.5" cy="50" r="6.1" fill="#1E1B4B" />
            <circle cx="40.2" cy="47.8" r="2.4" fill="#FFFFFF" />

            <circle cx="71.5" cy="52" r="8.5" fill="#FFFFFF" />
            <circle cx="73.5" cy="50" r="6.1" fill="#1E1B4B" />
            <circle cx="71.2" cy="47.8" r="2.4" fill="#FFFFFF" />
          </g>
        )}

        {canonicalMood === 'neutral' && (
          <g className="mascot-eyes">
            <path d="M 34,39 Q 40.5,38 47,39" stroke="#1E1B4B" strokeWidth="2.4" strokeLinecap="round" fill="none" />
            <path d="M 65,39 Q 71.5,38 78,39" stroke="#1E1B4B" strokeWidth="2.4" strokeLinecap="round" fill="none" />

            <circle cx="40.5" cy="52" r="8.2" fill="#FFFFFF" />
            <circle cx="40.8" cy="52" r="5.9" fill="#1E1B4B" />
            <circle cx="38.4" cy="49.4" r="2.3" fill="#FFFFFF" />

            <circle cx="71.5" cy="52" r="8.2" fill="#FFFFFF" />
            <circle cx="71.2" cy="52" r="5.9" fill="#1E1B4B" />
            <circle cx="68.8" cy="49.4" r="2.3" fill="#FFFFFF" />
          </g>
        )}

        {canonicalMood === 'offline' && (
          <g>
            <path d="M 33,52 Q 40.5,57.5 48,52" stroke="#1E293B" strokeWidth="3.1" strokeLinecap="round" fill="none" />
            <path d="M 64,52 Q 71.5,57.5 79,52" stroke="#1E293B" strokeWidth="3.1" strokeLinecap="round" fill="none" />
            <text x="84" y="30" fill="#475569" fontSize="12" fontWeight="900" fontFamily="sans-serif">z</text>
            <text x="93" y="21" fill="#64748B" fontSize="9.5" fontWeight="900" fontFamily="sans-serif">z</text>
          </g>
        )}

        {/* ===== EXPRESSIVE MOUTH ===== */}
        {canonicalMood === 'happy' && (
          <path d="M 47,63.5 Q 56,73 65,63.5" fill="none" stroke="#1E1B4B" strokeWidth="3.3" strokeLinecap="round" />
        )}

        {canonicalMood === 'celebrating' && (
          <g>
            <path d="M 43,62 Q 56,77.5 69,62 Z" fill="#F43F5E" stroke="#1E1B4B" strokeWidth="2.4" strokeLinejoin="round" />
            <path d="M 47,62.5 Q 56,67.2 65,62.5" fill="#FFFFFF" />
          </g>
        )}

        {canonicalMood === 'concerned' && (
          <path d="M 48,66 Q 56,63.5 64,66" fill="none" stroke="#1E1B4B" strokeWidth="3.1" strokeLinecap="round" />
        )}

        {canonicalMood === 'sad' && (
          <path d="M 47,70 Q 56,62.5 65,70" fill="none" stroke="#1E1B4B" strokeWidth="3.2" strokeLinecap="round" />
        )}

        {canonicalMood === 'thinking' && (
          <path d="M 50,65.5 Q 56,67 62,64.5" fill="none" stroke="#1E1B4B" strokeWidth="3" strokeLinecap="round" />
        )}

        {canonicalMood === 'neutral' && (
          <path d="M 49,65.5 L 63,65.5" fill="none" stroke="#1E1B4B" strokeWidth="3" strokeLinecap="round" />
        )}

        {canonicalMood === 'offline' && (
          <circle cx="56" cy="65.5" r="2.8" fill="#1E293B" />
        )}

        {/* Subtle Luminous Sparkles (Celebration & Happy Accent) */}
        {showSparkles && (canonicalMood === 'happy' || canonicalMood === 'celebrating') && (
          <g className="mascot-sparkle">
            <path
              d="M 10,30 L 12.2,23.5 L 18.5,21.5 L 12.2,19.5 L 10,13 L 7.8,19.5 L 1.5,21.5 L 7.8,23.5 Z"
              fill={canonicalMood === 'celebrating' ? '#FDE047' : '#C084FC'}
            />
            <path
              d="M 100,28 L 102.2,22 L 108,20 L 102.2,18 L 100,12 L 97.8,18 L 92,20 L 97.8,22 Z"
              fill={canonicalMood === 'celebrating' ? '#F472B6' : '#38BDF8'}
            />
          </g>
        )}
      </svg>
    </div>
  );
};
