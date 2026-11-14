import React, { useMemo, useState } from 'react';
import { Heart, Play, Search, Shuffle } from 'lucide-react';
import { TrackRow } from '../components/TrackCard';
import { useLibrary } from '../context/LibraryContext';
import { usePlayer } from '../context/PlayerContext';
import type { NavTab, Track } from '../types/music';

interface FavouritesPageProps {
  onAddToPlaylist: (track: Track) => void;
  onNavigate: (tab: NavTab) => void;
}

export function FavouritesPage({ onAddToPlaylist, onNavigate }: FavouritesPageProps) {
  const { favourites } = useLibrary();
  const { playTrack } = usePlayer();
  const [filterText, setFilterText] = useState('');

  const filtered = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    if (!q) return favourites;
    return favourites.filter(
      (t) => t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q)
    );
  }, [favourites, filterText]);

  const handleShuffle = () => {
    if (filtered.length === 0) return;
    const shuffled = [...filtered].sort(() => Math.random() - 0.5);
    playTrack(shuffled[0], shuffled);
  };

  return (
    <div className="space-y-8 pb-8">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">Favourites</h1>
          <p className="text-sm text-slate-400 mt-1 font-mono-tabular">
            {favourites.length} saved {favourites.length === 1 ? 'track' : 'tracks'}
          </p>
        </div>

        {filtered.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => playTrack(filtered[0], filtered)}
              className="h-10 px-4 rounded-xl bg-[#4F6BFF] hover:bg-[#415CE6] text-white text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap transition-colors"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>Play All</span>
            </button>
            <button
              type="button"
              onClick={handleShuffle}
              className="h-10 px-4 rounded-xl bg-[#11131A] hover:bg-[#181B26] border border-white/10 text-white text-xs font-medium inline-flex items-center gap-2 whitespace-nowrap transition-colors"
            >
              <Shuffle className="w-4 h-4" />
              <span>Shuffle</span>
            </button>
          </div>
        )}
      </div>

      {favourites.length > 0 && (
        <div className="relative max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Filter your favourites..."
            className="w-full h-11 pl-10 pr-4 rounded-xl bg-[#11131A] border border-white/10 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#4F6BFF]"
          />
        </div>
      )}

      {favourites.length === 0 ? (
        <div className="rounded-2xl bg-[#11131A] border border-white/[0.07] p-12 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-rose-500/15 text-rose-400 flex items-center justify-center mx-auto">
            <Heart className="w-6 h-6" />
          </div>
          <h3 className="text-base font-semibold text-white">No favourite tracks yet</h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            Tap the heart icon on any song or music video to build your personal collection.
          </p>
          <button
            type="button"
            onClick={() => onNavigate('explore')}
            className="mt-2 h-10 px-5 rounded-xl bg-[#4F6BFF] hover:bg-[#415CE6] text-xs font-semibold text-white inline-flex items-center justify-center"
          >
            Explore Music
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-slate-400 py-8 text-center">
          No favourites match &ldquo;{filterText}&rdquo;.
        </p>
      ) : (
        <div className="space-y-2">
          {filtered.map((track, idx) => (
            <TrackRow
              key={track.id}
              track={track}
              index={idx}
              queueContext={filtered}
              onAddToPlaylist={onAddToPlaylist}
            />
          ))}
        </div>
      )}
    </div>
  );
}
