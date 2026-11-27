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
  shortName: string;
  subtitle: string;
  accentClass: string;
}> = [
  {
    id: 'trending',
    title: 'Trending & Signature Hits',
    shortName: 'Trending',
    subtitle: 'Most streamed chartbusters and iconic tracks',
    accentClass: 'text-amber-300',
  },
  {
    id: 'romantic',
    title: 'Romantic & Love Songs',
    shortName: 'Romantic',
    subtitle: 'Heartfelt melodies, love ballads, and soulful duets',
    accentClass: 'text-rose-300',
  },
  {
    id: 'sad',
    title: 'Sad & Heartbreak',
    shortName: 'Sad',
    subtitle: 'Emotional, intense, and late-night heartbreak anthems',
    accentClass: 'text-indigo-300',
  },
  {
    id: 'chill',
    title: 'Chill, Acoustic & Unplugged',
    shortName: 'Chill',
    subtitle: 'Relaxed vibes, acoustic sessions, and smooth listening',
    accentClass: 'text-emerald-300',
  },
  {
    id: 'energetic',
    title: 'Party, Beats & High Energy',
    shortName: 'Party',
    subtitle: 'Upbeat dance tracks, Punjabi bangers, and workout anthems',
    accentClass: 'text-orange-300',
  },
  {
    id: 'classics',
    title: 'Evergreen Classics & Golden Hits',
    shortName: 'Classics',
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
    .replace(/\b(from|feat|ft|official|video|audio|full|song|lyrical|hd|remix|unplugged|lofi)\b/g, ' ')
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
    if (tKey.length >= 3 && seenTitles.has(tKey)) continue;
    seenIds.add(track.id);
    if (tKey.length >= 3) seenTitles.add(tKey);
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
  const [loadingByCategory, setLoadingByCategory] = useState<
    Partial<Record<ArtistSongCategory, boolean>>
  >({});
  const [hasMoreByCategory, setHasMoreByCategory] = useState<
    Partial<Record<ArtistSongCategory, boolean>>
  >({});

  const [loading, setLoading] = useState<boolean>(true);
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
      setCategoryPages({});
      setLoadingByCategory({});
      setHasMoreByCategory({
        all: true,
        trending: true,
        romantic: true,
        sad: true,
        chill: true,
        energetic: true,
        classics: true,
        videos: true,
      });
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

  const allCatalogTracks = useMemo<Track[]>(() => {
    const base = profile?.topTracks || [];
    return mergeUniqueArtistTracks(base, extraTracks);
  }, [profile?.topTracks, extraTracks]);

  const musicVideos = useMemo<Track[]>(() => {
    const base = profile?.musicVideos || [];
    const more = categorySpecificTracks.videos || [];
    return mergeUniqueArtistTracks(base, more);
  }, [profile?.musicVideos, categorySpecificTracks.videos]);

  const relatedArtists = profile?.relatedArtists || [];

  // Classify initial starter tracks into mood categories and merge per-category loaded tracks
  const categorizedMap = useMemo(() => {
    const buckets: Record<Exclude<ArtistSongCategory, 'all' | 'videos'>, Track[]> = {
      trending: [],
      romantic: [],
      sad: [],
      chill: [],
      energetic: [],
      classics: [],
    };

    const starterTracks = profile?.topTracks || [];
    starterTracks.forEach((track, idx) => {
      const cats = classifyArtistTrackCategories(track.title, track.artist, idx);
      cats.forEach((c) => {
        if (c !== 'all' && c !== 'videos' && buckets[c]) {
          buckets[c].push(track);
        }
      });
    });

    (Object.keys(buckets) as Array<Exclude<ArtistSongCategory, 'all' | 'videos'>>).forEach(
      (catKey) => {
        const direct = categorySpecificTracks[catKey] || [];
        if (direct.length > 0) {
          buckets[catKey] = mergeUniqueArtistTracks(buckets[catKey], direct);
        }
      }
    );

    return buckets;
  }, [profile?.topTracks, categorySpecificTracks]);

  // Independent per-category Load More handler that sends all already-loaded IDs & titles so every click loads 100% NEW songs
  const handleLoadMoreForCategory = useCallback(
    async (targetCategory: ArtistSongCategory) => {
      if (!isOnline || loadingByCategory[targetCategory]) return;

      const currentPage = categoryPages[targetCategory] || 0;
      const nextPage = currentPage + 1;

      // Collect every track already loaded on this artist page so the server never returns duplicates!
      const alreadyLoadedTracks =
        targetCategory === 'videos'
          ? musicVideos
          : mergeUniqueArtistTracks(
              allCatalogTracks,
              targetCategory !== 'all' ? categorizedMap[targetCategory] || [] : []
            );

      const excludeIds = alreadyLoadedTracks.map((t) => t.id);
      const excludeTitles = alreadyLoadedTracks.map((t) => t.title);

      setLoadingByCategory((prev) => ({ ...prev, [targetCategory]: true }));
      try {
        const res = await fetchArtistCategorySongs({
          artist: resolvedArtistName,
          category: targetCategory,
          page: nextPage,
          excludeIds,
          excludeTitles,
        });

        const freshTracks = (res.tracks || []).filter((t) => {
          const tKey = normalizeSongKey(t.title);
          return !alreadyLoadedTracks.some(
            (existing) => existing.id === t.id || (tKey && normalizeSongKey(existing.title) === tKey)
          );
        });

        setCategoryPages((prev) => ({
          ...prev,
          [targetCategory]: nextPage,
        }));
        setHasMoreByCategory((prev) => ({
          ...prev,
          [targetCategory]: res.hasMore && freshTracks.length > 0,
        }));

        if (freshTracks.length > 0) {
          if (targetCategory !== 'videos') {
            setExtraTracks((prev) => mergeUniqueArtistTracks(prev, freshTracks));
          }
          if (targetCategory !== 'all') {
            setCategorySpecificTracks((prev) => ({
              ...prev,
              [targetCategory]: mergeUniqueArtistTracks(prev[targetCategory] || [], freshTracks),
            }));
            // Automatically expand this category section so all newly loaded songs are visible immediately
            setExpandedMoodSections((prev) => ({
              ...prev,
              [targetCategory]: true,
            }));
          }
        }
      } catch {
        // Keep existing tracks
      } finally {
        setLoadingByCategory((prev) => ({ ...prev, [targetCategory]: false }));
      }
    },
    [
      allCatalogTracks,
      categorizedMap,
      categoryPages,
      isOnline,
      loadingByCategory,
      musicVideos,
      resolvedArtistName,
    ]
  );

  // When a user switches to a specific mood category tab for the first time and it has < 8 starter songs, load page 1 for that category
  useEffect(() => {
    if (
      !isOnline ||
      loading ||
      activeTab === 'categorized' ||
      activeTab === 'all' ||
      activeTab === 'videos'
    ) {
      return;
    }
    const alreadyFetchedPage = categoryPages[activeTab] || 0;
    const currentBucketLen = categorizedMap[activeTab]?.length || 0;
    if (alreadyFetchedPage === 0 && currentBucketLen < 8 && !loadingByCategory[activeTab]) {
      void handleLoadMoreForCategory(activeTab);
    }
  }, [
    activeTab,
    categorizedMap,
    categoryPages,
    handleLoadMoreForCategory,
    isOnline,
    loading,
    loadingByCategory,
  ]);

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

  // Always prioritize the singer's official portrait/poster over any YouTube channel avatar
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
              <span>Reset Starter Catalog</span>
            </button>
          )}
        </div>

        {/* Instant Horizontal Quick-Switch Bar for All 28 Popular Singers */}
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
              subtitle="Click any singer below to explore their songs divided into Sad, Romantic, Chill, Party, and Classics with per-category Load More"
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
                  : 'Artist & Categorized Discography'}
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
              <span aria-hidden="true" className="text-slate-500">·</span>
              <span className="font-mono-tabular text-sky-300">
                {categorizedMap.classics.length} Classics
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
                      Play {activeTab !== 'categorized' && activeTab !== 'all' ? 'Category' : 'Loaded'} (
                      {playableQueue.length})
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleShuffle()}
                    className="min-h-[40px] px-4 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] border border-white/10 text-white text-xs font-medium inline-flex items-center gap-2 whitespace-nowrap transition-colors"
                  >
                    <Shuffle className="w-4 h-4" />
                    <span>Shuffle Loaded</span>
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
                      <span>Download Loaded ({Math.min(40, downloadableTracks.length)})</span>
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

          {/* Search Within Singer's Loaded Songs */}
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

      {/* Main Content Area: Loading / Error / Divided By Mood Categories / Single Category Tab */}
      {loading ? (
        <section className="space-y-4">
          <div className="h-5 w-44 rounded bg-white/10 animate-pulse" />
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
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
        /* DIVIDED BY MOOD CATEGORIES VIEW: Each category loads a starter batch and has its OWN "Load More <Category> Songs" button! */
        <div className="space-y-7">
          {MOOD_SECTION_ORDER.map((section) => {
            const sectionTracks = filterByQuery(categorizedMap[section.id] || []);
            const isCatLoading = Boolean(loadingByCategory[section.id]);
            const isSectionExpanded = Boolean(expandedMoodSections[section.id]);
            const visibleTracks = isSectionExpanded
              ? sectionTracks
              : sectionTracks.slice(0, 6);

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
                          ({sectionTracks.length} loaded)
                        </span>
                      </h2>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">{section.subtitle}</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {sectionTracks.length > 0 && (
                      <>
                        <button
                          type="button"
                          onClick={() => handlePlayAll(sectionTracks)}
                          className="h-9 px-3.5 rounded-xl bg-[#4F6BFF] hover:bg-[#415CE6] text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
                        >
                          <Play className="w-3.5 h-3.5 fill-current" />
                          <span>Play {section.shortName}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleShuffle(sectionTracks)}
                          className="h-9 px-3 rounded-xl bg-white/[0.07] hover:bg-white/[0.13] border border-white/10 text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
                        >
                          <Shuffle className="w-3.5 h-3.5" />
                          <span>Shuffle</span>
                        </button>
                      </>
                    )}

                    <button
                      type="button"
                      onClick={() => setActiveTab(section.id)}
                      className="h-9 px-3 rounded-xl bg-white/[0.05] hover:bg-white/[0.11] border border-white/10 text-slate-200 hover:text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
                    >
                      <Compass className="w-3.5 h-3.5 text-[#7A90FF]" />
                      <span>Open Tab</span>
                    </button>
                  </div>
                </div>

                {visibleTracks.length > 0 ? (
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
                ) : (
                  <div className="rounded-xl bg-[#0D0F16] border border-white/[0.05] px-4 py-5 text-center text-xs text-slate-400">
                    Click &ldquo;Load More {section.shortName} Songs&rdquo; below to fetch {displayName}&apos;s{' '}
                    {section.shortName.toLowerCase()} tracks.
                  </div>
                )}

                {/* Per-Category Expand + Independent "Load More New <Category> Songs" Controls */}
                <div className="pt-1 flex flex-wrap items-center justify-between gap-2.5 border-t border-white/[0.06]">
                  <div className="flex items-center gap-2">
                    {sectionTracks.length > 6 && (
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedMoodSections((prev) => ({
                            ...prev,
                            [section.id]: !prev[section.id],
                          }))
                        }
                        className="h-9 px-3.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-xs font-semibold text-slate-200 hover:text-white inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
                      >
                        <span>
                          {isSectionExpanded
                            ? 'Collapse List'
                            : `Show All ${sectionTracks.length} Loaded`}
                        </span>
                      </button>
                    )}
                  </div>

                  {isOnline && hasMoreByCategory[section.id] !== false && (
                    <button
                      type="button"
                      onClick={() => void handleLoadMoreForCategory(section.id)}
                      disabled={isCatLoading}
                      className="min-h-[38px] px-4 rounded-xl bg-[#4F6BFF]/15 hover:bg-[#4F6BFF]/25 border border-[#4F6BFF]/40 text-xs font-semibold text-white inline-flex items-center gap-2 whitespace-nowrap transition-colors disabled:opacity-50"
                    >
                      {isCatLoading ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-[#7A90FF]" />
                          <span>Loading New {section.shortName} Songs...</span>
                        </>
                      ) : (
                        <>
                          <PlusCircle className="w-3.5 h-3.5 text-[#7A90FF]" />
                          <span>Load More {section.shortName} Songs (+New)</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              </section>
            );
          })}

          {/* All Songs Combined Section with Independent Load More */}
          {allCatalogTracks.length > 0 && (
            <section className="rounded-2xl bg-[#11131A]/90 border border-white/[0.08] p-4 sm:p-6 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
                    <ListMusic className="w-5 h-5 text-[#7A90FF]" />
                    <span>
                      All Loaded Songs by {displayName} ({filterByQuery(allCatalogTracks).length})
                    </span>
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Every &ldquo;Load More&rdquo; click fetches a fresh batch of unrepeated songs from {displayName}&apos;s 500+ song catalog
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
                      onClick={() => void handleLoadMoreForCategory('all')}
                      disabled={Boolean(loadingByCategory.all)}
                      className="h-9 px-3.5 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] border border-white/10 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors disabled:opacity-50"
                    >
                      {loadingByCategory.all ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-[#7A90FF]" />
                      ) : (
                        <PlusCircle className="w-3.5 h-3.5 text-[#7A90FF]" />
                      )}
                      <span>Load More Songs (+New)</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                {(expandedMoodSections.all
                  ? filterByQuery(allCatalogTracks)
                  : filterByQuery(allCatalogTracks).slice(0, 12)
                ).map((track, idx) => (
                  <TrackRow
                    key={`all_${track.id}`}
                    track={track}
                    index={idx}
                    queueContext={filterByQuery(allCatalogTracks)}
                    onAddToPlaylist={onAddToPlaylist}
                  />
                ))}
              </div>

              <div className="pt-2 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06]">
                {filterByQuery(allCatalogTracks).length > 12 && (
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedMoodSections((prev) => ({ ...prev, all: !prev.all }))
                    }
                    className="h-10 px-4 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-xs font-semibold text-white inline-flex items-center gap-2 whitespace-nowrap transition-colors"
                  >
                    <span>
                      {expandedMoodSections.all
                        ? 'Collapse List'
                        : `View All ${filterByQuery(allCatalogTracks).length} Loaded Songs`}
                    </span>
                  </button>
                )}

                {isOnline && (
                  <button
                    type="button"
                    onClick={() => void handleLoadMoreForCategory('all')}
                    disabled={Boolean(loadingByCategory.all)}
                    className="min-h-[42px] px-5 rounded-xl bg-[#4F6BFF] hover:bg-[#415CE6] text-white text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap transition-colors disabled:opacity-50"
                  >
                    {loadingByCategory.all ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Loading new songs by {displayName}...</span>
                      </>
                    ) : (
                      <>
                        <PlusCircle className="w-4 h-4" />
                        <span>Load More {displayName} Songs (+New Batch)</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            </section>
          )}
        </div>
      ) : activeTab === 'videos' ? (
        /* Music Videos Grid Tab with Load More */
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Tv className="w-4 h-4 text-[#7A90FF]" />
              <span>Music Videos ({activeCategoryTracks.length})</span>
            </h2>
            {isOnline && hasMoreByCategory.videos !== false && (
              <button
                type="button"
                onClick={() => void handleLoadMoreForCategory('videos')}
                disabled={Boolean(loadingByCategory.videos)}
                className="h-9 px-3.5 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] border border-white/10 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors disabled:opacity-50"
              >
                {loadingByCategory.videos ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#7A90FF]" />
                ) : (
                  <PlusCircle className="w-3.5 h-3.5 text-[#7A90FF]" />
                )}
                <span>Load More Videos</span>
              </button>
            )}
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
        /* Single Selected Category Tab (All Songs, Trending, Romantic, Sad, Chill, Party, Classics) with Dedicated Load More */
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
                  {activeCategoryTracks.length} loaded)
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {ARTIST_SONG_CATEGORIES.find((c) => c.id === activeTab)?.description} · Click &ldquo;Load More&rdquo; for fresh unrepeated songs
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
                  onClick={() => void handleLoadMoreForCategory(activeTab)}
                  disabled={Boolean(loadingByCategory[activeTab])}
                  className="h-9 px-3.5 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] border border-white/10 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors disabled:opacity-50"
                >
                  {loadingByCategory[activeTab] ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-[#7A90FF]" />
                  ) : (
                    <PlusCircle className="w-3.5 h-3.5 text-[#7A90FF]" />
                  )}
                  <span>Load More (+New Songs)</span>
                </button>
              )}
            </div>
          </div>

          {loadingByCategory[activeTab] && activeCategoryTracks.length === 0 ? (
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
                Click below to load {displayName}&apos;s songs in this category
              </p>
              {isOnline && (
                <button
                  type="button"
                  onClick={() => void handleLoadMoreForCategory(activeTab)}
                  disabled={Boolean(loadingByCategory[activeTab])}
                  className="min-h-[40px] px-4 rounded-xl bg-[#4F6BFF] hover:bg-[#415CE6] text-xs font-semibold text-white inline-flex items-center gap-1.5"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  <span>Load Songs for Category</span>
                </button>
              )}
            </div>
          )}

          {isOnline && activeCategoryTracks.length > 0 && (
            <div className="pt-2 flex justify-center">
              <button
                type="button"
                onClick={() => void handleLoadMoreForCategory(activeTab)}
                disabled={Boolean(loadingByCategory[activeTab])}
                className="min-h-[42px] px-6 rounded-xl bg-[#4F6BFF] hover:bg-[#415CE6] text-white text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap transition-colors disabled:opacity-50"
              >
                {loadingByCategory[activeTab] ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Loading new unrepeated songs...</span>
                  </>
                ) : (
                  <>
                    <PlusCircle className="w-4 h-4" />
                    <span>
                      Load More{' '}
                      {ARTIST_SONG_CATEGORIES.find((c) => c.id === activeTab)?.shortLabel || ''}{' '}
                      Songs ({activeCategoryTracks.length} loaded so far)
                    </span>
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
