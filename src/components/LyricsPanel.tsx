import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, LocateFixed, Mic2, Music, RefreshCw, WifiOff } from 'lucide-react';
import { fetchTrackLyrics } from '../services/api';
import type { LyricsResponse } from '../types/music';
import { formatSeconds } from '../utils/format';

const SECTION_HEADER_RE = /^\[[^\]]{1,48}\]$/;

interface LyricsPanelProps {
  title: string;
  artist: string;
  durationSeconds?: number;
  currentTime: number;
  onSeekTo: (seconds: number) => void;
  accentHex?: string;
}

export function LyricsPanel({
  title,
  artist,
  durationSeconds = 0,
  currentTime,
  onSeekTo,
  accentHex = '#7A90FF',
}: LyricsPanelProps) {
  const [lyrics, setLyrics] = useState<LyricsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isOfflineError, setIsOfflineError] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  const lineRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    setLyrics(null);
    setIsOfflineError(false);
    setCopied(false);
    setAutoScroll(true);
  }, [title, artist]);

  useEffect(() => {
    const queryTitle = title.trim();
    const queryArtist = artist.trim();
    if (!queryTitle) return;

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setIsOfflineError(true);
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    setIsLoading(true);
    setIsOfflineError(false);

    void fetchTrackLyrics({
      title: queryTitle,
      artist: queryArtist,
      durationSeconds,
      signal: controller.signal,
    })
      .then((res) => {
        if (!controller.signal.aborted) {
          setLyrics(res);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setIsOfflineError(typeof navigator !== 'undefined' && !navigator.onLine);
          setLyrics({ found: false, syncedLines: [], plainLyrics: null });
          setIsLoading(false);
        }
      });

    return () => controller.abort();
  }, [title, artist, durationSeconds, retryNonce]);

  const syncedLines = lyrics?.syncedLines ?? [];
  const hasSynced = syncedLines.length > 0;

  const activeIndex = useMemo(() => {
    if (!hasSynced) return -1;
    const t = currentTime + 0.3;
    let found = -1;
    for (let i = 0; i < syncedLines.length; i++) {
      if (syncedLines[i].timeSeconds <= t) {
        found = i;
      } else {
        break;
      }
    }
    return found;
  }, [hasSynced, syncedLines, currentTime]);

  const interludeInfo = useMemo(() => {
    if (!hasSynced) return null;
    if (activeIndex === -1 && syncedLines[0] && syncedLines[0].timeSeconds > 4) {
      return {
        label: 'Musical Intro',
        nextAt: syncedLines[0].timeSeconds,
        remaining: Math.max(0, Math.ceil(syncedLines[0].timeSeconds - currentTime)),
      };
    }
    if (activeIndex >= 0 && syncedLines[activeIndex + 1]) {
      const gap = syncedLines[activeIndex + 1].timeSeconds - syncedLines[activeIndex].timeSeconds;
      const sinceCur = currentTime - syncedLines[activeIndex].timeSeconds;
      if (gap >= 12 && sinceCur >= 6 && currentTime < syncedLines[activeIndex + 1].timeSeconds - 1) {
        return {
          label: 'Instrumental Break',
          nextAt: syncedLines[activeIndex + 1].timeSeconds,
          remaining: Math.max(0, Math.ceil(syncedLines[activeIndex + 1].timeSeconds - currentTime)),
        };
      }
    }
    return null;
  }, [activeIndex, currentTime, hasSynced, syncedLines]);

  useEffect(() => {
    if (!autoScroll || activeIndex < 0) return;
    const el = lineRefs.current[activeIndex];
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [activeIndex, autoScroll]);

  const handleCopyLyrics = async () => {
    const textToCopy = hasSynced
      ? syncedLines.map((l) => l.text).join('\n')
      : lyrics?.plainLyrics || '';
    if (!textToCopy) return;
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  const parsedPlainLines = useMemo(() => {
    const text = lyrics?.plainLyrics || '';
    if (!text) return [];
    return text.split(/\r?\n/);
  }, [lyrics?.plainLyrics]);

  if (isLoading) {
    return (
      <div className="p-4 sm:p-5 space-y-4 animate-pulse">
        <div className="h-4 w-36 rounded bg-white/[0.08]" />
        <div className="space-y-3.5 pt-2">
          {Array.from({ length: 7 }).map((_, idx) => (
            <div
              key={idx}
              className="h-6 rounded-lg bg-white/[0.06]"
              style={{ width: `${58 + ((idx * 17) % 38)}%` }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (isOfflineError) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-12 px-4 space-y-3">
        <div className="w-11 h-11 rounded-2xl bg-amber-500/15 text-amber-300 flex items-center justify-center">
          <WifiOff className="w-5 h-5" />
        </div>
        <p className="text-sm font-semibold text-white">Lyrics unavailable offline</p>
        <p className="text-xs text-slate-400 max-w-xs">
          Connect to the internet to load lyrics for this song.
        </p>
        <button
          type="button"
          onClick={() => setRetryNonce((n) => n + 1)}
          className="h-9 px-4 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] text-xs font-medium text-white inline-flex items-center gap-1.5"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Retry</span>
        </button>
      </div>
    );
  }

  if (!lyrics?.found) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-12 px-4 space-y-3">
        <div className="w-11 h-11 rounded-2xl bg-white/[0.06] text-slate-300 flex items-center justify-center">
          <Mic2 className="w-5 h-5" />
        </div>
        <p className="text-sm font-semibold text-white">Lyrics not found for this song</p>
        <p className="text-xs text-slate-400 max-w-xs leading-relaxed">
          Verified lyrics aren&apos;t available for this track right now.
        </p>
        <button
          type="button"
          onClick={() => setRetryNonce((n) => n + 1)}
          className="h-9 px-4 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] text-xs font-medium text-white inline-flex items-center gap-1.5 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Retry</span>
        </button>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col h-full min-h-0">
      {/* Minimal Single-Line Header */}
      <div className="shrink-0 pb-2 px-1 border-b border-white/[0.07] flex items-center justify-between gap-2">
        <div className="min-w-0 flex items-center gap-2 text-xs text-slate-400">
          <span className="font-medium text-slate-200 truncate">
            {hasSynced ? 'Synced Lyrics' : 'Lyrics'}
          </span>
          {lyrics.trackName && (
            <>
              <span aria-hidden="true">·</span>
              <span className="truncate">{lyrics.trackName}</span>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => void handleCopyLyrics()}
          title="Copy lyrics"
          aria-label="Copy lyrics"
          className="px-2.5 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-xs font-medium text-slate-300 hover:text-white inline-flex items-center gap-1.5 transition-colors shrink-0 whitespace-nowrap"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-emerald-300">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      {/* Pure Lyrics Canvas */}
      <div
        onWheel={() => {
          if (hasSynced && autoScroll) setAutoScroll(false);
        }}
        onTouchMove={() => {
          if (hasSynced && autoScroll) setAutoScroll(false);
        }}
        className="flex-1 min-h-0 overflow-y-auto pt-3 pb-10 px-1 sm:px-2 font-lyrics-modern"
      >
        {hasSynced && interludeInfo && (
          <div className="mb-3 mx-1 px-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.07] flex items-center justify-between gap-2 text-xs">
            <span className="inline-flex items-center gap-2 text-slate-300 font-medium">
              <Music className="w-3.5 h-3.5 shrink-0" style={{ color: accentHex }} />
              <span>{interludeInfo.label}</span>
            </span>
            <button
              type="button"
              onClick={() => onSeekTo(Math.max(0, interludeInfo.nextAt - 0.5))}
              className="font-mono-tabular text-[11px] font-semibold hover:underline shrink-0"
              style={{ color: accentHex }}
            >
              Next line in {interludeInfo.remaining}s · Jump
            </button>
          </div>
        )}

        {hasSynced ? (
          <div className="space-y-2 sm:space-y-2.5">
            {syncedLines.map((line, idx) => {
              const isActive = idx === activeIndex;
              const isPast = activeIndex >= 0 && idx < activeIndex;
              return (
                <button
                  key={`${line.timeSeconds}_${idx}`}
                  ref={(el) => {
                    lineRefs.current[idx] = el;
                  }}
                  type="button"
                  onClick={() => {
                    setAutoScroll(true);
                    onSeekTo(line.timeSeconds);
                  }}
                  style={
                    isActive
                      ? {
                          background: `linear-gradient(90deg, ${accentHex}2E 0%, ${accentHex}0D 100%)`,
                          boxShadow: `inset 0 0 0 1px ${accentHex}44`,
                        }
                      : undefined
                  }
                  className={`w-full text-left px-3.5 py-2.5 rounded-xl transition-all duration-200 group ${
                    isActive
                      ? 'shadow-sm'
                      : 'hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span
                      className={`break-words tracking-tight transition-all duration-200 flex-1 ${
                        isActive
                          ? 'text-[19px] sm:text-[22px] font-bold text-white leading-snug'
                          : isPast
                            ? 'text-[15px] sm:text-[17px] font-medium text-white/40 group-hover:text-white/80 leading-relaxed'
                            : 'text-[15px] sm:text-[17px] font-medium text-white/75 group-hover:text-white leading-relaxed'
                      }`}
                    >
                      {line.text}
                    </span>
                    <span
                      className={`font-mono-tabular text-[11px] shrink-0 transition-opacity ${
                        isActive
                          ? 'opacity-95 font-semibold'
                          : 'opacity-0 group-hover:opacity-75 text-slate-400'
                      }`}
                      style={isActive ? { color: accentHex } : undefined}
                    >
                      {formatSeconds(Math.floor(line.timeSeconds))}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="px-2 sm:px-3 py-2 space-y-1">
            {parsedPlainLines.map((rawLine, idx) => {
              const trimmed = rawLine.trim();
              if (!trimmed) {
                return <div key={idx} className="h-3.5" aria-hidden="true" />;
              }
              if (SECTION_HEADER_RE.test(trimmed)) {
                const label = trimmed.slice(1, -1);
                return (
                  <div key={idx} className="pt-5 first:pt-1 pb-1.5 flex items-center gap-2.5">
                    <span
                      className="text-[11px] font-bold uppercase tracking-[0.16em] whitespace-nowrap shrink-0"
                      style={{ color: accentHex }}
                    >
                      {label}
                    </span>
                    <span className="h-px flex-1 bg-white/[0.08]" aria-hidden="true" />
                  </div>
                );
              }
              return (
                <p
                  key={idx}
                  className="text-[16px] sm:text-[18px] leading-[1.85] font-medium text-white/90 tracking-tight break-words"
                >
                  {trimmed}
                </p>
              );
            })}
          </div>
        )}
      </div>

      {/* Floating Re-Sync CTA only when user scrolled away */}
      {hasSynced && !autoScroll && activeIndex >= 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <button
            type="button"
            onClick={() => {
              setAutoScroll(true);
              lineRefs.current[activeIndex]?.scrollIntoView({
                block: 'center',
                behavior: 'smooth',
              });
            }}
            className="pointer-events-auto h-9 px-4 rounded-full bg-[#181B26]/95 hover:bg-[#222636] border border-white/15 text-xs font-semibold text-white shadow-xl backdrop-blur-md inline-flex items-center gap-1.5 transition-colors"
          >
            <LocateFixed className="w-3.5 h-3.5" style={{ color: accentHex }} />
            <span>Jump to current line</span>
          </button>
        </div>
      )}
    </div>
  );
}
