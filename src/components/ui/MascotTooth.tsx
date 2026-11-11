import React, { useState } from 'react';

export type MascotMood = 'happy' | 'sad' | 'pro' | 'ai';

interface MascotToothProps {
  mood?: MascotMood;
  size?: number;
  className?: string;
  showSparkles?: boolean;
  interactive?: boolean;
  onClick?: () => void;
}

export const MascotTooth: React.FC<MascotToothProps> = ({
  mood = 'happy',
  size = 48,
  className = '',
  showSparkles = true,
  interactive = true,
  onClick,
}) => {
  const [isClicked, setIsClicked] = useState(false);

  const handleClick = () => {
    setIsClicked(true);
    setTimeout(() => setIsClicked(false), 400);
    if (onClick) onClick();
  };

  return (
    <div
      onClick={handleClick}
      className={`relative inline-flex items-center justify-center transition-transform duration-300 select-none ${
        interactive ? 'cursor-pointer hover:scale-110 active:scale-95' : ''
      } ${isClicked ? 'animate-bounce' : ''} ${className}`}
      style={{ width: size, height: size }}
      title={
        mood === 'happy'
          ? 'دندان مینا - همه چیز مرتب و لبخند رضایت!'
          : mood === 'sad'
          ? 'دندان مینا - نیاز به توجه و بازبینی فوری!'
          : mood === 'pro'
          ? 'دندان مینا - بخش درمان تخصصی کلینیک'
          : 'دندان مینا - هوش مصنوعی و تحلیل داده'
      }
    >
      {/* Background Soft Glow Aura */}
      <div
        className="absolute inset-0 rounded-full blur-md opacity-40 transition-colors duration-500 pointer-events-none"
        style={{
          background:
            mood === 'sad'
              ? 'radial-gradient(circle, #F87171 0%, transparent 70%)'
              : mood === 'pro'
              ? 'radial-gradient(circle, #60A5FA 0%, transparent 70%)'
              : mood === 'ai'
              ? 'radial-gradient(circle, #C084FC 0%, transparent 70%)'
              : 'radial-gradient(circle, #34D399 0%, transparent 70%)',
        }}
      />

      {/* Main Organic Mascot Tooth SVG - 100% No Square Border */}
      <svg
        viewBox="0 0 100 110"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full drop-shadow-xl overflow-visible"
      >
        <defs>
          {/* Tooth Surface Gradient */}
          <linearGradient id="toothBodyGrad" x1="15" y1="5" x2="85" y2="105" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="55%" stopColor="#F0F7FF" />
            <stop offset="100%" stopColor="#D6E8FC" />
          </linearGradient>

          {/* Tooth Gloss Highlight */}
          <linearGradient id="toothGlossGrad" x1="20" y1="10" x2="45" y2="50" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0.0" />
          </linearGradient>

          {/* Crown Metallic Accent */}
          <linearGradient id="goldCrownGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#FBBF24" />
            <stop offset="50%" stopColor="#F59E0B" />
            <stop offset="100%" stopColor="#B45309" />
          </linearGradient>

          {/* Cyber Halo Gradient for AI */}
          <linearGradient id="cyberHaloGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#A855F7" />
            <stop offset="100%" stopColor="#EC4899" />
          </linearGradient>

          {/* Soft Shadow filter */}
          <filter id="softToothDrop" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="6" stdDeviation="4" floodColor="#1E3A8A" floodOpacity="0.2" />
          </filter>
        </defs>

        {/* AI Cyber Halo Effect */}
        {mood === 'ai' && (
          <ellipse
            cx="50"
            cy="18"
            rx="32"
            ry="8"
            fill="none"
            stroke="url(#cyberHaloGrad)"
            strokeWidth="3"
            strokeDasharray="6 3"
            className="animate-spin-slow origin-center"
          />
        )}

        {/* Outer Organic Tooth Body - Curved Soft Edges */}
        <path
          d="M 28,14
             C 12,14 8,36 12,54
             C 14,68 22,86 33,100
             C 38,107 45,107 48,96
             C 50,90 50,90 52,96
             C 55,107 62,107 67,100
             C 78,86 86,68 88,54
             C 92,36 88,14 72,14
             C 62,14 56,22 50,22
             C 44,22 38,14 28,14 Z"
          fill="url(#toothBodyGrad)"
          stroke="#93C5FD"
          strokeWidth="2.5"
          filter="url(#softToothDrop)"
        />

        {/* Gloss Top-Left Highlight */}
        <path
          d="M 25,20 C 18,20 15,34 17,48 C 18,55 22,65 26,72 C 26,72 22,46 32,30 C 40,18 48,24 48,24 C 38,20 32,20 25,20 Z"
          fill="url(#toothGlossGrad)"
        />

        {/* Cheek Blush (For Happy & AI) */}
        {(mood === 'happy' || mood === 'ai' || mood === 'pro') && (
          <>
            <ellipse cx="27" cy="56" rx="5" ry="3.5" fill="#FCA5A5" opacity="0.6" />
            <ellipse cx="73" cy="56" rx="5" ry="3.5" fill="#FCA5A5" opacity="0.6" />
          </>
        )}

        {/* EYES LAYER */}
        {mood === 'happy' && (
          <g>
            {/* Big Sparkly Eyes */}
            <circle cx="36" cy="45" r="6" fill="#1E293B" />
            <circle cx="34" cy="43" r="2.2" fill="#FFFFFF" />
            <circle cx="38" cy="47" r="1" fill="#FFFFFF" />

            <circle cx="64" cy="45" r="6" fill="#1E293B" />
            <circle cx="62" cy="43" r="2.2" fill="#FFFFFF" />
            <circle cx="66" cy="47" r="1" fill="#FFFFFF" />
          </g>
        )}

        {mood === 'pro' && (
          <g>
            {/* Winking Pro Doctor Eye + Glasses / Loupe */}
            <path d="M 30,46 Q 36,40 42,46" stroke="#1E293B" strokeWidth="3" strokeLinecap="round" fill="none" />
            <circle cx="64" cy="45" r="6" fill="#1E293B" />
            <circle cx="62" cy="43" r="2.2" fill="#FFFFFF" />
            {/* Headlamp / Mirror */}
            <circle cx="50" cy="14" r="5" fill="#3B82F6" stroke="#FFFFFF" strokeWidth="1.5" />
            <circle cx="50" cy="14" r="2" fill="#93C5FD" />
          </g>
        )}

        {mood === 'ai' && (
          <g>
            {/* Sci-Fi Goggles / Cute AI Visor */}
            <rect x="26" y="38" width="48" height="14" rx="7" fill="#1E1B4B" stroke="#818CF8" strokeWidth="1.5" />
            <circle cx="38" cy="45" r="3.5" fill="#38BDF8" className="animate-pulse" />
            <circle cx="62" cy="45" r="3.5" fill="#F43F5E" className="animate-pulse" />
          </g>
        )}

        {mood === 'sad' && (
          <g>
            {/* Sad Worried Eyes */}
            <path d="M 30,41 L 42,45" stroke="#1E293B" strokeWidth="2.5" strokeLinecap="round" />
            <circle cx="36" cy="47" r="5" fill="#1E293B" />
            <circle cx="35" cy="46" r="1.8" fill="#FFFFFF" />

            <path d="M 70,41 L 58,45" stroke="#1E293B" strokeWidth="2.5" strokeLinecap="round" />
            <circle cx="64" cy="47" r="5" fill="#1E293B" />
            <circle cx="63" cy="46" r="1.8" fill="#FFFFFF" />

            {/* Teardrop */}
            <path d="M 72,56 C 72,56 75,62 72,65 C 69.5,67 67,64.5 69,60 Z" fill="#60A5FA" />
            {/* Small Bandage */}
            <rect x="18" y="58" width="16" height="7" rx="2" fill="#FED7AA" stroke="#F97316" strokeWidth="1" transform="rotate(-15 18 58)" />
          </g>
        )}

        {/* MOUTH LAYER */}
        {mood === 'happy' && (
          <g>
            {/* Wide Happy Smile with Sparkling Dental Tooth */}
            <path d="M 35,58 Q 50,74 65,58 Z" fill="#EF4444" stroke="#1E293B" strokeWidth="2" />
            <path d="M 38,58 Q 50,65 62,58" fill="#FFFFFF" />
          </g>
        )}

        {mood === 'pro' && (
          <g>
            {/* Confident Smile */}
            <path d="M 36,58 Q 50,70 64,58" fill="none" stroke="#1E293B" strokeWidth="3" strokeLinecap="round" />
          </g>
        )}

        {mood === 'ai' && (
          <g>
            {/* Cute Open Mouth */}
            <ellipse cx="50" cy="61" rx="5" ry="4" fill="#1E293B" />
            <path d="M 47,63 Q 50,65 53,63" fill="#F43F5E" />
          </g>
        )}

        {mood === 'sad' && (
          <g>
            {/* Frown Mouth */}
            <path d="M 36,65 Q 50,55 64,65" fill="none" stroke="#1E293B" strokeWidth="3" strokeLinecap="round" />
          </g>
        )}

        {/* SPARKLES AND ACCENTS */}
        {showSparkles && mood === 'happy' && (
          <g className="animate-pulse">
            <path d="M 12,22 L 15,15 L 22,12 L 15,9 L 12,2 L 9,9 L 2,12 L 9,15 Z" fill="#F59E0B" transform="scale(0.5) translate(10, 10)" />
            <path d="M 82,32 L 84,27 L 89,25 L 84,23 L 82,18 L 80,23 L 75,25 L 80,27 Z" fill="#38BDF8" transform="scale(0.5) translate(80, 20)" />
          </g>
        )}

        {showSparkles && mood === 'ai' && (
          <g className="animate-bounce">
            <polygon points="85,15 88,22 95,25 88,28 85,35 82,28 75,25 82,22" fill="#C084FC" />
          </g>
        )}
      </svg>
    </div>
  );
};
