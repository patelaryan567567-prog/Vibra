import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Compass,
  Disc3,
  Download,
  Flame,
  Grid,
  HardDrive,
  Heart,
  ListMusic,
  Loader2,
  Mic2,
  Music2,
  Play,
  PlusCircle,
  Radio,
  RefreshCw,
  Search,
  Shuffle,
  Sparkles,
  Tv,
  User,
  WifiOff,
} from 'lucide-react';
import { PopularSingersSection } from '../components/PopularSingersSection';
import { TrackCard, TrackCardSkeleton, TrackRow } from '../components/TrackCard';
import {
  ARTIST_SONG_CATEGORIES,
  classifyArtistTrackCategories,
  FEATURED_ARTISTS,
  findFeaturedArtist,
  type ArtistSongCategory,
} from '../constants/featuredArtists';
import { useArtistNavigation } from '../context/ArtistNavigationContext';
import { offlineTrackToLibraryTrack, useLibrary } from '../context/LibraryContext';
import { useOfflineMusic } from '../context/OfflineMusicContext';
import { useOfflinePlayer } from '../context/OfflinePlayerContext';
import { usePlayer } from '../context/PlayerContext';
import {
  fetchArtistCategorySongs,
  fetchArtistProfile,
  prewarmTrackBatch,
} from '../services/api';
import type { ArtistProfileResponse, OfflineTrack, Track } from '../types/music';
import { useAmbientColor } from '../utils/ambientColor';

interface ArtistPageProps {
  artistName: string;
  seedTrack?: Track;
  onAddToPlaylist: (track: Track) => void;
  onBack: () => void;
}

type ArtistViewTab = 'categorized' | ArtistSongCategory;

const MOOD_SECTION_ORDER: Array<{
  id: Exclude<ArtistSongCategory, 'all' | 'videos'>;
  title: string;
  subtitle: string;
  accentClass: string;
}> = [
  {
    id: 'trending',
    title: 'Trending & Signature Hits',
    subtitle: 'Most streamed chartbusters and iconic tracks',
    accentClass: 'text-amber-300',
  },
  {
    id: 'romantic',
    title: 'Romantic & Love Songs',
    subtitle: 'Heartfelt melodies, love ballads, and soulful duets',
    accentClass: 'text-rose-300',
  },
  {
    id: 'sad',
    title: 'Sad & Heartbreak',
    subtitle: 'Emotional, intense, and late-night heartbreak anthems',
    accentClass: 'text-indigo-300',
  },
  {
    id: 'chill',
    title: 'Chill, Acoustic & Unplugged',
    subtitle: 'Relaxed vibes, acoustic sessions, and smooth listening',
    accentClass: 'text-emerald-300',
  },
  {
    id: 'energetic',
    title: 'Party, Beats & High Energy',
    subtitle: 'Upbeat dance tracks, Punjabi bangers, and workout anthems',
    accentClass: 'text-orange-300',
  },
  {
    id: 'classics',
    title: 'Evergreen Classics & Golden Hits',
    subtitle: 'Timeless originals and unforgettable melodies',
    accentClass: 'text-sky-300',
  },
];

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase();
}

function normalizeArtistKey(name: string): string {
  return name.trim().toLowerCase();
}

function normalizeSongKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function mergeUniqueArtistTracks(existing: Track[], incoming: Track[]): Track[] {
  const seenIds = new Set<string>();
  const seenTitles = new Set<string>();
  const merged: Track[] = [];

  for (const track of [...existing, ...incoming]) {
    if (!track?.id || seenIds.has(track.id)) continue;
    const tKey = normalizeSongKey(track.title);
    if (tKey.length >= 4 && seenTitles.has(tKey)) continue;
    seenIds.add(track.id);
    if (tKey.length >= 4) seenTitles.add(tKey);
    merged.push(track);
  }
  return merged;
}

export function ArtistPage({ artistName, seedTrack, onAddToPlaylist, onBack }: ArtistPageProps) {
  const { openArtistPage } = useArtistNavigation();
  const { listeningStats, favourites, playlists } = useLibrary();
  const {
    offlineTracks,
    isOnline,
    batchDownloadTracks,
    isBatchDownloading,
    batchDownloadState,
  } = useOfflineMusic();
  const { playTrack, startTrackRadio } = usePlayer();
  const { playOfflineTrack } = useOfflinePlayer();

  const [profile, setProfile] = useState<ArtistProfileResponse | null>(null);
  const [extraTracks, setExtraTracks] = useState<Track[]>([]);
  const [categorySpecificTracks, setCategorySpecificTracks] = useState<
    Partial<Record<ArtistSongCategory, Track[]>>
  >({});
  const [categoryPages, setCategoryPages] = useState<Partial<Record<ArtistSongCategory, number>>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [loadingCategoryTab, setLoadingCategoryTab] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [imgError, setImgError] = useState(false);

  const [activeTab, setActiveTab] = useState<ArtistViewTab>('categorized');
  const [songQuery, setSongQuery] = useState<string>('');
  const [showAllSingersDirectory, setShowAllSingersDirectory] = useState<boolean>(false);
  const [expandedMoodSections, setExpandedMoodSections] = useState<Record<string, boolean>>({});

  const featuredMeta = useMemo(() => findFeaturedArtist(artistName), [artistName]);
  const resolvedArtistName = featuredMeta?.name || artistName;

  const loadProfile = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      setImgError(false);
      setExtraTracks([]);
      setCategorySpecificTracks({});
      setCategoryPages({ all: 1 });
      setSongQuery('');
      setExpandedMoodSections({});

      try {
        const res = await fetchArtistProfile({
          artist: resolvedArtistName,
          seedVideoId: seedTrack?.id,
          signal,
        });
        if (!signal?.aborted) {
          setProfile(res);
          if (res.topTracks.length > 0) {
            prewarmTrackBatch(res.topTracks.slice(0, 6));
          }
        }
      } catch (err) {
        if (!signal?.aborted) {
          setError(
            err instanceof Error ? err.message : 'Unable to load artist catalog right now.'
          );
        }
      } finally {
        if (!signal?.aborted) {
          setLoading(false);
        }
      }
    },
    [resolvedArtistName, seedTrack?.id]
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadProfile(controller.signal);
    return () => controller.abort();
  }, [loadProfile]);

  // When a specific mood category tab is selected, proactively fetch deep category tracks for that singer
  useEffect(() => {
    if (
      !isOnline ||
      activeTab === 'categorized' ||
      activeTab === 'all' ||
      activeTab === 'videos'
    ) {
      return;
    }
    if (categorySpecificTracks[activeTab] && (categorySpecificTracks[activeTab]?.length || 0) > 0) {
      return;
    }

    const controller = new AbortController();
    setLoadingCategoryTab(true);
    fetchArtistCategorySongs({
      artist: resolvedArtistName,
      category: activeTab,
      page: 1,
      signal: controller.signal,
    })
      .then((res) => {
        if (controller.signal.aborted) return;
        const fetchedTracks = res.tracks || [];
        setCategorySpecificTracks((prev) => ({
          ...prev,
          [activeTab]: fetchedTracks,
        }));
        setCategoryPages((prev) => ({
          ...prev,
          [activeTab]: 1,
        }));
        setExtraTracks((prev) => mergeUniqueArtistTracks(prev, fetchedTracks));
      })
      .catch(() => {
        // Non-fatal: already have classified tracks from initial catalog
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoadingCategoryTab(false);
        }
      });

    return () => controller.abort();
  }, [activeTab, categorySpecificTracks, isOnline, resolvedArtistName]);

  const handleLoadMoreSongs = async (targetCategory?: ArtistSongCategory) => {
    if (!isOnline || loadingMore) return;
    const cat: ArtistSongCategory =
      targetCategory ||
      (activeTab === 'categorized' || activeTab === 'videos' ? 'all' : activeTab);
    const currentPage = categoryPages[cat] || 1;
    const nextPage = currentPage + 1;

    setLoadingMore(true);
    try {
      const res = await fetchArtistCategorySongs({
        artist: resolvedArtistName,
        category: cat,
        page: nextPage,
      });
      const moreTracks = res.tracks || [];
      setCategoryPages((prev) => ({
        ...prev,
        [cat]: nextPage,
      }));
      if (moreTracks.length > 0) {
        setExtraTracks((prev) => mergeUniqueArtistTracks(prev, moreTracks));
        if (cat !== 'all') {
          setCategorySpecificTracks((prev) => ({
            ...prev,
            [cat]: mergeUniqueArtistTracks(prev[cat] || [], moreTracks),
          }));
        }
      }
    } catch {
      // Keep existing tracks
    } finally {
      setLoadingMore(false);
    }
  };

  const normName = normalizeArtistKey(resolvedArtistName);

  const personalArtistStat = useMemo(() => {
    return listeningStats.artistStats[normName] || null;
  }, [listeningStats.artistStats, normName]);

  const matchingOfflineTracks = useMemo<OfflineTrack[]>(() => {
    if (!normName) return [];
    return offlineTracks.filter((t) => {
      const candidate = normalizeArtistKey(t.artist);
      return (
        candidate === normName ||
        (candidate.length > 2 && (candidate.includes(normName) || normName.includes(candidate)))
      );
    });
  }, [offlineTracks, normName]);

  const matchingOfflineAsTracks = useMemo(
    () => matchingOfflineTracks.map(offlineTrackToLibraryTrack),
    [matchingOfflineTracks]
  );

  const savedInLibraryTracks = useMemo<Track[]>(() => {
    if (!normName) return [];
    const seen = new Set<string>();
    const combined: Track[] = [];
    const pushIfMatches = (t: Track) => {
      if (t.isOffline || seen.has(t.id)) return;
      const candidate = normalizeArtistKey(t.artist);
      if (
        candidate === normName ||
        (candidate.length > 2 && (candidate.includes(normName) || normName.includes(candidate)))
      ) {
        seen.add(t.id);
        combined.push(t);
      }
    };
    favourites.forEach(pushIfMatches);
    playlists.forEach((pl) => pl.tracks.forEach(pushIfMatches));
    return combined;
  }, [favourites, playlists, normName]);

  const allCatalogTracks = useMemo<Track[]>(() => {
    const base = profile?.topTracks || [];
    return mergeUniqueArtistTracks(base, extraTracks);
  }, [profile?.topTracks, extraTracks]);

  const musicVideos = profile?.musicVideos || [];
  const relatedArtists = profile?.relatedArtists || [];

  // Classify every track in the artist's catalog into mood categories (Romantic, Sad, Chill, Energetic, Classics, Trending)
  const categorizedMap = useMemo(() => {
    const buckets: Record<Exclude<ArtistSongCategory, 'all' | 'videos'>, Track[]> = {
      trending: [],
      romantic: [],
      sad: [],
      chill: [],
      energetic: [],
      classics: [],
    };

    allCatalogTracks.forEach((track, idx) => {
      const cats = classifyArtistTrackCategories(track.title, track.artist, idx);
      cats.forEach((c) => {
        if (c !== 'all' && c !== 'videos' && buckets[c]) {
          buckets[c].push(track);
        }
      });
    });

    // Also merge any category-specific fetched tracks directly into their respective bucket
    (Object.keys(buckets) as Array<Exclude<ArtistSongCategory, 'all' | 'videos'>>).forEach(
      (catKey) => {
        const direct = categorySpecificTracks[catKey] || [];
        if (direct.length > 0) {
          buckets[catKey] = mergeUniqueArtistTracks(buckets[catKey], direct);
        }
      }
    );

    return buckets;
  }, [allCatalogTracks, categorySpecificTracks]);

  // Filter tracks by in-artist search query
  const filterByQuery = useCallback(
    (tracks: Track[]): Track[] => {
      const q = songQuery.trim().toLowerCase();
      if (!q) return tracks;
      return tracks.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.artist.toLowerCase().includes(q) ||
          t.channelTitle.toLowerCase().includes(q)
      );
    },
    [songQuery]
  );

  const activeCategoryTracks = useMemo<Track[]>(() => {
    if (activeTab === 'categorized' || activeTab === 'all') {
      return filterByQuery(allCatalogTracks);
    }
    if (activeTab === 'videos') {
      return filterByQuery(musicVideos);
    }
    return filterByQuery(categorizedMap[activeTab] || []);
  }, [activeTab, allCatalogTracks, categorizedMap, filterByQuery, musicVideos]);

  // Always prioritize the singer's official portrait/poster over any YouTube channel avatar (so T-Series/label logos never replace Arijit Singh's photo)
  const heroImage =
    featuredMeta?.posterUrl ||
    profile?.avatarUrl ||
    allCatalogTracks[0]?.thumbnailHigh ||
    allCatalogTracks[0]?.thumbnail ||
    seedTrack?.thumbnailHigh ||
    seedTrack?.thumbnail ||
    matchingOfflineTracks[0]?.artworkDataUrl;

  const ambient = useAmbientColor(heroImage, resolvedArtistName);

  const downloadableTracks = useMemo(() => {
    const base =
      activeCategoryTracks.length > 0
        ? activeCategoryTracks
        : allCatalogTracks.length > 0
          ? allCatalogTracks
          : savedInLibraryTracks;
    return base.filter((t) => !t.isOffline);
  }, [activeCategoryTracks, allCatalogTracks, savedInLibraryTracks]);

  const allTopSaved =
    downloadableTracks.length > 0 &&
    downloadableTracks.every((t) =>
      offlineTracks.some((o) => o.id === t.id || o.sourceVideoId === t.id)
    );

  const playableQueue =
    activeCategoryTracks.length > 0
      ? activeCategoryTracks
      : allCatalogTracks.length > 0
        ? allCatalogTracks
        : savedInLibraryTracks;

  const handlePlayAll = (customQueue?: Track[]) => {
    const targetQueue = customQueue && customQueue.length > 0 ? customQueue : playableQueue;
    if (!isOnline && matchingOfflineTracks.length > 0) {
      playOfflineTrack(matchingOfflineTracks[0], matchingOfflineTracks);
      return;
    }
    if (targetQueue.length > 0) {
      playTrack(targetQueue[0], targetQueue);
    } else if (matchingOfflineTracks.length > 0) {
      playOfflineTrack(matchingOfflineTracks[0], matchingOfflineTracks);
    }
  };

  const handleShuffle = (customQueue?: Track[]) => {
    const targetQueue = customQueue && customQueue.length > 0 ? customQueue : playableQueue;
    if (!isOnline && matchingOfflineTracks.length > 0) {
      const shuffled = [...matchingOfflineTracks].sort(() => Math.random() - 0.5);
      playOfflineTrack(shuffled[0], shuffled);
      return;
    }
    if (targetQueue.length > 0) {
      const shuffled = [...targetQueue].sort(() => Math.random() - 0.5);
      playTrack(shuffled[0], shuffled);
    } else if (matchingOfflineTracks.length > 0) {
      const shuffled = [...matchingOfflineTracks].sort(() => Math.random() - 0.5);
      playOfflineTrack(shuffled[0], shuffled);
    }
  };

  const handleArtistRadio = () => {
    const radioSeed = playableQueue[0] || allCatalogTracks[0] || savedInLibraryTracks[0] || seedTrack;
    if (radioSeed && !radioSeed.isOffline) {
      startTrackRadio(radioSeed);
    }
  };

  const handleDownloadTopSongs = () => {
    if (downloadableTracks.length === 0) return;
    void batchDownloadTracks(
      downloadableTracks.slice(0, 40),
      profile?.artistName || resolvedArtistName,
      false
    );
  };

  const displayName = featuredMeta?.name || profile?.artistName || resolvedArtistName;

  return (
    <div className="space-y-7 pb-10">
      {/* Top Action Bar & Popular Singers Quick Switcher */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onBack}
              className="min-h-[40px] px-3.5 rounded-xl bg-[#11131A] hover:bg-[#181B26] border border-white/10 text-xs font-semibold text-slate-200 hover:text-white inline-flex items-center gap-2 whitespace-nowrap transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back</span>
            </button>

            <button
              type="button"
              onClick={() => setShowAllSingersDirectory((prev) => !prev)}
              className={`min-h-[40px] px-3.5 rounded-xl border text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap transition-colors ${
                showAllSingersDirectory
                  ? 'bg-[#4F6BFF] border-[#4F6BFF] text-white'
                  : 'bg-[#11131A] hover:bg-[#181B26] border-white/10 text-slate-200 hover:text-white'
              }`}
            >
              <Mic2 className="w-3.5 h-3.5 text-[#7A90FF]" />
              <span>
                {showAllSingersDirectory
                  ? 'Hide Singers Directory'
                  : `Browse All ${FEATURED_ARTISTS.length} Popular Singers`}
              </span>
            </button>
          </div>

          {!loading && (
            <button
              type="button"
              onClick={() => void loadProfile()}
              className="min-h-[40px] px-3.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-xs font-medium text-slate-200 inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Refresh Catalog</span>
            </button>
          )}
        </div>

        {/* Instant Horizontal Quick-Switch Bar for All 28 Popular Singers (#1 Arijit Singh to #12 Alka Yagnik & More) */}
        <div className="rounded-2xl bg-[#11131A] border border-white/[0.07] p-2.5">
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
            <span className="text-[11px] font-semibold text-slate-400 px-2 whitespace-nowrap shrink-0">
              Popular Singers:
            </span>
            {FEATURED_ARTISTS.map((singer) => {
              const isSelected =
                singer.name.toLowerCase() === displayName.toLowerCase() ||
                displayName.toLowerCase().includes(singer.name.toLowerCase());
              return (
                <button
                  key={singer.name}
                  type="button"
                  onClick={() => openArtistPage(singer.name)}
                  className={`h-9 pl-1.5 pr-3 rounded-xl text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors ${
                    isSelected
                      ? 'bg-[#4F6BFF] text-white shadow-sm'
                      : 'bg-white/[0.04] hover:bg-white/[0.09] text-slate-300 hover:text-white'
                  }`}
                >
                  <img
                    src={singer.posterUrl}
                    alt={singer.name}
                    referrerPolicy="no-referrer"
                    className="w-6 h-6 rounded-lg object-cover bg-[#181B26] shrink-0"
                  />
                  <span className="font-mono-tabular text-[10px] opacity-80">#{singer.rank}</span>
                  <span>{singer.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Expandable Full Popular Singers Grid */}
        {showAllSingersDirectory && (
          <div className="rounded-2xl bg-[#0D0F17] border border-white/10 p-4 sm:p-5">
            <PopularSingersSection
              title="Switch to Any Popular Singer"
              subtitle="Click any singer below to load their complete song catalog divided into Sad, Romantic, Chill, Party, and Classics"
              defaultShowAll
              activeArtistName={displayName}
            />
          </div>
        )}
      </div>

      {/* Hero Artist Poster Banner with Atmospheric Backdrop & Dynamic Ambient Glow */}
      <section
        className="relative overflow-hidden rounded-2xl bg-[#11131A] border border-white/[0.09] p-5 sm:p-7"
        style={{
          backgroundImage: `radial-gradient(circle at 18% 25%, ${ambient.glowStrong} 0%, ${ambient.glowSoft} 38%, rgba(17,19,26,0.98) 82%)`,
        }}
      >
        {/* Subtle Blurred Artist Poster Backdrop */}
        {heroImage && !imgError && (
          <img
            src={heroImage}
            alt=""
            aria-hidden="true"
            referrerPolicy="no-referrer"
            className="pointer-events-none absolute right-0 top-0 h-full w-1/2 object-cover opacity-15 blur-2xl scale-110 select-none"
          />
        )}

        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center gap-5 sm:gap-7">
          {/* Official High-Resolution Artist Poster */}
          <div className="w-32 h-32 sm:w-40 sm:h-40 rounded-2xl overflow-hidden bg-[#181B26] border border-white/20 shadow-2xl shrink-0 flex items-center justify-center">
            {heroImage && !imgError ? (
              <img
                src={heroImage}
                alt={`${displayName} Poster`}
                referrerPolicy="no-referrer"
                onError={() => setImgError(true)}
                className="w-full h-full object-cover"
              />
            ) : (
              <div
                className="w-full h-full flex items-center justify-center text-white text-3xl font-bold"
                style={{
                  background: ambient.accentGradient,
                }}
              >
                {getInitials(displayName) || <User className="w-9 h-9" />}
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1 space-y-2.5">
            <div>
              <p className="text-xs font-semibold text-[#7A90FF]">
                {featuredMeta
                  ? `Featured Singer #${featuredMeta.rank} · ${featuredMeta.primaryLanguage} Music`
                  : 'Artist & Complete Categorized Discography'}
              </p>
              <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight break-words mt-0.5">
                {displayName}
              </h1>
              {featuredMeta && (
                <p className="text-xs sm:text-sm text-slate-300 mt-1">
                  {featuredMeta.tagline} · Famous for{' '}
                  <span className="text-white font-medium">
                    {featuredMeta.signatureSongs.join(', ')}
                  </span>
                </p>
              )}
            </div>

            {/* Clean Typographic Metadata Line (no static pills) */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs sm:text-sm text-slate-300">
              <span className="font-mono-tabular text-white font-semibold">
                {allCatalogTracks.length} songs loaded
              </span>
              <span aria-hidden="true" className="text-slate-500">·</span>
              <span className="font-mono-tabular text-rose-300">
                {categorizedMap.romantic.length} Romantic
              </span>
              <span aria-hidden="true" className="text-slate-500">·</span>
              <span className="font-mono-tabular text-indigo-300">
                {categorizedMap.sad.length} Sad
              </span>
              <span aria-hidden="true" className="text-slate-500">·</span>
              <span className="font-mono-tabular text-emerald-300">
                {categorizedMap.chill.length} Chill
              </span>
              <span aria-hidden="true" className="text-slate-500">·</span>
              <span className="font-mono-tabular text-orange-300">
                {categorizedMap.energetic.length} Party
              </span>
              {personalArtistStat && (
                <>
                  <span aria-hidden="true" className="text-slate-500">·</span>
                  <span className="font-mono-tabular text-emerald-300 font-semibold">
                    {personalArtistStat.playCount}{' '}
                    {personalArtistStat.playCount === 1 ? 'play' : 'plays'} by you
                  </span>
                </>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {(playableQueue.length > 0 || matchingOfflineTracks.length > 0) && (
                <>
                  <button
                    type="button"
                    onClick={() => handlePlayAll()}
                    className="min-h-[40px] px-4 rounded-xl bg-[#4F6BFF] hover:bg-[#415CE6] text-white text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap transition-colors"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    <span>
                      Play {activeTab !== 'categorized' && activeTab !== 'all' ? 'Category' : 'All'} (
                      {playableQueue.length})
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleShuffle()}
                    className="min-h-[40px] px-4 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] border border-white/10 text-white text-xs font-medium inline-flex items-center gap-2 whitespace-nowrap transition-colors"
                  >
                    <Shuffle className="w-4 h-4" />
                    <span>Shuffle Songs</span>
                  </button>
                </>
              )}

              {isOnline &&
                (allCatalogTracks[0] ||
                  savedInLibraryTracks[0] ||
                  (seedTrack && !seedTrack.isOffline)) && (
                  <button
                    type="button"
                    onClick={handleArtistRadio}
                    className="min-h-[40px] px-4 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] border border-white/10 text-white text-xs font-medium inline-flex items-center gap-2 whitespace-nowrap transition-colors"
                  >
                    <Radio className="w-4 h-4 text-[#7A90FF]" />
                    <span>Non-Stop Artist Radio</span>
                  </button>
                )}

              {isOnline && (
                <button
                  type="button"
                  onClick={() => void handleLoadMoreSongs('all')}
                  disabled={loadingMore}
                  className="min-h-[40px] px-4 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] border border-white/10 text-white text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap transition-colors disabled:opacity-50"
                >
                  {loadingMore ? (
                    <Loader2 className="w-4 h-4 animate-spin text-[#7A90FF]" />
                  ) : (
                    <PlusCircle className="w-4 h-4 text-[#7A90FF]" />
                  )}
                  <span>Load More Songs</span>
                </button>
              )}

              {isOnline && downloadableTracks.length > 0 && (
                <button
                  type="button"
                  disabled={isBatchDownloading || allTopSaved}
                  onClick={handleDownloadTopSongs}
                  className={`min-h-[40px] px-4 rounded-xl text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap transition-colors ${
                    allTopSaved
                      ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                      : 'bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white'
                  }`}
                >
                  {isBatchDownloading && batchDownloadState?.label === displayName ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="font-mono-tabular">
                        Downloading {batchDownloadState.completed}/{batchDownloadState.total}
                      </span>
                    </>
                  ) : allTopSaved ? (
                    <>
                      <Check className="w-4 h-4" />
                      <span>Songs Saved Offline</span>
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4" />
                      <span>Download Songs ({Math.min(40, downloadableTracks.length)})</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Category Navigation Bar + In-Artist Song Search Filter */}
      <section className="space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Interactive Mood Category Tabs */}
          <div
            className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1"
            role="tablist"
            aria-label="Divide artist songs by mood and category"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'categorized'}
              onClick={() => setActiveTab('categorized')}
              className={`h-10 px-3.5 rounded-xl text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors ${
                activeTab === 'categorized'
                  ? 'bg-[#4F6BFF] text-white'
                  : 'bg-[#11131A] text-slate-300 hover:text-white border border-white/[0.08]'
              }`}
            >
              <Grid className="w-3.5 h-3.5" />
              <span>By Mood Categories</span>
            </button>

            {ARTIST_SONG_CATEGORIES.map((cat) => {
              const isSelected = activeTab === cat.id;
              const count =
                cat.id === 'all'
                  ? allCatalogTracks.length
                  : cat.id === 'videos'
                    ? musicVideos.length
                    : categorizedMap[cat.id]?.length || 0;

              return (
                <button
                  key={cat.id}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  onClick={() => setActiveTab(cat.id)}
                  className={`h-10 px-3.5 rounded-xl text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors ${
                    isSelected
                      ? 'bg-[#4F6BFF] text-white'
                      : 'bg-[#11131A] text-slate-300 hover:text-white border border-white/[0.08]'
                  }`}
                >
                  <span>{cat.label}</span>
                  <span
                    className={`font-mono-tabular text-[11px] ${
                      isSelected ? 'text-white/90' : 'text-slate-400'
                    }`}
                  >
                    ({count})
                  </span>
                </button>
              );
            })}
          </div>

          {/* Search Within Singer's Songs */}
          <div className="relative w-full md:w-64 shrink-0">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={songQuery}
              onChange={(e) => setSongQuery(e.target.value)}
              placeholder={`Search in ${displayName}'s songs...`}
              aria-label={`Search in ${displayName}'s songs`}
              className="w-full h-10 pl-9 pr-3 rounded-xl bg-[#11131A] border border-white/10 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-[#4F6BFF]"
            />
          </div>
        </div>
      </section>

      {/* Offline Notice Banner when offline */}
      {!isOnline && (
        <div className="rounded-xl bg-amber-500/10 border border-amber-500/25 px-4 py-3 flex items-center gap-2.5 text-xs text-amber-200">
          <WifiOff className="w-4 h-4 text-amber-300 shrink-0" />
          <span>
            You are offline. Showing songs saved in your My Music library and favourites matching{' '}
            {displayName}.
          </span>
        </div>
      )}

      {/* Offline / My Music Matches */}
      {matchingOfflineAsTracks.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-emerald-400" />
              <span>Saved in My Music ({matchingOfflineAsTracks.length})</span>
            </h2>
          </div>
          <div className="space-y-2">
            {matchingOfflineAsTracks.map((track, idx) => (
              <TrackRow
                key={`offline_${track.id}`}
                track={track}
                index={idx}
                queueContext={matchingOfflineAsTracks}
                onAddToPlaylist={onAddToPlaylist}
              />
            ))}
          </div>
        </section>
      )}

      {/* Main Content Area: Loading / Error / Divided By Mood Categories / Single Category Full List */}
      {loading ? (
        <section className="space-y-4">
          <div className="h-5 w-44 rounded bg-white/10 animate-pulse" />
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="h-16 rounded-xl bg-[#11131A] border border-white/[0.06] animate-pulse"
              />
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <TrackCardSkeleton key={i} />
            ))}
          </div>
        </section>
      ) : error && allCatalogTracks.length === 0 && savedInLibraryTracks.length === 0 ? (
        <div className="rounded-2xl bg-[#11131A] border border-white/[0.07] p-8 text-center space-y-3">
          <Music2 className="w-8 h-8 text-slate-500 mx-auto" />
          <p className="text-sm font-medium text-white">
            Couldn&apos;t load online songs for {displayName}
          </p>
          <p className="text-xs text-slate-400 max-w-md mx-auto">{error}</p>
          {isOnline && (
            <button
              type="button"
              onClick={() => void loadProfile()}
              className="min-h-[40px] px-4 rounded-xl bg-[#4F6BFF] hover:bg-[#415CE6] text-xs font-semibold text-white inline-flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Try Again</span>
            </button>
          )}
        </div>
      ) : activeTab === 'categorized' ? (
        /* DIVIDED BY MOOD CATEGORIES VIEW: Romantic, Sad, Chill, Party, Classics, Trending + Complete All Songs List */
        <div className="space-y-8">
          {MOOD_SECTION_ORDER.map((section) => {
            const sectionTracks = filterByQuery(categorizedMap[section.id] || []);
            if (sectionTracks.length === 0) return null;

            const isSectionExpanded = Boolean(expandedMoodSections[section.id]);
            const visibleTracks = isSectionExpanded
              ? sectionTracks
              : sectionTracks.slice(0, 10);

            return (
              <section
                key={section.id}
                className="rounded-2xl bg-[#11131A]/90 border border-white/[0.08] p-4 sm:p-6 space-y-4"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Sparkles className={`w-4 h-4 ${section.accentClass}`} />
                      <h2 className="text-lg sm:text-xl font-bold text-white">
                        {displayName} · {section.title}{' '}
                        <span className="font-mono-tabular text-sm text-slate-400 font-normal">
                          ({sectionTracks.length})
                        </span>
                      </h2>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">{section.subtitle}</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handlePlayAll(sectionTracks)}
                      className="h-9 px-3.5 rounded-xl bg-[#4F6BFF] hover:bg-[#415CE6] text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>Play {section.id === 'energetic' ? 'Party' : section.id}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleShuffle(sectionTracks)}
                      className="h-9 px-3 rounded-xl bg-white/[0.07] hover:bg-white/[0.13] border border-white/10 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
                    >
                      <Shuffle className="w-3.5 h-3.5" />
                      <span>Shuffle</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveTab(section.id)}
                      className="h-9 px-3 rounded-xl bg-white/[0.05] hover:bg-white/[0.11] border border-white/10 text-slate-200 hover:text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
                    >
                      <Compass className="w-3.5 h-3.5 text-[#7A90FF]" />
                      <span>Open Full Category</span>
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  {visibleTracks.map((track, idx) => (
                    <TrackRow
                      key={`${section.id}_${track.id}`}
                      track={track}
                      index={idx}
                      queueContext={sectionTracks}
                      onAddToPlaylist={onAddToPlaylist}
                    />
                  ))}
                </div>

                {sectionTracks.length > 10 && (
                  <div className="pt-1 flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedMoodSections((prev) => ({
                          ...prev,
                          [section.id]: !prev[section.id],
                        }))
                      }
                      className="h-9 px-4 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-xs font-semibold text-white inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
                    >
                      <span>
                        {isSectionExpanded
                          ? 'Show Fewer'
                          : `Show All ${sectionTracks.length} ${section.title}`}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveTab(section.id)}
                      className="text-xs font-semibold text-[#7A90FF] hover:text-white transition-colors whitespace-nowrap"
                    >
                      Load even more {section.title.toLowerCase()} →
                    </button>
                  </div>
                )}
              </section>
            );
          })}

          {/* Complete A-to-Z All Songs Section at Bottom of Categorized View */}
          {allCatalogTracks.length > 0 && (
            <section className="rounded-2xl bg-[#11131A]/90 border border-white/[0.08] p-4 sm:p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
                    <ListMusic className="w-5 h-5 text-[#7A90FF]" />
                    <span>
                      All Songs by {displayName} ({filterByQuery(allCatalogTracks).length})
                    </span>
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Complete combined catalog · Use &ldquo;Load More Songs&rdquo; to fetch even more tracks
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handlePlayAll(filterByQuery(allCatalogTracks))}
                    className="h-9 px-3.5 rounded-xl bg-[#4F6BFF] hover:bg-[#415CE6] text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Play All ({filterByQuery(allCatalogTracks).length})</span>
                  </button>

                  {isOnline && (
                    <button
                      type="button"
                      onClick={() => void handleLoadMoreSongs('all')}
                      disabled={loadingMore}
                      className="h-9 px-3.5 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] border border-white/10 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors disabled:opacity-50"
                    >
                      {loadingMore ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-[#7A90FF]" />
                      ) : (
                        <PlusCircle className="w-3.5 h-3.5 text-[#7A90FF]" />
                      )}
                      <span>Load More Songs</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                {filterByQuery(allCatalogTracks).map((track, idx) => (
                  <TrackRow
                    key={`all_${track.id}`}
                    track={track}
                    index={idx}
                    queueContext={filterByQuery(allCatalogTracks)}
                    onAddToPlaylist={onAddToPlaylist}
                  />
                ))}
              </div>

              {isOnline && (
                <div className="pt-2 flex justify-center">
                  <button
                    type="button"
                    onClick={() => void handleLoadMoreSongs('all')}
                    disabled={loadingMore}
                    className="min-h-[42px] px-6 rounded-xl bg-[#4F6BFF] hover:bg-[#415CE6] text-white text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap transition-colors disabled:opacity-50"
                  >
                    {loadingMore ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Fetching more songs by {displayName}...</span>
                      </>
                    ) : (
                      <>
                        <PlusCircle className="w-4 h-4" />
                        <span>Load More {displayName} Songs</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </section>
          )}
        </div>
      ) : activeTab === 'videos' ? (
        /* Music Videos Grid Tab */
        <section className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Tv className="w-4 h-4 text-[#7A90FF]" />
              <span>Music Videos ({activeCategoryTracks.length})</span>
            </h2>
          </div>
          {activeCategoryTracks.length === 0 ? (
            <div className="rounded-2xl bg-[#11131A] border border-white/[0.07] p-8 text-center text-xs text-slate-400">
              No music videos found matching your filter.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {activeCategoryTracks.map((video) => (
                <TrackCard
                  key={video.id}
                  track={video}
                  queueContext={activeCategoryTracks}
                  onAddToPlaylist={onAddToPlaylist}
                />
              ))}
            </div>
          )}
        </section>
      ) : (
        /* Single Selected Category Tab (All Songs, Trending, Romantic, Sad, Chill, Party, Classics) */
        <section className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
                {activeTab === 'romantic' ? (
                  <Heart className="w-4 h-4 text-rose-400" />
                ) : activeTab === 'trending' || activeTab === 'energetic' ? (
                  <Flame className="w-4 h-4 text-amber-400" />
                ) : (
                  <Disc3 className="w-4 h-4 text-[#7A90FF]" />
                )}
                <span>
                  {displayName} ·{' '}
                  {ARTIST_SONG_CATEGORIES.find((c) => c.id === activeTab)?.label || 'Songs'} (
                  {activeCategoryTracks.length})
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {ARTIST_SONG_CATEGORIES.find((c) => c.id === activeTab)?.description}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {activeCategoryTracks.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => handlePlayAll(activeCategoryTracks)}
                    className="h-9 px-3.5 rounded-xl bg-[#4F6BFF] hover:bg-[#415CE6] text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Play All ({activeCategoryTracks.length})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleShuffle(activeCategoryTracks)}
                    className="h-9 px-3.5 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] border border-white/10 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
                  >
                    <Shuffle className="w-3.5 h-3.5" />
                    <span>Shuffle</span>
                  </button>
                </>
              )}

              {isOnline && (
                <button
                  type="button"
                  onClick={() => void handleLoadMoreSongs(activeTab)}
                  disabled={loadingMore || loadingCategoryTab}
                  className="h-9 px-3.5 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] border border-white/10 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors disabled:opacity-50"
                >
                  {loadingMore || loadingCategoryTab ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-[#7A90FF]" />
                  ) : (
                    <PlusCircle className="w-3.5 h-3.5 text-[#7A90FF]" />
                  )}
                  <span>Load More in Category</span>
                </button>
              )}
            </div>
          </div>

          {loadingCategoryTab && activeCategoryTracks.length === 0 ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="h-16 rounded-xl bg-[#11131A] border border-white/[0.06] animate-pulse"
                />
              ))}
            </div>
          ) : activeCategoryTracks.length > 0 ? (
            <div className="space-y-2">
              {activeCategoryTracks.map((track, idx) => (
                <TrackRow
                  key={`${activeTab}_${track.id}`}
                  track={track}
                  index={idx}
                  queueContext={activeCategoryTracks}
                  onAddToPlaylist={onAddToPlaylist}
                />
              ))}
            </div>
          ) : savedInLibraryTracks.length > 0 ? (
            <div className="space-y-2">
              {savedInLibraryTracks.map((track, idx) => (
                <TrackRow
                  key={track.id}
                  track={track}
                  index={idx}
                  queueContext={savedInLibraryTracks}
                  onAddToPlaylist={onAddToPlaylist}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl bg-[#11131A] border border-white/[0.07] p-8 text-center space-y-3">
              <p className="text-sm font-medium text-white">
                No songs matched this filter yet
              </p>
              {isOnline && (
                <button
                  type="button"
                  onClick={() => void handleLoadMoreSongs(activeTab)}
                  disabled={loadingMore}
                  className="min-h-[40px] px-4 rounded-xl bg-[#4F6BFF] hover:bg-[#415CE6] text-xs font-semibold text-white inline-flex items-center gap-1.5"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  <span>Fetch More Songs from Online Catalog</span>
                </button>
              )}
            </div>
          )}

          {isOnline && activeCategoryTracks.length > 0 && (
            <div className="pt-2 flex justify-center">
              <button
                type="button"
                onClick={() => void handleLoadMoreSongs(activeTab)}
                disabled={loadingMore}
                className="min-h-[42px] px-6 rounded-xl bg-[#4F6BFF] hover:bg-[#415CE6] text-white text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap transition-colors disabled:opacity-50"
              >
                {loadingMore ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Loading more songs...</span>
                  </>
                ) : (
                  <>
                    <PlusCircle className="w-4 h-4" />
                    <span>Load More Songs ({activeCategoryTracks.length} loaded so far)</span>
                  </>
                )}
              </button>
            </div>
          )}
        </section>
      )}

      {/* Music Videos Grid (also shown at bottom of Categorized View) */}
      {activeTab === 'categorized' && musicVideos.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Tv className="w-4 h-4 text-[#7A90FF]" />
              <span>Official Music Videos ({musicVideos.length})</span>
            </h2>
            <button
              type="button"
              onClick={() => setActiveTab('videos')}
              className="text-xs font-semibold text-[#7A90FF] hover:text-white transition-colors"
            >
              View All Videos
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {musicVideos.slice(0, 8).map((video) => (
              <TrackCard
                key={video.id}
                track={video}
                queueContext={musicVideos}
                onAddToPlaylist={onAddToPlaylist}
              />
            ))}
          </div>
        </section>
      )}

      {/* Related Artists Navigation */}
      {relatedArtists.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <User className="w-4 h-4 text-[#7A90FF]" />
            <span>Related Singers &amp; Collaborators</span>
          </h2>
          <div className="flex flex-wrap gap-2">
            {relatedArtists.map((rel) => (
              <button
                key={rel}
                type="button"
                onClick={() => openArtistPage(rel)}
                className="min-h-[40px] px-4 rounded-xl bg-[#11131A] hover:bg-[#181B26] border border-white/10 hover:border-[#4F6BFF]/45 text-xs sm:text-sm font-medium text-slate-200 hover:text-white inline-flex items-center gap-2 transition-colors"
              >
                <User className="w-3.5 h-3.5 text-[#7A90FF]" />
                <span>{rel}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
