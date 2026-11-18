import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AudioSourceProvider,
  BatchDownloadState,
  DownloadProgressItem,
  MultiSourceTrack,
  OfflinePlaylist,
  OfflineTrack,
  Track,
} from '../types/music';
import {
  clearOfflineMusicDb,
  createOfflineTrackFromFile,
  deleteOfflineTrackFromDb,
  exportOfflineTrackToDevice,
  type FileSystemDirectoryHandleLike,
  getAllOfflineTracks,
  getDirectoryHandleFromDb,
  isAudioFileCandidate,
  putOfflineTrackWithBlob,
  saveDirectAudioUrlOffline,
  saveDirectoryHandleToDb,
  saveOnlineTrackOffline,
  scanDirectoryHandleRecursively,
} from '../utils/offlineMusicDb';
import { useLibrary } from './LibraryContext';

const OFFLINE_PLAYLISTS_KEY = 'vibra_offline_playlists_v1';
const STORAGE_GRANTED_KEY = 'vibra_storage_permission_granted_v1';
const FOLDER_NAME_KEY = 'vibra_storage_folder_name_v1';

function readOfflinePlaylists(): OfflinePlaylist[] {
  try {
    const raw = localStorage.getItem(OFFLINE_PLAYLISTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

interface OfflineMusicContextValue {
  offlineTracks: OfflineTrack[];
  offlinePlaylists: OfflinePlaylist[];
  isLoaded: boolean;
  isScanning: boolean;
  scanStatusText: string | null;
  storageGranted: boolean;
  grantedFolderName: string | null;
  canRescanFolder: boolean;
  isOnline: boolean;
  downloadingIds: Record<string, boolean>;
  downloadProgressMap: Record<string, DownloadProgressItem>;
  activeDownloads: DownloadProgressItem[];
  supportsDirectoryPicker: boolean;
  grantPermissionAndScanDirectory: () => Promise<'picked' | 'fallback-needed' | 'cancelled'>;
  rescanSavedFolder: () => Promise<void>;
  importAudioFiles: (files: FileList | File[], source?: 'device-folder' | 'device-file') => Promise<number>;
  saveOnlineTrack: (track: Track, alsoDownloadToDevice?: boolean) => Promise<void>;
  downloadFromDirectUrl: (
    rawUrl: string,
    options?: { title?: string; artist?: string; alsoDownloadToDevice?: boolean }
  ) => Promise<OfflineTrack | null>;
  exportTrackToDevice: (track: OfflineTrack) => Promise<void>;
  searchOtherSources: (
    query: string,
    source?: 'all' | AudioSourceProvider
  ) => Promise<MultiSourceTrack[]>;
  isTrackSavedOffline: (videoId: string) => boolean;
  deleteOfflineTrack: (trackId: string) => Promise<void>;
  clearAllOfflineTracks: () => Promise<void>;
  createOfflinePlaylist: (name: string, trackIds?: string[], description?: string) => OfflinePlaylist;
  renameOfflinePlaylist: (playlistId: string, name: string) => void;
  deleteOfflinePlaylist: (playlistId: string) => void;
  addTrackToOfflinePlaylist: (playlistId: string, trackId: string) => void;
  removeTrackFromOfflinePlaylist: (playlistId: string, trackId: string) => void;
  batchDownloadState: BatchDownloadState | null;
  isBatchDownloading: boolean;
  batchDownloadTracks: (
    tracks: Track[],
    label?: string,
    alsoDownloadToDevice?: boolean
  ) => Promise<void>;
  cancelBatchDownload: () => void;
  importOfflinePlaylistsBackup: (
    incoming: OfflinePlaylist[],
    mode: 'merge' | 'replace'
  ) => void;
}

const OfflineMusicContext = createContext<OfflineMusicContextValue | null>(null);

export function OfflineMusicProvider({ children }: { children: React.ReactNode }) {
  const { showToast } = useLibrary();
  const [offlineTracks, setOfflineTracks] = useState<OfflineTrack[]>([]);
  const [offlinePlaylists, setOfflinePlaylists] = useState<OfflinePlaylist[]>(() =>
    readOfflinePlaylists()
  );
  const [isLoaded, setIsLoaded] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanStatusText, setScanStatusText] = useState<string | null>(null);
  const [storageGranted, setStorageGranted] = useState<boolean>(
    () => localStorage.getItem(STORAGE_GRANTED_KEY) === 'true'
  );
  const [grantedFolderName, setGrantedFolderName] = useState<string | null>(() =>
    localStorage.getItem(FOLDER_NAME_KEY)
  );
  const [savedFolderHandle, setSavedFolderHandle] = useState<FileSystemDirectoryHandleLike | null>(null);
  const [downloadingIds, setDownloadingIds] = useState<Record<string, boolean>>({});
  const [downloadProgressMap, setDownloadProgressMap] = useState<Record<string, DownloadProgressItem>>({});
  const [batchDownloadState, setBatchDownloadState] = useState<BatchDownloadState | null>(null);
  const batchCancelRef = useRef(false);
  const batchRunningRef = useRef(false);
  const offlineTracksRef = useRef<OfflineTrack[]>([]);
  offlineTracksRef.current = offlineTracks;
  const clearTimersRef = useRef<Record<string, number>>({});
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  const supportsDirectoryPicker =
    typeof window !== 'undefined' &&
    typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    return () => {
      Object.values(clearTimersRef.current).forEach((timerId) => window.clearTimeout(timerId));
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(OFFLINE_PLAYLISTS_KEY, JSON.stringify(offlinePlaylists));
    } catch {
      // ignore storage quota errors
    }
  }, [offlinePlaylists]);

  const activeDownloads = useMemo(
    () => Object.values(downloadProgressMap),
    [downloadProgressMap]
  );

  const setTrackProgress = useCallback((item: DownloadProgressItem) => {
    if (clearTimersRef.current[item.trackId]) {
      window.clearTimeout(clearTimersRef.current[item.trackId]);
      delete clearTimersRef.current[item.trackId];
    }
    setDownloadProgressMap((prev) => ({
      ...prev,
      [item.trackId]: item,
    }));
  }, []);

  const clearTrackProgressLater = useCallback((trackId: string, delayMs = 2000) => {
    if (clearTimersRef.current[trackId]) {
      window.clearTimeout(clearTimersRef.current[trackId]);
    }
    if (delayMs <= 0) {
      setDownloadProgressMap((prev) => {
        const next = { ...prev };
        delete next[trackId];
        return next;
      });
      return;
    }
    clearTimersRef.current[trackId] = window.setTimeout(() => {
      delete clearTimersRef.current[trackId];
      setDownloadProgressMap((prev) => {
        const next = { ...prev };
        delete next[trackId];
        return next;
      });
    }, delayMs);
  }, []);

  const refreshTracksFromDb = useCallback(async () => {
    try {
      const list = await getAllOfflineTracks();
      setOfflineTracks(list);
      if (list.length > 0 && !storageGranted) {
        setStorageGranted(true);
        localStorage.setItem(STORAGE_GRANTED_KEY, 'true');
      }
    } catch {
      // ignore
    } finally {
      setIsLoaded(true);
    }
  }, [storageGranted]);

  useEffect(() => {
    void refreshTracksFromDb();
    void getDirectoryHandleFromDb().then((handle) => {
      if (handle) setSavedFolderHandle(handle);
    });
  }, [refreshTracksFromDb]);

  const requestPersistentBrowserStorage = useCallback(async () => {
    try {
      if (navigator.storage && typeof navigator.storage.persist === 'function') {
        await navigator.storage.persist();
      }
    } catch {
      // ignore unsupported persist
    }
    setStorageGranted(true);
    localStorage.setItem(STORAGE_GRANTED_KEY, 'true');
  }, []);

  const ingestFileEntries = useCallback(
    async (
      entries: Array<{ file: File; relativePath?: string }>,
      source: 'device-folder' | 'device-file'
    ): Promise<number> => {
      const audioEntries = entries.filter((e) => isAudioFileCandidate(e.file) && e.file.size > 4096);
      if (audioEntries.length === 0) {
        showToast('No supported audio files found in selection');
        return 0;
      }

      setIsScanning(true);
      setScanStatusText(`Scanning 0 / ${audioEntries.length} songs...`);
      let addedCount = 0;

      try {
        await requestPersistentBrowserStorage();

        for (let i = 0; i < audioEntries.length; i++) {
          const { file, relativePath } = audioEntries[i];
          setScanStatusText(`Importing ${i + 1} / ${audioEntries.length}: ${file.name}`);
          try {
            const { track, blob } = await createOfflineTrackFromFile(file, source, relativePath);
            await putOfflineTrackWithBlob(track, blob);
            addedCount += 1;
          } catch {
            // skip individual broken file
          }
        }

        await refreshTracksFromDb();
        showToast(`Added ${addedCount} downloaded ${addedCount === 1 ? 'song' : 'songs'} to My Music`);
      } finally {
        setIsScanning(false);
        setScanStatusText(null);
      }

      return addedCount;
    },
    [refreshTracksFromDb, requestPersistentBrowserStorage, showToast]
  );

  const importAudioFiles = useCallback(
    async (files: FileList | File[], source: 'device-folder' | 'device-file' = 'device-file') => {
      const arr = Array.from(files);
      const entries = arr.map((file) => ({
        file,
        relativePath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || undefined,
      }));
      return ingestFileEntries(entries, source);
    },
    [ingestFileEntries]
  );

  const scanDirHandle = useCallback(
    async (dirHandle: FileSystemDirectoryHandleLike) => {
      setIsScanning(true);
      setScanStatusText(`Scanning "${dirHandle.name}" for audio files...`);
      try {
        const found = await scanDirectoryHandleRecursively(dirHandle);
        setGrantedFolderName(dirHandle.name);
        localStorage.setItem(FOLDER_NAME_KEY, dirHandle.name);
        await saveDirectoryHandleToDb(dirHandle);
        setSavedFolderHandle(dirHandle);
        await ingestFileEntries(found, 'device-folder');
      } finally {
        setIsScanning(false);
        setScanStatusText(null);
      }
    },
    [ingestFileEntries]
  );

  const grantPermissionAndScanDirectory = useCallback(async (): Promise<
    'picked' | 'fallback-needed' | 'cancelled'
  > => {
    await requestPersistentBrowserStorage();
    const picker = (
      window as unknown as {
        showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite'; id?: string }) => Promise<FileSystemDirectoryHandleLike>;
      }
    ).showDirectoryPicker;

    if (typeof picker !== 'function') {
      return 'fallback-needed';
    }

    try {
      const handle = await picker({ mode: 'read', id: 'vibra-music' });
      await scanDirHandle(handle);
      return 'picked';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return 'cancelled';
      }
      // On Android / iframe contexts where showDirectoryPicker throws SecurityError/NotSupportedError
      return 'fallback-needed';
    }
  }, [requestPersistentBrowserStorage, scanDirHandle]);

  const rescanSavedFolder = useCallback(async () => {
    if (!savedFolderHandle) return;
    try {
      if (typeof savedFolderHandle.queryPermission === 'function') {
        const cur = await savedFolderHandle.queryPermission({ mode: 'read' });
        if (cur !== 'granted' && typeof savedFolderHandle.requestPermission === 'function') {
          const req = await savedFolderHandle.requestPermission({ mode: 'read' });
          if (req !== 'granted') {
            showToast('Folder read permission was not granted');
            return;
          }
        }
      }
      await scanDirHandle(savedFolderHandle);
    } catch {
      showToast('Please re-select your Downloads or Music folder');
    }
  }, [savedFolderHandle, scanDirHandle, showToast]);

  const saveOnlineTrack = useCallback(
    async (track: Track, alsoDownloadToDevice = true) => {
      if (downloadingIds[track.id]) return;
      setDownloadingIds((prev) => ({ ...prev, [track.id]: true }));
      setTrackProgress({
        trackId: track.id,
        title: track.title,
        artist: track.artist,
        percent: 1,
        loadedBytes: 0,
        totalBytes: 0,
        remainingBytes: 0,
        phase: 'resolving',
      });
      showToast(
        alsoDownloadToDevice
          ? `Downloading "${track.title}" to Device & My Music...`
          : `Saving "${track.title}" to My Music...`
      );
      let succeeded = false;
      try {
        await requestPersistentBrowserStorage();
        await saveOnlineTrackOffline(track, {
          alsoDownloadToDevice,
          onProgress: (p) => {
            setTrackProgress({
              trackId: track.id,
              title: track.title,
              artist: track.artist,
              percent: p.percent,
              loadedBytes: p.loadedBytes,
              totalBytes: p.totalBytes,
              remainingBytes: p.remainingBytes,
              phase: p.percent >= 100 ? 'saving' : 'downloading',
            });
          },
        });
        await refreshTracksFromDb();
        setTrackProgress({
          trackId: track.id,
          title: track.title,
          artist: track.artist,
          percent: 100,
          loadedBytes: 1,
          totalBytes: 1,
          remainingBytes: 0,
          phase: 'done',
        });
        succeeded = true;
        showToast(
          alsoDownloadToDevice
            ? `Downloaded "${track.title}" to Device & My Music`
            : `Saved "${track.title}" to My Music for offline play`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unable to save song offline right now';
        showToast(msg);
      } finally {
        setDownloadingIds((prev) => {
          const next = { ...prev };
          delete next[track.id];
          return next;
        });
        clearTrackProgressLater(track.id, succeeded ? 2200 : 0);
      }
    },
    [
      clearTrackProgressLater,
      downloadingIds,
      refreshTracksFromDb,
      requestPersistentBrowserStorage,
      setTrackProgress,
      showToast,
    ]
  );

  const downloadFromDirectUrl = useCallback(
    async (
      rawUrl: string,
      options?: { title?: string; artist?: string; alsoDownloadToDevice?: boolean }
    ): Promise<OfflineTrack | null> => {
      const cleanedUrl = rawUrl.trim();
      if (!cleanedUrl) return null;
      const dlKey = `url_${Date.now()}`;
      const labelTitle = options?.title?.trim() || 'Audio Link';
      const labelArtist = options?.artist?.trim() || 'Direct URL';
      const alsoDevice = options?.alsoDownloadToDevice ?? true;

      setDownloadingIds((prev) => ({ ...prev, [dlKey]: true }));
      setTrackProgress({
        trackId: dlKey,
        title: labelTitle,
        artist: labelArtist,
        percent: 2,
        loadedBytes: 0,
        totalBytes: 0,
        remainingBytes: 0,
        phase: 'resolving',
      });

      let succeeded = false;
      try {
        await requestPersistentBrowserStorage();
        const saved = await saveDirectAudioUrlOffline(cleanedUrl, {
          title: options?.title,
          artist: options?.artist,
          alsoDownloadToDevice: alsoDevice,
          onProgress: (p) => {
            setTrackProgress({
              trackId: dlKey,
              title: labelTitle,
              artist: labelArtist,
              percent: p.percent,
              loadedBytes: p.loadedBytes,
              totalBytes: p.totalBytes,
              remainingBytes: p.remainingBytes,
              phase: p.percent >= 100 ? 'saving' : 'downloading',
            });
          },
        });
        await refreshTracksFromDb();
        setTrackProgress({
          trackId: dlKey,
          title: saved.title,
          artist: saved.artist,
          percent: 100,
          loadedBytes: saved.sizeBytes,
          totalBytes: saved.sizeBytes,
          remainingBytes: 0,
          phase: 'done',
        });
        succeeded = true;
        showToast(
          alsoDevice
            ? `Downloaded "${saved.title}" to Device & My Music`
            : `Saved "${saved.title}" to My Music`
        );
        return saved;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unable to download audio URL';
        showToast(msg);
        return null;
      } finally {
        setDownloadingIds((prev) => {
          const next = { ...prev };
          delete next[dlKey];
          return next;
        });
        clearTrackProgressLater(dlKey, succeeded ? 2200 : 0);
      }
    },
    [clearTrackProgressLater, refreshTracksFromDb, requestPersistentBrowserStorage, setTrackProgress, showToast]
  );

  const exportTrackToDevice = useCallback(
    async (track: OfflineTrack) => {
      try {
        await exportOfflineTrackToDevice(track);
        showToast(`Saved "${track.title}" to Device Downloads`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Could not export file to device';
        showToast(msg);
      }
    },
    [showToast]
  );

  const searchOtherSources = useCallback(
    async (
      query: string,
      source: 'all' | AudioSourceProvider = 'all'
    ): Promise<MultiSourceTrack[]> => {
      const cleaned = query.trim();
      if (!cleaned) return [];
      const qs = new URLSearchParams({ q: cleaned, source });
      const res = await fetch(`/api/sources/search?${qs.toString()}`);
      if (!res.ok) {
        let errMsg = 'Could not search audio sources right now.';
        try {
          const json = (await res.json()) as { message?: string };
          if (json.message) errMsg = json.message;
        } catch {
          // ignore
        }
        throw new Error(errMsg);
      }
      const data = (await res.json()) as { tracks?: MultiSourceTrack[] };
      return data.tracks ?? [];
    },
    []
  );

  const isTrackSavedOffline = useCallback(
    (videoId: string) => offlineTracks.some((t) => t.sourceVideoId === videoId || t.id === `dl_${videoId}`),
    [offlineTracks]
  );

  const deleteOfflineTrack = useCallback(
    async (trackId: string) => {
      await deleteOfflineTrackFromDb(trackId);
      setOfflineTracks((prev) => prev.filter((t) => t.id !== trackId));
      setOfflinePlaylists((prev) =>
        prev.map((pl) => ({
          ...pl,
          trackIds: pl.trackIds.filter((id) => id !== trackId),
          updatedAt: Date.now(),
        }))
      );
      showToast('Removed song from My Music');
    },
    [showToast]
  );

  const clearAllOfflineTracks = useCallback(async () => {
    await clearOfflineMusicDb();
    setOfflineTracks([]);
    setOfflinePlaylists((prev) => prev.map((pl) => ({ ...pl, trackIds: [], updatedAt: Date.now() })));
    showToast('Cleared downloaded songs from My Music');
  }, [showToast]);

  const createOfflinePlaylist = useCallback(
    (name: string, trackIds: string[] = [], description = ''): OfflinePlaylist => {
      const now = Date.now();
      const uniqueIds = Array.from(new Set(trackIds));
      const newPl: OfflinePlaylist = {
        id: `opl_${now}_${Math.random().toString(36).slice(2, 7)}`,
        name: name.trim() || 'My Offline Playlist',
        description: description.trim(),
        trackIds: uniqueIds,
        createdAt: now,
        updatedAt: now,
      };
      setOfflinePlaylists((prev) => [newPl, ...prev]);
      showToast(`Created offline playlist "${newPl.name}" (${uniqueIds.length} songs)`);
      return newPl;
    },
    [showToast]
  );

  const renameOfflinePlaylist = useCallback(
    (playlistId: string, name: string) => {
      setOfflinePlaylists((prev) =>
        prev.map((pl) =>
          pl.id === playlistId
            ? { ...pl, name: name.trim() || pl.name, updatedAt: Date.now() }
            : pl
        )
      );
      showToast('Updated offline playlist name');
    },
    [showToast]
  );

  const deleteOfflinePlaylist = useCallback(
    (playlistId: string) => {
      setOfflinePlaylists((prev) => prev.filter((pl) => pl.id !== playlistId));
      showToast('Deleted offline playlist');
    },
    [showToast]
  );

  const addTrackToOfflinePlaylist = useCallback(
    (playlistId: string, trackId: string) => {
      setOfflinePlaylists((prev) =>
        prev.map((pl) => {
          if (pl.id !== playlistId) return pl;
          if (pl.trackIds.includes(trackId)) {
            showToast(`Already in "${pl.name}"`);
            return pl;
          }
          showToast(`Added song to "${pl.name}"`);
          return { ...pl, trackIds: [...pl.trackIds, trackId], updatedAt: Date.now() };
        })
      );
    },
    [showToast]
  );

  const removeTrackFromOfflinePlaylist = useCallback(
    (playlistId: string, trackId: string) => {
      setOfflinePlaylists((prev) =>
        prev.map((pl) =>
          pl.id === playlistId
            ? { ...pl, trackIds: pl.trackIds.filter((id) => id !== trackId), updatedAt: Date.now() }
            : pl
        )
      );
      showToast('Removed song from offline playlist');
    },
    [showToast]
  );

  const cancelBatchDownload = useCallback(() => {
    batchCancelRef.current = true;
    showToast('Stopping batch download after current song...');
  }, [showToast]);

  const batchDownloadTracks = useCallback(
    async (tracks: Track[], label = 'Playlist', alsoDownloadToDevice = false) => {
      if (batchRunningRef.current) {
        showToast('A batch download is already in progress');
        return;
      }

      const seen = new Set<string>();
      const uniqueTracks = tracks.filter((t) => {
        if (!t || !t.id || t.isOffline) return false;
        if (seen.has(t.id)) return false;
        seen.add(t.id);
        return true;
      });

      if (uniqueTracks.length === 0) {
        showToast('No downloadable online tracks found in this list');
        return;
      }

      batchRunningRef.current = true;
      batchCancelRef.current = false;

      let completed = 0;
      let skipped = 0;
      let failed = 0;

      await requestPersistentBrowserStorage();
      setBatchDownloadState({
        label,
        total: uniqueTracks.length,
        completed: 0,
        skipped: 0,
        failed: 0,
        currentTitle: uniqueTracks[0].title,
      });

      showToast(`Starting download for "${label}" (${uniqueTracks.length} songs)...`);

      try {
        for (const track of uniqueTracks) {
          if (batchCancelRef.current) break;

          const alreadySaved = offlineTracksRef.current.some(
            (o) => o.sourceVideoId === track.id || o.id === `dl_${track.id}`
          );
          if (alreadySaved) {
            skipped += 1;
            setBatchDownloadState({
              label,
              total: uniqueTracks.length,
              completed,
              skipped,
              failed,
              currentTitle: track.title,
            });
            continue;
          }

          setBatchDownloadState({
            label,
            total: uniqueTracks.length,
            completed,
            skipped,
            failed,
            currentTitle: track.title,
          });

          setDownloadingIds((prev) => ({ ...prev, [track.id]: true }));
          setTrackProgress({
            trackId: track.id,
            title: track.title,
            artist: track.artist,
            percent: 2,
            loadedBytes: 0,
            totalBytes: 0,
            remainingBytes: 0,
            phase: 'resolving',
          });

          let ok = false;
          try {
            await saveOnlineTrackOffline(track, {
              alsoDownloadToDevice,
              onProgress: (p) => {
                setTrackProgress({
                  trackId: track.id,
                  title: track.title,
                  artist: track.artist,
                  percent: p.percent,
                  loadedBytes: p.loadedBytes,
                  totalBytes: p.totalBytes,
                  remainingBytes: p.remainingBytes,
                  phase: p.percent >= 100 ? 'saving' : 'downloading',
                });
              },
            });
            ok = true;
            completed += 1;
            setTrackProgress({
              trackId: track.id,
              title: track.title,
              artist: track.artist,
              percent: 100,
              loadedBytes: 1,
              totalBytes: 1,
              remainingBytes: 0,
              phase: 'done',
            });
            await refreshTracksFromDb();
          } catch {
            failed += 1;
          } finally {
            setDownloadingIds((prev) => {
              const next = { ...prev };
              delete next[track.id];
              return next;
            });
            clearTrackProgressLater(track.id, ok ? 1400 : 0);
          }

          setBatchDownloadState({
            label,
            total: uniqueTracks.length,
            completed,
            skipped,
            failed,
            currentTitle: track.title,
          });
        }

        if (batchCancelRef.current) {
          showToast(
            `Batch cancelled · ${completed} saved${skipped > 0 ? `, ${skipped} already offline` : ''}`
          );
        } else {
          const parts = [`${completed} saved to My Music`];
          if (skipped > 0) parts.push(`${skipped} already offline`);
          if (failed > 0) parts.push(`${failed} failed`);
          showToast(`Finished "${label}": ${parts.join(' · ')}`);
        }
      } finally {
        batchRunningRef.current = false;
        batchCancelRef.current = false;
        setBatchDownloadState(null);
      }
    },
    [
      clearTrackProgressLater,
      refreshTracksFromDb,
      requestPersistentBrowserStorage,
      setTrackProgress,
      showToast,
    ]
  );

  const importOfflinePlaylistsBackup = useCallback(
    (incoming: OfflinePlaylist[], mode: 'merge' | 'replace') => {
      if (!Array.isArray(incoming)) return;
      if (mode === 'replace') {
        setOfflinePlaylists(incoming);
        return;
      }
      setOfflinePlaylists((prev) => {
        const byId = new Map(prev.map((p) => [p.id, p]));
        for (const imp of incoming) {
          const existing = byId.get(imp.id);
          if (existing) {
            const ids = Array.from(new Set([...existing.trackIds, ...imp.trackIds]));
            byId.set(imp.id, { ...existing, trackIds: ids, updatedAt: Date.now() });
          } else {
            byId.set(imp.id, imp);
          }
        }
        return Array.from(byId.values());
      });
    },
    []
  );

  return (
    <OfflineMusicContext.Provider
      value={{
        offlineTracks,
        offlinePlaylists,
        isLoaded,
        isScanning,
        scanStatusText,
        storageGranted,
        grantedFolderName,
        canRescanFolder: Boolean(savedFolderHandle),
        isOnline,
        downloadingIds,
        downloadProgressMap,
        activeDownloads,
        supportsDirectoryPicker,
        grantPermissionAndScanDirectory,
        rescanSavedFolder,
        importAudioFiles,
        saveOnlineTrack,
        downloadFromDirectUrl,
        exportTrackToDevice,
        searchOtherSources,
        isTrackSavedOffline,
        deleteOfflineTrack,
        clearAllOfflineTracks,
        createOfflinePlaylist,
        renameOfflinePlaylist,
        deleteOfflinePlaylist,
        addTrackToOfflinePlaylist,
        removeTrackFromOfflinePlaylist,
        batchDownloadState,
        isBatchDownloading: Boolean(batchDownloadState),
        batchDownloadTracks,
        cancelBatchDownload,
        importOfflinePlaylistsBackup,
      }}
    >
      {children}
    </OfflineMusicContext.Provider>
  );
}

export function useOfflineMusic(): OfflineMusicContextValue {
  const ctx = useContext(OfflineMusicContext);
  if (!ctx) throw new Error('useOfflineMusic must be used within OfflineMusicProvider');
  return ctx;
}
