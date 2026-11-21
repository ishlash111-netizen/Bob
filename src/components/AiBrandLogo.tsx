import React from 'react';

interface AiBrandLogoProps {
  size?: 'sm' | 'lg';
}

export const AiBrandLogo: React.FC<AiBrandLogoProps> = ({ size = 'sm' }) => {
  const isLg = size === 'lg';
  const dim = isLg ? 'w-14 h-14' : 'w-8 h-8';
  const radius = isLg ? 'rounded-[18px]' : 'rounded-[10px]';
  const badgeCls = isLg
    ? 'text-[9px] px-1.5 py-0.5 rounded-md -bottom-1 -right-1.5 border-2 border-white'
    : 'text-[6px] px-1 py-[1px] rounded -bottom-0.5 -right-1 border border-white';

  return (
    <div className={`relative inline-flex items-center justify-center shrink-0 select-none ${dim}`}>
      <svg
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`w-full h-full ${radius} shadow-sm`}
      >
        <defs>
          <linearGradient id={`ai-grad-${size}`} x1="6" y1="58" x2="58" y2="6" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#06B6D4" />
            <stop offset="35%" stopColor="#3B82F6" />
            <stop offset="70%" stopColor="#7C3AED" />
            <stop offset="100%" stopColor="#EC4899" />
          </linearGradient>
        </defs>
        <rect width="64" height="64" rx="18" fill="white" />
        {/* Outer colorful ring */}
        <circle
          cx="32"
          cy="32"
          r="21"
          stroke={`url(#ai-grad-${size})`}
          strokeWidth="9"
          fill="none"
        />
        {/* Stylized 'A' center glyph */}
        <path
          d="M32 20L23.5 42H28.2L30 37H34L35.8 42H40.5L32 20ZM30.9 33.2L32 28.5L33.1 33.2H30.9Z"
          fill={`url(#ai-grad-${size})`}
        />
      </svg>
      <span
        className={`absolute font-extrabold tracking-tight bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white leading-none shadow-xs ${badgeCls}`}
      >
        AI
      </span>
    </div>
  );
};
