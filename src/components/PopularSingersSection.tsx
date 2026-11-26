import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Mic2, Music2, Sparkles } from 'lucide-react';
import { FEATURED_ARTISTS, type FeaturedArtistInfo } from '../constants/featuredArtists';
import { useArtistNavigation } from '../context/ArtistNavigationContext';

interface PopularSingersSectionProps {
  title?: string;
  subtitle?: string;
  defaultShowAll?: boolean;
  activeArtistName?: string;
}

type SingerGroupFilter = 'all' | 'top12' | 'romantic' | 'punjabi' | 'evergreen';

const GROUP_TABS: Array<{ id: SingerGroupFilter; label: string }> = [
  { id: 'all', label: 'All Popular Singers (28)' },
  { id: 'top12', label: 'Top 12 Spotlight' },
  { id: 'romantic', label: 'Romantic & Soul' },
  { id: 'punjabi', label: 'Punjabi & Hip-Hop' },
  { id: 'evergreen', label: '90s & Evergreen' },
];

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase();
}

export function PopularSingersSection({
  title = 'Popular Singers & Categorized Catalogs',
  subtitle = 'Open any singer to explore all their songs divided into Romantic, Sad, Chill, Party, and Classics',
  defaultShowAll = false,
  activeArtistName,
}: PopularSingersSectionProps) {
  const { openArtistPage } = useArtistNavigation();
  const [groupFilter, setGroupFilter] = useState<SingerGroupFilter>('all');
  const [showAll, setShowAll] = useState<boolean>(defaultShowAll);
  const [searchText, setSearchText] = useState<string>('');
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});

  const filteredArtists = useMemo<FeaturedArtistInfo[]>(() => {
    const q = searchText.trim().toLowerCase();
    return FEATURED_ARTISTS.filter((artist) => {
      if (q) {
        const hay = `${artist.name} ${artist.tagline} ${artist.primaryLanguage} ${artist.signatureSongs.join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (groupFilter === 'top12') return artist.rank <= 12;
      if (groupFilter === 'romantic') {
        return (
          artist.defaultMoods.includes('romantic') ||
          artist.defaultMoods.includes('sad')
        );
      }
      if (groupFilter === 'punjabi') {
        return (
          artist.primaryLanguage === 'Punjabi' ||
          artist.defaultMoods.includes('energetic')
        );
      }
      if (groupFilter === 'evergreen') {
        return artist.defaultMoods.includes('classics');
      }
      return true;
    });
  }, [groupFilter, searchText]);

  const visibleArtists = useMemo(() => {
    if (showAll || searchText.trim() || groupFilter !== 'all') {
      return filteredArtists;
    }
    return filteredArtists.slice(0, 12);
  }, [filteredArtists, showAll, searchText, groupFilter]);

  const activeNorm = (activeArtistName || '').trim().toLowerCase();

  return (
    <section className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Mic2 className="w-4 h-4 text-[#7A90FF] shrink-0" />
            <p className="text-xs font-semibold text-[#7A90FF] tracking-wide">
              Artist Hub · Mood Categorized Discographies
            </p>
          </div>
          <h2 className="text-lg sm:text-2xl font-bold text-white tracking-tight mt-0.5">
            {title}
          </h2>
          <p className="text-xs sm:text-sm text-slate-300 mt-0.5 leading-snug">
            {subtitle}
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Filter singer..."
            aria-label="Filter popular singers"
            className="h-9 w-40 sm:w-48 px-3 rounded-xl bg-[#11131A] border border-white/10 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-[#4F6BFF]"
          />
          {groupFilter === 'all' && !searchText.trim() && (
            <button
              type="button"
              onClick={() => setShowAll((prev) => !prev)}
              className="h-9 px-3.5 rounded-xl bg-[#11131A] hover:bg-[#181B26] border border-white/10 text-xs font-semibold text-slate-200 hover:text-white inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
            >
              <span>{showAll ? 'Show Top 12' : `View All ${FEATURED_ARTISTS.length} Singers`}</span>
              {showAll ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      </div>

      {/* Interactive Filter Tabs */}
      <div
        className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1"
        role="tablist"
        aria-label="Singer style categories"
      >
        {GROUP_TABS.map((tab) => {
          const active = groupFilter === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setGroupFilter(tab.id)}
              className={`h-9 px-3.5 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                active
                  ? 'bg-[#4F6BFF] text-white'
                  : 'bg-[#11131A] text-slate-400 hover:text-white border border-white/[0.07]'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Responsive Singer Poster Cards Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {visibleArtists.map((artist) => {
          const isCurrent = Boolean(
            activeNorm &&
              (artist.name.toLowerCase() === activeNorm ||
                activeNorm.includes(artist.name.toLowerCase()) ||
                artist.name.toLowerCase().includes(activeNorm))
          );
          const hasImgError = Boolean(failedImages[artist.name]);

          return (
            <button
              key={artist.name}
              type="button"
              onClick={() => openArtistPage(artist.name)}
              className={`group relative overflow-hidden rounded-2xl p-3 text-left transition-all flex flex-col justify-between bg-gradient-to-br ${artist.avatarGradient} bg-[#11131A] hover:bg-[#161924] border ${
                isCurrent
                  ? 'border-[#4F6BFF] ring-1 ring-[#4F6BFF]/40'
                  : 'border-white/[0.08] hover:border-white/20'
              }`}
            >
              {/* Artist Poster Artwork */}
              <div className="relative aspect-square w-full rounded-xl overflow-hidden bg-[#181B26] border border-white/10 mb-2.5">
                {artist.posterUrl && !hasImgError ? (
                  <img
                    src={artist.posterUrl}
                    alt={artist.name}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    onError={() =>
                      setFailedImages((prev) => ({ ...prev, [artist.name]: true }))
                    }
                    className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-white font-display font-extrabold text-2xl">
                    {getInitials(artist.name)}
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent" />
                <span className="absolute top-2 right-2 font-mono-tabular text-[11px] font-bold text-white/95 drop-shadow">
                  #{artist.rank}
                </span>
              </div>

              <div className="relative z-10 space-y-0.5">
                <h3 className="text-sm font-bold text-white group-hover:text-[#7A90FF] transition-colors line-clamp-1">
                  {artist.name}
                </h3>
                <p className="text-[11px] text-slate-300 line-clamp-1">
                  {artist.tagline}
                </p>
                <p className="text-[10px] text-slate-400 line-clamp-1 pt-0.5 flex items-center gap-1">
                  <Music2 className="w-3 h-3 text-[#7A90FF] shrink-0" />
                  <span className="truncate">{artist.signatureSongs.slice(0, 2).join(' · ')}</span>
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Expand/Collapse Footer Button for Mobile Convenience */}
      {groupFilter === 'all' && !searchText.trim() && !showAll && (
        <div className="pt-1 flex justify-center">
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="h-10 px-5 rounded-xl bg-white/[0.06] hover:bg-white/[0.11] border border-white/10 text-xs font-semibold text-white inline-flex items-center gap-2 whitespace-nowrap transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5 text-[#7A90FF]" />
            <span>Show All {FEATURED_ARTISTS.length} Popular Singers (Atif Aslam, Shubh, KK, Kumar Sanu &amp; More)</span>
          </button>
        </div>
      )}
    </section>
  );
}
