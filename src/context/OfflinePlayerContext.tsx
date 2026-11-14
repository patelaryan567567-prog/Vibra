import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { OfflineTrack, RepeatMode } from '../types/music';
import {
  acquirePlaybackWakeLock,
  getSilentLoopBlobUrl,
  releasePlaybackWakeLock,
  startWebAudioKeepAlive,
  stopWebAudioKeepAlive,
} from '../utils/backgroundAudio';
import { getOfflineTrackBlob } from '../utils/offlineMusicDb';
import { useLibrary } from './LibraryContext';

interface OfflinePlayerContextValue {
  currentTrack: OfflineTrack | null;
  queue: OfflineTrack[];
  currentIndex: number;
  isPlaying: boolean;
  isBuffering: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  repeatMode: RepeatMode;
  isShuffle: boolean;
  isExpanded: boolean;
  mobilePlayerView: 'player' | 'queue';
  isQueueOpen: boolean;
  isBackgroundPlay: boolean;
  playerError: string | null;
  playOfflineTrack: (track: OfflineTrack, newQueue?: OfflineTrack[]) => void;
  addToOfflineQueue: (track: OfflineTrack) => void;
  playNextInOfflineQueue: (track: OfflineTrack) => void;
  removeFromOfflineQueue: (index: number) => void;
  moveOfflineQueueItem: (fromIndex: number, toIndex: number) => void;
  shuffleUpcomingOfflineQueue: () => void;
  clearOfflineQueue: () => void;
  togglePlay: () => void;
  nextTrack: () => void;
  prevTrack: () => void;
  seekTo: (seconds: number) => void;
  setVolume: (vol: number) => void;
  toggleMute: () => void;
  cycleRepeat: () => void;
  toggleShuffle: () => void;
  toggleBackgroundPlay: () => void;
  setIsExpanded: (val: boolean) => void;
  setMobilePlayerView: (view: 'player' | 'queue') => void;
  setIsQueueOpen: (val: boolean) => void;
  jumpToOfflineQueueIndex: (index: number) => void;
}

const OfflinePlayerContext = createContext<OfflinePlayerContextValue | null>(null);

const offlineBlobUrlCache = new Map<string, string>();
const inFlightOfflineLoads = new Map<string, Promise<string | null>>();

async function ensureOfflineBlobUrl(track: OfflineTrack, activeTrackId?: string): Promise<string | null> {
  const cached = offlineBlobUrlCache.get(track.id);
  if (cached) return cached;

  const existing = inFlightOfflineLoads.get(track.id);
  if (existing) return existing;

  const job = (async (): Promise<string | null> => {
    try {
      const blob = await getOfflineTrackBlob(track.id);
      if (!blob || blob.size < 1024) return null;
      const typedBlob = blob.type.startsWith('audio/')
        ? blob
        : new Blob([blob], { type: track.mimeType || 'audio/mpeg' });
      const url = URL.createObjectURL(typedBlob);

      if (offlineBlobUrlCache.size >= 30) {
        const oldestKey = offlineBlobUrlCache.keys().next().value;
        if (oldestKey !== undefined && oldestKey !== track.id && oldestKey !== activeTrackId) {
          const oldUrl = offlineBlobUrlCache.get(oldestKey);
          offlineBlobUrlCache.delete(oldestKey);
          if (oldUrl) {
            try {
              URL.revokeObjectURL(oldUrl);
            } catch {
              // ignore
            }
          }
        }
      }
      offlineBlobUrlCache.set(track.id, url);
      return url;
    } catch {
      return null;
    } finally {
      inFlightOfflineLoads.delete(track.id);
    }
  })();

  inFlightOfflineLoads.set(track.id, job);
  return job;
}

export function OfflinePlayerProvider({ children }: { children: React.ReactNode }) {
  const { showToast } = useLibrary();

  const [queue, setQueue] = useState<OfflineTrack[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState<number>(() => {
    const saved = localStorage.getItem('vibra_offline_volume') || localStorage.getItem('vibra_volume');
    return saved ? Number(saved) : 85;
  });
  const [isMuted, setIsMuted] = useState(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('all');
  const [isShuffle, setIsShuffle] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [mobilePlayerView, setMobilePlayerView] = useState<'player' | 'queue'>('player');
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [isBackgroundPlay, setIsBackgroundPlay] = useState<boolean>(() => {
    const saved = localStorage.getItem('vibra_bg_play');
    return saved === null ? true : saved === 'true';
  });
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [isYieldedToOnline, setIsYieldedToOnline] = useState(false);

  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const audioUnlockedRef = useRef(false);
  const isSilentWarmupRef = useRef(false);
  const pendingSeekSecRef = useRef<number>(0);
  const loadedTrackIdRef = useRef<string | null>(null);
  const loadedAudioTrackIdRef = useRef<string | null>(null);
  const shouldPlayRef = useRef(false);
  const userPausedRef = useRef(false);
  const hiddenAtRef = useRef(0);
  const endedHandledForLoadRef = useRef<string | null>(null);
  const errorSkipStreakRef = useRef(0);
  const shuffleHistoryRef = useRef<Set<string>>(new Set());
  const lastMediaPosSyncRef = useRef<number>(0);
  const isYieldedToOnlineRef = useRef(false);

  const queueRef = useRef(queue);
  const currentIndexRef = useRef(currentIndex);
  const currentTimeRef = useRef(currentTime);
  const repeatModeRef = useRef(repeatMode);
  const isShuffleRef = useRef(isShuffle);
  const isBackgroundPlayRef = useRef(isBackgroundPlay);
  const volumeRef = useRef(volume);
  const isMutedRef = useRef(isMuted);

  queueRef.current = queue;
  currentIndexRef.current = currentIndex;
  currentTimeRef.current = currentTime;
  repeatModeRef.current = repeatMode;
  isShuffleRef.current = isShuffle;
  isBackgroundPlayRef.current = isBackgroundPlay;
  volumeRef.current = volume;
  isMutedRef.current = isMuted;

  const currentTrack = currentIndex >= 0 && currentIndex < queue.length ? queue[currentIndex] : null;

  const applyPendingSeek = useCallback((a: HTMLAudioElement) => {
    const targetSec = pendingSeekSecRef.current;
    if (targetSec <= 0.5) return;
    if (isSilentWarmupRef.current || !a.src || a.src.startsWith('data:')) return;
    if (Number.isFinite(a.duration) && a.duration > 3) {
      const clamped = Math.min(targetSec, Math.max(0, a.duration - 0.5));
      try {
        a.currentTime = clamped;
        currentTimeRef.current = clamped;
        setCurrentTime(clamped);
        if (Math.abs(a.currentTime - clamped) < 1.5) {
          pendingSeekSecRef.current = 0;
        }
      } catch {
        // wait
      }
    }
  }, []);

  const stopAudio = useCallback(() => {
    isSilentWarmupRef.current = false;
    const audio = audioElRef.current;
    if (audio) {
      try {
        audio.loop = false;
        audio.pause();
      } catch {
        // ignore
      }
    }
    loadedAudioTrackIdRef.current = null;
  }, []);

  const beginOfflineTrackAudio = useCallback(
    (track: OfflineTrack, resumeSec = 0) => {
      const audio = audioElRef.current;
      if (!audio) return;

      loadedAudioTrackIdRef.current = track.id;
      pendingSeekSecRef.current = resumeSec > 0.5 ? resumeSec : 0;
      if (resumeSec > 0.5) {
        currentTimeRef.current = resumeSec;
        setCurrentTime(resumeSec);
      }

      audio.muted = isMutedRef.current;
      audio.volume = isMutedRef.current ? 0 : volumeRef.current / 100;

      const cachedUrl = offlineBlobUrlCache.get(track.id);
      if (cachedUrl) {
        isSilentWarmupRef.current = false;
        audio.loop = false;
        if (audio.src !== cachedUrl) {
          audio.src = cachedUrl;
        }
        if (audio.readyState >= 1 && pendingSeekSecRef.current > 0.5) {
          applyPendingSeek(audio);
        }
        setIsBuffering(false);
        if (shouldPlayRef.current && !userPausedRef.current) {
          const p = audio.play();
          if (p) {
            void p
              .then(() => {
                audioUnlockedRef.current = true;
                if (pendingSeekSecRef.current > 0.5) {
                  applyPendingSeek(audio);
                }
              })
              .catch((err) => {
                if (err instanceof Error && err.name === 'NotAllowedError') {
                  setIsPlaying(false);
                }
              });
          }
        }
        return;
      }

      if (!document.hidden) {
        isSilentWarmupRef.current = true;
        const silentUrl = getSilentLoopBlobUrl();
        audio.loop = true;
        if (audio.src !== silentUrl) {
          audio.src = silentUrl;
        }
        setIsBuffering(true);
        if (shouldPlayRef.current && !userPausedRef.current) {
          try {
            const wp = audio.play();
            if (wp) {
              void wp
                .then(() => {
                  audioUnlockedRef.current = true;
                })
                .catch(() => {});
            }
          } catch {
            // ignore
          }
        }
      } else {
        setIsBuffering(true);
      }

      void ensureOfflineBlobUrl(track, track.id).then((blobUrl) => {
        if (loadedAudioTrackIdRef.current !== track.id) return;

        if (!blobUrl) {
          isSilentWarmupRef.current = false;
          stopAudio();
          setIsBuffering(false);
          const q = queueRef.current;
          if (q.length > 1 && errorSkipStreakRef.current < 10) {
            errorSkipStreakRef.current += 1;
            const nextIdx = (currentIndexRef.current + 1) % q.length;
            setCurrentIndex(nextIdx);
          } else {
            setIsPlaying(false);
            setPlayerError('Offline audio file could not be loaded from local storage.');
          }
          return;
        }

        isSilentWarmupRef.current = false;
        audio.loop = false;
        audio.muted = isMutedRef.current;
        audio.volume = isMutedRef.current ? 0 : volumeRef.current / 100;
        if (audio.src !== blobUrl) {
          audio.src = blobUrl;
        }

        if (shouldPlayRef.current && !userPausedRef.current) {
          const p = audio.play();
          if (p) {
            void p
              .then(() => {
                audioUnlockedRef.current = true;
                if (pendingSeekSecRef.current > 0.5) {
                  applyPendingSeek(audio);
                }
              })
              .catch((err) => {
                if (err instanceof Error && err.name === 'NotAllowedError') {
                  setIsBuffering(false);
                  setIsPlaying(false);
                }
              });
          }
        } else {
          setIsBuffering(false);
        }
      });
    },
    [applyPendingSeek, stopAudio]
  );

  const pickNextShuffleIndex = useCallback((q: OfflineTrack[], currentIdx: number): number => {
    if (q.length <= 1) return currentIdx;
    const unplayed: number[] = [];
    for (let i = 0; i < q.length; i++) {
      if (i !== currentIdx && !shuffleHistoryRef.current.has(q[i].id)) {
        unplayed.push(i);
      }
    }
    if (unplayed.length === 0) {
      shuffleHistoryRef.current.clear();
      if (q[currentIdx]) shuffleHistoryRef.current.add(q[currentIdx].id);
      for (let i = 0; i < q.length; i++) {
        if (i !== currentIdx) unplayed.push(i);
      }
    }
    const chosen = unplayed[Math.floor(Math.random() * unplayed.length)];
    if (q[chosen]) shuffleHistoryRef.current.add(q[chosen].id);
    return chosen;
  }, []);

  const handleTrackEnd = useCallback(() => {
    const q = queueRef.current;
    const idx = currentIndexRef.current;
    const rep = repeatModeRef.current;
    const shuf = isShuffleRef.current;

    if (q.length === 0) return;

    const activeLoadKey = `${idx}:${q[idx]?.id ?? ''}`;
    if (rep !== 'one' && endedHandledForLoadRef.current === activeLoadKey) {
      return;
    }
    endedHandledForLoadRef.current = activeLoadKey;

    if (rep === 'one') {
      shouldPlayRef.current = true;
      userPausedRef.current = false;
      if (audioElRef.current) {
        audioElRef.current.currentTime = 0;
        void audioElRef.current.play().catch(() => {});
      }
      return;
    }

    shouldPlayRef.current = true;
    userPausedRef.current = false;

    if (shuf && q.length > 1) {
      const nextIdx = pickNextShuffleIndex(q, idx);
      if (q[nextIdx]) {
        beginOfflineTrackAudio(q[nextIdx], 0);
      }
      setCurrentIndex(nextIdx);
      return;
    }

    if (idx + 1 < q.length) {
      const nextItem = q[idx + 1];
      if (nextItem) {
        beginOfflineTrackAudio(nextItem, 0);
      }
      setCurrentIndex(idx + 1);
    } else if (rep === 'all') {
      if (q[0]) {
        beginOfflineTrackAudio(q[0], 0);
      }
      setCurrentIndex(0);
    } else {
      shouldPlayRef.current = false;
      setIsPlaying(false);
      stopWebAudioKeepAlive();
      void releasePlaybackWakeLock();
    }
  }, [beginOfflineTrackAudio, pickNextShuffleIndex]);

  // Sync & pre-warm next 5 upcoming tracks from IndexedDB into Object URLs so 20+ offline songs transition gaplessly in background
  useEffect(() => {
    if (!currentTrack) {
      loadedTrackIdRef.current = null;
      shouldPlayRef.current = false;
      stopAudio();
      stopWebAudioKeepAlive();
      void releasePlaybackWakeLock();
      return;
    }

    if (isYieldedToOnlineRef.current) {
      return;
    }

    if (loadedTrackIdRef.current === currentTrack.id) {
      return;
    }

    loadedTrackIdRef.current = currentTrack.id;
    endedHandledForLoadRef.current = null;
    pendingSeekSecRef.current = 0;
    currentTimeRef.current = 0;
    shouldPlayRef.current = true;
    userPausedRef.current = false;
    shuffleHistoryRef.current.add(currentTrack.id);
    setCurrentTime(0);
    setDuration(currentTrack.durationSeconds || 0);
    setPlayerError(null);

    if (isBackgroundPlayRef.current) {
      startWebAudioKeepAlive();
      void acquirePlaybackWakeLock();
    }

    let cancelled = false;
    const prewarmTimer = window.setTimeout(() => {
      void (async () => {
        const q = queueRef.current;
        const idx = currentIndexRef.current;
        for (const offset of [1, 2, 3, 4, 5]) {
          if (cancelled) break;
          const upcoming = q[idx + offset];
          if (upcoming && upcoming.id !== currentTrack.id) {
            await ensureOfflineBlobUrl(upcoming, currentTrack.id);
          }
        }
      })();
    }, 200);

    if (loadedAudioTrackIdRef.current !== currentTrack.id) {
      beginOfflineTrackAudio(currentTrack, 0);
    }

    return () => {
      cancelled = true;
      window.clearTimeout(prewarmTimer);
    };
  }, [currentTrack, beginOfflineTrackAudio, stopAudio]);

  // Background visibility continuity
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden && !isYieldedToOnlineRef.current) {
        hiddenAtRef.current = Date.now();
        if (isBackgroundPlayRef.current && shouldPlayRef.current && !userPausedRef.current) {
          for (const waitMs of [50, 220, 600]) {
            window.setTimeout(() => {
              const a = audioElRef.current;
              if (
                !isYieldedToOnlineRef.current &&
                a &&
                a.paused &&
                !a.ended &&
                shouldPlayRef.current &&
                !userPausedRef.current
              ) {
                void a.play().catch(() => {});
              }
            }, waitMs);
          }
        }
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  // Mutual exclusion with online PlayerContext
  useEffect(() => {
    const handlePauseFromOnline = () => {
      isYieldedToOnlineRef.current = true;
      setIsYieldedToOnline(true);
      setIsExpanded(false);
      setIsQueueOpen(false);
      userPausedRef.current = true;
      shouldPlayRef.current = false;
      stopWebAudioKeepAlive();
      void releasePlaybackWakeLock();
      if (audioElRef.current && !audioElRef.current.paused) {
        try {
          audioElRef.current.pause();
        } catch {
          // ignore
        }
      }
      setIsPlaying(false);
    };

    window.addEventListener('vibra:pause-offline-player', handlePauseFromOnline);
    return () => {
      window.removeEventListener('vibra:pause-offline-player', handlePauseFromOnline);
    };
  }, []);

  const playOfflineTrack = useCallback(
    (track: OfflineTrack, newQueue?: OfflineTrack[]) => {
      window.dispatchEvent(new CustomEvent('vibra:pause-online-player'));
      isYieldedToOnlineRef.current = false;
      setIsYieldedToOnline(false);
      errorSkipStreakRef.current = 0;
      shouldPlayRef.current = true;
      userPausedRef.current = false;
      if (isBackgroundPlayRef.current) {
        startWebAudioKeepAlive();
        void acquirePlaybackWakeLock();
      }

      beginOfflineTrackAudio(track, 0);

      if (newQueue && newQueue.length > 0) {
        const idx = newQueue.findIndex((t) => t.id === track.id);
        if (idx >= 0) {
          setQueue(newQueue);
          setCurrentIndex(idx);
        } else {
          setQueue([track, ...newQueue]);
          setCurrentIndex(0);
        }
      } else {
        setQueue((prev) => {
          const existingIdx = prev.findIndex((t) => t.id === track.id);
          if (existingIdx >= 0) {
            setCurrentIndex(existingIdx);
            return prev;
          }
          const nextQueue = [...prev, track];
          setCurrentIndex(nextQueue.length - 1);
          return nextQueue;
        });
      }
    },
    [beginOfflineTrackAudio]
  );

  const addToOfflineQueue = useCallback(
    (track: OfflineTrack) => {
      setQueue((prev) => {
        if (prev.length === 0) {
          setCurrentIndex(0);
          return [track];
        }
        if (prev.some((t) => t.id === track.id)) {
          showToast(`"${track.title}" is already in offline queue`);
          return prev;
        }
        showToast(`Added "${track.title}" to offline queue`);
        return [...prev, track];
      });
    },
    [showToast]
  );

  const playNextInOfflineQueue = useCallback(
    (track: OfflineTrack) => {
      setQueue((prev) => {
        if (prev.length === 0 || currentIndexRef.current < 0) {
          setCurrentIndex(0);
          return [track];
        }
        const filtered = prev.filter((t) => t.id !== track.id);
        const curId = prev[currentIndexRef.current]?.id;
        const newCurIdx = filtered.findIndex((t) => t.id === curId);
        const insertAt = newCurIdx >= 0 ? newCurIdx + 1 : 0;
        filtered.splice(insertAt, 0, track);
        if (newCurIdx >= 0) setCurrentIndex(newCurIdx);
        showToast(`Playing "${track.title}" next`);
        return filtered;
      });
    },
    [showToast]
  );

  const removeFromOfflineQueue = useCallback(
    (index: number) => {
      setQueue((prev) => {
        if (index < 0 || index >= prev.length) return prev;
        const next = prev.filter((_, i) => i !== index);
        if (next.length === 0) {
          shouldPlayRef.current = false;
          userPausedRef.current = true;
          stopAudio();
          stopWebAudioKeepAlive();
          void releasePlaybackWakeLock();
          setCurrentIndex(-1);
          setIsPlaying(false);
        } else if (index < currentIndexRef.current) {
          setCurrentIndex(currentIndexRef.current - 1);
        } else if (index === currentIndexRef.current) {
          const clamped = Math.min(index, next.length - 1);
          setCurrentIndex(clamped);
        }
        return next;
      });
    },
    [stopAudio]
  );

  const moveOfflineQueueItem = useCallback((fromIndex: number, toIndex: number) => {
    setQueue((prev) => {
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= prev.length ||
        toIndex >= prev.length ||
        fromIndex === toIndex
      ) {
        return prev;
      }
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);

      const cur = currentIndexRef.current;
      if (cur === fromIndex) setCurrentIndex(toIndex);
      else if (fromIndex < cur && toIndex >= cur) setCurrentIndex(cur - 1);
      else if (fromIndex > cur && toIndex <= cur) setCurrentIndex(cur + 1);
      return next;
    });
  }, []);

  const shuffleUpcomingOfflineQueue = useCallback(() => {
    const q = queueRef.current;
    const cur = currentIndexRef.current;
    if (q.length - (cur + 1) < 2) {
      showToast('Add at least 2 upcoming songs to shuffle');
      return;
    }
    const prefix = cur >= 0 ? q.slice(0, cur + 1) : [];
    const upcoming = cur >= 0 ? [...q.slice(cur + 1)] : [...q];
    for (let i = upcoming.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [upcoming[i], upcoming[j]] = [upcoming[j], upcoming[i]];
    }
    setQueue([...prefix, ...upcoming]);
    showToast('Shuffled upcoming offline queue');
  }, [showToast]);

  const clearOfflineQueue = useCallback(() => {
    const cur = currentIndexRef.current >= 0 ? queueRef.current[currentIndexRef.current] : null;
    if (cur) {
      setQueue([cur]);
      setCurrentIndex(0);
      showToast('Cleared upcoming offline queue');
    } else {
      setQueue([]);
      setCurrentIndex(-1);
    }
  }, [showToast]);

  const togglePlay = useCallback(() => {
    if (!currentTrack || !audioElRef.current) return;
    const audio = audioElRef.current;
    if (!audio.paused) {
      userPausedRef.current = true;
      shouldPlayRef.current = false;
      stopWebAudioKeepAlive();
      void releasePlaybackWakeLock();
      audio.pause();
    } else {
      window.dispatchEvent(new CustomEvent('vibra:pause-online-player'));
      isYieldedToOnlineRef.current = false;
      setIsYieldedToOnline(false);
      userPausedRef.current = false;
      shouldPlayRef.current = true;
      if (isBackgroundPlayRef.current) {
        startWebAudioKeepAlive();
        void acquirePlaybackWakeLock();
      }
      if (!audio.getAttribute('src') || audio.src.startsWith('data:')) {
        beginOfflineTrackAudio(currentTrack, currentTime);
      } else {
        void audio.play().catch(() => {});
      }
    }
  }, [beginOfflineTrackAudio, currentTime, currentTrack]);

  const nextTrack = useCallback(() => {
    const q = queueRef.current;
    const idx = currentIndexRef.current;
    if (q.length === 0) return;
    window.dispatchEvent(new CustomEvent('vibra:pause-online-player'));
    isYieldedToOnlineRef.current = false;
    setIsYieldedToOnline(false);
    shouldPlayRef.current = true;
    userPausedRef.current = false;
    if (isBackgroundPlayRef.current) {
      startWebAudioKeepAlive();
      void acquirePlaybackWakeLock();
    }
    if (isShuffleRef.current && q.length > 1) {
      const nextIdx = pickNextShuffleIndex(q, idx);
      if (q[nextIdx]) beginOfflineTrackAudio(q[nextIdx], 0);
      setCurrentIndex(nextIdx);
      return;
    }
    const targetIdx = idx + 1 < q.length ? idx + 1 : 0;
    if (q[targetIdx]) beginOfflineTrackAudio(q[targetIdx], 0);
    setCurrentIndex(targetIdx);
  }, [beginOfflineTrackAudio, pickNextShuffleIndex]);

  const prevTrack = useCallback(() => {
    const q = queueRef.current;
    const idx = currentIndexRef.current;
    if (q.length === 0) return;
    window.dispatchEvent(new CustomEvent('vibra:pause-online-player'));
    isYieldedToOnlineRef.current = false;
    setIsYieldedToOnline(false);
    shouldPlayRef.current = true;
    userPausedRef.current = false;
    if (isBackgroundPlayRef.current) {
      startWebAudioKeepAlive();
      void acquirePlaybackWakeLock();
    }
    if (currentTime > 4 && audioElRef.current && !isSilentWarmupRef.current) {
      audioElRef.current.currentTime = 0;
      setCurrentTime(0);
      return;
    }
    const targetIdx = idx - 1 >= 0 ? idx - 1 : q.length - 1;
    if (q[targetIdx]) beginOfflineTrackAudio(q[targetIdx], 0);
    setCurrentIndex(targetIdx);
  }, [beginOfflineTrackAudio, currentTime]);

  const seekTo = useCallback((seconds: number) => {
    currentTimeRef.current = seconds;
    setCurrentTime(seconds);
    const a = audioElRef.current;
    if (!a) return;
    if (isSilentWarmupRef.current || !Number.isFinite(a.duration) || a.duration <= 3) {
      pendingSeekSecRef.current = seconds;
    } else {
      pendingSeekSecRef.current = 0;
      a.currentTime = seconds;
    }
  }, []);

  const setVolume = useCallback(
    (vol: number) => {
      const clamped = Math.max(0, Math.min(100, vol));
      setVolumeState(clamped);
      localStorage.setItem('vibra_offline_volume', String(clamped));
      if (audioElRef.current) {
        audioElRef.current.volume = clamped / 100;
        if (clamped > 0) audioElRef.current.muted = false;
      }
      if (clamped > 0 && isMuted) {
        setIsMuted(false);
      }
    },
    [isMuted]
  );

  const toggleMute = useCallback(() => {
    if (isMuted) {
      if (audioElRef.current) {
        audioElRef.current.muted = false;
        audioElRef.current.volume = volumeRef.current / 100;
      }
      setIsMuted(false);
    } else {
      if (audioElRef.current) {
        audioElRef.current.muted = true;
      }
      setIsMuted(true);
    }
  }, [isMuted]);

  const cycleRepeat = useCallback(() => {
    setRepeatMode((prev) => (prev === 'off' ? 'all' : prev === 'all' ? 'one' : 'off'));
  }, []);

  const toggleShuffle = useCallback(() => {
    setIsShuffle((prev) => !prev);
  }, []);

  const toggleBackgroundPlay = useCallback(() => {
    setIsBackgroundPlay((prev) => {
      const next = !prev;
      localStorage.setItem('vibra_bg_play', String(next));
      if (next && isPlaying) {
        startWebAudioKeepAlive();
        void acquirePlaybackWakeLock();
      } else if (!next) {
        stopWebAudioKeepAlive();
        void releasePlaybackWakeLock();
      }
      showToast(next ? 'Background continuity enabled for My Music' : 'Background continuity paused');
      return next;
    });
  }, [isPlaying, showToast]);

  const jumpToOfflineQueueIndex = useCallback(
    (index: number) => {
      if (index >= 0 && index < queueRef.current.length) {
        window.dispatchEvent(new CustomEvent('vibra:pause-online-player'));
        isYieldedToOnlineRef.current = false;
        setIsYieldedToOnline(false);
        shouldPlayRef.current = true;
        userPausedRef.current = false;
        if (isBackgroundPlayRef.current) {
          startWebAudioKeepAlive();
          void acquirePlaybackWakeLock();
        }
        const target = queueRef.current[index];
        if (target) beginOfflineTrackAudio(target, 0);
        setCurrentIndex(index);
      }
    },
    [beginOfflineTrackAudio]
  );

  const nextTrackRef = useRef(nextTrack);
  const prevTrackRef = useRef(prevTrack);
  nextTrackRef.current = nextTrack;
  prevTrackRef.current = prevTrack;

  // Document title sync when Offline Player is active
  useEffect(() => {
    if (isYieldedToOnline || !currentTrack) return;
    document.title = `${isPlaying ? '▶ ' : ''}${currentTrack.title} · ${currentTrack.artist} — VIBRA Offline`;
  }, [currentTrack, isPlaying, isYieldedToOnline]);

  // OS Lock-screen / Notification Shade MediaSession for Offline Player
  useEffect(() => {
    if (isYieldedToOnline || !currentTrack) return;
    if (!('mediaSession' in navigator)) return;
    try {
      const artSrc = currentTrack.artworkDataUrl || '/pwa-512x512.png';
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.title,
        artist: currentTrack.artist,
        album: currentTrack.album || 'My Music · Offline',
        artwork: [
          { src: artSrc, sizes: '512x512', type: 'image/png' },
        ],
      });
      navigator.mediaSession.playbackState =
        isPlaying || (shouldPlayRef.current && !userPausedRef.current && isBackgroundPlay)
          ? 'playing'
          : 'paused';

      navigator.mediaSession.setActionHandler('play', () => {
        userPausedRef.current = false;
        shouldPlayRef.current = true;
        if (isBackgroundPlayRef.current) void acquirePlaybackWakeLock();
        if (audioElRef.current) {
          void audioElRef.current.play().catch(() => {});
        }
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        userPausedRef.current = true;
        shouldPlayRef.current = false;
        void releasePlaybackWakeLock();
        audioElRef.current?.pause();
      });
      navigator.mediaSession.setActionHandler('previoustrack', () => prevTrackRef.current());
      navigator.mediaSession.setActionHandler('nexttrack', () => nextTrackRef.current());
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (typeof details.seekTime === 'number') {
          seekTo(details.seekTime);
        }
      });
      navigator.mediaSession.setActionHandler('seekbackward', (details) => {
        const offset = details.seekOffset || 10;
        const cur = audioElRef.current?.currentTime ?? 0;
        seekTo(Math.max(0, cur - offset));
      });
      navigator.mediaSession.setActionHandler('seekforward', (details) => {
        const offset = details.seekOffset || 10;
        const cur = audioElRef.current?.currentTime ?? 0;
        const dur = audioElRef.current?.duration ?? 0;
        seekTo(dur > 0 ? Math.min(dur, cur + offset) : cur + offset);
      });
    } catch {
      // ignore unsupported MediaSession
    }
  }, [currentTrack, isPlaying, isBackgroundPlay, isYieldedToOnline, seekTo]);

  return (
    <OfflinePlayerContext.Provider
      value={{
        currentTrack: isYieldedToOnline ? null : currentTrack,
        queue,
        currentIndex,
        isPlaying,
        isBuffering,
        currentTime,
        duration,
        volume,
        isMuted,
        repeatMode,
        isShuffle,
        isExpanded,
        mobilePlayerView,
        isQueueOpen,
        isBackgroundPlay,
        playerError,
        playOfflineTrack,
        addToOfflineQueue,
        playNextInOfflineQueue,
        removeFromOfflineQueue,
        moveOfflineQueueItem,
        shuffleUpcomingOfflineQueue,
        clearOfflineQueue,
        togglePlay,
        nextTrack,
        prevTrack,
        seekTo,
        setVolume,
        toggleMute,
        cycleRepeat,
        toggleShuffle,
        toggleBackgroundPlay,
        setIsExpanded,
        setMobilePlayerView,
        setIsQueueOpen,
        jumpToOfflineQueueIndex,
      }}
    >
      <audio
        ref={audioElRef}
        preload="auto"
        playsInline
        className="hidden"
        onPlaying={() => {
          if (isSilentWarmupRef.current) return;
          const a = audioElRef.current;
          if (a && pendingSeekSecRef.current > 0.5) {
            applyPendingSeek(a);
          }
          errorSkipStreakRef.current = 0;
          setIsPlaying(true);
          setIsBuffering(false);
          setPlayerError(null);
          if (isBackgroundPlayRef.current) {
            void acquirePlaybackWakeLock();
          }
        }}
        onPause={() => {
          if (isSilentWarmupRef.current) return;
          const a = audioElRef.current;
          if (!a || a.src.startsWith('data:')) return;
          if (!a.ended) {
            const recentlyHidden =
              document.hidden || Date.now() - hiddenAtRef.current < 8000;
            if (
              !isYieldedToOnlineRef.current &&
              isBackgroundPlayRef.current &&
              shouldPlayRef.current &&
              !userPausedRef.current &&
              recentlyHidden
            ) {
              for (const retryMs of [40, 180, 450, 950]) {
                window.setTimeout(() => {
                  if (
                    !isYieldedToOnlineRef.current &&
                    shouldPlayRef.current &&
                    !userPausedRef.current &&
                    a.paused &&
                    !a.ended
                  ) {
                    void a.play().catch(() => {});
                  }
                }, retryMs);
              }
              window.setTimeout(() => {
                if (
                  a.paused &&
                  !a.ended &&
                  (!shouldPlayRef.current || userPausedRef.current || isYieldedToOnlineRef.current)
                ) {
                  setIsPlaying(false);
                  setIsBuffering(false);
                }
              }, 1250);
              return;
            }
            setIsPlaying(false);
            setIsBuffering(false);
          }
        }}
        onLoadedMetadata={(e) => {
          if (isSilentWarmupRef.current) return;
          const a = e.currentTarget;
          if (a.src.startsWith('data:')) return;
          if (pendingSeekSecRef.current > 0.5) {
            applyPendingSeek(a);
          }
        }}
        onCanPlay={() => {
          if (isSilentWarmupRef.current) return;
          const a = audioElRef.current;
          if (!a || a.src.startsWith('data:')) return;
          if (pendingSeekSecRef.current > 0.5) {
            applyPendingSeek(a);
          }
          setIsBuffering(false);
        }}
        onDurationChange={(e) => {
          if (isSilentWarmupRef.current) return;
          const a = e.currentTarget;
          const dur = a.duration;
          if (Number.isFinite(dur) && dur > 3) {
            setDuration(dur);
            if (pendingSeekSecRef.current > 0.5) {
              applyPendingSeek(a);
            }
          }
        }}
        onTimeUpdate={(e) => {
          if (isSilentWarmupRef.current) return;
          const a = e.currentTarget;
          if (a.src.startsWith('data:')) return;
          if (pendingSeekSecRef.current > 0.5) {
            applyPendingSeek(a);
            if (pendingSeekSecRef.current > 0.5) return;
          }
          const cur = a.currentTime;
          const dur = Number.isFinite(a.duration) && a.duration > 3 ? a.duration : currentTrack?.durationSeconds || 0;
          if (Number.isFinite(cur)) {
            currentTimeRef.current = cur;
            setCurrentTime(cur);
          }

          const now = Date.now();
          if (
            !isYieldedToOnlineRef.current &&
            now - lastMediaPosSyncRef.current > 2000 &&
            'mediaSession' in navigator &&
            typeof navigator.mediaSession.setPositionState === 'function' &&
            dur > 0 &&
            cur >= 0 &&
            cur <= dur
          ) {
            lastMediaPosSyncRef.current = now;
            try {
              navigator.mediaSession.setPositionState({
                duration: dur,
                playbackRate: 1,
                position: cur,
              });
            } catch {
              // ignore
            }
          }
        }}
        onEnded={() => {
          if (isSilentWarmupRef.current) return;
          const a = audioElRef.current;
          if (a?.src?.startsWith('data:') || a?.loop) return;
          setIsBuffering(false);
          handleTrackEnd();
        }}
        onError={() => {
          if (isSilentWarmupRef.current) return;
          const a = audioElRef.current;
          if (!a || !a.getAttribute('src') || a.src.startsWith('data:')) return;
          stopAudio();
          const q = queueRef.current;
          if (q.length > 1 && errorSkipStreakRef.current < 10) {
            errorSkipStreakRef.current += 1;
            const nextIdx = (currentIndexRef.current + 1) % q.length;
            if (q[nextIdx]) {
              beginOfflineTrackAudio(q[nextIdx], 0);
            }
            setCurrentIndex(nextIdx);
          } else {
            setIsPlaying(false);
            setPlayerError('Could not play this audio file.');
          }
        }}
      />
      {children}
    </OfflinePlayerContext.Provider>
  );
}

export function useOfflinePlayer(): OfflinePlayerContextValue {
  const ctx = useContext(OfflinePlayerContext);
  if (!ctx) throw new Error('useOfflinePlayer must be used within OfflinePlayerProvider');
  return ctx;
}
