import React, { useId } from 'react';

interface VibraLogoProps {
  size?: 'sm' | 'md' | 'lg';
}

export function VibraLogo({ size = 'md' }: VibraLogoProps) {
  const uid = useId().replace(/:/g, '');
  const dims =
    size === 'sm' ? 'w-8 h-8 rounded-xl' : size === 'lg' ? 'w-11 h-11 rounded-2xl' : 'w-9 h-9 rounded-xl';

  return (
    <div
      className={`${dims} relative shrink-0 flex items-center justify-center bg-gradient-to-br from-[#191D2B] to-[#0B0C12] border border-[#7A90FF]/30 shadow-lg shadow-[#4F6BFF]/20 overflow-hidden`}
      aria-hidden="true"
    >
      <div className="absolute inset-0 bg-radial from-[#4F6BFF]/18 via-transparent to-transparent" />
      <svg viewBox="0 0 64 64" fill="none" className="w-[82%] h-[82%] relative z-10">
        <defs>
          <linearGradient id={`vo_${uid}`} x1="14" y1="18" x2="50" y2="48" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#7A94FF" />
            <stop offset="50%" stopColor="#4F6BFF" />
            <stop offset="100%" stopColor="#8B5CF6" />
          </linearGradient>
          <linearGradient id={`vi_${uid}`} x1="20" y1="18" x2="44" y2="40" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#B8C7FF" />
            <stop offset="100%" stopColor="#6A80FF" />
          </linearGradient>
        </defs>
        <path
          d="M12 18C17.4 18 20.4 21.4 24.4 29.8L30.1 41.6C30.9 43.2 33.1 43.2 33.9 41.6L39.6 29.8C43.6 21.4 46.6 18 52 18"
          stroke={`url(#vi_${uid})`}
          strokeWidth="3.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M15 25.5C19 26.3 21.6 30 25 37.2L29.8 46.8C30.7 48.6 33.3 48.6 34.2 46.8L39 37.2C42.4 30 45 26.3 49 25.5"
          stroke={`url(#vo_${uid})`}
          strokeWidth="3.1"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.9"
        />
        <path
          d="M19.5 34C22.4 35.6 24.6 39 27 44L29.7 49.4C30.7 51.2 33.3 51.2 34.3 49.4L37 44C39.4 39 41.6 35.6 44.5 34"
          stroke="#4F6BFF"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.62"
        />
      </svg>
    </div>
  );
}
