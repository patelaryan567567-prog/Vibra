import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Disc3,
  Download,
  HardDrive,
  Loader2,
  Music2,
  Play,
  Radio,
  RefreshCw,
  Shuffle,
  Tv,
  User,
  WifiOff,
} from 'lucide-react';
import { TrackCard, TrackCardSkeleton, TrackRow } from '../components/TrackCard';
import { useArtistNavigation } from '../context/ArtistNavigationContext';
import { offlineTrackToLibraryTrack, useLibrary } from '../context/LibraryContext';
import { useOfflineMusic } from '../context/OfflineMusicContext';
import { useOfflinePlayer } from '../context/OfflinePlayerContext';
import { usePlayer } from '../context/PlayerContext';
import { fetchArtistProfile, prewarmTrackBatch } from '../services/api';
import type { ArtistProfileResponse, OfflineTrack, Track } from '../types/music';
import { useAmbientColor } from '../utils/ambientColor';

interface ArtistPageProps {
  artistName: string;
  seedTrack?: Track;
  onAddToPlaylist: (track: Track) => void;
  onBack: () => void;
}

function normalizeArtistKey(name: string): string {
  return name.trim().toLowerCase();
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
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [imgError, setImgError] = useState(false);

  const loadProfile = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      setImgError(false);
      try {
        const res = await fetchArtistProfile({
          artist: artistName,
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
    [artistName, seedTrack?.id]
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadProfile(controller.signal);
    return () => controller.abort();
  }, [loadProfile]);

  const normName = normalizeArtistKey(artistName);

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

  const topTracks = profile?.topTracks || [];
  const musicVideos = profile?.musicVideos || [];
  const relatedArtists = profile?.relatedArtists || [];

  const heroImage =
    profile?.avatarUrl ||
    topTracks[0]?.thumbnailHigh ||
    topTracks[0]?.thumbnail ||
    seedTrack?.thumbnailHigh ||
    seedTrack?.thumbnail ||
    matchingOfflineTracks[0]?.artworkDataUrl;

  const ambient = useAmbientColor(heroImage, artistName);

  const downloadableTracks = useMemo(() => {
    const base = topTracks.length > 0 ? topTracks : savedInLibraryTracks;
    return base.filter((t) => !t.isOffline);
  }, [topTracks, savedInLibraryTracks]);

  const allTopSaved =
    downloadableTracks.length > 0 &&
    downloadableTracks.every((t) =>
      offlineTracks.some((o) => o.id === t.id || o.sourceVideoId === t.id)
    );

  const playableQueue = topTracks.length > 0 ? topTracks : savedInLibraryTracks;

  const handlePlayAll = () => {
    if (!isOnline && matchingOfflineTracks.length > 0) {
      playOfflineTrack(matchingOfflineTracks[0], matchingOfflineTracks);
      return;
    }
    if (playableQueue.length > 0) {
      playTrack(playableQueue[0], playableQueue);
    } else if (matchingOfflineTracks.length > 0) {
      playOfflineTrack(matchingOfflineTracks[0], matchingOfflineTracks);
    }
  };

  const handleShuffle = () => {
    if (!isOnline && matchingOfflineTracks.length > 0) {
      const shuffled = [...matchingOfflineTracks].sort(() => Math.random() - 0.5);
      playOfflineTrack(shuffled[0], shuffled);
      return;
    }
    if (playableQueue.length > 0) {
      const shuffled = [...playableQueue].sort(() => Math.random() - 0.5);
      playTrack(shuffled[0], shuffled);
    } else if (matchingOfflineTracks.length > 0) {
      const shuffled = [...matchingOfflineTracks].sort(() => Math.random() - 0.5);
      playOfflineTrack(shuffled[0], shuffled);
    }
  };

  const handleArtistRadio = () => {
    const radioSeed = topTracks[0] || savedInLibraryTracks[0] || seedTrack;
    if (radioSeed && !radioSeed.isOffline) {
      startTrackRadio(radioSeed);
    }
  };

  const handleDownloadTopSongs = () => {
    if (downloadableTracks.length === 0) return;
    void batchDownloadTracks(downloadableTracks, profile?.artistName || artistName, false);
  };

  const displayName = profile?.artistName || artistName;

  return (
    <div className="space-y-8 pb-10">
      {/* Top Back Action */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="min-h-[40px] px-3.5 rounded-xl bg-[#11131A] hover:bg-[#181B26] border border-white/10 text-xs font-semibold text-slate-200 hover:text-white inline-flex items-center gap-2 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back</span>
        </button>

        {!loading && error && (
          <button
            type="button"
            onClick={() => void loadProfile()}
            className="min-h-[40px] px-3.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-xs font-medium text-slate-200 inline-flex items-center gap-1.5 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Retry</span>
          </button>
        )}
      </div>

      {/* Hero Artist Banner with Dynamic Ambient Glow */}
      <section
        className="relative overflow-hidden rounded-2xl bg-[#11131A] border border-white/[0.09] p-5 sm:p-7"
        style={{
          backgroundImage: `radial-gradient(circle at 18% 25%, ${ambient.glowStrong} 0%, ${ambient.glowSoft} 38%, rgba(17,19,26,0.98) 82%)`,
        }}
      >
        <div className="flex flex-col sm:flex-row sm:items-center gap-5 sm:gap-6">
          {/* Artist Avatar */}
          <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl overflow-hidden bg-[#181B26] border border-white/15 shadow-2xl shrink-0 flex items-center justify-center">
            {heroImage && !imgError ? (
              <img
                src={heroImage}
                alt={displayName}
                referrerPolicy="no-referrer"
                onError={() => setImgError(true)}
                className="w-full h-full object-cover"
              />
            ) : (
              <div
                className="w-full h-full flex items-center justify-center text-white text-3xl font-bold"
                style={{ background: ambient.accentGradient }}
              >
                {displayName.charAt(0).toUpperCase() || <User className="w-9 h-9" />}
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1 space-y-2.5">
            <div>
              <p className="text-xs font-semibold text-slate-300">Artist &amp; Channel</p>
              <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight break-words mt-0.5">
                {displayName}
              </h1>
            </div>

            {/* Clean Typographic Metadata Line (no pills) */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs sm:text-sm text-slate-300">
              {profile?.channelTitle && profile.channelTitle !== displayName && (
                <>
                  <span className="text-white/90 font-medium">{profile.channelTitle}</span>
                  <span aria-hidden="true" className="text-slate-500">·</span>
                </>
              )}
              {profile?.subscriberCount && (
                <>
                  <span className="font-mono-tabular text-slate-200">{profile.subscriberCount}</span>
                  <span aria-hidden="true" className="text-slate-500">·</span>
                </>
              )}
              {personalArtistStat ? (
                <span className="font-mono-tabular text-emerald-300 font-semibold">
                  {personalArtistStat.playCount}{' '}
                  {personalArtistStat.playCount === 1 ? 'play' : 'plays'} in your history
                </span>
              ) : (
                <span className="text-slate-400">
                  {topTracks.length > 0
                    ? `${topTracks.length} top tracks`
                    : matchingOfflineTracks.length > 0
                      ? `${matchingOfflineTracks.length} offline tracks`
                      : 'Catalog overview'}
                </span>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {(playableQueue.length > 0 || matchingOfflineTracks.length > 0) && (
                <>
                  <button
                    type="button"
                    onClick={handlePlayAll}
                    className="min-h-[40px] px-4 rounded-xl bg-[#4F6BFF] hover:bg-[#415CE6] text-white text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap transition-colors"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    <span>Play All</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleShuffle}
                    className="min-h-[40px] px-4 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] border border-white/10 text-white text-xs font-medium inline-flex items-center gap-2 whitespace-nowrap transition-colors"
                  >
                    <Shuffle className="w-4 h-4" />
                    <span>Shuffle</span>
                  </button>
                </>
              )}

              {isOnline && (topTracks[0] || savedInLibraryTracks[0] || (seedTrack && !seedTrack.isOffline)) && (
                <button
                  type="button"
                  onClick={handleArtistRadio}
                  className="min-h-[40px] px-4 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] border border-white/10 text-white text-xs font-medium inline-flex items-center gap-2 whitespace-nowrap transition-colors"
                >
                  <Radio className="w-4 h-4 text-[#7A90FF]" />
                  <span>Artist Radio</span>
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
                      <span>Top Songs Saved</span>
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4" />
                      <span>Download Top Songs ({downloadableTracks.length})</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Offline Notice Banner when offline */}
      {!isOnline && (
        <div className="rounded-xl bg-amber-500/10 border border-amber-500/25 px-4 py-3 flex items-center gap-2.5 text-xs text-amber-200">
          <WifiOff className="w-4 h-4 text-amber-300 shrink-0" />
          <span>
            You are offline. Showing songs saved in your My Music library and favourites matching {displayName}.
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

      {/* Top Songs from Online Catalog */}
      {loading ? (
        <section className="space-y-4">
          <div className="h-5 w-44 rounded bg-white/10 animate-pulse" />
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-16 rounded-xl bg-[#11131A] border border-white/[0.06] animate-pulse" />
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <TrackCardSkeleton key={i} />
            ))}
          </div>
        </section>
      ) : error && topTracks.length === 0 && savedInLibraryTracks.length === 0 ? (
        <div className="rounded-2xl bg-[#11131A] border border-white/[0.07] p-8 text-center space-y-3">
          <Music2 className="w-8 h-8 text-slate-500 mx-auto" />
          <p className="text-sm font-medium text-white">Couldn&apos;t load online songs for {displayName}</p>
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
      ) : topTracks.length > 0 ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Disc3 className="w-4 h-4 text-[#7A90FF]" />
              <span>Top Songs ({topTracks.length})</span>
            </h2>
          </div>
          <div className="space-y-2">
            {topTracks.map((track, idx) => (
              <TrackRow
                key={track.id}
                track={track}
                index={idx}
                queueContext={topTracks}
                onAddToPlaylist={onAddToPlaylist}
              />
            ))}
          </div>
        </section>
      ) : savedInLibraryTracks.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Disc3 className="w-4 h-4 text-[#7A90FF]" />
            <span>In Your Library ({savedInLibraryTracks.length})</span>
          </h2>
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
        </section>
      ) : null}

      {/* Music Videos Grid */}
      {musicVideos.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Tv className="w-4 h-4 text-[#7A90FF]" />
            <span>Music Videos ({musicVideos.length})</span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {musicVideos.map((video) => (
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
            <span>Related Artists</span>
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
