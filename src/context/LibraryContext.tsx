import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type {
  ListeningStats,
  Playlist,
  RecentlyPlayedItem,
  SearchHistoryItem,
  Track,
} from '../types/music';

const STORAGE_KEYS = {
  favourites: 'vibra_favourites_v1',
  recentlyPlayed: 'vibra_recent_v1',
  searchHistory: 'vibra_search_history_v1',
  playlists: 'vibra_playlists_v1',
  stats: 'vibra_stats_v1',
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
  toast: ToastMessage | null;
  showToast: (text: string) => void;
  isFavourite: (trackId: string) => boolean;
  toggleFavourite: (track: Track) => void;
  recordPlayed: (track: Track) => void;
  recordListeningSeconds: (seconds: number) => void;
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
  const [toast, setToast] = useState<ToastMessage | null>(null);

  useEffect(() => writeStorage(STORAGE_KEYS.favourites, favourites), [favourites]);
  useEffect(() => writeStorage(STORAGE_KEYS.recentlyPlayed, recentlyPlayed), [recentlyPlayed]);
  useEffect(() => writeStorage(STORAGE_KEYS.searchHistory, searchHistory), [searchHistory]);
  useEffect(() => writeStorage(STORAGE_KEYS.playlists, playlists), [playlists]);
  useEffect(() => writeStorage(STORAGE_KEYS.stats, listeningStats), [listeningStats]);

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
      return [{ track, playedAt: now }, ...filtered].slice(0, 50);
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

  const recordListeningSeconds = useCallback((seconds: number) => {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    setListeningStats((prev) => ({
      ...prev,
      totalSecondsListened: prev.totalSecondsListened + Math.round(seconds),
    }));
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

  return (
    <LibraryContext.Provider
      value={{
        favourites,
        recentlyPlayed,
        searchHistory,
        playlists,
        listeningStats,
        toast,
        showToast,
        isFavourite,
        toggleFavourite,
        recordPlayed,
        recordListeningSeconds,
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
      }}
    >
      {children}
    </LibraryContext.Provider>
  );
}

export function useLibrary(): LibraryContextValue {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error('useLibrary must be used within LibraryProvider');
  return ctx;
}
