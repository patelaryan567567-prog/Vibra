import React, { useId } from 'react';

interface VibraLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  animated?: boolean;
}

export function VibraLogo({ size = 'md', animated = false }: VibraLogoProps) {
  const uid = useId().replace(/:/g, '');
  const dims =
    size === 'sm'
      ? 'w-8 h-8 rounded-xl'
      : size === 'lg'
        ? 'w-11 h-11 rounded-2xl'
        : size === 'xl'
          ? 'w-24 h-24 sm:w-28 sm:h-28 rounded-[28px]'
          : 'w-9 h-9 rounded-xl';

  return (
    <div
      className={`${dims} relative shrink-0 flex items-center justify-center bg-gradient-to-br from-[#191D2B] via-[#111420] to-[#090A0F] border border-[#7A90FF]/35 shadow-lg shadow-[#4F6BFF]/25 overflow-hidden`}
      aria-hidden="true"
    >
      <div
        className={`absolute inset-0 bg-radial from-[#4F6BFF]/25 via-[#8B5CF6]/10 to-transparent ${
          animated ? 'animate-pulse' : ''
        }`}
      />
      {/* Top specular highlight */}
      <div className="absolute inset-x-2 top-0 h-px bg-gradient-to-r from-transparent via-white/35 to-transparent" />

      <svg viewBox="0 0 64 64" fill="none" className="w-[82%] h-[82%] relative z-10">
        <defs>
          <linearGradient id={`vo_${uid}`} x1="12" y1="16" x2="52" y2="50" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#7A94FF" />
            <stop offset="50%" stopColor="#4F6BFF" />
            <stop offset="100%" stopColor="#8B5CF6" />
          </linearGradient>
          <linearGradient id={`vi_${uid}`} x1="18" y1="16" x2="46" y2="42" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#E0E7FF" />
            <stop offset="50%" stopColor="#93A8FF" />
            <stop offset="100%" stopColor="#6A80FF" />
          </linearGradient>
          <linearGradient id={`va_${uid}`} x1="18" y1="32" x2="46" y2="52" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#4F6BFF" />
            <stop offset="50%" stopColor="#8B5CF6" />
            <stop offset="100%" stopColor="#EC4899" />
          </linearGradient>
        </defs>
        <path
          d="M12 18C17.4 18 20.4 21.4 24.4 29.8L30.1 41.6C30.9 43.2 33.1 43.2 33.9 41.6L39.6 29.8C43.6 21.4 46.6 18 52 18"
          stroke={`url(#vi_${uid})`}
          strokeWidth="3.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={animated ? 'vibra-logo-path-1' : undefined}
        />
        <path
          d="M15 25.5C19 26.3 21.6 30 25 37.2L29.8 46.8C30.7 48.6 33.3 48.6 34.2 46.8L39 37.2C42.4 30 45 26.3 49 25.5"
          stroke={`url(#vo_${uid})`}
          strokeWidth="3.1"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.92"
          className={animated ? 'vibra-logo-path-2' : undefined}
        />
        <path
          d="M19.5 34C22.4 35.6 24.6 39 27 44L29.7 49.4C30.7 51.2 33.3 51.2 34.3 49.4L37 44C39.4 39 41.6 35.6 44.5 34"
          stroke={`url(#va_${uid})`}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.8"
          className={animated ? 'vibra-logo-path-3' : undefined}
        />
      </svg>
    </div>
  );
}
