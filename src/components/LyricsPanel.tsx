import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Languages,
  Loader2,
  LocateFixed,
  Mic2,
  Music,
  Pencil,
  RefreshCw,
  RotateCcw,
  Search,
  Sparkles,
  WifiOff,
  X,
} from 'lucide-react';
import { enhanceTrackLyrics, fetchTrackLyrics } from '../services/api';
import type { LyricsEnhanceMode, LyricsResponse } from '../types/music';
import { formatSeconds } from '../utils/format';

type LyricsFontStyle = 'modern' | 'serif' | 'clean';
type LyricsFontSize = 'sm' | 'md' | 'lg';

const FONT_STORAGE_KEY = 'vibra_lyrics_font_v1';
const SIZE_STORAGE_KEY = 'vibra_lyrics_size_v1';

function readStoredFont(): LyricsFontStyle {
  try {
    const val = localStorage.getItem(FONT_STORAGE_KEY);
    if (val === 'modern' || val === 'serif' || val === 'clean') return val;
  } catch {
    // ignore
  }
  return 'modern';
}

function readStoredSize(): LyricsFontSize {
  try {
    const val = localStorage.getItem(SIZE_STORAGE_KEY);
    if (val === 'sm' || val === 'md' || val === 'lg') return val;
  } catch {
    // ignore
  }
  return 'md';
}

const FONT_CLASS_MAP: Record<LyricsFontStyle, string> = {
  modern: 'font-lyrics-modern',
  serif: 'font-lyrics-serif',
  clean: 'font-lyrics-clean',
};

const SYNCED_ACTIVE_SIZE: Record<LyricsFontSize, string> = {
  sm: 'text-[17px] sm:text-[19px]',
  md: 'text-[19px] sm:text-[22px]',
  lg: 'text-[22px] sm:text-[26px]',
};

const SYNCED_INACTIVE_SIZE: Record<LyricsFontSize, string> = {
  sm: 'text-sm sm:text-[15px]',
  md: 'text-[15px] sm:text-[17px]',
  lg: 'text-[17px] sm:text-[19px]',
};

const PLAIN_TEXT_SIZE: Record<LyricsFontSize, string> = {
  sm: 'text-[15px] sm:text-base leading-[1.8]',
  md: 'text-[16px] sm:text-[18px] leading-[1.85]',
  lg: 'text-[18px] sm:text-[21px] leading-[1.9]',
};

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
  const [baseLyrics, setBaseLyrics] = useState<LyricsResponse | null>(null);
  const [enhancedLyrics, setEnhancedLyrics] = useState<LyricsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isEnhancing, setIsEnhancing] = useState<LyricsEnhanceMode | null>(null);
  const [enhanceError, setEnhanceError] = useState<string | null>(null);
  const [isOfflineError, setIsOfflineError] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const [customTitle, setCustomTitle] = useState(title);
  const [customArtist, setCustomArtist] = useState(artist);
  const [manualQuery, setManualQuery] = useState<{
    title: string;
    artist: string;
    nonce: number;
  } | null>(null);
  const [isTitleEditorOpen, setIsTitleEditorOpen] = useState(false);

  const [fontStyle, setFontStyle] = useState<LyricsFontStyle>(() => readStoredFont());
  const [fontSize, setFontSize] = useState<LyricsFontSize>(() => readStoredSize());

  const lineRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const activeLyrics = enhancedLyrics ?? baseLyrics;

  const updateFontStyle = (next: LyricsFontStyle) => {
    setFontStyle(next);
    try {
      localStorage.setItem(FONT_STORAGE_KEY, next);
    } catch {
      // ignore
    }
  };

  const stepFontSize = (dir: -1 | 1) => {
    const order: LyricsFontSize[] = ['sm', 'md', 'lg'];
    const idx = order.indexOf(fontSize);
    const nextIdx = Math.min(order.length - 1, Math.max(0, idx + dir));
    const next = order[nextIdx];
    setFontSize(next);
    try {
      localStorage.setItem(SIZE_STORAGE_KEY, next);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    setCustomTitle(title);
    setCustomArtist(artist);
    setManualQuery(null);
    setIsTitleEditorOpen(false);
    setBaseLyrics(null);
    setEnhancedLyrics(null);
    setEnhanceError(null);
    setIsEnhancing(null);
    setIsOfflineError(false);
    setCopied(false);
  }, [title, artist]);

  useEffect(() => {
    const queryTitle = (manualQuery ? manualQuery.title : title).trim();
    const queryArtist = (manualQuery ? manualQuery.artist : artist).trim();
    if (!queryTitle) return;

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setIsOfflineError(true);
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    setIsLoading(true);
    setIsOfflineError(false);
    setEnhanceError(null);

    void fetchTrackLyrics({
      title: queryTitle,
      artist: queryArtist,
      durationSeconds,
      signal: controller.signal,
    })
      .then((res) => {
        if (!controller.signal.aborted) {
          setBaseLyrics(res);
          setEnhancedLyrics(null);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setIsOfflineError(typeof navigator !== 'undefined' && !navigator.onLine);
          setBaseLyrics({ found: false, syncedLines: [], plainLyrics: null });
          setIsLoading(false);
        }
      });

    return () => controller.abort();
  }, [title, artist, durationSeconds, manualQuery]);

  const syncedLines = activeLyrics?.syncedLines ?? [];
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

  // Detect musical intro or long >12s interlude before the upcoming synced lyric line
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

  const handleManualSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const nextTitle = customTitle.trim();
    if (!nextTitle) return;
    setManualQuery({
      title: nextTitle,
      artist: customArtist.trim(),
      nonce: Date.now(),
    });
    setIsTitleEditorOpen(false);
  };

  const handleAiEnhance = async (mode: LyricsEnhanceMode) => {
    const queryTitle = (customTitle || title).trim();
    const queryArtist = (customArtist || artist).trim();
    if (!queryTitle || isEnhancing) return;

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setEnhanceError('Connect to the internet to enhance or fetch lyrics with AI.');
      return;
    }

    setIsEnhancing(mode);
    setEnhanceError(null);
    try {
      const sourceObj = baseLyrics ?? activeLyrics;
      const result = await enhanceTrackLyrics({
        title: queryTitle,
        artist: queryArtist,
        rawLyrics: mode === 'find' ? null : sourceObj?.plainLyrics || null,
        syncedLines: mode === 'find' ? [] : sourceObj?.syncedLines || [],
        mode,
      });

      if (!result.found) {
        setEnhanceError('AI could not verify lyrics for this specific title.');
      } else {
        if (mode === 'find') {
          setBaseLyrics(result);
          setEnhancedLyrics(null);
          setIsTitleEditorOpen(false);
        } else {
          setEnhancedLyrics(result);
        }
      }
    } catch (err) {
      setEnhanceError(err instanceof Error ? err.message : 'Unable to process lyrics with AI.');
    } finally {
      setIsEnhancing(null);
    }
  };

  const handleCopyLyrics = async () => {
    const textToCopy = hasSynced
      ? syncedLines.map((l) => l.text).join('\n')
      : activeLyrics?.plainLyrics || '';
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
    const text = activeLyrics?.plainLyrics || '';
    if (!text) return [];
    return text.split(/\r?\n/);
  }, [activeLyrics?.plainLyrics]);

  const fontClass = FONT_CLASS_MAP[fontStyle];

  if (isLoading) {
    return (
      <div className="p-4 sm:p-5 space-y-4 animate-pulse">
        <div className="h-4 w-40 rounded bg-white/[0.08]" />
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
      <div className="flex flex-col items-center justify-center text-center py-10 px-4 space-y-3">
        <div className="w-11 h-11 rounded-2xl bg-amber-500/15 text-amber-300 flex items-center justify-center">
          <WifiOff className="w-5 h-5" />
        </div>
        <p className="text-sm font-semibold text-white">Lyrics unavailable offline</p>
        <p className="text-xs text-slate-400 max-w-xs">
          Connect to the internet to load synced or AI-formatted lyrics for this track.
        </p>
        <button
          type="button"
          onClick={() =>
            setManualQuery({
              title: customTitle.trim() || title,
              artist: customArtist.trim() || artist,
              nonce: Date.now(),
            })
          }
          className="h-9 px-3.5 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] text-xs font-medium text-white inline-flex items-center gap-1.5"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Retry</span>
        </button>
      </div>
    );
  }

  if (!activeLyrics?.found) {
    return (
      <div className="p-4 space-y-4 overflow-y-auto">
        <div className="text-center py-2 space-y-2">
          <div className="w-11 h-11 rounded-2xl bg-white/[0.07] text-[#7A90FF] flex items-center justify-center mx-auto">
            <Mic2 className="w-5 h-5" />
          </div>
          <p className="text-sm font-semibold text-white">No lyrics matched automatically</p>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            Searched for{' '}
            <span className="text-slate-200 font-medium">
              {activeLyrics?.trackName || customTitle || title}
            </span>
            {activeLyrics?.artistName ? ` · ${activeLyrics.artistName}` : ''}. Edit below to search again or send to AI.
          </p>
        </div>

        <form onSubmit={handleManualSearch} className="space-y-2.5">
          <input
            type="text"
            value={customTitle}
            onChange={(e) => setCustomTitle(e.target.value)}
            placeholder="Write song title (e.g. Kesariya)"
            className="w-full h-10 px-3 rounded-xl bg-[#090A0F] border border-white/10 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-[#4F6BFF]"
          />
          <input
            type="text"
            value={customArtist}
            onChange={(e) => setCustomArtist(e.target.value)}
            placeholder="Artist name (optional)"
            className="w-full h-10 px-3 rounded-xl bg-[#090A0F] border border-white/10 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-[#4F6BFF]"
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-0.5">
            <button
              type="submit"
              disabled={!customTitle.trim()}
              className="w-full h-10 px-3 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] border border-white/10 disabled:opacity-50 text-xs font-semibold text-white inline-flex items-center justify-center gap-1.5"
            >
              <Search className="w-3.5 h-3.5" />
              <span>Fetch from Web</span>
            </button>

            <button
              type="button"
              disabled={Boolean(isEnhancing) || !customTitle.trim()}
              onClick={() => void handleAiEnhance('find')}
              className="w-full h-10 px-3 rounded-xl bg-gradient-to-r from-[#4F6BFF] to-[#7C5CFF] hover:opacity-95 disabled:opacity-60 text-xs font-semibold text-white inline-flex items-center justify-center gap-1.5 shadow-lg transition-opacity"
            >
              {isEnhancing === 'find' ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Sending to AI...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Send Title to AI</span>
                </>
              )}
            </button>
          </div>
        </form>

        {enhanceError && (
          <p className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/25 rounded-xl px-3 py-2 text-center">
            {enhanceError}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="relative flex flex-col h-full min-h-0">
      {/* Pinned Readability, Font & AI Toolbar */}
      <div className="shrink-0 pb-2.5 border-b border-white/[0.08] space-y-2">
        <div className="flex items-center justify-between gap-2 px-1">
          <div className="min-w-0 flex items-center gap-2">
            <span className="text-[11px] font-semibold text-slate-300 truncate">
              {hasSynced ? 'Synced Lyrics · Tap line to seek' : 'Formatted Lyrics'}
            </span>
            {activeLyrics.source && (
              <span className="text-[11px] text-slate-400 shrink-0 hidden sm:inline">
                · {activeLyrics.source}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => void handleCopyLyrics()}
              title="Copy lyrics to clipboard"
              className="px-2 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-[11px] font-medium text-slate-300 hover:text-white inline-flex items-center gap-1 transition-colors whitespace-nowrap"
            >
              {copied ? (
                <>
                  <Check className="w-3 h-3 text-emerald-400" />
                  <span className="text-emerald-300">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  <span className="hidden sm:inline">Copy</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => setIsTitleEditorOpen((prev) => !prev)}
              title="Edit song title to fetch website lyrics or send to AI"
              className={`px-2 py-1 rounded-lg text-[11px] font-medium inline-flex items-center gap-1 transition-colors border whitespace-nowrap ${
                isTitleEditorOpen
                  ? 'bg-[#4F6BFF]/25 border-[#4F6BFF]/50 text-white'
                  : 'bg-white/[0.06] hover:bg-white/[0.12] border-transparent text-slate-300 hover:text-white'
              }`}
            >
              {isTitleEditorOpen ? <X className="w-3 h-3" /> : <Pencil className="w-3 h-3" />}
              <span>Edit Title</span>
            </button>

            {enhancedLyrics && (
              <button
                type="button"
                onClick={() => {
                  setEnhancedLyrics(null);
                  setEnhanceError(null);
                }}
                title="Switch back to original lyrics"
                className="px-2 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-[11px] font-medium text-slate-300 hover:text-white inline-flex items-center gap-1 transition-colors whitespace-nowrap"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Original</span>
              </button>
            )}

            {hasSynced && (
              <button
                type="button"
                onClick={() => {
                  const next = !autoScroll;
                  setAutoScroll(next);
                  if (next && activeIndex >= 0) {
                    lineRefs.current[activeIndex]?.scrollIntoView({
                      block: 'center',
                      behavior: 'smooth',
                    });
                  }
                }}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold inline-flex items-center gap-1 shrink-0 transition-colors whitespace-nowrap ${
                  autoScroll
                    ? 'bg-white/15 text-white'
                    : 'bg-white/[0.05] text-slate-400 hover:text-white'
                }`}
              >
                <LocateFixed className="w-3 h-3" />
                <span>{autoScroll ? 'Synced' : 'Sync'}</span>
              </button>
            )}
          </div>
        </div>

        {/* Collapsible Custom Song Title -> Website / AI Fetch Form */}
        {isTitleEditorOpen && (
          <form
            onSubmit={handleManualSearch}
            className="mx-1 p-2.5 rounded-xl bg-[#090A0F]/90 border border-white/10 space-y-2"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              <input
                type="text"
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                placeholder="Write exact song title"
                className="w-full h-8 px-2.5 rounded-lg bg-[#11131A] border border-white/10 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-[#4F6BFF]"
              />
              <input
                type="text"
                value={customArtist}
                onChange={(e) => setCustomArtist(e.target.value)}
                placeholder="Artist name (optional)"
                className="w-full h-8 px-2.5 rounded-lg bg-[#11131A] border border-white/10 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-[#4F6BFF]"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="submit"
                disabled={!customTitle.trim()}
                className="flex-1 h-8 px-2.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.14] border border-white/10 disabled:opacity-50 text-[11px] font-semibold text-white inline-flex items-center justify-center gap-1.5"
              >
                <Search className="w-3 h-3" />
                <span>Fetch Website</span>
              </button>
              <button
                type="button"
                disabled={Boolean(isEnhancing) || !customTitle.trim()}
                onClick={() => void handleAiEnhance('find')}
                className="flex-1 h-8 px-2.5 rounded-lg bg-gradient-to-r from-[#4F6BFF] to-[#7C5CFF] hover:opacity-95 disabled:opacity-60 text-[11px] font-semibold text-white inline-flex items-center justify-center gap-1.5"
              >
                {isEnhancing === 'find' ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>Sending to AI...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3 h-3" />
                    <span>Send to AI</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}

        {/* Font Picker + Size Stepper + AI Polish & Hinglish Controls */}
        <div className="flex flex-wrap items-center justify-between gap-1.5 px-1">
          <div className="flex items-center gap-1.5">
            {/* Font Selector */}
            <div
              className="inline-flex items-center p-0.5 rounded-lg bg-black/35 border border-white/[0.07]"
              role="group"
              aria-label="Lyrics font style"
            >
              {(
                [
                  { id: 'modern', label: 'Modern' },
                  { id: 'serif', label: 'Serif' },
                  { id: 'clean', label: 'Sans' },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => updateFontStyle(f.id)}
                  className={`px-2 py-1 rounded-md text-[11px] font-semibold transition-colors ${
                    fontStyle === f.id
                      ? 'bg-white/15 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* Font Size A- / A+ */}
            <div
              className="inline-flex items-center p-0.5 rounded-lg bg-black/35 border border-white/[0.07]"
              role="group"
              aria-label="Lyrics text size"
            >
              <button
                type="button"
                disabled={fontSize === 'sm'}
                onClick={() => stepFontSize(-1)}
                aria-label="Smaller lyrics text"
                className="px-2 py-1 rounded-md text-[11px] font-bold text-slate-300 hover:text-white disabled:opacity-35 transition-colors"
              >
                A-
              </button>
              <button
                type="button"
                disabled={fontSize === 'lg'}
                onClick={() => stepFontSize(1)}
                aria-label="Larger lyrics text"
                className="px-2 py-1 rounded-md text-[11px] font-bold text-slate-300 hover:text-white disabled:opacity-35 transition-colors"
              >
                A+
              </button>
            </div>
          </div>

          {/* AI Lyrics Helpers */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={Boolean(isEnhancing)}
              onClick={() => void handleAiEnhance('polish')}
              title="Clean & organize stanzas with Gemini AI"
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold inline-flex items-center gap-1 transition-colors border whitespace-nowrap ${
                enhancedLyrics?.mode === 'polish'
                  ? 'bg-[#4F6BFF]/25 border-[#4F6BFF]/50 text-white'
                  : 'bg-white/[0.06] hover:bg-white/[0.12] border-white/[0.08] text-slate-200 hover:text-white'
              } disabled:opacity-55`}
            >
              {isEnhancing === 'polish' ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Sparkles className="w-3 h-3 text-[#8CA2FF]" />
              )}
              <span>AI Format</span>
            </button>

            <button
              type="button"
              disabled={Boolean(isEnhancing)}
              onClick={() => void handleAiEnhance('hinglish')}
              title="Convert to clean, readable Roman Hinglish with Gemini AI"
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold inline-flex items-center gap-1 transition-colors border whitespace-nowrap ${
                enhancedLyrics?.mode === 'hinglish'
                  ? 'bg-emerald-500/25 border-emerald-500/50 text-emerald-200'
                  : 'bg-white/[0.06] hover:bg-white/[0.12] border-white/[0.08] text-slate-200 hover:text-white'
              } disabled:opacity-55`}
            >
              {isEnhancing === 'hinglish' ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Languages className="w-3 h-3 text-emerald-300" />
              )}
              <span>Hinglish</span>
            </button>
          </div>
        </div>

        {enhanceError && <p className="text-[11px] text-rose-300 px-1">{enhanceError}</p>}
      </div>

      {/* Scrollable Stage Lyrics Canvas */}
      <div
        ref={containerRef}
        onWheel={() => {
          if (hasSynced && autoScroll) setAutoScroll(false);
        }}
        onTouchMove={() => {
          if (hasSynced && autoScroll) setAutoScroll(false);
        }}
        className={`flex-1 min-h-0 overflow-y-auto pt-3 pb-10 px-1 sm:px-2 ${fontClass}`}
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
                          background: `linear-gradient(90deg, ${accentHex}2A 0%, rgba(255,255,255,0.03) 100%)`,
                          borderLeftColor: accentHex,
                        }
                      : undefined
                  }
                  className={`w-full text-left px-3.5 py-2.5 rounded-xl border-l-[3px] transition-all duration-200 group ${
                    isActive
                      ? 'shadow-sm'
                      : 'border-l-transparent hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span
                      className={`break-words tracking-tight transition-all duration-200 flex-1 ${
                        isActive
                          ? `${SYNCED_ACTIVE_SIZE[fontSize]} font-bold text-white leading-snug`
                          : isPast
                            ? `${SYNCED_INACTIVE_SIZE[fontSize]} font-medium text-white/40 group-hover:text-white/80 leading-relaxed`
                            : `${SYNCED_INACTIVE_SIZE[fontSize]} font-medium text-white/75 group-hover:text-white leading-relaxed`
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
                  className={`${PLAIN_TEXT_SIZE[fontSize]} font-medium text-white/90 tracking-tight break-words`}
                >
                  {trimmed}
                </p>
              );
            })}
          </div>
        )}
      </div>

      {/* Floating Re-Sync CTA when user manually scrolled away */}
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
            className="pointer-events-auto h-8 px-3.5 rounded-full bg-[#181B26]/95 hover:bg-[#222636] border border-white/15 text-[11px] font-semibold text-white shadow-xl backdrop-blur-md inline-flex items-center gap-1.5 transition-colors"
          >
            <LocateFixed className="w-3.5 h-3.5" style={{ color: accentHex }} />
            <span>Jump to current line</span>
          </button>
        </div>
      )}
    </div>
  );
}
