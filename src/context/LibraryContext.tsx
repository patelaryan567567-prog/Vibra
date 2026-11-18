import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type {
  LibraryBackupPayload,
  ListeningStats,
  OfflinePlaylist,
  OfflineTrack,
  Playlist,
  RecentlyPlayedItem,
  SearchHistoryItem,
  Track,
  TrackResumeInfo,
} from '../types/music';

const STORAGE_KEYS = {
  favourites: 'vibra_favourites_v1',
  recentlyPlayed: 'vibra_recent_v1',
  searchHistory: 'vibra_search_history_v1',
  playlists: 'vibra_playlists_v1',
  stats: 'vibra_stats_v1',
  trackPositions: 'vibra_track_positions_v1',
};

const EMPTY_STATS: ListeningStats = {
  totalPlays: 0,
  totalSecondsListened: 0,
  trackStats: {},
  artistStats: {},
  dailyPlays: {},
};

function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeStorage<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore storage quota errors
  }
}

function getLocalDayKey(ts = Date.now()): string {
  const d = new Date(ts);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function offlineTrackToLibraryTrack(offlineTrack: OfflineTrack): Track {
  const art = offlineTrack.artworkDataUrl || '/pwa-512x512.png';
  return {
    id: offlineTrack.id,
    title: offlineTrack.title,
    artist: offlineTrack.artist,
    channelTitle: offlineTrack.album || 'My Music · Offline',
    thumbnail: art,
    thumbnailHigh: art,
    duration: offlineTrack.duration || '--:--',
    durationSeconds: offlineTrack.durationSeconds || 0,
    viewCount: 'Offline',
    isOffline: true,
    offlineTrackId: offlineTrack.id,
  };
}

export interface ToastMessage {
  id: number;
  text: string;
}

interface LibraryContextValue {
  favourites: Track[];
  recentlyPlayed: RecentlyPlayedItem[];
  searchHistory: SearchHistoryItem[];
  playlists: Playlist[];
  listeningStats: ListeningStats;
  trackPositions: Record<string, TrackResumeInfo>;
  toast: ToastMessage | null;
  showToast: (text: string) => void;
  isFavourite: (trackId: string) => boolean;
  toggleFavourite: (track: Track) => void;
  recordPlayed: (track: Track) => void;
  recordOfflinePlayed: (offlineTrack: OfflineTrack) => void;
  recordListeningSeconds: (seconds: number) => void;
  saveTrackPosition: (trackId: string, positionSeconds: number, durationSeconds?: number) => void;
  clearTrackPosition: (trackId: string) => void;
  getTrackPosition: (trackId: string) => TrackResumeInfo | null;
  clearRecentlyPlayed: () => void;
  clearListeningStats: () => void;
  addSearchQuery: (query: string) => void;
  removeSearchQuery: (query: string) => void;
  clearSearchHistory: () => void;
  createPlaylist: (name: string, description?: string, initialTrack?: Track) => Playlist;
  createPlaylistWithTracks: (name: string, tracks: Track[], description?: string) => Playlist;
  renamePlaylist: (playlistId: string, name: string, description?: string) => void;
  deletePlaylist: (playlistId: string) => void;
  addTrackToPlaylist: (playlistId: string, track: Track) => void;
  removeTrackFromPlaylist: (playlistId: string, trackId: string) => void;
  exportLibraryBackup: (offlinePlaylists?: OfflinePlaylist[]) => LibraryBackupPayload;
  importLibraryBackup: (
    payload: unknown,
    mode: 'merge' | 'replace'
  ) => { playlists: number; favourites: number; recent: number; offlinePlaylists?: OfflinePlaylist[] };
}

const LibraryContext = createContext<LibraryContextValue | null>(null);

export function LibraryProvider({ children }: { children: React.ReactNode }) {
  const [favourites, setFavourites] = useState<Track[]>(() => readStorage(STORAGE_KEYS.favourites, []));
  const [recentlyPlayed, setRecentlyPlayed] = useState<RecentlyPlayedItem[]>(() =>
    readStorage(STORAGE_KEYS.recentlyPlayed, [])
  );
  const [searchHistory, setSearchHistory] = useState<SearchHistoryItem[]>(() =>
    readStorage(STORAGE_KEYS.searchHistory, [])
  );
  const [playlists, setPlaylists] = useState<Playlist[]>(() => readStorage(STORAGE_KEYS.playlists, []));
  const [listeningStats, setListeningStats] = useState<ListeningStats>(() => {
    const raw = readStorage<Partial<ListeningStats>>(STORAGE_KEYS.stats, EMPTY_STATS);
    return {
      totalPlays: typeof raw.totalPlays === 'number' ? raw.totalPlays : 0,
      totalSecondsListened:
        typeof raw.totalSecondsListened === 'number' ? raw.totalSecondsListened : 0,
      trackStats: raw.trackStats && typeof raw.trackStats === 'object' ? raw.trackStats : {},
      artistStats: raw.artistStats && typeof raw.artistStats === 'object' ? raw.artistStats : {},
      dailyPlays: raw.dailyPlays && typeof raw.dailyPlays === 'object' ? raw.dailyPlays : {},
    };
  });
  const [trackPositions, setTrackPositions] = useState<Record<string, TrackResumeInfo>>(() =>
    readStorage(STORAGE_KEYS.trackPositions, {})
  );
  const trackPositionsRef = useRef(trackPositions);
  trackPositionsRef.current = trackPositions;

  const [toast, setToast] = useState<ToastMessage | null>(null);

  useEffect(() => writeStorage(STORAGE_KEYS.favourites, favourites), [favourites]);
  useEffect(() => writeStorage(STORAGE_KEYS.recentlyPlayed, recentlyPlayed), [recentlyPlayed]);
  useEffect(() => writeStorage(STORAGE_KEYS.searchHistory, searchHistory), [searchHistory]);
  useEffect(() => writeStorage(STORAGE_KEYS.playlists, playlists), [playlists]);
  useEffect(() => writeStorage(STORAGE_KEYS.stats, listeningStats), [listeningStats]);
  useEffect(() => writeStorage(STORAGE_KEYS.trackPositions, trackPositions), [trackPositions]);

  const showToast = useCallback((text: string) => {
    const id = Date.now();
    setToast({ id, text });
    window.setTimeout(() => {
      setToast((prev) => (prev?.id === id ? null : prev));
    }, 2800);
  }, []);

  const isFavourite = useCallback(
    (trackId: string) => favourites.some((t) => t.id === trackId),
    [favourites]
  );

  const toggleFavourite = useCallback(
    (track: Track) => {
      setFavourites((prev) => {
        const exists = prev.some((t) => t.id === track.id);
        if (exists) {
          showToast(`Removed "${track.title}" from Favourites`);
          return prev.filter((t) => t.id !== track.id);
        }
        showToast(`Saved "${track.title}" to Favourites`);
        return [track, ...prev];
      });
    },
    [showToast]
  );

  const recordPlayed = useCallback((track: Track) => {
    const now = Date.now();
    const dayKey = getLocalDayKey(now);

    setRecentlyPlayed((prev) => {
      const filtered = prev.filter((item) => item.track.id !== track.id);
      return [{ track, playedAt: now }, ...filtered].slice(0, 60);
    });

    setListeningStats((prev) => {
      const prevTrack = prev.trackStats[track.id];
      const nextTrackStats = {
        ...prev.trackStats,
        [track.id]: {
          track,
          playCount: (prevTrack?.playCount ?? 0) + 1,
          lastPlayedAt: now,
        },
      };

      const artistName = (track.artist || 'Unknown Artist').trim();
      const artistKey = artistName.toLowerCase();
      const prevArtist = prev.artistStats[artistKey];
      const nextArtistStats = {
        ...prev.artistStats,
        [artistKey]: {
          artist: prevArtist?.artist || artistName,
          playCount: (prevArtist?.playCount ?? 0) + 1,
          lastPlayedAt: now,
        },
      };

      const nextDailyPlays = {
        ...prev.dailyPlays,
        [dayKey]: (prev.dailyPlays[dayKey] ?? 0) + 1,
      };

      return {
        totalPlays: prev.totalPlays + 1,
        totalSecondsListened: prev.totalSecondsListened,
        trackStats: nextTrackStats,
        artistStats: nextArtistStats,
        dailyPlays: nextDailyPlays,
      };
    });
  }, []);

  const recordOfflinePlayed = useCallback(
    (offlineTrack: OfflineTrack) => {
      const asTrack = offlineTrackToLibraryTrack(offlineTrack);
      recordPlayed(asTrack);
    },
    [recordPlayed]
  );

  const recordListeningSeconds = useCallback((seconds: number) => {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    setListeningStats((prev) => ({
      ...prev,
      totalSecondsListened: prev.totalSecondsListened + Math.round(seconds),
    }));
  }, []);

  const saveTrackPosition = useCallback(
    (trackId: string, positionSeconds: number, durationSeconds = 0) => {
      if (!trackId || !Number.isFinite(positionSeconds)) return;
      const pos = Math.floor(positionSeconds);
      const dur = Number.isFinite(durationSeconds) && durationSeconds > 0 ? Math.floor(durationSeconds) : 0;

      // If near the very end of the track (within last 5 seconds), clear saved resume position
      if (dur > 10 && pos >= dur - 5) {
        setTrackPositions((prev) => {
          if (!prev[trackId]) return prev;
          const next = { ...prev };
          delete next[trackId];
          return next;
        });
        return;
      }

      // Only save once playback has progressed at least 3 seconds
      if (pos < 3) return;

      setTrackPositions((prev) => {
        const existing = prev[trackId];
        if (existing && Math.abs(existing.positionSeconds - pos) < 2 && existing.durationSeconds === dur) {
          return prev;
        }
        const next: Record<string, TrackResumeInfo> = {
          ...prev,
          [trackId]: {
            positionSeconds: pos,
            durationSeconds: dur || existing?.durationSeconds || 0,
            updatedAt: Date.now(),
          },
        };
        const keys = Object.keys(next);
        if (keys.length > 200) {
          const sorted = keys.sort((a, b) => (next[b]?.updatedAt ?? 0) - (next[a]?.updatedAt ?? 0));
          for (const oldKey of sorted.slice(200)) {
            delete next[oldKey];
          }
        }
        return next;
      });
    },
    []
  );

  const clearTrackPosition = useCallback((trackId: string) => {
    if (!trackId) return;
    setTrackPositions((prev) => {
      if (!prev[trackId]) return prev;
      const next = { ...prev };
      delete next[trackId];
      return next;
    });
  }, []);

  const getTrackPosition = useCallback((trackId: string): TrackResumeInfo | null => {
    if (!trackId) return null;
    const info = trackPositionsRef.current[trackId];
    if (!info || info.positionSeconds < 3) return null;
    if (info.durationSeconds > 10 && info.positionSeconds >= info.durationSeconds - 5) {
      return null;
    }
    return info;
  }, []);

  const clearRecentlyPlayed = useCallback(() => {
    setRecentlyPlayed([]);
    showToast('Cleared recently played history');
  }, [showToast]);

  const clearListeningStats = useCallback(() => {
    setListeningStats(EMPTY_STATS);
    showToast('Reset listening statistics');
  }, [showToast]);

  const addSearchQuery = useCallback((query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setSearchHistory((prev) => {
      const filtered = prev.filter((item) => item.query.toLowerCase() !== trimmed.toLowerCase());
      return [{ query: trimmed, timestamp: Date.now() }, ...filtered].slice(0, 25);
    });
  }, []);

  const removeSearchQuery = useCallback((query: string) => {
    setSearchHistory((prev) => prev.filter((item) => item.query !== query));
  }, []);

  const clearSearchHistory = useCallback(() => {
    setSearchHistory([]);
    showToast('Cleared search history');
  }, [showToast]);

  const createPlaylist = useCallback(
    (name: string, description = '', initialTrack?: Track): Playlist => {
      const now = Date.now();
      const newPlaylist: Playlist = {
        id: `pl_${now}_${Math.random().toString(36).slice(2, 7)}`,
        name: name.trim() || 'Untitled Playlist',
        description: description.trim(),
        tracks: initialTrack ? [initialTrack] : [],
        createdAt: now,
        updatedAt: now,
      };
      setPlaylists((prev) => [newPlaylist, ...prev]);
      showToast(
        initialTrack
          ? `Created "${newPlaylist.name}" and added "${initialTrack.title}"`
          : `Created playlist "${newPlaylist.name}"`
      );
      return newPlaylist;
    },
    [showToast]
  );

  const createPlaylistWithTracks = useCallback(
    (name: string, tracks: Track[], description = ''): Playlist => {
      const now = Date.now();
      const seen = new Set<string>();
      const uniqueTracks = tracks.filter((t) => {
        if (seen.has(t.id)) return false;
        seen.add(t.id);
        return true;
      });
      const newPlaylist: Playlist = {
        id: `pl_${now}_${Math.random().toString(36).slice(2, 7)}`,
        name: name.trim() || 'Queue Snapshot',
        description: description.trim(),
        tracks: uniqueTracks,
        createdAt: now,
        updatedAt: now,
      };
      setPlaylists((prev) => [newPlaylist, ...prev]);
      showToast(`Saved ${uniqueTracks.length} tracks to "${newPlaylist.name}"`);
      return newPlaylist;
    },
    [showToast]
  );

  const renamePlaylist = useCallback(
    (playlistId: string, name: string, description?: string) => {
      setPlaylists((prev) =>
        prev.map((pl) =>
          pl.id === playlistId
            ? {
                ...pl,
                name: name.trim() || pl.name,
                description: description !== undefined ? description.trim() : pl.description,
                updatedAt: Date.now(),
              }
            : pl
        )
      );
      showToast('Updated playlist details');
    },
    [showToast]
  );

  const deletePlaylist = useCallback(
    (playlistId: string) => {
      setPlaylists((prev) => prev.filter((pl) => pl.id !== playlistId));
      showToast('Deleted playlist');
    },
    [showToast]
  );

  const addTrackToPlaylist = useCallback(
    (playlistId: string, track: Track) => {
      setPlaylists((prev) =>
        prev.map((pl) => {
          if (pl.id !== playlistId) return pl;
          if (pl.tracks.some((t) => t.id === track.id)) {
            showToast(`Already in "${pl.name}"`);
            return pl;
          }
          showToast(`Added "${track.title}" to "${pl.name}"`);
          return {
            ...pl,
            tracks: [...pl.tracks, track],
            updatedAt: Date.now(),
          };
        })
      );
    },
    [showToast]
  );

  const removeTrackFromPlaylist = useCallback(
    (playlistId: string, trackId: string) => {
      setPlaylists((prev) =>
        prev.map((pl) => {
          if (pl.id !== playlistId) return pl;
          return {
            ...pl,
            tracks: pl.tracks.filter((t) => t.id !== trackId),
            updatedAt: Date.now(),
          };
        })
      );
      showToast('Removed track from playlist');
    },
    [showToast]
  );

  const exportLibraryBackup = useCallback(
    (offlinePlaylists?: OfflinePlaylist[]): LibraryBackupPayload => ({
      version: 1,
      app: 'VIBRA',
      exportedAt: Date.now(),
      favourites,
      playlists,
      recentlyPlayed,
      searchHistory,
      listeningStats,
      trackPositions,
      ...(offlinePlaylists && offlinePlaylists.length > 0 ? { offlinePlaylists } : {}),
    }),
    [favourites, listeningStats, playlists, recentlyPlayed, searchHistory, trackPositions]
  );

  const importLibraryBackup = useCallback(
    (
      rawPayload: unknown,
      mode: 'merge' | 'replace'
    ): { playlists: number; favourites: number; recent: number; offlinePlaylists?: OfflinePlaylist[] } => {
      if (!rawPayload || typeof rawPayload !== 'object') {
        throw new Error('Invalid backup file format.');
      }
      const data = rawPayload as Partial<LibraryBackupPayload>;
      if (data.app !== 'VIBRA' || data.version !== 1) {
        throw new Error('Unsupported or corrupted VIBRA backup file.');
      }

      const incomingFavs = Array.isArray(data.favourites)
        ? data.favourites.filter((t): t is Track => Boolean(t && t.id && t.title))
        : [];
      const incomingPlaylists = Array.isArray(data.playlists)
        ? data.playlists.filter((p): p is Playlist => Boolean(p && p.id && p.name && Array.isArray(p.tracks)))
        : [];
      const incomingRecent = Array.isArray(data.recentlyPlayed)
        ? data.recentlyPlayed.filter((r): r is RecentlyPlayedItem => Boolean(r && r.track?.id && r.track?.title))
        : [];
      const incomingSearches = Array.isArray(data.searchHistory)
        ? data.searchHistory.filter((s): s is SearchHistoryItem => Boolean(s && typeof s.query === 'string'))
        : [];
      const incomingPositions =
        data.trackPositions && typeof data.trackPositions === 'object' ? data.trackPositions : {};
      const incomingStats =
        data.listeningStats && typeof data.listeningStats === 'object' ? data.listeningStats : EMPTY_STATS;
      const incomingOfflinePlaylists = Array.isArray(data.offlinePlaylists)
        ? data.offlinePlaylists.filter(
            (p): p is OfflinePlaylist => Boolean(p && p.id && p.name && Array.isArray(p.trackIds))
          )
        : undefined;

      if (mode === 'replace') {
        setFavourites(incomingFavs);
        setPlaylists(incomingPlaylists);
        setRecentlyPlayed(incomingRecent.slice(0, 60));
        setSearchHistory(incomingSearches.slice(0, 25));
        setTrackPositions(incomingPositions);
        setListeningStats({
          totalPlays: typeof incomingStats.totalPlays === 'number' ? incomingStats.totalPlays : 0,
          totalSecondsListened:
            typeof incomingStats.totalSecondsListened === 'number' ? incomingStats.totalSecondsListened : 0,
          trackStats: incomingStats.trackStats ?? {},
          artistStats: incomingStats.artistStats ?? {},
          dailyPlays: incomingStats.dailyPlays ?? {},
        });
      } else {
        setFavourites((prev) => {
          const seen = new Set(prev.map((t) => t.id));
          return [...prev, ...incomingFavs.filter((t) => !seen.has(t.id))];
        });

        setPlaylists((prev) => {
          const byId = new Map(prev.map((p) => [p.id, p]));
          for (const imp of incomingPlaylists) {
            const existing = byId.get(imp.id);
            if (existing) {
              const trackIds = new Set(existing.tracks.map((t) => t.id));
              const mergedTracks = [...existing.tracks, ...imp.tracks.filter((t) => !trackIds.has(t.id))];
              byId.set(imp.id, { ...existing, tracks: mergedTracks, updatedAt: Date.now() });
            } else {
              byId.set(imp.id, imp);
            }
          }
          return Array.from(byId.values());
        });

        setRecentlyPlayed((prev) => {
          const map = new Map<string, RecentlyPlayedItem>();
          for (const item of [...prev, ...incomingRecent]) {
            const prevItem = map.get(item.track.id);
            if (!prevItem || item.playedAt > prevItem.playedAt) {
              map.set(item.track.id, item);
            }
          }
          return Array.from(map.values())
            .sort((a, b) => b.playedAt - a.playedAt)
            .slice(0, 60);
        });

        setSearchHistory((prev) => {
          const map = new Map<string, SearchHistoryItem>();
          for (const item of [...prev, ...incomingSearches]) {
            const k = item.query.toLowerCase();
            const existing = map.get(k);
            if (!existing || item.timestamp > existing.timestamp) {
              map.set(k, item);
            }
          }
          return Array.from(map.values())
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, 25);
        });

        setTrackPositions((prev) => {
          const next = { ...prev };
          for (const [id, info] of Object.entries(incomingPositions)) {
            if (!info || typeof info.positionSeconds !== 'number') continue;
            if (!next[id] || info.updatedAt > next[id].updatedAt) {
              next[id] = info;
            }
          }
          return next;
        });

        setListeningStats((prev) => {
          const mergedTrackStats = { ...prev.trackStats };
          for (const [id, stat] of Object.entries(incomingStats.trackStats ?? {})) {
            const existing = mergedTrackStats[id];
            if (!existing) {
              mergedTrackStats[id] = stat;
            } else {
              mergedTrackStats[id] = {
                track: existing.track || stat.track,
                playCount: Math.max(existing.playCount, stat.playCount),
                lastPlayedAt: Math.max(existing.lastPlayedAt, stat.lastPlayedAt),
              };
            }
          }
          const mergedArtistStats = { ...prev.artistStats };
          for (const [k, stat] of Object.entries(incomingStats.artistStats ?? {})) {
            const existing = mergedArtistStats[k];
            if (!existing) {
              mergedArtistStats[k] = stat;
            } else {
              mergedArtistStats[k] = {
                artist: existing.artist || stat.artist,
                playCount: Math.max(existing.playCount, stat.playCount),
                lastPlayedAt: Math.max(existing.lastPlayedAt, stat.lastPlayedAt),
              };
            }
          }
          const mergedDailyPlays = { ...prev.dailyPlays };
          for (const [day, count] of Object.entries(incomingStats.dailyPlays ?? {})) {
            mergedDailyPlays[day] = Math.max(mergedDailyPlays[day] ?? 0, count);
          }
          return {
            totalPlays: Math.max(prev.totalPlays, incomingStats.totalPlays ?? 0),
            totalSecondsListened: Math.max(
              prev.totalSecondsListened,
              incomingStats.totalSecondsListened ?? 0
            ),
            trackStats: mergedTrackStats,
            artistStats: mergedArtistStats,
            dailyPlays: mergedDailyPlays,
          };
        });
      }

      return {
        playlists: incomingPlaylists.length,
        favourites: incomingFavs.length,
        recent: incomingRecent.length,
        offlinePlaylists: incomingOfflinePlaylists,
      };
    },
    []
  );

  const contextValue = useMemo<LibraryContextValue>(
    () => ({
      favourites,
      recentlyPlayed,
      searchHistory,
      playlists,
      listeningStats,
      trackPositions,
      toast,
      showToast,
      isFavourite,
      toggleFavourite,
      recordPlayed,
      recordOfflinePlayed,
      recordListeningSeconds,
      saveTrackPosition,
      clearTrackPosition,
      getTrackPosition,
      clearRecentlyPlayed,
      clearListeningStats,
      addSearchQuery,
      removeSearchQuery,
      clearSearchHistory,
      createPlaylist,
      createPlaylistWithTracks,
      renamePlaylist,
      deletePlaylist,
      addTrackToPlaylist,
      removeTrackFromPlaylist,
      exportLibraryBackup,
      importLibraryBackup,
    }),
    [
      favourites,
      recentlyPlayed,
      searchHistory,
      playlists,
      listeningStats,
      trackPositions,
      toast,
      showToast,
      isFavourite,
      toggleFavourite,
      recordPlayed,
      recordOfflinePlayed,
      recordListeningSeconds,
      saveTrackPosition,
      clearTrackPosition,
      getTrackPosition,
      clearRecentlyPlayed,
      clearListeningStats,
      addSearchQuery,
      removeSearchQuery,
      clearSearchHistory,
      createPlaylist,
      createPlaylistWithTracks,
      renamePlaylist,
      deletePlaylist,
      addTrackToPlaylist,
      removeTrackFromPlaylist,
      exportLibraryBackup,
      importLibraryBackup,
    ]
  );

  return (
    <LibraryContext.Provider value={contextValue}>
      {children}
    </LibraryContext.Provider>
  );
}

export function useLibrary(): LibraryContextValue {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error('useLibrary must be used within LibraryProvider');
  return ctx;
}
