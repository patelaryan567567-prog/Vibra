import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { VibraLogo } from './VibraLogo';

interface AppSplashIntroProps {
  forceTriggerCount?: number;
}

const BRAND_LETTERS = ['V', 'I', 'B', 'R', 'A'];
const EQ_BARS = [0.42, 0.75, 1.0, 0.64, 0.88, 0.52, 0.95, 0.68, 0.45];

export function AppSplashIntro({ forceTriggerCount = 0 }: AppSplashIntroProps) {
  const [visible, setVisible] = useState<boolean>(true);
  const [isStandalonePWA, setIsStandalonePWA] = useState<boolean>(false);

  useEffect(() => {
    const checkStandalone = () => {
      const standalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        window.matchMedia('(display-mode: fullscreen)').matches ||
        window.matchMedia('(display-mode: minimal-ui)').matches ||
        (window.navigator as unknown as { standalone?: boolean }).standalone === true;
      setIsStandalonePWA(standalone);
    };

    checkStandalone();

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const durationMs = prefersReducedMotion ? 550 : 2100;

    const timer = window.setTimeout(() => {
      setVisible(false);
    }, durationMs);

    const handleAppInstalled = () => {
      setIsStandalonePWA(true);
      setVisible(true);
      window.setTimeout(() => {
        setVisible(false);
      }, 2200);
    };

    window.addEventListener('appinstalled', handleAppInstalled);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  useEffect(() => {
    if (forceTriggerCount <= 0) return;
    setVisible(true);
    const timer = window.setTimeout(() => {
      setVisible(false);
    }, 2100);
    return () => window.clearTimeout(timer);
  }, [forceTriggerCount]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="vibra-app-splash"
          initial={{ opacity: 1 }}
          exit={{
            opacity: 0,
            scale: 1.035,
            transition: { duration: 0.48, ease: [0.16, 1, 0.3, 1] },
          }}
          role="dialog"
          aria-label="VIBRA App Opening Screen"
          className="fixed inset-0 z-[100] bg-[#090A0F] flex flex-col items-center justify-between px-6 py-10 select-none overflow-hidden"
        >
          {/* Ambient radial studio soundstage lighting */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <motion.div
              initial={{ opacity: 0, scale: 0.75 }}
              animate={{ opacity: 1, scale: 1.08 }}
              transition={{ duration: 1.6, ease: [0.16, 1, 0.3, 1] }}
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[340px] h-[340px] sm:w-[460px] sm:h-[460px] rounded-full bg-radial from-[#4F6BFF]/22 via-[#8B5CF6]/10 to-transparent blur-3xl"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 0.85, scale: 1.15 }}
              transition={{ duration: 1.9, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[220px] h-[220px] sm:w-[300px] sm:h-[300px] rounded-full bg-radial from-[#EC4899]/14 via-[#4F6BFF]/10 to-transparent blur-2xl"
            />
          </div>

          {/* Top layout balance spacer */}
          <div className="h-4" aria-hidden="true" />

          {/* Centerpiece: Acoustic Ripple Rings + Animated VIBRA Emblem + Wordmark */}
          <div className="relative z-10 flex flex-col items-center text-center my-auto">
            {/* Acoustic Ripple Rings */}
            <div className="relative flex items-center justify-center mb-7">
              <motion.span
                initial={{ opacity: 0.6, scale: 0.75 }}
                animate={{ opacity: 0, scale: 1.95 }}
                transition={{
                  duration: 1.75,
                  repeat: Infinity,
                  ease: 'easeOut',
                }}
                className="pointer-events-none absolute w-24 h-24 sm:w-28 sm:h-28 rounded-[30px] border border-[#4F6BFF]/35"
              />
              <motion.span
                initial={{ opacity: 0.45, scale: 0.8 }}
                animate={{ opacity: 0, scale: 2.3 }}
                transition={{
                  duration: 1.75,
                  delay: 0.35,
                  repeat: Infinity,
                  ease: 'easeOut',
                }}
                className="pointer-events-none absolute w-24 h-24 sm:w-28 sm:h-28 rounded-[32px] border border-[#8B5CF6]/25"
              />

              {/* Logo Emblem Container */}
              <motion.div
                initial={{ opacity: 0, scale: 0.68, rotate: -6 }}
                animate={{ opacity: 1, scale: 1, rotate: 0 }}
                transition={{
                  duration: 0.72,
                  ease: [0.16, 1, 0.3, 1],
                }}
                className="relative group"
              >
                <VibraLogo size="xl" animated />
                {/* Diagonal specular light sweep across logo badge */}
                <motion.div
                  initial={{ x: '-140%', opacity: 0 }}
                  animate={{ x: '160%', opacity: [0, 0.85, 0] }}
                  transition={{ duration: 1.15, delay: 0.35, ease: 'easeInOut' }}
                  className="pointer-events-none absolute inset-0 w-1/2 bg-gradient-to-r from-transparent via-white/25 to-transparent -skew-x-12"
                />
              </motion.div>
            </div>

            {/* Staggered VIBRA Display Wordmark */}
            <div className="flex items-center justify-center gap-1.5 sm:gap-2 overflow-hidden">
              {BRAND_LETTERS.map((letter, idx) => (
                <motion.span
                  key={letter}
                  initial={{ opacity: 0, y: 22 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.52,
                    delay: 0.18 + idx * 0.055,
                    ease: [0.16, 1, 0.3, 1],
                  }}
                  className="font-display text-3xl sm:text-4xl font-extrabold tracking-[0.18em] bg-gradient-to-b from-white via-[#E2E8FF] to-[#8C9EFF] bg-clip-text text-transparent"
                >
                  {letter}
                </motion.span>
              ))}
            </div>

            {/* Unboxed Editorial Subtitle */}
            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.5, ease: [0.16, 1, 0.3, 1] }}
              className="mt-2.5 text-xs sm:text-sm font-medium text-slate-400 tracking-wide"
            >
              <span>High-Res Audio</span>
              <span className="mx-2 text-slate-600" aria-hidden="true">·</span>
              <span>Music Video</span>
              <span className="mx-2 text-slate-600" aria-hidden="true">·</span>
              <span>Infinite Radio</span>
            </motion.p>

            {/* Animated Harmonic Equalizer Bars */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.45, delay: 0.42 }}
              className="mt-7 h-7 flex items-center justify-center gap-1.5"
              aria-hidden="true"
            >
              {EQ_BARS.map((peak, i) => (
                <motion.span
                  key={i}
                  initial={{ scaleY: 0.25 }}
                  animate={{
                    scaleY: [0.25, peak, 0.35, Math.min(1, peak + 0.15), 0.28],
                  }}
                  transition={{
                    duration: 1.05,
                    delay: i * 0.07,
                    repeat: Infinity,
                    ease: 'easeInOut',
                  }}
                  className="w-1 h-6 rounded-full origin-center bg-gradient-to-t from-[#4F6BFF] via-[#8B5CF6] to-[#EC4899]"
                />
              ))}
            </motion.div>
          </div>

          {/* Bottom Progress Sweep & Installed App Signature */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.35 }}
            className="w-full max-w-[220px] flex flex-col items-center gap-2.5 relative z-10"
          >
            <div className="w-full h-1 rounded-full bg-white/[0.08] overflow-hidden">
              <motion.div
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 1.65, ease: [0.22, 1, 0.36, 1] }}
                className="w-full h-full origin-left rounded-full bg-gradient-to-r from-[#4F6BFF] via-[#8B5CF6] to-[#EC4899]"
              />
            </div>
            <span className="text-[11px] font-medium text-slate-500 tracking-wide">
              {isStandalonePWA ? 'Installed App Ready' : 'Launching Soundstage'}
            </span>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
