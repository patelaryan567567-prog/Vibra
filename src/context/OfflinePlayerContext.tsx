import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { OfflineTrack, RepeatMode } from '../types/music';
import {
  acquirePlaybackWakeLock,
  getSilentLoopBlobUrl,
  pauseKeepAliveBridgeIfForeground,
  pokeBackgroundKeepAlive,
  releasePlaybackWakeLock,
  startWebAudioKeepAlive,
  stopWebAudioKeepAlive,
} from '../utils/backgroundAudio';
import { formatSeconds, parseDurationLabel } from '../utils/format';
import { getAllOfflineTracks, getOfflineTrackBlob } from '../utils/offlineMusicDb';
import { useLibrary } from './LibraryContext';

interface OfflinePlayerTimeContextValue {
  currentTime: number;
  duration: number;
}

interface OfflinePlayerContextValue {
  currentTrack: OfflineTrack | null;
  queue: OfflineTrack[];
  currentIndex: number;
  isPlaying: boolean;
  isBuffering: boolean;
  volume: number;
  isMuted: boolean;
  repeatMode: RepeatMode;
  isShuffle: boolean;
  isExpanded: boolean;
  mobilePlayerView: 'player' | 'queue' | 'lyrics';
  isQueueOpen: boolean;
  isBackgroundPlay: boolean;
  playerError: string | null;
  playOfflineTrack: (track: OfflineTrack, newQueue?: OfflineTrack[], startAtSeconds?: number) => void;
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
  seekBy: (deltaSeconds: number) => void;
  setVolume: (vol: number) => void;
  toggleMute: () => void;
  cycleRepeat: () => void;
  toggleShuffle: () => void;
  toggleBackgroundPlay: () => void;
  setIsExpanded: (val: boolean) => void;
  setMobilePlayerView: (view: 'player' | 'queue' | 'lyrics') => void;
  setIsQueueOpen: (val: boolean) => void;
  jumpToOfflineQueueIndex: (index: number) => void;
}

const OfflinePlayerContext = createContext<OfflinePlayerContextValue | null>(null);
const OfflinePlayerTimeContext = createContext<OfflinePlayerTimeContextValue | null>(null);

const OFFLINE_SESSION_KEY = 'vibra_offline_session_v1';
const ACTIVE_PLAYER_KEY = 'vibra_active_player';

// Strictly cap in-RAM Blob URLs to at most 3 tracks (current + immediate next)
// so background RAM usage stays < 15 MB across 100+ songs and Mobile OS never OOM-kills the app!
const MAX_OFFLINE_BLOB_CACHE = 3;
const offlineBlobUrlCache = new Map<string, string>();
const inFlightOfflineLoads = new Map<string, Promise<string | null>>();

function pruneOfflineBlobCache(keepIds: Set<string>) {
  for (const [id, url] of offlineBlobUrlCache.entries()) {
    if (!keepIds.has(id) && offlineBlobUrlCache.size > 1) {
      offlineBlobUrlCache.delete(id);
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    }
  }
  while (offlineBlobUrlCache.size > MAX_OFFLINE_BLOB_CACHE) {
    const oldestKey = offlineBlobUrlCache.keys().next().value;
    if (oldestKey === undefined || keepIds.has(oldestKey)) break;
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

async function ensureOfflineBlobUrl(track: OfflineTrack, keepIds?: Set<string>): Promise<string | null> {
  const cached = offlineBlobUrlCache.get(track.id);
  if (cached) {
    offlineBlobUrlCache.delete(track.id);
    offlineBlobUrlCache.set(track.id, cached);
    return cached;
  }

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

      const protectedIds = keepIds ? new Set(keepIds) : new Set<string>();
      protectedIds.add(track.id);
      pruneOfflineBlobCache(protectedIds);

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
  const {
    showToast,
    recordOfflinePlayed,
    recordListeningSeconds,
    saveTrackPosition,
    clearTrackPosition,
    getTrackPosition,
  } = useLibrary();

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
  const [mobilePlayerView, setMobilePlayerView] = useState<'player' | 'queue' | 'lyrics'>('player');
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
  const pendingSeekMuteGuardRef = useRef(false);
  const pendingSeekSetAtRef = useRef(0);
  const loadedTrackIdRef = useRef<string | null>(null);
  const loadedAudioTrackIdRef = useRef<string | null>(null);
  const audioKickDoneForLoadRef = useRef<string | null>(null);
  const shouldPlayRef = useRef(false);
  const userPausedRef = useRef(false);
  const endedHandledForLoadRef = useRef<string | null>(null);
  const errorSkipStreakRef = useRef(0);
  const shuffleHistoryRef = useRef<Set<string>>(new Set());
  const nextShuffleCandidateRef = useRef<number>(-1);
  const lastMediaPosSyncRef = useRef<number>(0);
  const lastSessionSaveRef = useRef<number>(0);
  const lastPosSaveRef = useRef<number>(0);
  const isYieldedToOnlineRef = useRef(false);
  const sessionRestoredRef = useRef(false);
  const restoredPausedTrackIdRef = useRef<string | null>(null);

  const queueRef = useRef(queue);
  const currentIndexRef = useRef(currentIndex);
  const currentTimeRef = useRef(currentTime);
  const durationRef = useRef(duration);
  const repeatModeRef = useRef(repeatMode);
  const isShuffleRef = useRef(isShuffle);
  const isBackgroundPlayRef = useRef(isBackgroundPlay);
  const volumeRef = useRef(volume);
  const isMutedRef = useRef(isMuted);

  queueRef.current = queue;
  currentIndexRef.current = currentIndex;
  currentTimeRef.current = currentTime;
  durationRef.current = duration;
  repeatModeRef.current = repeatMode;
  isShuffleRef.current = isShuffle;
  isBackgroundPlayRef.current = isBackgroundPlay;
  volumeRef.current = volume;
  isMutedRef.current = isMuted;

  const currentTrack = currentIndex >= 0 && currentIndex < queue.length ? queue[currentIndex] : null;

  const persistCurrentTrackResume = useCallback(
    (overrideSec?: number) => {
      const curTrack = queueRef.current[currentIndexRef.current];
      if (!curTrack) return;
      if (pendingSeekSecRef.current > 0.5) {
        const safePending = Math.max(pendingSeekSecRef.current, currentTimeRef.current ?? 0);
        const dur = durationRef.current || curTrack.durationSeconds || 0;
        saveTrackPosition(curTrack.id, safePending, dur);
        if (curTrack.sourceVideoId) {
          saveTrackPosition(curTrack.sourceVideoId, safePending, dur);
        }
        return;
      }
      const sec = overrideSec ?? currentTimeRef.current ?? 0;
      const dur = durationRef.current || curTrack.durationSeconds || 0;
      saveTrackPosition(curTrack.id, sec, dur);
      if (curTrack.sourceVideoId) {
        saveTrackPosition(curTrack.sourceVideoId, sec, dur);
      }
    },
    [saveTrackPosition]
  );

  const releaseSeekMuteGuard = useCallback((a?: HTMLAudioElement | null) => {
    pendingSeekMuteGuardRef.current = false;
    const targetEl = a ?? audioElRef.current;
    if (targetEl && !isSilentWarmupRef.current) {
      targetEl.muted = isMutedRef.current;
      targetEl.volume = isMutedRef.current ? 0 : volumeRef.current / 100;
    }
  }, []);

  const applyPendingSeek = useCallback(
    (a: HTMLAudioElement) => {
      const targetSec = pendingSeekSecRef.current;
      if (targetSec <= 0.5) {
        if (pendingSeekMuteGuardRef.current) releaseSeekMuteGuard(a);
        return;
      }
      if (isSilentWarmupRef.current || !a.src || a.src.startsWith('data:')) return;
      if (a.readyState < 1) return;

      const dur = Number.isFinite(a.duration) && a.duration > 3 ? a.duration : 0;
      if (dur <= 3) return;

      const clamped = Math.min(targetSec, Math.max(0, dur - 0.5));
      if (Math.abs((a.currentTime || 0) - clamped) <= 1.5) {
        pendingSeekSecRef.current = 0;
        pendingSeekSetAtRef.current = 0;
        currentTimeRef.current = a.currentTime;
        setCurrentTime(a.currentTime);
        releaseSeekMuteGuard(a);
        return;
      }

      if (a.seeking) return;

      try {
        a.currentTime = clamped;
        currentTimeRef.current = clamped;
        setCurrentTime(clamped);
        if (Math.abs((a.currentTime || 0) - clamped) <= 1.5) {
          pendingSeekSecRef.current = 0;
          pendingSeekSetAtRef.current = 0;
          releaseSeekMuteGuard(a);
        }
      } catch {
        // wait
      }
    },
    [releaseSeekMuteGuard]
  );

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
      audioKickDoneForLoadRef.current = null;
      const hasResumeSeek = resumeSec > 0.5;
      pendingSeekSecRef.current = hasResumeSeek ? resumeSec : 0;
      pendingSeekSetAtRef.current = hasResumeSeek ? Date.now() : 0;
      pendingSeekMuteGuardRef.current = hasResumeSeek;
      currentTimeRef.current = hasResumeSeek ? resumeSec : 0;
      setCurrentTime(hasResumeSeek ? resumeSec : 0);

      audio.muted = hasResumeSeek ? true : isMutedRef.current;
      audio.volume = isMutedRef.current ? 0 : volumeRef.current / 100;
      audio.playbackRate = 1;

      if (isBackgroundPlayRef.current && shouldPlayRef.current && !userPausedRef.current && document.hidden) {
        startWebAudioKeepAlive();
        pokeBackgroundKeepAlive();
      } else {
        pauseKeepAliveBridgeIfForeground();
      }

      const cachedUrl = offlineBlobUrlCache.get(track.id);
      if (cachedUrl) {
        isSilentWarmupRef.current = false;
        audio.loop = false;
        if (audio.src !== cachedUrl) {
          audio.pause();
          audio.src = cachedUrl;
          audio.load();
        } else if (!hasResumeSeek) {
          try {
            audio.currentTime = 0;
          } catch {
            // ignore
          }
        }
        if (audio.readyState >= 1 && pendingSeekSecRef.current > 0.5) {
          applyPendingSeek(audio);
        } else if (!hasResumeSeek) {
          releaseSeekMuteGuard(audio);
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
                } else {
                  releaseSeekMuteGuard(audio);
                }
              })
              .catch((err) => {
                if (err instanceof Error && err.name === 'NotAllowedError') {
                  shouldPlayRef.current = false;
                  userPausedRef.current = true;
                  releaseSeekMuteGuard(audio);
                  setIsBuffering(false);
                  setIsPlaying(false);
                }
              });
          }
        }
        return;
      }

      // Only run the silent WAV warmup on <audio> when tab is hidden/backgrounded
      // (avoids swapping audio.src twice in 10ms in foreground which can stall Chromium's decoder!)
      if (document.hidden) {
        isSilentWarmupRef.current = true;
        const silentUrl = getSilentLoopBlobUrl();
        audio.loop = true;
        if (audio.src !== silentUrl) {
          audio.src = silentUrl;
        }
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
        isSilentWarmupRef.current = false;
        audio.loop = false;
      }
      setIsBuffering(true);

      const keepSet = new Set<string>([track.id]);
      const q = queueRef.current;
      const idx = currentIndexRef.current;
      if (q[idx + 1]) keepSet.add(q[idx + 1].id);
      if (q[0]) keepSet.add(q[0].id);

      void ensureOfflineBlobUrl(track, keepSet).then((blobUrl) => {
        if (loadedAudioTrackIdRef.current !== track.id) return;

        if (!blobUrl) {
          isSilentWarmupRef.current = false;
          stopAudio();
          releaseSeekMuteGuard(audio);
          setIsBuffering(false);
          const curQ = queueRef.current;
          if (curQ.length > 1 && errorSkipStreakRef.current < 10) {
            errorSkipStreakRef.current += 1;
            const nextIdx = (currentIndexRef.current + 1) % curQ.length;
            if (curQ[nextIdx]) {
              beginOfflineTrackAudio(curQ[nextIdx], 0);
            }
            setCurrentIndex(nextIdx);
          } else {
            setIsPlaying(false);
            setPlayerError('Offline audio file could not be loaded from local storage.');
          }
          return;
        }

        isSilentWarmupRef.current = false;
        audio.pause();
        audio.loop = false;
        audio.muted = pendingSeekSecRef.current > 0.5 ? true : isMutedRef.current;
        audio.volume = isMutedRef.current ? 0 : volumeRef.current / 100;
        audio.playbackRate = 1;
        if (audio.src !== blobUrl) {
          audio.src = blobUrl;
          audio.load();
        } else if (pendingSeekSecRef.current <= 0.5) {
          try {
            audio.currentTime = 0;
          } catch {
            // ignore
          }
        }
        if (audio.readyState >= 1 && pendingSeekSecRef.current > 0.5) {
          applyPendingSeek(audio);
        }

        if (shouldPlayRef.current && !userPausedRef.current) {
          const p = audio.play();
          if (p) {
            void p
              .then(() => {
                audioUnlockedRef.current = true;
                if (pendingSeekSecRef.current > 0.5) {
                  applyPendingSeek(audio);
                } else {
                  releaseSeekMuteGuard(audio);
                }
              })
              .catch((err) => {
                if (err instanceof Error && err.name === 'NotAllowedError') {
                  shouldPlayRef.current = false;
                  userPausedRef.current = true;
                  releaseSeekMuteGuard(audio);
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
    [applyPendingSeek, releaseSeekMuteGuard, stopAudio]
  );

  const pickNextShuffleIndex = useCallback((q: OfflineTrack[], currentIdx: number): number => {
    if (q.length <= 1) return currentIdx;
    if (
      nextShuffleCandidateRef.current >= 0 &&
      nextShuffleCandidateRef.current < q.length &&
      nextShuffleCandidateRef.current !== currentIdx
    ) {
      const prePicked = nextShuffleCandidateRef.current;
      nextShuffleCandidateRef.current = -1;
      if (q[prePicked]) shuffleHistoryRef.current.add(q[prePicked].id);
      return prePicked;
    }
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

    const finishedTrack = q[idx];
    const activeLoadKey = `${idx}:${finishedTrack?.id ?? ''}`;
    if (rep !== 'one' && endedHandledForLoadRef.current === activeLoadKey) {
      return;
    }
    endedHandledForLoadRef.current = activeLoadKey;

    // Clear saved resume position for the track that just completed naturally
    if (finishedTrack) {
      clearTrackPosition(finishedTrack.id);
      if (finishedTrack.sourceVideoId) {
        clearTrackPosition(finishedTrack.sourceVideoId);
      }
    }

    shouldPlayRef.current = true;
    userPausedRef.current = false;

    if (isBackgroundPlayRef.current) {
      startWebAudioKeepAlive();
      pokeBackgroundKeepAlive();
    }

    if (rep === 'one') {
      if (audioElRef.current) {
        audioElRef.current.currentTime = 0;
        void audioElRef.current.play().catch(() => {});
      }
      return;
    }

    if (shuf && q.length > 1) {
      const nextIdx = pickNextShuffleIndex(q, idx);
      if (q[nextIdx]) {
        beginOfflineTrackAudio(q[nextIdx], 0);
      }
      setCurrentIndex(nextIdx);
      return;
    }

    const targetIdx = idx + 1 < q.length ? idx + 1 : 0;
    const nextItem = q[targetIdx];
    if (nextItem) {
      beginOfflineTrackAudio(nextItem, 0);
    }
    setCurrentIndex(targetIdx);
  }, [beginOfflineTrackAudio, clearTrackPosition, pickNextShuffleIndex]);

  // Restore saved offline session on initial mount if user was last listening to My Music
  useEffect(() => {
    if (sessionRestoredRef.current) return;
    sessionRestoredRef.current = true;

    try {
      const activePlayer = localStorage.getItem(ACTIVE_PLAYER_KEY);
      const raw = localStorage.getItem(OFFLINE_SESSION_KEY);
      if (!raw || activePlayer !== 'offline') return;
      const parsed = JSON.parse(raw) as {
        queueIds?: string[];
        currentIndex?: number;
        currentTime?: number;
        repeatMode?: RepeatMode;
        isShuffle?: boolean;
        wasPlaying?: boolean;
        savedAt?: number;
      };
      if (!parsed.queueIds || parsed.queueIds.length === 0) return;

      void getAllOfflineTracks()
        .then((allTracks) => {
          if (queueRef.current.length > 0 || isYieldedToOnlineRef.current) return;
          const byId = new Map(allTracks.map((t) => [t.id, t]));
          const restoredQueue = (parsed.queueIds || [])
            .map((id) => byId.get(id))
            .filter((t): t is OfflineTrack => Boolean(t));
          if (restoredQueue.length === 0) return;

          const restoredIdx = Math.max(
            0,
            Math.min(restoredQueue.length - 1, parsed.currentIndex ?? 0)
          );
          const restoredTrack = restoredQueue[restoredIdx];
          const savedPos =
            getTrackPosition(restoredTrack.id) ||
            (restoredTrack.sourceVideoId ? getTrackPosition(restoredTrack.sourceVideoId) : null);
          const sessionTime = typeof parsed.currentTime === 'number' && parsed.currentTime > 0 ? parsed.currentTime : 0;
          const sessionSavedAt = typeof parsed.savedAt === 'number' ? parsed.savedAt : 0;
          const posSavedAt = savedPos?.updatedAt ?? 0;
          const restoredTime = Math.max(
            0,
            posSavedAt > sessionSavedAt && savedPos
              ? savedPos.positionSeconds
              : sessionTime > 0
                ? sessionTime
                : (savedPos?.positionSeconds ?? 0)
          );

          if (parsed.repeatMode) setRepeatMode(parsed.repeatMode);
          if (typeof parsed.isShuffle === 'boolean') setIsShuffle(parsed.isShuffle);

          // Always restore the previous offline song in PAUSED state on app open so the user chooses when to resume
          restoredPausedTrackIdRef.current = restoredTrack.id;
          shouldPlayRef.current = false;
          userPausedRef.current = true;
          loadedTrackIdRef.current = restoredTrack.id;
          loadedAudioTrackIdRef.current = restoredTrack.id;
          pendingSeekSecRef.current = restoredTime;
          currentTimeRef.current = restoredTime;
          setIsPlaying(false);
          setIsBuffering(false);
          setCurrentTime(restoredTime);
          setDuration(restoredTrack.durationSeconds || 0);
          setQueue(restoredQueue);
          setCurrentIndex(restoredIdx);

          const keepSet = new Set<string>([restoredTrack.id]);
          const nextInQ = restoredQueue[(restoredIdx + 1) % restoredQueue.length];
          if (nextInQ) keepSet.add(nextInQ.id);
          void ensureOfflineBlobUrl(restoredTrack, keepSet).then((blobUrl) => {
            const audio = audioElRef.current;
            if (!audio || !blobUrl) return;
            if (loadedAudioTrackIdRef.current !== restoredTrack.id) return;
            audio.muted = isMutedRef.current;
            audio.volume = isMutedRef.current ? 0 : volumeRef.current / 100;
            if (!audio.getAttribute('src')) {
              audio.pause();
              audio.src = blobUrl;
              audio.load();
            }
          });
        })
        .catch(() => {});
    } catch {
      // ignore malformed storage
    }
  }, [getTrackPosition]);

  // Persist offline session state so OS tab eviction/reload never loses the queue or song position
  const saveOfflineSession = useCallback(
    (overrideTime?: number, overridePlaying?: boolean) => {
      if (isYieldedToOnlineRef.current || queueRef.current.length === 0 || currentIndexRef.current < 0) {
        return;
      }
      try {
        const payload = {
          queueIds: queueRef.current.slice(0, 150).map((t) => t.id),
          currentIndex: currentIndexRef.current,
          currentTime: Math.floor(overrideTime ?? currentTimeRef.current ?? 0),
          repeatMode: repeatModeRef.current,
          isShuffle: isShuffleRef.current,
          wasPlaying: overridePlaying ?? (shouldPlayRef.current && !userPausedRef.current),
          savedAt: Date.now(),
        };
        localStorage.setItem(OFFLINE_SESSION_KEY, JSON.stringify(payload));
        localStorage.setItem(ACTIVE_PLAYER_KEY, 'offline');
      } catch {
        // ignore quota errors
      }
    },
    []
  );

  useEffect(() => {
    saveOfflineSession();
  }, [queue, currentIndex, repeatMode, isShuffle, isPlaying, saveOfflineSession]);

  // Track offline listening seconds cleanly (5s interval when audio is actively playing)
  useEffect(() => {
    if (!isPlaying || isYieldedToOnline) return;
    const timer = window.setInterval(() => {
      if (audioElRef.current && !audioElRef.current.paused && !isYieldedToOnlineRef.current) {
        recordListeningSeconds(5);
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [isPlaying, isYieldedToOnline, recordListeningSeconds]);

  // Sync & pre-warm ONLY the immediate next track + record offline song in Recently Played!
  useEffect(() => {
    if (!currentTrack) {
      if (restoredPausedTrackIdRef.current) {
        return;
      }
      loadedTrackIdRef.current = null;
      shouldPlayRef.current = false;
      stopAudio();
      stopWebAudioKeepAlive();
      void releasePlaybackWakeLock();
      return;
    }

    if (restoredPausedTrackIdRef.current === currentTrack.id) {
      restoredPausedTrackIdRef.current = null;
      loadedTrackIdRef.current = currentTrack.id;
      shouldPlayRef.current = false;
      userPausedRef.current = true;
      setIsPlaying(false);
      setIsBuffering(false);
      return;
    }
    restoredPausedTrackIdRef.current = null;

    if (isYieldedToOnlineRef.current) {
      return;
    }

    if (loadedTrackIdRef.current === currentTrack.id) {
      return;
    }

    const alreadyStartedInGesture = loadedAudioTrackIdRef.current === currentTrack.id;
    loadedTrackIdRef.current = currentTrack.id;
    endedHandledForLoadRef.current = null;

    if (!alreadyStartedInGesture) {
      pendingSeekSecRef.current = 0;
      currentTimeRef.current = 0;
      setCurrentTime(0);
    }

    shouldPlayRef.current = true;
    userPausedRef.current = false;
    shuffleHistoryRef.current.add(currentTrack.id);
    setDuration(currentTrack.durationSeconds || 0);
    setPlayerError(null);

    // Record this offline song in Recently Played and Listening Stats!
    recordOfflinePlayed(currentTrack);

    if (isBackgroundPlayRef.current) {
      startWebAudioKeepAlive();
      pokeBackgroundKeepAlive();
      void acquirePlaybackWakeLock();
    }

    let cancelled = false;
    const prewarmTimer = window.setTimeout(() => {
      void (async () => {
        if (cancelled) return;
        const q = queueRef.current;
        const idx = currentIndexRef.current;
        if (q.length === 0) return;

        let nextIdx = (idx + 1) % q.length;
        if (isShuffleRef.current && q.length > 1) {
          const unplayed: number[] = [];
          for (let i = 0; i < q.length; i++) {
            if (i !== idx && !shuffleHistoryRef.current.has(q[i].id)) {
              unplayed.push(i);
            }
          }
          if (unplayed.length > 0) {
            nextIdx = unplayed[Math.floor(Math.random() * unplayed.length)];
          } else {
            nextIdx = (idx + 1) % q.length;
          }
          nextShuffleCandidateRef.current = nextIdx;
        } else {
          nextShuffleCandidateRef.current = -1;
        }

        const nextTrackItem = q[nextIdx];
        const keepIds = new Set<string>([currentTrack.id]);
        if (nextTrackItem) keepIds.add(nextTrackItem.id);

        pruneOfflineBlobCache(keepIds);

        await ensureOfflineBlobUrl(currentTrack, keepIds);
        if (!cancelled && nextTrackItem && nextTrackItem.id !== currentTrack.id) {
          await ensureOfflineBlobUrl(nextTrackItem, keepIds);
        }
      })();
    }, 80);

    if (!alreadyStartedInGesture) {
      beginOfflineTrackAudio(currentTrack, pendingSeekSecRef.current);
    }

    return () => {
      cancelled = true;
      window.clearTimeout(prewarmTimer);
    };
  }, [currentTrack, beginOfflineTrackAudio, recordOfflinePlayed, stopAudio]);

  // Background & Screen-Wake Continuity (handles both screen lock AND screen unlock/wake!)
  useEffect(() => {
    const ensurePlaybackAlive = () => {
      if (isYieldedToOnlineRef.current) return;
      if (!shouldPlayRef.current || userPausedRef.current) return;

      if (isBackgroundPlayRef.current) {
        startWebAudioKeepAlive();
        pokeBackgroundKeepAlive();
        if (!document.hidden) {
          void acquirePlaybackWakeLock();
        }
      }

      const a = audioElRef.current;
      if (!a) return;

      if (
        !isSilentWarmupRef.current &&
        (a.ended || (Number.isFinite(a.duration) && a.duration > 3 && a.currentTime >= a.duration - 0.25))
      ) {
        handleTrackEnd();
        return;
      }

      for (const waitMs of [0, 60, 220, 600, 1200]) {
        window.setTimeout(() => {
          const el = audioElRef.current;
          if (
            !isYieldedToOnlineRef.current &&
            el &&
            el.paused &&
            !el.ended &&
            shouldPlayRef.current &&
            !userPausedRef.current
          ) {
            void el.play().catch(() => {});
          }
        }, waitMs);
      }
    };

    const onVisibilityChange = () => {
      persistCurrentTrackResume();
      saveOfflineSession();
      ensurePlaybackAlive();
    };

    const flushPlaybackSnapshot = () => {
      persistCurrentTrackResume();
      saveOfflineSession();
    };

    const onWindowFocusOrShow = () => {
      ensurePlaybackAlive();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', flushPlaybackSnapshot);
    window.addEventListener('beforeunload', flushPlaybackSnapshot);
    window.addEventListener('focus', onWindowFocusOrShow);
    window.addEventListener('pageshow', onWindowFocusOrShow);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', flushPlaybackSnapshot);
      window.removeEventListener('beforeunload', flushPlaybackSnapshot);
      window.removeEventListener('focus', onWindowFocusOrShow);
      window.removeEventListener('pageshow', onWindowFocusOrShow);
    };
  }, [handleTrackEnd, persistCurrentTrackResume, saveOfflineSession]);

  // Continuous 2-second watchdog timer: catches throttled `ended` events or involuntary OS pauses while screen is off
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (isYieldedToOnlineRef.current) return;
      if (!shouldPlayRef.current || userPausedRef.current) return;
      const a = audioElRef.current;
      if (!a || queueRef.current.length === 0) return;

      if (isBackgroundPlayRef.current) {
        pokeBackgroundKeepAlive();
      }

      if (!isSilentWarmupRef.current && !a.src.startsWith('data:')) {
        const dur = a.duration;
        const cur = a.currentTime;
        if (a.ended || (Number.isFinite(dur) && dur > 3 && cur >= dur - 0.22)) {
          handleTrackEnd();
          return;
        }
      }

      if (a.paused && !a.ended && isBackgroundPlayRef.current) {
        void a.play().catch(() => {});
      }
    }, 2000);

    return () => window.clearInterval(timer);
  }, [handleTrackEnd]);

  // Mutual exclusion with online PlayerContext
  useEffect(() => {
    const handlePauseFromOnline = () => {
      persistCurrentTrackResume();
      isYieldedToOnlineRef.current = true;
      setIsYieldedToOnline(true);
      setIsExpanded(false);
      setIsQueueOpen(false);
      userPausedRef.current = true;
      shouldPlayRef.current = false;
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
  }, [persistCurrentTrackResume]);

  const playOfflineTrack = useCallback(
    (track: OfflineTrack, newQueue?: OfflineTrack[], startAtSeconds?: number) => {
      // Save previous track position before switching
      persistCurrentTrackResume();

      window.dispatchEvent(new CustomEvent('vibra:pause-online-player'));
      isYieldedToOnlineRef.current = false;
      setIsYieldedToOnline(false);
      localStorage.setItem(ACTIVE_PLAYER_KEY, 'offline');
      errorSkipStreakRef.current = 0;
      shouldPlayRef.current = true;
      userPausedRef.current = false;
      if (isBackgroundPlayRef.current) {
        startWebAudioKeepAlive();
        pokeBackgroundKeepAlive();
        void acquirePlaybackWakeLock();
      }

      // Determine resume position: explicit startAtSeconds OR saved pause/stop position
      let resumeSec = 0;
      if (typeof startAtSeconds === 'number') {
        resumeSec = Math.max(0, startAtSeconds);
        if (resumeSec === 0) {
          clearTrackPosition(track.id);
          if (track.sourceVideoId) clearTrackPosition(track.sourceVideoId);
        }
      } else {
        const saved =
          getTrackPosition(track.id) ||
          (track.sourceVideoId ? getTrackPosition(track.sourceVideoId) : null);
        if (saved && saved.positionSeconds >= 3) {
          resumeSec = saved.positionSeconds;
          showToast(`Resuming "${track.title}" from ${formatSeconds(resumeSec)}`);
        }
      }

      beginOfflineTrackAudio(track, resumeSec);
      // Record in Recently Played even if re-playing the same track id
      recordOfflinePlayed(track);

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
    [
      beginOfflineTrackAudio,
      clearTrackPosition,
      getTrackPosition,
      persistCurrentTrackResume,
      recordOfflinePlayed,
      showToast,
    ]
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
          persistCurrentTrackResume();
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
    [persistCurrentTrackResume, stopAudio]
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
    const curSec = currentTimeRef.current;
    if (!audio.paused && shouldPlayRef.current) {
      userPausedRef.current = true;
      shouldPlayRef.current = false;
      stopWebAudioKeepAlive();
      void releasePlaybackWakeLock();
      audio.pause();
      setIsPlaying(false);
      persistCurrentTrackResume(curSec);
      saveOfflineSession(curSec, false);
    } else {
      window.dispatchEvent(new CustomEvent('vibra:pause-online-player'));
      isYieldedToOnlineRef.current = false;
      setIsYieldedToOnline(false);
      localStorage.setItem(ACTIVE_PLAYER_KEY, 'offline');
      userPausedRef.current = false;
      shouldPlayRef.current = true;
      if (isBackgroundPlayRef.current) {
        startWebAudioKeepAlive();
        pokeBackgroundKeepAlive();
        void acquirePlaybackWakeLock();
      }
      const savedPos =
        getTrackPosition(currentTrack.id)?.positionSeconds ??
        (currentTrack.sourceVideoId ? getTrackPosition(currentTrack.sourceVideoId)?.positionSeconds : undefined) ??
        0;
      const effectiveResume = curSec > 0.5 ? curSec : savedPos;
      if (
        !audio.getAttribute('src') ||
        audio.src.startsWith('data:') ||
        audio.error ||
        loadedAudioTrackIdRef.current !== currentTrack.id
      ) {
        beginOfflineTrackAudio(currentTrack, effectiveResume);
      } else {
        const needsSeek = effectiveResume > 0.5 && Math.abs((audio.currentTime || 0) - effectiveResume) > 1.5;
        if (needsSeek) {
          pendingSeekSecRef.current = effectiveResume;
          pendingSeekSetAtRef.current = Date.now();
          pendingSeekMuteGuardRef.current = true;
          audio.muted = true;
          applyPendingSeek(audio);
        } else {
          releaseSeekMuteGuard(audio);
        }
        void audio.play().catch(() => {
          beginOfflineTrackAudio(currentTrack, effectiveResume);
        });
      }
      saveOfflineSession(effectiveResume, true);
    }
  }, [
    applyPendingSeek,
    beginOfflineTrackAudio,
    currentTrack,
    getTrackPosition,
    persistCurrentTrackResume,
    releaseSeekMuteGuard,
    saveOfflineSession,
  ]);

  const nextTrack = useCallback(() => {
    const q = queueRef.current;
    const idx = currentIndexRef.current;
    if (q.length === 0) return;
    persistCurrentTrackResume();
    window.dispatchEvent(new CustomEvent('vibra:pause-online-player'));
    isYieldedToOnlineRef.current = false;
    setIsYieldedToOnline(false);
    localStorage.setItem(ACTIVE_PLAYER_KEY, 'offline');
    shouldPlayRef.current = true;
    userPausedRef.current = false;
    if (isBackgroundPlayRef.current) {
      startWebAudioKeepAlive();
      pokeBackgroundKeepAlive();
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
  }, [beginOfflineTrackAudio, persistCurrentTrackResume, pickNextShuffleIndex]);

  const prevTrack = useCallback(() => {
    const q = queueRef.current;
    const idx = currentIndexRef.current;
    if (q.length === 0) return;
    window.dispatchEvent(new CustomEvent('vibra:pause-online-player'));
    isYieldedToOnlineRef.current = false;
    setIsYieldedToOnline(false);
    localStorage.setItem(ACTIVE_PLAYER_KEY, 'offline');
    shouldPlayRef.current = true;
    userPausedRef.current = false;
    if (isBackgroundPlayRef.current) {
      startWebAudioKeepAlive();
      pokeBackgroundKeepAlive();
      void acquirePlaybackWakeLock();
    }
    if (currentTimeRef.current > 4 && audioElRef.current && !isSilentWarmupRef.current) {
      audioElRef.current.currentTime = 0;
      currentTimeRef.current = 0;
      setCurrentTime(0);
      if (q[idx]) clearTrackPosition(q[idx].id);
      return;
    }
    persistCurrentTrackResume();
    const targetIdx = idx - 1 >= 0 ? idx - 1 : q.length - 1;
    if (q[targetIdx]) beginOfflineTrackAudio(q[targetIdx], 0);
    setCurrentIndex(targetIdx);
  }, [beginOfflineTrackAudio, clearTrackPosition, persistCurrentTrackResume]);

  const seekTo = useCallback(
    (seconds: number) => {
      currentTimeRef.current = seconds;
      setCurrentTime(seconds);
      persistCurrentTrackResume(seconds);
      saveOfflineSession(seconds);
      const a = audioElRef.current;
      if (!a) return;
      if (isSilentWarmupRef.current || !Number.isFinite(a.duration) || a.duration <= 3) {
        pendingSeekSecRef.current = seconds;
      } else {
        pendingSeekSecRef.current = 0;
        a.currentTime = seconds;
      }
    },
    [persistCurrentTrackResume, saveOfflineSession]
  );

  const seekBy = useCallback(
    (deltaSeconds: number) => {
      const curTrack = queueRef.current[currentIndexRef.current];
      const effDur =
        durationRef.current > 0
          ? durationRef.current
          : curTrack?.durationSeconds || parseDurationLabel(curTrack?.duration) || 0;
      const rawNext = currentTimeRef.current + deltaSeconds;
      const clamped = effDur > 0 ? Math.max(0, Math.min(effDur, rawNext)) : Math.max(0, rawNext);
      seekTo(clamped);
    },
    [seekTo]
  );

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
        pokeBackgroundKeepAlive();
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
        persistCurrentTrackResume();
        window.dispatchEvent(new CustomEvent('vibra:pause-online-player'));
        isYieldedToOnlineRef.current = false;
        setIsYieldedToOnline(false);
        localStorage.setItem(ACTIVE_PLAYER_KEY, 'offline');
        shouldPlayRef.current = true;
        userPausedRef.current = false;
        if (isBackgroundPlayRef.current) {
          startWebAudioKeepAlive();
          pokeBackgroundKeepAlive();
          void acquirePlaybackWakeLock();
        }
        const target = queueRef.current[index];
        if (target) {
          const saved = getTrackPosition(target.id);
          beginOfflineTrackAudio(target, saved?.positionSeconds ?? 0);
        }
        setCurrentIndex(index);
      }
    },
    [beginOfflineTrackAudio, getTrackPosition, persistCurrentTrackResume]
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
        if (isBackgroundPlayRef.current) {
          startWebAudioKeepAlive();
          pokeBackgroundKeepAlive();
          void acquirePlaybackWakeLock();
        }
        if (audioElRef.current) {
          void audioElRef.current.play().catch(() => {});
        }
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        userPausedRef.current = true;
        shouldPlayRef.current = false;
        persistCurrentTrackResume();
        stopWebAudioKeepAlive();
        void releasePlaybackWakeLock();
        audioElRef.current?.pause();
        setIsPlaying(false);
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
  }, [currentTrack, isPlaying, isBackgroundPlay, isYieldedToOnline, persistCurrentTrackResume, seekTo]);

  const effectiveCurrentTrack = isYieldedToOnline ? null : currentTrack;

  const offlineContextValue = useMemo<OfflinePlayerContextValue>(
    () => ({
      currentTrack: effectiveCurrentTrack,
      queue,
      currentIndex,
      isPlaying,
      isBuffering,
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
      seekBy,
      setVolume,
      toggleMute,
      cycleRepeat,
      toggleShuffle,
      toggleBackgroundPlay,
      setIsExpanded,
      setMobilePlayerView,
      setIsQueueOpen,
      jumpToOfflineQueueIndex,
    }),
    [
      effectiveCurrentTrack,
      queue,
      currentIndex,
      isPlaying,
      isBuffering,
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
      seekBy,
      setVolume,
      toggleMute,
      cycleRepeat,
      toggleShuffle,
      toggleBackgroundPlay,
      jumpToOfflineQueueIndex,
    ]
  );

  const offlineTimeValue = useMemo<OfflinePlayerTimeContextValue>(
    () => ({ currentTime, duration }),
    [currentTime, duration]
  );

  return (
    <OfflinePlayerContext.Provider value={offlineContextValue}>
      <OfflinePlayerTimeContext.Provider value={offlineTimeValue}>
      <audio
        ref={audioElRef}
        preload="auto"
        playsInline
        className="hidden"
        onPlaying={() => {
          if (isSilentWarmupRef.current) return;
          const a = audioElRef.current;
          if (a) {
            a.playbackRate = 1;
            if (pendingSeekSecRef.current > 0.5) {
              a.muted = true;
              applyPendingSeek(a);
            } else {
              releaseSeekMuteGuard(a);
              if (
                a.currentTime < 0.35 &&
                audioKickDoneForLoadRef.current !== loadedAudioTrackIdRef.current
              ) {
                const loadTrackId = loadedAudioTrackIdRef.current;
                audioKickDoneForLoadRef.current = loadTrackId;
                window.setTimeout(() => {
                  const el = audioElRef.current;
                  if (
                    !el ||
                    loadedAudioTrackIdRef.current !== loadTrackId ||
                    el.paused ||
                    el.ended ||
                    isSilentWarmupRef.current ||
                    pendingSeekSecRef.current > 0.5
                  ) {
                    return;
                  }
                  releaseSeekMuteGuard(el);
                  if (Number.isFinite(el.duration) && el.duration > 3 && el.currentTime < 0.08) {
                    try {
                      el.currentTime = 0.08;
                    } catch {
                      // ignore
                    }
                  }
                }, 220);
              }
            }
          }
          pauseKeepAliveBridgeIfForeground();
          errorSkipStreakRef.current = 0;
          setIsPlaying(true);
          setIsBuffering(false);
          setPlayerError(null);
          if (isBackgroundPlayRef.current) {
            startWebAudioKeepAlive();
            pokeBackgroundKeepAlive();
            void acquirePlaybackWakeLock();
          }
        }}
        onSeeked={(e) => {
          if (isSilentWarmupRef.current) return;
          const a = e.currentTarget;
          if (a.src.startsWith('data:')) return;
          const pending = pendingSeekSecRef.current;
          if (pending > 0.5) {
            if (Math.abs((a.currentTime || 0) - pending) <= 2.0) {
              pendingSeekSecRef.current = 0;
              pendingSeekSetAtRef.current = 0;
              currentTimeRef.current = a.currentTime;
              setCurrentTime(a.currentTime);
              releaseSeekMuteGuard(a);
            } else {
              applyPendingSeek(a);
            }
          } else if (pendingSeekMuteGuardRef.current) {
            releaseSeekMuteGuard(a);
          }
        }}
        onPause={() => {
          if (isSilentWarmupRef.current) return;
          const a = audioElRef.current;
          if (!a || a.src.startsWith('data:')) return;
          if (!a.ended) {
            persistCurrentTrackResume(pendingSeekSecRef.current > 0.5 ? undefined : a.currentTime);
            if (
              !isYieldedToOnlineRef.current &&
              isBackgroundPlayRef.current &&
              shouldPlayRef.current &&
              !userPausedRef.current
            ) {
              pokeBackgroundKeepAlive();
              for (const retryMs of [25, 120, 350, 800, 1600, 2800]) {
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
            durationRef.current = dur;
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
          if (now - lastPosSaveRef.current > 2000) {
            lastPosSaveRef.current = now;
            persistCurrentTrackResume(cur);
          }
          if (now - lastSessionSaveRef.current > 5000) {
            lastSessionSaveRef.current = now;
            saveOfflineSession(cur);
          }

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
      </OfflinePlayerTimeContext.Provider>
    </OfflinePlayerContext.Provider>
  );
}

export function useOfflinePlayer(): OfflinePlayerContextValue {
  const ctx = useContext(OfflinePlayerContext);
  if (!ctx) throw new Error('useOfflinePlayer must be used within OfflinePlayerProvider');
  return ctx;
}

export function useOfflinePlayerTime(): OfflinePlayerTimeContextValue {
  const ctx = useContext(OfflinePlayerTimeContext);
  if (!ctx) throw new Error('useOfflinePlayerTime must be used within OfflinePlayerProvider');
  return ctx;
}
