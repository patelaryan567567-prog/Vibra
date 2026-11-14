import React, { useState } from 'react';
import { Play, RefreshCw } from 'lucide-react';
import { AiDiscoveryPanel } from '../components/AiDiscoveryPanel';
import { ApiNoticeBanner } from '../components/ApiNoticeBanner';
import { TrackCard, TrackCardSkeleton } from '../components/TrackCard';
import { DISCOVERY_CATEGORIES } from '../constants/categories';
import { usePlayer } from '../context/PlayerContext';
import { ApiError, fetchCategoryTracks } from '../services/api';
import type { CategoryId, Track } from '../types/music';

interface ExplorePageProps {
  onAddToPlaylist: (track: Track) => void;
  onRunSearchQuery: (query: string) => void;
}

export function ExplorePage({ onAddToPlaylist, onRunSearchQuery }: ExplorePageProps) {
  const { playTrack } = usePlayer();
  const [selectedCategory, setSelectedCategory] = useState<CategoryId | null>(null);
  const [catTracks, setCatTracks] = useState<Track[]>([]);
  const [loadingCat, setLoadingCat] = useState(false);
  const [catError, setCatError] = useState<string | null>(null);

  const openMoodWorld = async (id: CategoryId, refresh = false) => {
    setSelectedCategory(id);
    setLoadingCat(true);
    setCatError(null);
    try {
      const tracks = await fetchCategoryTracks({
        category: id,
        refresh,
        ai: id === 'energetic' || id === 'sad',
      });
      setCatTracks(tracks);
    } catch (err) {
      setCatTracks([]);
      setCatError(
        err instanceof ApiError ? err.message : 'Unable to fetch mood tracks right now.'
      );
    } finally {
      setLoadingCat(false);
    }
  };

  const activeMeta = DISCOVERY_CATEGORIES.find((c) => c.id === selectedCategory);

  return (
    <div className="space-y-10 pb-8">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">Explore &amp; AI Studio</h1>
        <p className="text-sm text-slate-400 mt-1">
          Let Gemini decode your mood into playable YouTube tracks, or dive into a sonic world.
        </p>
      </div>

      {/* Gemini AI Discovery Panel */}
      <AiDiscoveryPanel
        onAddToPlaylist={onAddToPlaylist}
        onRunSearchQuery={onRunSearchQuery}
      />

      {/* Four Mood Worlds */}
      <section className="space-y-4">
        <h2 className="text-lg sm:text-xl font-bold text-white">Curated Mood Worlds</h2>
        <div className="flex lg:grid lg:grid-cols-4 gap-3.5 sm:gap-4 overflow-x-auto lg:overflow-visible pb-2 lg:pb-0 snap-x snap-mandatory no-scrollbar -mx-3.5 px-3.5 sm:mx-0 sm:px-0">
          {DISCOVERY_CATEGORIES.map((cat) => {
            const isSelected = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => openMoodWorld(cat.id, isSelected)}
                className={`w-[210px] sm:w-[235px] lg:w-auto shrink-0 snap-start group relative overflow-hidden rounded-2xl border text-left transition-all ${
                  isSelected
                    ? 'border-[#4F6BFF] ring-1 ring-[#4F6BFF]/40'
                    : 'border-white/[0.08] hover:border-white/20'
                } bg-[#11131A]`}
              >
                <div className="aspect-square w-full overflow-hidden bg-[#181B26] relative">
                  <img
                    src={cat.coverImage}
                    alt={cat.title}
                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#090A0F] via-[#090A0F]/45 to-transparent" />
                </div>
                <div className="absolute inset-x-0 bottom-0 p-4 space-y-1">
                  <h3 className="text-base font-bold text-white">{cat.title}</h3>
                  <p className="text-xs text-slate-300 line-clamp-2">{cat.subtitle}</p>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Selected Mood Results — Horizontal Scroll Carousel */}
      {selectedCategory && activeMeta && (
        <section className="space-y-4 pt-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold text-white">{activeMeta.title}</h3>
              <p className="text-xs text-slate-400">{activeMeta.subtitle}</p>
            </div>
            <div className="flex items-center gap-2">
              {catTracks.length > 0 && (
                <button
                  type="button"
                  onClick={() => playTrack(catTracks[0], catTracks)}
                  className="h-9 px-3.5 rounded-xl bg-[#4F6BFF] hover:bg-[#415CE6] text-xs font-semibold text-white inline-flex items-center gap-1.5"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Play Mix</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => openMoodWorld(selectedCategory, true)}
                disabled={loadingCat}
                className="h-9 px-3.5 rounded-xl bg-[#11131A] hover:bg-[#181B26] border border-white/10 text-xs font-medium text-slate-200 inline-flex items-center gap-1.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingCat ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
            </div>
          </div>

          {loadingCat ? (
            <div className="flex gap-3.5 sm:gap-4 overflow-x-auto pb-2 no-scrollbar -mx-3.5 px-3.5 sm:mx-0 sm:px-0">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="w-[235px] sm:w-[255px] md:w-[265px] lg:w-[275px] shrink-0"
                >
                  <TrackCardSkeleton />
                </div>
              ))}
            </div>
          ) : catError ? (
            <ApiNoticeBanner
              message={catError}
              onRetry={() => openMoodWorld(selectedCategory, true)}
            />
          ) : (
            <div className="flex gap-3.5 sm:gap-4 overflow-x-auto pb-2 snap-x snap-mandatory no-scrollbar -mx-3.5 px-3.5 sm:mx-0 sm:px-0">
              {catTracks.map((track) => (
                <div
                  key={track.id}
                  className="w-[235px] sm:w-[255px] md:w-[265px] lg:w-[275px] shrink-0 snap-start"
                >
                  <TrackCard
                    track={track}
                    queueContext={catTracks}
                    onAddToPlaylist={onAddToPlaylist}
                  />
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
