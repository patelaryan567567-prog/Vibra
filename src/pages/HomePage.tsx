import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Globe, Play, RefreshCw, Sparkles } from 'lucide-react';
import { ApiNoticeBanner } from '../components/ApiNoticeBanner';
import { TrackCard, TrackCardSkeleton } from '../components/TrackCard';
import {
  DISCOVERY_CATEGORIES,
  HERO_BANNER_IMAGE,
  INDIA_LANGUAGE_OPTIONS,
  REGION_OPTIONS,
} from '../constants/categories';
import { useLibrary } from '../context/LibraryContext';
import { usePlayer } from '../context/PlayerContext';
import { ApiError, fetchCategoryTracks } from '../services/api';
import type { CategoryId, IndiaLanguageFilter, NavTab, Track } from '../types/music';
import { formatRelativeTime, getTimeGreeting } from '../utils/format';

interface HomePageProps {
  onAddToPlaylist: (track: Track) => void;
  onNavigate: (tab: NavTab) => void;
}

type CategoryState = {
  tracks: Track[];
  loading: boolean;
  error: string | null;
  errorCode?: string;
};

const INITIAL_CAT_STATE: Record<CategoryId, CategoryState> = {
  trending: { tracks: [], loading: true, error: null },
  energetic: { tracks: [], loading: true, error: null },
  sad: { tracks: [], loading: true, error: null },
  discover: { tracks: [], loading: true, error: null },
};

export function HomePage({ onAddToPlaylist, onNavigate }: HomePageProps) {
  const { recentlyPlayed } = useLibrary();
  const { playTrack } = usePlayer();

  const [region, setRegion] = useState<string>('IN');
  const [indiaLang, setIndiaLang] = useState<IndiaLanguageFilter>('all');
  const [discoverSubFilter, setDiscoverSubFilter] = useState<string>('All');
  const [categories, setCategories] = useState<Record<CategoryId, CategoryState>>(INITIAL_CAT_STATE);
  const abortControllersRef = useRef<Partial<Record<CategoryId, AbortController>>>({});

  const loadCategory = useCallback(
    async (
      id: CategoryId,
      opts?: {
        refresh?: boolean;
        ai?: boolean;
        subFilter?: string;
        targetRegion?: string;
        targetLang?: IndiaLanguageFilter;
      }
    ) => {
      abortControllersRef.current[id]?.abort();
      const controller = new AbortController();
      abortControllersRef.current[id] = controller;

      setCategories((prev) => ({
        ...prev,
        [id]: { ...prev[id], loading: true, error: null },
      }));

      try {
        const tracks = await fetchCategoryTracks({
          category: id,
          region: opts?.targetRegion ?? region,
          lang: opts?.targetLang ?? indiaLang,
          refresh: opts?.refresh,
          ai: opts?.ai,
          subFilter: opts?.subFilter ?? (id === 'discover' ? discoverSubFilter : undefined),
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setCategories((prev) => ({
          ...prev,
          [id]: { tracks, loading: false, error: null },
        }));
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const message = err instanceof Error ? err.message : 'Unable to load tracks.';
        const errorCode = err instanceof ApiError ? err.code : undefined;
        setCategories((prev) => ({
          ...prev,
          [id]: { tracks: [], loading: false, error: message, errorCode },
        }));
      }
    },
    [region, indiaLang, discoverSubFilter]
  );

  useEffect(() => {
    DISCOVERY_CATEGORIES.forEach((cat) => {
      loadCategory(cat.id, { targetRegion: region, targetLang: indiaLang });
    });
    return () => {
      Object.values(abortControllersRef.current).forEach((ctrl) => ctrl?.abort());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [region, indiaLang]);

  const handleDiscoverFilterChange = (sub: string) => {
    setDiscoverSubFilter(sub);
    loadCategory('discover', { subFilter: sub, refresh: true });
  };

  const anyMissingYoutubeKey = Object.values(categories).some(
    (c) => c.errorCode === 'YOUTUBE_API_KEY_MISSING'
  );

  const greeting = getTimeGreeting();
  const activeLangMeta = INDIA_LANGUAGE_OPTIONS.find((l) => l.id === indiaLang);

  return (
    <div className="space-y-8 sm:space-y-10 pb-8">
      {/* Greeting & Hero Section */}
      <section className="space-y-4 sm:space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 sm:gap-4">
          <div>
            <p className="text-xs font-medium text-[#7A90FF] tracking-wide">{greeting}</p>
            <h1 className="text-xl sm:text-3xl lg:text-4xl font-bold text-white tracking-tight mt-0.5 sm:mt-1 text-balance">
              Soundscapes tailored to your moment
            </h1>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            <Globe className="w-4 h-4 text-slate-400 shrink-0" />
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              aria-label="Select music region"
              className="h-10 px-3 rounded-xl bg-[#11131A] border border-white/10 text-xs font-medium text-white focus:outline-none focus:border-[#4F6BFF]"
            >
              {REGION_OPTIONS.map((r) => (
                <option key={r.code} value={r.code} className="bg-[#11131A]">
                  {r.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* India Multi-Language Music Filter Strip */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-2.5 sm:gap-3">
          <div
            className="flex items-center gap-1 p-1 rounded-xl bg-[#11131A] border border-white/[0.07] overflow-x-auto no-scrollbar max-w-full"
            role="tablist"
            aria-label="India music language categories"
          >
            {INDIA_LANGUAGE_OPTIONS.map((opt) => {
              const active = indiaLang === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setIndiaLang(opt.id)}
                  className={`px-3 sm:px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                    active
                      ? 'bg-[#4F6BFF] text-white'
                      : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          {activeLangMeta && (
            <p className="text-xs text-slate-400 shrink-0">{activeLangMeta.description}</p>
          )}
        </div>

        {/* Hero Feature Banner */}
        <div className="relative rounded-2xl overflow-hidden border border-white/[0.08] bg-[#11131A] min-h-[190px] sm:min-h-[240px] flex items-end">
          <img
            src={HERO_BANNER_IMAGE}
            alt="VIBRA Studio Console"
            className="absolute inset-0 w-full h-full object-cover opacity-70"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[#090A0F]/95 via-[#090A0F]/75 to-[#090A0F]/30" />

          <div className="relative z-10 p-5 sm:p-8 max-w-2xl space-y-3 sm:space-y-4">
            <p className="text-xs font-medium text-[#7A90FF]">VIBRA Discovery</p>
            <h2 className="text-lg sm:text-2xl font-bold text-white leading-snug text-balance">
              Stream trending hits, high-energy mixes, or ask Vibra AI for your exact mood.
            </h2>
            <div className="flex flex-wrap items-center gap-2.5 sm:gap-3 pt-1">
              <button
                type="button"
                onClick={() => {
                  const first = categories.trending.tracks[0];
                  if (first) playTrack(first, categories.trending.tracks);
                  else onNavigate('search');
                }}
                className="h-10 sm:h-11 px-4 sm:px-5 rounded-xl bg-[#4F6BFF] hover:bg-[#415CE6] text-white text-xs sm:text-sm font-semibold inline-flex items-center gap-2 whitespace-nowrap transition-colors"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>Play Trending Mix</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('explore')}
                className="h-10 sm:h-11 px-4 sm:px-5 rounded-xl bg-white/10 hover:bg-white/15 backdrop-blur-md border border-white/15 text-white text-xs sm:text-sm font-medium inline-flex items-center gap-2 whitespace-nowrap transition-colors"
              >
                <Sparkles className="w-4 h-4 text-[#7A90FF]" />
                <span>Open AI Mood Studio</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Missing API Key Honest Banner */}
      {anyMissingYoutubeKey && (
        <ApiNoticeBanner
          message={
            categories.trending.error ||
            'YouTube Data API v3 key is not configured. Add YOUTUBE_API_KEY in your server environment secrets to load live YouTube music tracks.'
          }
          onRetry={() => {
            DISCOVERY_CATEGORIES.forEach((cat) => loadCategory(cat.id, { refresh: true }));
          }}
        />
      )}

      {/* Recently Played Section — Horizontal Scroll Carousel */}
      {recentlyPlayed.length > 0 && (
        <section className="space-y-3.5 sm:space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg sm:text-xl font-bold text-white">Recently Played</h2>
              <p className="text-xs text-slate-400 mt-0.5">Pick up right where you left off</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('library')}
              className="text-xs font-medium text-[#7A90FF] hover:text-white transition-colors whitespace-nowrap"
            >
              View History
            </button>
          </div>

          <div className="flex gap-3.5 sm:gap-4 overflow-x-auto pb-2 snap-x snap-mandatory no-scrollbar -mx-3.5 px-3.5 sm:mx-0 sm:px-0">
            {recentlyPlayed.slice(0, 10).map((item) => (
              <div
                key={`${item.track.id}_${item.playedAt}`}
                className="w-[235px] sm:w-[255px] md:w-[265px] lg:w-[275px] shrink-0 snap-start"
              >
                <TrackCard
                  track={item.track}
                  queueContext={recentlyPlayed.map((r) => r.track)}
                  onAddToPlaylist={onAddToPlaylist}
                  timestampLabel={formatRelativeTime(item.playedAt)}
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Four Primary Discovery Categories — Horizontal Scroll Carousels */}
      {DISCOVERY_CATEGORIES.map((cat) => {
        const state = categories[cat.id];
        return (
          <section key={cat.id} className="space-y-3.5 sm:space-y-4">
            <div className="flex flex-wrap items-start sm:items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-lg sm:text-2xl font-bold text-white tracking-tight">
                  {cat.title}
                </h2>
                <p className="text-xs sm:text-sm text-slate-300 mt-0.5 leading-snug">
                  {cat.subtitle}
                </p>
              </div>

              <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                {state.tracks.length > 0 && (
                  <button
                    type="button"
                    onClick={() => playTrack(state.tracks[0], state.tracks)}
                    className="h-9 px-3 sm:px-3.5 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] text-xs font-medium text-white inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Play All</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() =>
                    loadCategory(cat.id, {
                      refresh: true,
                      ai: cat.id === 'energetic' || cat.id === 'sad',
                    })
                  }
                  disabled={state.loading}
                  className="h-9 px-3 sm:px-3.5 rounded-xl bg-[#11131A] hover:bg-[#181B26] border border-white/10 text-xs font-medium text-slate-200 inline-flex items-center gap-1.5 whitespace-nowrap transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${state.loading ? 'animate-spin' : ''}`} />
                  <span>{cat.id === 'energetic' ? 'AI Refresh' : 'Refresh'}</span>
                </button>
              </div>
            </div>

            {/* Discover More Genre Sub-Filters */}
            {cat.subFilters && (
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
                {cat.subFilters.map((sub) => (
                  <button
                    key={sub}
                    type="button"
                    onClick={() => handleDiscoverFilterChange(sub)}
                    className={`px-3.5 py-2 rounded-xl text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                      discoverSubFilter === sub
                        ? 'bg-[#4F6BFF] text-white'
                        : 'bg-[#11131A] text-slate-400 hover:text-white border border-white/[0.06]'
                    }`}
                  >
                    {sub}
                  </button>
                ))}
              </div>
            )}

            {/* Category Content: Horizontal Scroll Carousel Across All Devices */}
            {state.loading ? (
              <div className="flex gap-3.5 sm:gap-4 overflow-x-auto pb-2 no-scrollbar -mx-3.5 px-3.5 sm:mx-0 sm:px-0">
                {Array.from({ length: 5 }).map((_, idx) => (
                  <div
                    key={idx}
                    className="w-[235px] sm:w-[255px] md:w-[265px] lg:w-[275px] shrink-0"
                  >
                    <TrackCardSkeleton />
                  </div>
                ))}
              </div>
            ) : state.error ? (
              state.errorCode !== 'YOUTUBE_API_KEY_MISSING' ? (
                <ApiNoticeBanner
                  title={`Could not load ${cat.title}`}
                  message={state.error}
                  onRetry={() => loadCategory(cat.id, { refresh: true })}
                />
              ) : (
                <div className="rounded-xl bg-[#11131A] border border-white/[0.06] px-4 py-6 text-xs text-slate-400">
                  Live tracks for <span className="text-white font-medium">{cat.title}</span> will appear here once{' '}
                  <code className="font-mono text-amber-300">YOUTUBE_API_KEY</code> is active.
                </div>
              )
            ) : state.tracks.length === 0 ? (
              <div className="rounded-xl bg-[#11131A] border border-white/[0.06] px-4 py-8 text-center text-sm text-slate-400">
                No tracks found for this category right now. Try refreshing.
              </div>
            ) : (
              <div className="flex gap-3.5 sm:gap-4 overflow-x-auto pb-2 snap-x snap-mandatory no-scrollbar -mx-3.5 px-3.5 sm:mx-0 sm:px-0">
                {state.tracks.map((track) => (
                  <div
                    key={track.id}
                    className="w-[235px] sm:w-[255px] md:w-[265px] lg:w-[275px] shrink-0 snap-start"
                  >
                    <TrackCard
                      track={track}
                      queueContext={state.tracks}
                      onAddToPlaylist={onAddToPlaylist}
                    />
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
