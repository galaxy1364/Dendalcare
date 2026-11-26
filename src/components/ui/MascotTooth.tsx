import React, { useId, useState } from 'react';

export type MascotMood = 'happy' | 'sad' | 'pro' | 'ai' | 'celebrate' | 'offline';

interface MascotToothProps {
  mood?: MascotMood;
  size?: number;
  className?: string;
  showSparkles?: boolean;
  interactive?: boolean;
  /** Renders the royal-indigo (#1B0B47) app-icon squircle badge behind the crystal tooth */
  framed?: boolean;
  onClick?: () => void;
}

const MOOD_TITLES: Record<MascotMood, string> = {
  happy: 'دندان مینا — همه چیز مرتب و پرانرژی!',
  sad: 'دندان مینا — نیاز به توجه و بررسی فوری!',
  pro: 'دندان مینا — آماده ثبت و پیگیری تخصصی درمان',
  ai: 'دندان مینا — دستیار هوشمند کلینیک',
  celebrate: 'دندان مینا — عالی انجام شد!',
  offline: 'دندان مینا — حالت آفلاین و کش امن فعال است',
};

/**
 * Emotional Duolingo-style Iridescent Glass Tooth Mascot
 * Preserves the signature translucent 3D violet/pink/cyan aurora crystal tooth
 * from the beloved MinaDental emblem, brought to life with expressive eyes,
 * eyebrows, blush, sparkles, and contextual moods across header, notifications, and states.
 */
export const MascotTooth: React.FC<MascotToothProps> = ({
  mood = 'happy',
  size = 48,
  className = '',
  showSparkles = true,
  interactive = true,
  framed = false,
  onClick,
}) => {
  const [isClicked, setIsClicked] = useState(false);
  const uid = useId().replace(/:/g, '');

  const handleClick = () => {
    if (!interactive && !onClick) return;
    setIsClicked(true);
    setTimeout(() => setIsClicked(false), 450);
    if (onClick) onClick();
  };

  const auraBackground =
    mood === 'sad'
      ? 'radial-gradient(circle, rgba(244,63,94,0.52) 0%, rgba(168,85,247,0.22) 52%, transparent 74%)'
      : mood === 'pro'
      ? 'radial-gradient(circle, rgba(56,189,248,0.5) 0%, rgba(139,92,246,0.26) 54%, transparent 74%)'
      : mood === 'ai'
      ? 'radial-gradient(circle, rgba(192,132,252,0.58) 0%, rgba(244,114,182,0.3) 54%, transparent 74%)'
      : mood === 'celebrate'
      ? 'radial-gradient(circle, rgba(251,191,36,0.52) 0%, rgba(244,114,182,0.3) 52%, transparent 74%)'
      : mood === 'offline'
      ? 'radial-gradient(circle, rgba(148,163,184,0.42) 0%, rgba(99,102,241,0.18) 54%, transparent 74%)'
      : 'radial-gradient(circle, rgba(168,85,247,0.55) 0%, rgba(56,189,248,0.28) 55%, transparent 75%)';

  const frameStyle = framed
    ? {
        width: size,
        height: size,
        background: 'radial-gradient(circle at 50% 42%, #311473 0%, #1B0B47 64%, #120633 100%)',
        borderRadius: Math.max(10, Math.round(size * 0.27)),
        padding: Math.max(3, Math.round(size * 0.08)),
        boxShadow: '0 6px 16px rgba(27, 11, 71, 0.34), inset 0 1px 1px rgba(255,255,255,0.22)',
      }
    : { width: size, height: size };

  return (
    <div
      data-testid="minadental_mascot_tooth"
      data-mascot-mood={mood}
      onClick={handleClick}
      className={`relative inline-flex items-center justify-center transition-transform duration-300 select-none ${
        interactive ? 'cursor-pointer hover:scale-110 active:scale-95' : ''
      } ${isClicked ? 'animate-bounce' : ''} ${className}`}
      style={frameStyle}
      title={MOOD_TITLES[mood]}
    >
      {/* Luminous Iridescent Aura Glow */}
      <div
        className="absolute inset-0 rounded-full blur-md opacity-70 transition-colors duration-500 pointer-events-none"
        style={{ background: auraBackground }}
      />

      {/* Translucent 3D Iridescent Crystal Tooth SVG */}
      <svg
        viewBox="0 0 100 108"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="relative z-10 w-full h-full overflow-visible mascot-breathe"
        aria-hidden="true"
      >
        <defs>
          {/* Main Iridescent Glass Body (Violet -> Pink -> Cyan Aurora) */}
          <linearGradient id={`${uid}_body`} x1="14" y1="8" x2="88" y2="100" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor={mood === 'offline' ? '#E2E8F0' : '#E0F2FE'} />
            <stop offset="30%" stopColor={mood === 'sad' ? '#C4B5FD' : '#C084FC'} />
            <stop offset="66%" stopColor={mood === 'sad' ? '#FB7185' : '#F472B6'} />
            <stop offset="100%" stopColor={mood === 'offline' ? '#94A3B8' : '#38BDF8'} />
          </linearGradient>

          {/* Inner Luminous Nebula Swirl */}
          <radialGradient id={`${uid}_nebula`} cx="58%" cy="48%" r="48%">
            <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.82" />
            <stop offset="48%" stopColor="#E879F9" stopOpacity="0.58" />
            <stop offset="100%" stopColor="#5B21B6" stopOpacity="0.08" />
          </radialGradient>

          {/* Secondary Warm Pink-Gold Inner Ribbon */}
          <linearGradient id={`${uid}_ribbon`} x1="20" y1="82" x2="82" y2="24" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#F472B6" stopOpacity="0.85" />
            <stop offset="50%" stopColor="#38BDF8" stopOpacity="0.72" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.5" />
          </linearGradient>

          {/* Crystal Glass Rim Stroke */}
          <linearGradient id={`${uid}_rim`} x1="12" y1="10" x2="88" y2="98" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="48%" stopColor="#F5D0FE" />
            <stop offset="100%" stopColor="#7DD3FC" />
          </linearGradient>

          {/* Specular Top-Left Glass Highlight */}
          <linearGradient id={`${uid}_gloss`} x1="20" y1="12" x2="48" y2="54" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.94" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
          </linearGradient>

          {/* AI Cyber Halo Gradient */}
          <linearGradient id={`${uid}_halo`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#38BDF8" />
            <stop offset="50%" stopColor="#C084FC" />
            <stop offset="100%" stopColor="#F472B6" />
          </linearGradient>

          <filter id={`${uid}_drop`} x="-22%" y="-22%" width="144%" height="144%">
            <feDropShadow dx="0" dy="4" stdDeviation="3.2" floodColor="#1B0B47" floodOpacity="0.34" />
          </filter>
        </defs>

        {/* AI Floating Cosmic Halo */}
        {mood === 'ai' && (
          <ellipse
            cx="50"
            cy="14"
            rx="30"
            ry="7"
            fill="none"
            stroke={`url(#${uid}_halo)`}
            strokeWidth="2.8"
            strokeDasharray="6 3"
          />
        )}

        {/* Outer Sculpted 3D Crystal Tooth Silhouette */}
        <path
          d="M 29,14
             C 14,14 9,33 13,52
             C 16,66 23,86 33,98
             C 38,104 44,103 47,93
             C 49,85 51,85 53,93
             C 56,103 62,104 67,98
             C 77,86 84,66 87,52
             C 91,33 86,14 71,14
             C 61,14 56,21 50,21
             C 44,21 39,14 29,14 Z"
          fill={`url(#${uid}_body)`}
          stroke={`url(#${uid}_rim)`}
          strokeWidth="2.6"
          strokeLinejoin="round"
          filter={`url(#${uid}_drop)`}
        />

        {/* Iridescent Aurora Swirl Inside Glass */}
        <path
          d="M 29,14
             C 14,14 9,33 13,52
             C 16,66 23,86 33,98
             C 38,104 44,103 47,93
             C 49,85 51,85 53,93
             C 56,103 62,104 67,98
             C 77,86 84,66 87,52
             C 91,33 86,14 71,14
             C 61,14 56,21 50,21
             C 44,21 39,14 29,14 Z"
          fill={`url(#${uid}_nebula)`}
        />

        {/* Luminous Internal Aurora Ribbon */}
        <path
          d="M 26,76 C 36,64 46,66 56,55 C 65,45 73,37 78,24 C 76,42 68,58 58,67 C 49,75 38,76 31,88 Z"
          fill={`url(#${uid}_ribbon)`}
          opacity="0.62"
        />

        {/* Glossy 3D Top-Left Specular Glass Reflection */}
        <path
          d="M 27,20 C 19,21 16,34 18,46 C 19,53 22,60 25,66 C 24,49 28,35 36,28 C 40,24 44,24 46,25 C 39,20 33,19 27,20 Z"
          fill={`url(#${uid}_gloss)`}
        />
        <ellipse cx="26" cy="27" rx="5.5" ry="3" transform="rotate(-34 26 27)" fill="#FFFFFF" opacity="0.88" />

        {/* Soft Glowing Rosy Cheeks */}
        <ellipse
          cx="26"
          cy="58"
          rx="6"
          ry="3.4"
          fill={mood === 'sad' ? '#FDA4AF' : '#FB7185'}
          opacity={mood === 'offline' ? 0.35 : 0.72}
        />
        <ellipse
          cx="74"
          cy="58"
          rx="6"
          ry="3.4"
          fill={mood === 'sad' ? '#FDA4AF' : '#FB7185'}
          opacity={mood === 'offline' ? 0.35 : 0.72}
        />

        {/* ===== DUOLINGO-STYLE EXPRESSIVE EYES & EYEBROWS ===== */}
        {(mood === 'happy' || mood === 'celebrate') && (
          <g className="mascot-eyes">
            {/* Joyful Raised Eyebrows */}
            <path d="M 30,36 Q 36,32 42,35" stroke="#2E1065" strokeWidth="2.4" strokeLinecap="round" fill="none" />
            <path d="M 58,35 Q 64,32 70,36" stroke="#2E1065" strokeWidth="2.4" strokeLinecap="round" fill="none" />

            {/* Left Glossy Eye */}
            <circle cx="36" cy="48" r="8.2" fill="#FFFFFF" />
            <circle cx="36.5" cy="48" r="6.3" fill="#1E1B4B" />
            <circle cx="34" cy="45.2" r="2.4" fill="#FFFFFF" />
            <circle cx="39" cy="50.5" r="1.2" fill="#7DD3FC" />
            {mood === 'celebrate' && (
              <path d="M 37,44 L 38,46.5 L 40.5,47.5 L 38,48.5 L 37,51 L 36,48.5 L 33.5,47.5 L 36,46.5 Z" fill="#FDE047" />
            )}

            {/* Right Glossy Eye */}
            <circle cx="64" cy="48" r="8.2" fill="#FFFFFF" />
            <circle cx="63.5" cy="48" r="6.3" fill="#1E1B4B" />
            <circle cx="61" cy="45.2" r="2.4" fill="#FFFFFF" />
            <circle cx="66" cy="50.5" r="1.2" fill="#7DD3FC" />
            {mood === 'celebrate' && (
              <path d="M 63,44 L 64,46.5 L 66.5,47.5 L 64,48.5 L 63,51 L 62,48.5 L 59.5,47.5 L 62,46.5 Z" fill="#FDE047" />
            )}
          </g>
        )}

        {mood === 'pro' && (
          <g>
            {/* Confident Wink + Clinical Sparkle */}
            <path d="M 29,37 Q 36,33 42,36" stroke="#2E1065" strokeWidth="2.4" strokeLinecap="round" fill="none" />
            <path d="M 29,48 Q 36,41 43,48" stroke="#1E1B4B" strokeWidth="3.2" strokeLinecap="round" fill="none" />

            <path d="M 58,36 Q 64,32 71,36" stroke="#2E1065" strokeWidth="2.4" strokeLinecap="round" fill="none" />
            <circle cx="64" cy="48" r="8" fill="#FFFFFF" />
            <circle cx="63.5" cy="48" r="6.1" fill="#1E1B4B" />
            <circle cx="61.2" cy="45.4" r="2.4" fill="#FFFFFF" />
            <circle cx="66" cy="50.4" r="1.1" fill="#38BDF8" />
          </g>
        )}

        {mood === 'ai' && (
          <g>
            {/* Futuristic Glossy Visor with Glowing Expressive Eyes */}
            <rect x="23" y="39" width="54" height="17" rx="8.5" fill="#1B0B47" stroke="#7DD3FC" strokeWidth="1.8" />
            <circle cx="37" cy="47.5" r="4.3" fill="#38BDF8" />
            <circle cx="35.6" cy="46" r="1.6" fill="#FFFFFF" />
            <circle cx="63" cy="47.5" r="4.3" fill="#F472B6" />
            <circle cx="61.6" cy="46" r="1.6" fill="#FFFFFF" />
          </g>
        )}

        {mood === 'sad' && (
          <g>
            {/* Empathetic Worried Duolingo Eyebrows + Pleading Glossy Eyes */}
            <path d="M 29,39 Q 35,37 42,34" stroke="#2E1065" strokeWidth="2.6" strokeLinecap="round" fill="none" />
            <path d="M 71,39 Q 65,37 58,34" stroke="#2E1065" strokeWidth="2.6" strokeLinecap="round" fill="none" />

            <circle cx="36" cy="49" r="7.8" fill="#FFFFFF" />
            <circle cx="36.5" cy="49.5" r="5.8" fill="#1E1B4B" />
            <circle cx="34.2" cy="47" r="2.4" fill="#FFFFFF" />
            <circle cx="38.5" cy="52" r="1.1" fill="#BAE6FD" />

            <circle cx="64" cy="49" r="7.8" fill="#FFFFFF" />
            <circle cx="63.5" cy="49.5" r="5.8" fill="#1E1B4B" />
            <circle cx="61.2" cy="47" r="2.4" fill="#FFFFFF" />
            <circle cx="65.5" cy="52" r="1.1" fill="#BAE6FD" />

            {/* Shimmering Teardrop */}
            <path
              d="M 73,57 C 73,57 78,64 74.5,68 C 71.5,70.5 68,67.5 70.2,62.5 Z"
              fill="#38BDF8"
              stroke="#FFFFFF"
              strokeWidth="1"
            />
          </g>
        )}

        {mood === 'offline' && (
          <g>
            {/* Cozy Sleepy Curved Eyes */}
            <path d="M 29,48 Q 36,53 43,48" stroke="#1E1B4B" strokeWidth="3" strokeLinecap="round" fill="none" />
            <path d="M 57,48 Q 64,53 71,48" stroke="#1E1B4B" strokeWidth="3" strokeLinecap="round" fill="none" />
            <text x="74" y="30" fill="#E0F2FE" fontSize="11" fontWeight="900" fontFamily="sans-serif">
              z
            </text>
            <text x="82" y="22" fill="#C4B5FD" fontSize="9" fontWeight="900" fontFamily="sans-serif">
              z
            </text>
          </g>
        )}

        {/* ===== EXPRESSIVE MOUTH LAYER ===== */}
        {(mood === 'happy' || mood === 'pro') && (
          <path
            d="M 42,58 Q 50,67 58,58"
            fill="none"
            stroke="#2E1065"
            strokeWidth="3.2"
            strokeLinecap="round"
          />
        )}

        {mood === 'celebrate' && (
          <g>
            <path d="M 38,57 Q 50,71 62,57 Z" fill="#F43F5E" stroke="#2E1065" strokeWidth="2.2" strokeLinejoin="round" />
            <path d="M 42,57.5 Q 50,62 58,57.5" fill="#FFFFFF" />
          </g>
        )}

        {mood === 'ai' && (
          <path
            d="M 44,60 Q 50,66 56,60"
            fill="none"
            stroke="#2E1065"
            strokeWidth="3"
            strokeLinecap="round"
          />
        )}

        {mood === 'sad' && (
          <path
            d="M 42,65 Q 50,58 58,65"
            fill="none"
            stroke="#2E1065"
            strokeWidth="3"
            strokeLinecap="round"
          />
        )}

        {mood === 'offline' && (
          <circle cx="50" cy="61" r="2.8" fill="#2E1065" />
        )}

        {/* ===== FLOATING DIAMOND SPARKLES ===== */}
        {showSparkles && mood !== 'offline' && (
          <g className="mascot-sparkle">
            <path
              d="M 10,28 L 12,22 L 18,20 L 12,18 L 10,12 L 8,18 L 2,20 L 8,22 Z"
              fill={mood === 'sad' ? '#FDA4AF' : '#FFFFFF'}
            />
            <path
              d="M 88,26 L 90.2,20 L 96,17.8 L 90.2,15.6 L 88,10 L 85.8,15.6 L 80,17.8 L 85.8,20 Z"
              fill={mood === 'celebrate' ? '#FDE047' : '#7DD3FC'}
            />
            <path
              d="M 13,74 L 14.5,70 L 18.5,68.5 L 14.5,67 L 13,63 L 11.5,67 L 7.5,68.5 L 11.5,70 Z"
              fill="#F9A8D4"
            />
          </g>
        )}
      </svg>
    </div>
  );
};
