import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { fetchRelatedTracks } from '../services/api';
import type { RepeatMode, Track } from '../types/music';
import {
  acquirePlaybackWakeLock,
  getSilentLoopBlobUrl,
  registerVibraServiceWorker,
  releasePlaybackWakeLock,
  startWebAudioKeepAlive,
  stopWebAudioKeepAlive,
} from '../utils/backgroundAudio';
import { useLibrary } from './LibraryContext';

interface YTPlayerInstance {
  loadVideoById: (
    videoIdOrConfig: string | { videoId: string; startSeconds?: number }
  ) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  setVolume: (volume: number) => void;
  mute: () => void;
  unMute: () => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
  destroy: () => void;
}

declare global {
  interface Window {
    YT?: {
      Player: new (
        element: HTMLElement | string,
        options: {
          height?: string | number;
          width?: string | number;
          videoId?: string;
          playerVars?: Record<string, string | number>;
          events?: {
            onReady?: (event: { target: YTPlayerInstance }) => void;
            onStateChange?: (event: { data: number; target: YTPlayerInstance }) => void;
            onError?: (event: { data: number }) => void;
          };
        }
      ) => YTPlayerInstance;
      PlayerState: {
        UNSTARTED: number;
        ENDED: number;
        PLAYING: number;
        PAUSED: number;
        BUFFERING: number;
        CUED: number;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

interface PlayerContextValue {
  currentTrack: Track | null;
  queue: Track[];
  currentIndex: number;
  isPlaying: boolean;
  isBuffering: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  repeatMode: RepeatMode;
  isShuffle: boolean;
  isRadioMode: boolean;
  isLoadingRadio: boolean;
  isExpanded: boolean;
  mobilePlayerView: 'player' | 'queue' | 'related';
  isVideoMode: boolean;
  isQueueOpen: boolean;
  isBackgroundPlay: boolean;
  relatedTracks: Track[];
  isLoadingRelated: boolean;
  playerError: string | null;
  backgroundBlockedHint: string | null;
  clearBackgroundBlockedHint: () => void;
  playerHostRef: React.RefObject<HTMLDivElement | null>;
  playTrack: (track: Track, newQueue?: Track[], openVideo?: boolean) => void;
  startTrackRadio: (track: Track) => void;
  addToQueue: (track: Track) => void;
  playNextInQueue: (track: Track) => void;
  removeFromQueue: (index: number) => void;
  moveQueueItem: (fromIndex: number, toIndex: number) => void;
  shuffleUpcomingQueue: () => void;
  saveQueueAsPlaylist: (name?: string) => void;
  clearQueue: () => void;
  togglePlay: () => void;
  nextTrack: () => void;
  prevTrack: () => void;
  seekTo: (seconds: number) => void;
  setVolume: (vol: number) => void;
  toggleMute: () => void;
  cycleRepeat: () => void;
  toggleShuffle: () => void;
  toggleRadioMode: () => void;
  toggleBackgroundPlay: () => void;
  setIsExpanded: (val: boolean) => void;
  setMobilePlayerView: (view: 'player' | 'queue' | 'related') => void;
  setIsVideoMode: (val: boolean) => void;
  setIsQueueOpen: (val: boolean) => void;
  jumpToQueueIndex: (index: number) => void;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

const audioBlobCache = new Map<string, string>();
const inFlightBlobFetches = new Map<string, Promise<string | null>>();

function buildDirectAudioStreamUrl(track: Track): string {
  const qs = new URLSearchParams({
    videoId: track.id,
    title: track.title,
    artist: track.artist,
    duration: String(track.durationSeconds || 0),
  });
  return `/api/audio/stream?${qs.toString()}`;
}

async function fetchTrackAudioBlobUrl(track: Track): Promise<string | null> {
  const cached = audioBlobCache.get(track.id);
  if (cached) return cached;

  const existingJob = inFlightBlobFetches.get(track.id);
  if (existingJob) return existingJob;

  const job = (async (): Promise<string | null> => {
    try {
      const res = await window.fetch(buildDirectAudioStreamUrl(track), {
        credentials: 'include',
      });
      if (!res.ok) return null;
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      if (!ct.includes('audio') && !ct.includes('mp4') && !ct.includes('mpeg')) {
        return null;
      }
      const blob = await res.blob();
      if (blob.size < 16384) return null;
      const typedBlob = blob.type.startsWith('audio/')
        ? blob
        : new Blob([blob], { type: 'audio/mp4' });
      const blobUrl = URL.createObjectURL(typedBlob);

      if (audioBlobCache.size >= 20) {
        const oldestKey = audioBlobCache.keys().next().value;
        if (oldestKey !== undefined && oldestKey !== track.id) {
          const oldUrl = audioBlobCache.get(oldestKey);
          audioBlobCache.delete(oldestKey);
          if (oldUrl) {
            try {
              URL.revokeObjectURL(oldUrl);
            } catch {
              // ignore
            }
          }
        }
      }
      audioBlobCache.set(track.id, blobUrl);
      return blobUrl;
    } catch {
      return null;
    } finally {
      inFlightBlobFetches.delete(track.id);
    }
  })();

  inFlightBlobFetches.set(track.id, job);
  return job;
}

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const { recordPlayed, recordListeningSeconds, createPlaylistWithTracks, showToast } = useLibrary();

  const [queue, setQueue] = useState<Track[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState<number>(() => {
    const saved = localStorage.getItem('vibra_volume');
    return saved ? Number(saved) : 85;
  });
  const [isMuted, setIsMuted] = useState(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('off');
  const [isShuffle, setIsShuffle] = useState(false);
  const [isRadioMode, setIsRadioMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('vibra_radio_mode');
    return saved === null ? true : saved === 'true';
  });
  const [isLoadingRadio, setIsLoadingRadio] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [mobilePlayerView, setMobilePlayerView] = useState<'player' | 'queue' | 'related'>('player');
  const [isVideoMode, setIsVideoMode] = useState(false);
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [isBackgroundPlay, setIsBackgroundPlay] = useState<boolean>(() => {
    const saved = localStorage.getItem('vibra_bg_play');
    return saved === null ? true : saved === 'true';
  });
  const [relatedTracks, setRelatedTracks] = useState<Track[]>([]);
  const [isLoadingRelated, setIsLoadingRelated] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [backgroundBlockedHint, setBackgroundBlockedHint] = useState<string | null>(null);

  const playerHostRef = useRef<HTMLDivElement | null>(null);
  const ytPlayerRef = useRef<YTPlayerInstance | null>(null);
  const ytReadyRef = useRef(false);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const activeEngineRef = useRef<'none' | 'audio' | 'youtube'>('none');
  const audioUnlockedRef = useRef(false);
  const isSilentWarmupRef = useRef(false);
  const pendingSeekSecRef = useRef<number>(0);
  const pendingYtSeekSecRef = useRef<number>(0);
  const pendingTrackIdRef = useRef<string | null>(null);
  const loadedTrackIdRef = useRef<string | null>(null);
  const loadedAudioTrackIdRef = useRef<string | null>(null);
  const loadedYtVideoIdRef = useRef<string | null>(null);
  const resolveAbortRef = useRef<AbortController | null>(null);
  const consecutiveErrorsRef = useRef(0);
  const bgSkipStreakRef = useRef(0);
  const radioFetchingRef = useRef(false);
  const shuffleHistoryRef = useRef<Set<string>>(new Set());
  const shouldPlayRef = useRef(false);
  const userPausedRef = useRef(false);
  const hiddenAtRef = useRef(0);
  const bgResumeAttemptsRef = useRef(0);
  const endedHandledForLoadRef = useRef<string | null>(null);
  const relatedFetchedForIdRef = useRef<string | null>(null);
  const lastMediaPosSyncRef = useRef<number>(0);
  const isYieldedToOfflineRef = useRef(false);
  const [isYieldedToOffline, setIsYieldedToOffline] = useState(false);

  const queueRef = useRef(queue);
  const currentIndexRef = useRef(currentIndex);
  const currentTimeRef = useRef(currentTime);
  const repeatModeRef = useRef(repeatMode);
  const isShuffleRef = useRef(isShuffle);
  const isRadioModeRef = useRef(isRadioMode);
  const isBackgroundPlayRef = useRef(isBackgroundPlay);
  const isVideoModeRef = useRef(isVideoMode);
  const volumeRef = useRef(volume);
  const isMutedRef = useRef(isMuted);
  const relatedTracksRef = useRef(relatedTracks);

  queueRef.current = queue;
  currentIndexRef.current = currentIndex;
  currentTimeRef.current = currentTime;
  repeatModeRef.current = repeatMode;
  isShuffleRef.current = isShuffle;
  isRadioModeRef.current = isRadioMode;
  isBackgroundPlayRef.current = isBackgroundPlay;
  isVideoModeRef.current = isVideoMode;
  volumeRef.current = volume;
  isMutedRef.current = isMuted;
  relatedTracksRef.current = relatedTracks;

  const currentTrack = currentIndex >= 0 && currentIndex < queue.length ? queue[currentIndex] : null;

  const applyPendingAudioSeek = useCallback((a: HTMLAudioElement) => {
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
        // wait for next readiness event
      }
    }
  }, []);

  const destroyHls = useCallback(() => {
    if (hlsRef.current) {
      try {
        hlsRef.current.destroy();
      } catch {
        // ignore
      }
      hlsRef.current = null;
    }
  }, []);

  const stopNativeAudio = useCallback(() => {
    destroyHls();
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
  }, [destroyHls]);

  const startYouTubeTrack = useCallback((videoId: string, startSec = 0) => {
    activeEngineRef.current = 'youtube';
    pendingYtSeekSecRef.current = startSec > 0.5 ? startSec : 0;
    if (startSec > 0.5) {
      currentTimeRef.current = startSec;
      setCurrentTime(startSec);
    }

    if (ytReadyRef.current && ytPlayerRef.current) {
      const sameVideoLoaded = loadedYtVideoIdRef.current === videoId;
      loadedYtVideoIdRef.current = videoId;

      if (sameVideoLoaded && startSec > 0.5) {
        try {
          ytPlayerRef.current.seekTo(startSec, true);
          if (shouldPlayRef.current && !userPausedRef.current) {
            ytPlayerRef.current.playVideo();
          }
          return;
        } catch {
          // fallback to loadVideoById below
        }
      }

      if (startSec > 0.5) {
        ytPlayerRef.current.loadVideoById({
          videoId,
          startSeconds: Math.floor(startSec),
        });
      } else {
        ytPlayerRef.current.loadVideoById(videoId);
      }

      for (const delay of [350, 750, 1300]) {
        window.setTimeout(() => {
          if (activeEngineRef.current !== 'youtube' || !ytPlayerRef.current) return;
          try {
            const target = pendingYtSeekSecRef.current;
            if (target > 0.5) {
              const cur = ytPlayerRef.current.getCurrentTime() || 0;
              if (Math.abs(cur - target) > 2.5) {
                ytPlayerRef.current.seekTo(target, true);
              }
            }
            if (shouldPlayRef.current && !userPausedRef.current) {
              const st = ytPlayerRef.current.getPlayerState();
              const PS = window.YT?.PlayerState;
              if (PS && (st === PS.CUED || st === PS.UNSTARTED || st === PS.PAUSED)) {
                ytPlayerRef.current.playVideo();
              }
            }
          } catch {
            // ignore
          }
        }, delay);
      }
    } else {
      pendingTrackIdRef.current = videoId;
    }
  }, []);

  /**
   * Starts native HTML5 <audio> playback synchronously inside the user gesture (0ms delay):
   * 1. If the track's full MP4 Blob URL is already in RAM (audioBlobCache), plays it in 0ms.
   * 2. Otherwise, immediately plays an in-memory 2s looping silent WAV Blob URL in 0ms inside the tap gesture
   *    (activating Android's hardware AudioTrack immediately even if the user switches tabs 100ms later),
   *    fetches the MP4 Blob via window.fetch(), and seamlessly swaps audio.src to the RAM Blob URL.
   */
  const beginSynchronousNativeAudio = useCallback(
    (track: Track, resumeSec = 0) => {
      const audio = audioElRef.current;
      if (!audio) {
        startYouTubeTrack(track.id, resumeSec);
        return;
      }

      destroyHls();
      activeEngineRef.current = 'audio';
      loadedAudioTrackIdRef.current = track.id;
      pendingSeekSecRef.current = resumeSec > 0.5 ? resumeSec : 0;
      if (resumeSec > 0.5) {
        currentTimeRef.current = resumeSec;
        setCurrentTime(resumeSec);
      }
      audio.muted = isMutedRef.current;
      audio.volume = isMutedRef.current ? 0 : volumeRef.current / 100;

      try {
        ytPlayerRef.current?.pauseVideo();
      } catch {
        // ignore
      }

      const cachedBlobUrl = audioBlobCache.get(track.id);
      if (cachedBlobUrl) {
        isSilentWarmupRef.current = false;
        audio.loop = false;
        if (audio.src !== cachedBlobUrl) {
          audio.src = cachedBlobUrl;
        }
        if (audio.readyState >= 1 && pendingSeekSecRef.current > 0.5) {
          applyPendingAudioSeek(audio);
        }
        setIsBuffering(false);
        if (shouldPlayRef.current && !userPausedRef.current) {
          const p = audio.play();
          if (p) {
            void p
              .then(() => {
                audioUnlockedRef.current = true;
                if (pendingSeekSecRef.current > 0.5) {
                  applyPendingAudioSeek(audio);
                }
              })
              .catch((err) => {
                if (err instanceof Error && err.name === 'AbortError') return;
                if (err instanceof Error && err.name === 'NotAllowedError') {
                  setIsPlaying(false);
                  return;
                }
              });
          }
        }
        return;
      }

      // Not yet in RAM:
      // If screen is off or app is in background, stream directly via native HTTP 206 <audio src="/api/audio/stream?...">
      // synchronously inside the ended/transition callback so OS media daemon keeps continuous playback across 10-20+ tracks!
      if (document.hidden && isBackgroundPlayRef.current) {
        isSilentWarmupRef.current = false;
        audio.loop = false;
        audio.muted = isMutedRef.current;
        audio.volume = isMutedRef.current ? 0 : volumeRef.current / 100;
        const directUrl = buildDirectAudioStreamUrl(track);
        if (audio.src !== directUrl) {
          audio.src = directUrl;
        }
        setIsBuffering(true);
        if (shouldPlayRef.current && !userPausedRef.current) {
          const directPlay = audio.play();
          if (directPlay) {
            void directPlay
              .then(() => {
                audioUnlockedRef.current = true;
                if (pendingSeekSecRef.current > 0.5) {
                  applyPendingAudioSeek(audio);
                }
              })
              .catch(() => {});
          }
        }
        return;
      }

      // Foreground tap: start in-memory silent loop synchronously in 0ms to hold Android AudioTrack & gesture unlock
      isSilentWarmupRef.current = true;
      const silentUrl = getSilentLoopBlobUrl();
      audio.loop = true;
      if (audio.src !== silentUrl) {
        audio.src = silentUrl;
      }
      setIsBuffering(true);

      if (shouldPlayRef.current && !userPausedRef.current) {
        try {
          const warmPromise = audio.play();
          if (warmPromise) {
            void warmPromise
              .then(() => {
                audioUnlockedRef.current = true;
              })
              .catch(() => {});
          }
        } catch {
          // ignore
        }
      }

      void fetchTrackAudioBlobUrl(track).then((blobUrl) => {
        if (loadedAudioTrackIdRef.current !== track.id || activeEngineRef.current !== 'audio') {
          return;
        }
        const effectiveResume = Math.max(pendingSeekSecRef.current, resumeSec);
        if (!blobUrl) {
          isSilentWarmupRef.current = false;
          stopNativeAudio();
          if (document.hidden && isBackgroundPlayRef.current && queueRef.current.length > 1 && bgSkipStreakRef.current < 8) {
            bgSkipStreakRef.current += 1;
            const q = queueRef.current;
            const nextIdx = (currentIndexRef.current + 1) % q.length;
            setCurrentIndex(nextIdx);
            return;
          }
          startYouTubeTrack(track.id, effectiveResume);
          return;
        }

        isSilentWarmupRef.current = false;
        audio.loop = false;
        audio.muted = isMutedRef.current;
        audio.volume = isMutedRef.current ? 0 : volumeRef.current / 100;
        pendingSeekSecRef.current = effectiveResume > 0.5 ? effectiveResume : 0;
        audio.src = blobUrl;

        if (shouldPlayRef.current && !userPausedRef.current) {
          const playPromise = audio.play();
          if (playPromise) {
            void playPromise
              .then(() => {
                audioUnlockedRef.current = true;
                if (pendingSeekSecRef.current > 0.5) {
                  applyPendingAudioSeek(audio);
                }
              })
              .catch((err) => {
                if (err instanceof Error && err.name === 'AbortError') return;
                if (err instanceof Error && err.name === 'NotAllowedError') {
                  setIsBuffering(false);
                  setIsPlaying(false);
                  return;
                }
              });
          }
        } else {
          setIsBuffering(false);
        }
      });
    },
    [applyPendingAudioSeek, destroyHls, startYouTubeTrack, stopNativeAudio]
  );

  const unlockAudioFromGesture = useCallback(() => {
    const audio = audioElRef.current;
    if (!audio || audioUnlockedRef.current) return;
    if (activeEngineRef.current === 'audio' && loadedAudioTrackIdRef.current) return;
    try {
      const silentUrl = getSilentLoopBlobUrl();
      if (!audio.src) {
        audio.src = silentUrl;
      }
      audio.volume = 0;
      const p = audio.play();
      if (p) {
        void p
          .then(() => {
            audioUnlockedRef.current = true;
            if (activeEngineRef.current !== 'audio') {
              audio.pause();
            }
          })
          .catch(() => {});
      }
    } catch {
      // ignore
    }
  }, []);

  const replenishRadioQueue = useCallback(
    async (seedTrack: Track, advanceToNewTrack = false) => {
      if (radioFetchingRef.current) return;
      radioFetchingRef.current = true;
      setIsLoadingRadio(true);

      try {
        const currentQueueIds = queueRef.current.map((t) => t.id);
        // Prefer already-fetched related tracks that aren't in queue yet to save quota
        const localCandidates = relatedTracksRef.current.filter(
          (t) => !currentQueueIds.includes(t.id)
        );

        let freshTracks = localCandidates;
        if (freshTracks.length < 3) {
          freshTracks = await fetchRelatedTracks(seedTrack, currentQueueIds);
        }

        const existingIds = new Set(queueRef.current.map((t) => t.id));
        const uniqueAdditions = freshTracks.filter((t) => !existingIds.has(t.id)).slice(0, 14);

        if (uniqueAdditions.length > 0) {
          let insertStartIndex = queueRef.current.length;
          setQueue((prev) => {
            const seen = new Set(prev.map((t) => t.id));
            const cleanNew = uniqueAdditions.filter((t) => !seen.has(t.id));
            insertStartIndex = prev.length;
            return [...prev, ...cleanNew];
          });
          // Prewarm the newly added upcoming tracks immediately
          for (const added of uniqueAdditions.slice(0, 4)) {
            void fetchTrackAudioBlobUrl(added);
          }
          if (advanceToNewTrack) {
            const firstNewTrack = uniqueAdditions[0];
            if (firstNewTrack && !isVideoModeRef.current) {
              beginSynchronousNativeAudio(firstNewTrack, 0);
            }
            setCurrentIndex(insertStartIndex);
          }
        } else if (advanceToNewTrack) {
          setIsPlaying(false);
        }
      } catch {
        if (advanceToNewTrack) {
          setIsPlaying(false);
        }
      } finally {
        radioFetchingRef.current = false;
        setIsLoadingRadio(false);
      }
    },
    [beginSynchronousNativeAudio]
  );

  const pickNextShuffleIndex = useCallback((q: Track[], currentIdx: number): number => {
    if (q.length <= 1) return currentIdx;
    const unplayedIndices: number[] = [];
    for (let i = 0; i < q.length; i++) {
      if (i !== currentIdx && !shuffleHistoryRef.current.has(q[i].id)) {
        unplayedIndices.push(i);
      }
    }
    if (unplayedIndices.length === 0) {
      shuffleHistoryRef.current.clear();
      if (q[currentIdx]) shuffleHistoryRef.current.add(q[currentIdx].id);
      for (let i = 0; i < q.length; i++) {
        if (i !== currentIdx) unplayedIndices.push(i);
      }
    }
    const chosen = unplayedIndices[Math.floor(Math.random() * unplayedIndices.length)];
    if (q[chosen]) shuffleHistoryRef.current.add(q[chosen].id);
    return chosen;
  }, []);

  const handleTrackEnd = useCallback(() => {
    const q = queueRef.current;
    const idx = currentIndexRef.current;
    const rep = repeatModeRef.current;
    const shuf = isShuffleRef.current;
    const radio = isRadioModeRef.current;

    if (q.length === 0) return;

    const activeLoadKey = `${idx}:${q[idx]?.id ?? ''}`;
    if (rep !== 'one' && endedHandledForLoadRef.current === activeLoadKey) {
      return;
    }
    endedHandledForLoadRef.current = activeLoadKey;

    if (rep === 'one') {
      shouldPlayRef.current = true;
      userPausedRef.current = false;
      if (activeEngineRef.current === 'audio' && audioElRef.current) {
        audioElRef.current.currentTime = 0;
        void audioElRef.current.play().catch(() => {});
      } else {
        ytPlayerRef.current?.seekTo(0, true);
        ytPlayerRef.current?.playVideo();
      }
      return;
    }

    shouldPlayRef.current = true;
    userPausedRef.current = false;

    if (shuf && q.length > 1) {
      const nextIdx = pickNextShuffleIndex(q, idx);
      if (q[nextIdx] && !isVideoModeRef.current) {
        beginSynchronousNativeAudio(q[nextIdx], 0);
      }
      setCurrentIndex(nextIdx);
      return;
    }

    if (idx + 1 < q.length) {
      const nextTrackItem = q[idx + 1];
      if (nextTrackItem && !isVideoModeRef.current) {
        beginSynchronousNativeAudio(nextTrackItem, 0);
      }
      setCurrentIndex(idx + 1);
    } else if (radio && q[idx]) {
      void replenishRadioQueue(q[idx], true);
    } else if (rep === 'all') {
      if (q[0] && !isVideoModeRef.current) {
        beginSynchronousNativeAudio(q[0], 0);
      }
      setCurrentIndex(0);
    } else {
      shouldPlayRef.current = false;
      setIsPlaying(false);
      stopWebAudioKeepAlive();
      void releasePlaybackWakeLock();
    }
  }, [beginSynchronousNativeAudio, pickNextShuffleIndex, replenishRadioQueue]);

  const handleEmbedErrorSkip = useCallback(
    (code: number) => {
      const q = queueRef.current;
      const idx = currentIndexRef.current;
      const isRecoverable = code === 100 || code === 101 || code === 150 || code === 2;

      if (isRecoverable && q.length > 1 && consecutiveErrorsRef.current < 3) {
        consecutiveErrorsRef.current += 1;
        showToast('Skipped restricted YouTube track — playing next');
        if (idx + 1 < q.length) {
          if (q[idx + 1] && !isVideoModeRef.current) {
            beginSynchronousNativeAudio(q[idx + 1], 0);
          }
          setCurrentIndex(idx + 1);
        } else if (repeatModeRef.current === 'all') {
          if (q[0] && !isVideoModeRef.current) {
            beginSynchronousNativeAudio(q[0], 0);
          }
          setCurrentIndex(0);
        } else if (isRadioModeRef.current && q[idx]) {
          void replenishRadioQueue(q[idx], true);
        }
        return;
      }

      if (code === 101 || code === 150) {
        setPlayerError('Playback disabled by the video owner for embedded players.');
      } else if (code === 100) {
        setPlayerError('This track is no longer available on YouTube.');
      } else {
        setPlayerError('Unable to play this YouTube stream. Try another track.');
      }
    },
    [beginSynchronousNativeAudio, replenishRadioQueue, showToast]
  );

  // Load official YouTube IFrame Player API once
  useEffect(() => {
    const initPlayer = () => {
      if (ytPlayerRef.current || !playerHostRef.current || !window.YT?.Player) return;

      const mountEl = document.createElement('div');
      playerHostRef.current.innerHTML = '';
      playerHostRef.current.appendChild(mountEl);

      ytPlayerRef.current = new window.YT.Player(mountEl, {
        width: '100%',
        height: '100%',
        playerVars: {
          autoplay: 1,
          controls: 1,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          enablejsapi: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: (e) => {
            ytReadyRef.current = true;
            e.target.setVolume(volumeRef.current);
            if (isMutedRef.current) e.target.mute();
            if (pendingTrackIdRef.current && activeEngineRef.current === 'youtube') {
              const vid = pendingTrackIdRef.current;
              const startAt = pendingYtSeekSecRef.current;
              loadedYtVideoIdRef.current = vid;
              pendingTrackIdRef.current = null;
              if (startAt > 0.5) {
                e.target.loadVideoById({ videoId: vid, startSeconds: Math.floor(startAt) });
              } else {
                e.target.loadVideoById(vid);
              }
            }
          },
          onStateChange: (e) => {
            if (activeEngineRef.current !== 'youtube') return;
            const state = e.data;
            const PS = window.YT?.PlayerState;
            if (!PS) return;
            if (state === PS.PLAYING) {
              consecutiveErrorsRef.current = 0;
              bgResumeAttemptsRef.current = 0;
              shouldPlayRef.current = true;
              userPausedRef.current = false;
              setIsPlaying(true);
              setIsBuffering(false);
              setPlayerError(null);
              setBackgroundBlockedHint(null);
              const dur = e.target.getDuration();
              if (dur > 0) setDuration(dur);
              const targetYtSec = pendingYtSeekSecRef.current;
              if (targetYtSec > 0.5) {
                const curYt = e.target.getCurrentTime() || 0;
                if (Math.abs(curYt - targetYtSec) > 2.2) {
                  try {
                    e.target.seekTo(targetYtSec, true);
                  } catch {
                    // ignore
                  }
                }
                pendingYtSeekSecRef.current = 0;
              }
              if (isBackgroundPlayRef.current) {
                startWebAudioKeepAlive();
                void acquirePlaybackWakeLock();
              }
            } else if (state === PS.PAUSED) {
              const recentlyHidden =
                document.hidden || Date.now() - hiddenAtRef.current < 4500;
              if (
                isBackgroundPlayRef.current &&
                shouldPlayRef.current &&
                !userPausedRef.current &&
                recentlyHidden
              ) {
                const delays = [100, 280, 550, 900, 1400];
                if (bgResumeAttemptsRef.current < delays.length) {
                  const delay = delays[bgResumeAttemptsRef.current];
                  bgResumeAttemptsRef.current += 1;
                  window.setTimeout(() => {
                    if (
                      activeEngineRef.current === 'youtube' &&
                      shouldPlayRef.current &&
                      !userPausedRef.current
                    ) {
                      try {
                        e.target.playVideo();
                      } catch {
                        // ignore
                      }
                    }
                  }, delay);
                  return;
                }
                const inIframe = (() => {
                  try {
                    return window.self !== window.top;
                  } catch {
                    return true;
                  }
                })();
                setBackgroundBlockedHint(
                  inIframe
                    ? 'Background audio for this video-only track is restricted inside AI Studio preview. Tap "Open Full App" to open VIBRA directly in Chrome.'
                    : 'This track uses the YouTube player, which Mobile Chrome pauses when minimized. Turn on Chrome Menu (⋮) → Desktop site for continuous background play on video-only tracks.'
                );
              }
              setIsPlaying(false);
              setIsBuffering(false);
              stopWebAudioKeepAlive();
              void releasePlaybackWakeLock();
            } else if (state === PS.CUED) {
              if (shouldPlayRef.current && !userPausedRef.current) {
                try {
                  e.target.playVideo();
                } catch {
                  // ignore
                }
              }
            } else if (state === PS.BUFFERING) {
              setIsBuffering(true);
            } else if (state === PS.ENDED) {
              setIsBuffering(false);
              handleTrackEnd();
            }
          },
          onError: (e) => {
            if (activeEngineRef.current !== 'youtube') return;
            setIsBuffering(false);
            setIsPlaying(false);
            stopWebAudioKeepAlive();
            handleEmbedErrorSkip(e.data);
          },
        },
      });
    };

    if (window.YT?.Player) {
      initPlayer();
      return;
    }

    const existingScript = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
    const prevCallback = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (prevCallback) prevCallback();
      initPlayer();
    };

    if (!existingScript) {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
    }

    return () => {
      if (ytPlayerRef.current) {
        try {
          ytPlayerRef.current.destroy();
        } catch {
          // ignore
        }
        ytPlayerRef.current = null;
        ytReadyRef.current = false;
      }
    };
  }, [handleTrackEnd, handleEmbedErrorSkip]);

  // Sync state & pre-warm upcoming tracks when currentTrack changes
  useEffect(() => {
    if (!currentTrack) {
      resolveAbortRef.current?.abort();
      loadedTrackIdRef.current = null;
      activeEngineRef.current = 'none';
      shouldPlayRef.current = false;
      stopNativeAudio();
      try {
        ytPlayerRef.current?.pauseVideo();
      } catch {
        // ignore
      }
      stopWebAudioKeepAlive();
      void releasePlaybackWakeLock();
      return;
    }
    if (loadedTrackIdRef.current === currentTrack.id) {
      return;
    }

    resolveAbortRef.current?.abort();
    const controller = new AbortController();
    resolveAbortRef.current = controller;

    loadedTrackIdRef.current = currentTrack.id;
    endedHandledForLoadRef.current = null;
    bgResumeAttemptsRef.current = 0;
    pendingSeekSecRef.current = 0;
    pendingYtSeekSecRef.current = 0;
    currentTimeRef.current = 0;
    shouldPlayRef.current = true;
    userPausedRef.current = false;
    shuffleHistoryRef.current.add(currentTrack.id);
    setCurrentTime(0);
    setDuration(currentTrack.durationSeconds || 0);
    setPlayerError(null);
    setBackgroundBlockedHint(null);
    setIsBuffering(true);
    recordPlayed(currentTrack);

    if (isBackgroundPlayRef.current) {
      startWebAudioKeepAlive();
      void acquirePlaybackWakeLock();
    }

    // Pre-fetch the current track (even if in video mode) + next 5 upcoming tracks sequentially into RAM Blob cache
    // so 10-20+ consecutive songs transition instantaneously even when screen is off
    void fetchTrackAudioBlobUrl(currentTrack);
    const prewarmTimer = window.setTimeout(() => {
      void (async () => {
        const q = queueRef.current;
        const idx = currentIndexRef.current;
        for (const offset of [1, 2, 3, 4, 5]) {
          if (controller.signal.aborted) break;
          const upcoming = q[idx + offset];
          if (upcoming && upcoming.id !== currentTrack.id) {
            await fetchTrackAudioBlobUrl(upcoming);
          }
        }
      })();
    }, 350);

    if (isVideoModeRef.current) {
      stopNativeAudio();
      startYouTubeTrack(currentTrack.id, 0);
      return () => window.clearTimeout(prewarmTimer);
    }

    // If beginSynchronousNativeAudio already started this track inside the user gesture, DO NOT reset <audio>!
    if (activeEngineRef.current === 'audio' && loadedAudioTrackIdRef.current === currentTrack.id) {
      return () => window.clearTimeout(prewarmTimer);
    }

    beginSynchronousNativeAudio(currentTrack, 0);
    return () => window.clearTimeout(prewarmTimer);
  }, [
    currentTrack,
    recordPlayed,
    beginSynchronousNativeAudio,
    startYouTubeTrack,
    stopNativeAudio,
  ]);

  // Switch seamlessly between Audio (<audio>) and Video (YouTube IFrame) without losing playback position
  useEffect(() => {
    if (!currentTrack || loadedTrackIdRef.current !== currentTrack.id) return;

    if (isVideoMode && activeEngineRef.current === 'audio') {
      const audioTime =
        !isSilentWarmupRef.current && audioElRef.current && !audioElRef.current.src.startsWith('data:')
          ? audioElRef.current.currentTime || 0
          : 0;
      const resumeSec = Math.max(audioTime, currentTimeRef.current, pendingSeekSecRef.current);
      stopNativeAudio();
      startYouTubeTrack(currentTrack.id, resumeSec);
    } else if (!isVideoMode && activeEngineRef.current === 'youtube') {
      const ytTime = ytPlayerRef.current?.getCurrentTime() || 0;
      const resumeSec = Math.max(ytTime, currentTimeRef.current, pendingYtSeekSecRef.current);
      beginSynchronousNativeAudio(currentTrack, resumeSec);
    }
  }, [isVideoMode, currentTrack, beginSynchronousNativeAudio, startYouTubeTrack, stopNativeAudio]);

  // Lazy-fetch related tracks only when user expands the player OR Radio is on the final track (prevents burning 100 quota units per skip)
  useEffect(() => {
    if (!currentTrack) {
      relatedFetchedForIdRef.current = null;
      setRelatedTracks([]);
      return;
    }

    if (relatedFetchedForIdRef.current !== currentTrack.id) {
      setRelatedTracks([]);
    }

    const remainingCount = queue.length - 1 - currentIndex;
    const needsRelatedNow =
      isExpanded || (isRadioMode && remainingCount < 10);
    if (!needsRelatedNow || relatedFetchedForIdRef.current === currentTrack.id) {
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      relatedFetchedForIdRef.current = currentTrack.id;
      setIsLoadingRelated(true);
      const exclude = queueRef.current.map((t) => t.id);

      fetchRelatedTracks(currentTrack, exclude, controller.signal)
        .then((tracks) => {
          if (!controller.signal.aborted) {
            setRelatedTracks(tracks);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            relatedFetchedForIdRef.current = null;
            setRelatedTracks([]);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setIsLoadingRelated(false);
          }
        });
    }, 600);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [currentTrack?.id, isExpanded, isRadioMode, currentIndex, queue.length]);

  // Proactively pre-fill Infinite Radio to keep at least 12-15 upcoming songs ready so background playback never runs dry
  useEffect(() => {
    if (!isRadioMode || !currentTrack) return;
    const remainingCount = queue.length - 1 - currentIndex;
    if (currentIndex >= 0 && remainingCount < 10 && relatedTracks.length > 0 && !radioFetchingRef.current) {
      const existing = new Set(queue.map((t) => t.id));
      const candidates = relatedTracks.filter((t) => !existing.has(t.id)).slice(0, 12);
      if (candidates.length > 0) {
        setQueue((prev) => {
          const seen = new Set(prev.map((t) => t.id));
          const add = candidates.filter((t) => !seen.has(t.id));
          return add.length > 0 ? [...prev, ...add] : prev;
        });
      }
    }
  }, [isRadioMode, currentTrack, currentIndex, queue.length, relatedTracks, queue]);

  // Track background visibility transitions + ensure continuous background playback (including auto-handoff from Video to Audio on tab switch)
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden) {
        hiddenAtRef.current = Date.now();
        bgResumeAttemptsRef.current = 0;

        if (
          activeEngineRef.current === 'audio' &&
          isBackgroundPlayRef.current &&
          shouldPlayRef.current &&
          !userPausedRef.current
        ) {
          for (const waitMs of [50, 220, 600]) {
            window.setTimeout(() => {
              const a = audioElRef.current;
              if (
                activeEngineRef.current === 'audio' &&
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
        } else if (
          activeEngineRef.current === 'youtube' &&
          isBackgroundPlayRef.current &&
          shouldPlayRef.current &&
          !userPausedRef.current
        ) {
          // Hand off immediately from Video (YouTube IFrame) to native <audio> whenever app enters background or screen locks!
          const curTrack = queueRef.current[currentIndexRef.current];
          if (curTrack) {
            const resumeSec = ytPlayerRef.current?.getCurrentTime() ?? currentTimeRef.current ?? 0;
            isVideoModeRef.current = false;
            setIsVideoMode(false);
            beginSynchronousNativeAudio(curTrack, resumeSec);
            return;
          }

          for (const waitMs of [250, 750]) {
            window.setTimeout(() => {
              const p = ytPlayerRef.current;
              const PS = window.YT?.PlayerState;
              if (
                activeEngineRef.current !== 'youtube' ||
                !p ||
                !PS ||
                !shouldPlayRef.current ||
                userPausedRef.current ||
                !document.hidden
              ) {
                return;
              }
              try {
                const st = p.getPlayerState();
                if (st === PS.PAUSED || st === PS.CUED) {
                  p.playVideo();
                }
              } catch {
                // ignore
              }
            }, waitMs);
          }
        }
      } else if (activeEngineRef.current === 'youtube') {
        const p = ytPlayerRef.current;
        const PS = window.YT?.PlayerState;
        if (p && PS) {
          try {
            const st = p.getPlayerState();
            if (st === PS.PLAYING) {
              setIsPlaying(true);
              setIsBuffering(false);
              setBackgroundBlockedHint(null);
              if (isBackgroundPlayRef.current) {
                startWebAudioKeepAlive();
                void acquirePlaybackWakeLock();
              }
            } else if (st === PS.ENDED) {
              handleTrackEnd();
            } else if (st === PS.PAUSED) {
              setIsPlaying(false);
              setIsBuffering(false);
            }
          } catch {
            // ignore
          }
        }
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [beginSynchronousNativeAudio, handleTrackEnd]);

  // Poll YouTube playback progress when YouTube engine is active (native <audio> emits timeupdate/ended natively)
  useEffect(() => {
    const shouldMonitor =
      isPlaying || (isBackgroundPlay && Boolean(currentTrack) && shouldPlayRef.current && !userPausedRef.current);
    if (!shouldMonitor) return;
    let tickCount = 0;
    const timer = window.setInterval(() => {
      if (activeEngineRef.current !== 'youtube') return;
      const p = ytPlayerRef.current;
      if (p) {
        try {
          const PS = window.YT?.PlayerState;
          const st = p.getPlayerState();
          const cur = p.getCurrentTime();
          const dur = p.getDuration();
          if (typeof cur === 'number' && !Number.isNaN(cur)) {
            const pendingYt = pendingYtSeekSecRef.current;
            if (pendingYt > 0.5) {
              if (Math.abs(cur - pendingYt) < 2.5) {
                pendingYtSeekSecRef.current = 0;
                currentTimeRef.current = cur;
                setCurrentTime(cur);
              } else if (PS && st === PS.PLAYING) {
                try {
                  p.seekTo(pendingYt, true);
                } catch {
                  // ignore
                }
              }
            } else if (PS && (st === PS.PLAYING || cur > 0.2)) {
              currentTimeRef.current = cur;
              setCurrentTime(cur);
            }
          }
          if (typeof dur === 'number' && dur > 0) setDuration(dur);

          if (tickCount % 4 === 0 && 'mediaSession' in navigator && typeof navigator.mediaSession.setPositionState === 'function') {
            const effDur = dur > 0 ? dur : currentTrack?.durationSeconds || 0;
            if (effDur > 0 && cur >= 0 && cur <= effDur) {
              try {
                navigator.mediaSession.setPositionState({
                  duration: effDur,
                  playbackRate: 1,
                  position: cur,
                });
              } catch {
                // ignore unsupported
              }
            }
          }

          if (PS && st === PS.ENDED) {
            handleTrackEnd();
          } else if (
            isBackgroundPlayRef.current &&
            document.hidden &&
            dur > 10 &&
            cur >= dur - 0.6 &&
            shouldPlayRef.current &&
            !userPausedRef.current
          ) {
            handleTrackEnd();
          }

          if (PS && st === PS.PLAYING) {
            tickCount += 1;
            if (tickCount % 10 === 0) {
              recordListeningSeconds(5);
            }
          }
        } catch {
          // ignore
        }
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [isPlaying, isBackgroundPlay, currentTrack, handleTrackEnd, recordListeningSeconds]);

  // Track native <audio> listening seconds cleanly (5s interval when audio is actively playing)
  useEffect(() => {
    if (!isPlaying || activeEngineRef.current !== 'audio') return;
    const timer = window.setInterval(() => {
      if (activeEngineRef.current === 'audio' && audioElRef.current && !audioElRef.current.paused) {
        recordListeningSeconds(5);
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [isPlaying, recordListeningSeconds]);

  const playTrack = useCallback(
    (track: Track, newQueue?: Track[], openVideo?: boolean) => {
      window.dispatchEvent(new CustomEvent('vibra:pause-offline-player'));
      isYieldedToOfflineRef.current = false;
      setIsYieldedToOffline(false);
      consecutiveErrorsRef.current = 0;
      bgSkipStreakRef.current = 0;
      shouldPlayRef.current = true;
      userPausedRef.current = false;
      bgResumeAttemptsRef.current = 0;
      setBackgroundBlockedHint(null);
      if (isBackgroundPlayRef.current) {
        startWebAudioKeepAlive();
        void acquirePlaybackWakeLock();
      }

      const wantVideo = Boolean(openVideo || track.isVideo);
      if (wantVideo) {
        isVideoModeRef.current = true;
        setIsVideoMode(true);
        setIsExpanded(true);
        stopNativeAudio();
        startYouTubeTrack(track.id, 0);
      } else {
        isVideoModeRef.current = false;
        setIsVideoMode(false);
        beginSynchronousNativeAudio(track, 0);
      }

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
    [beginSynchronousNativeAudio, startYouTubeTrack, stopNativeAudio]
  );

  const startTrackRadio = useCallback(
    (track: Track) => {
      window.dispatchEvent(new CustomEvent('vibra:pause-offline-player'));
      isYieldedToOfflineRef.current = false;
      setIsYieldedToOffline(false);
      consecutiveErrorsRef.current = 0;
      bgSkipStreakRef.current = 0;
      shouldPlayRef.current = true;
      userPausedRef.current = false;
      bgResumeAttemptsRef.current = 0;
      setBackgroundBlockedHint(null);
      if (isBackgroundPlayRef.current) {
        startWebAudioKeepAlive();
        void acquirePlaybackWakeLock();
      }
      if (!isVideoModeRef.current) {
        beginSynchronousNativeAudio(track, 0);
      }
      setIsRadioMode(true);
      localStorage.setItem('vibra_radio_mode', 'true');
      setQueue([track]);
      setCurrentIndex(0);
      showToast(`Infinite Radio started from "${track.title}"`);
      void replenishRadioQueue(track, false);
    },
    [beginSynchronousNativeAudio, replenishRadioQueue, showToast]
  );

  const addToQueue = useCallback(
    (track: Track) => {
      setQueue((prev) => {
        if (prev.length === 0) {
          setCurrentIndex(0);
          return [track];
        }
        if (prev.some((t) => t.id === track.id)) {
          showToast(`"${track.title}" is already in queue`);
          return prev;
        }
        showToast(`Added "${track.title}" to queue`);
        return [...prev, track];
      });
    },
    [showToast]
  );

  const playNextInQueue = useCallback(
    (track: Track) => {
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

  const removeFromQueue = useCallback(
    (index: number) => {
      setQueue((prev) => {
        if (index < 0 || index >= prev.length) return prev;
        const next = prev.filter((_, i) => i !== index);
        if (next.length === 0) {
          shouldPlayRef.current = false;
          userPausedRef.current = true;
          activeEngineRef.current = 'none';
          stopNativeAudio();
          stopWebAudioKeepAlive();
          void releasePlaybackWakeLock();
          setCurrentIndex(-1);
          setIsPlaying(false);
          ytPlayerRef.current?.pauseVideo();
        } else if (index < currentIndexRef.current) {
          setCurrentIndex(currentIndexRef.current - 1);
        } else if (index === currentIndexRef.current) {
          const clamped = Math.min(index, next.length - 1);
          setCurrentIndex(clamped);
        }
        return next;
      });
    },
    [stopNativeAudio]
  );

  const moveQueueItem = useCallback((fromIndex: number, toIndex: number) => {
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
      if (cur === fromIndex) {
        setCurrentIndex(toIndex);
      } else if (fromIndex < cur && toIndex >= cur) {
        setCurrentIndex(cur - 1);
      } else if (fromIndex > cur && toIndex <= cur) {
        setCurrentIndex(cur + 1);
      }
      return next;
    });
  }, []);

  const shuffleUpcomingQueue = useCallback(() => {
    const q = queueRef.current;
    const cur = currentIndexRef.current;
    if (q.length - (cur + 1) < 2) {
      showToast('Add at least 2 upcoming tracks to shuffle');
      return;
    }
    const prefix = cur >= 0 ? q.slice(0, cur + 1) : [];
    const upcoming = cur >= 0 ? [...q.slice(cur + 1)] : [...q];
    for (let i = upcoming.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [upcoming[i], upcoming[j]] = [upcoming[j], upcoming[i]];
    }
    setQueue([...prefix, ...upcoming]);
    showToast('Shuffled upcoming queue');
  }, [showToast]);

  const saveQueueAsPlaylist = useCallback(
    (name?: string) => {
      const q = queueRef.current;
      if (q.length === 0) return;
      const curTitle = currentIndexRef.current >= 0 ? q[currentIndexRef.current]?.title : '';
      const defaultName = curTitle
        ? `${curTitle.replace(/\(.*?\)|\[.*?\]/g, '').trim().slice(0, 26)} Radio`
        : 'VIBRA Queue Mix';
      createPlaylistWithTracks(
        name?.trim() || defaultName,
        q,
        'Saved from active VIBRA playback queue'
      );
    },
    [createPlaylistWithTracks]
  );

  const clearQueue = useCallback(() => {
    const cur = currentIndexRef.current >= 0 ? queueRef.current[currentIndexRef.current] : null;
    if (cur) {
      setQueue([cur]);
      setCurrentIndex(0);
      showToast('Cleared upcoming queue');
    } else {
      setQueue([]);
      setCurrentIndex(-1);
    }
  }, [showToast]);

  const togglePlay = useCallback(() => {
    if (!currentTrack) return;

    if (activeEngineRef.current === 'audio' && audioElRef.current) {
      const audio = audioElRef.current;
      if (!audio.paused) {
        userPausedRef.current = true;
        shouldPlayRef.current = false;
        stopWebAudioKeepAlive();
        void releasePlaybackWakeLock();
        audio.pause();
      } else {
        window.dispatchEvent(new CustomEvent('vibra:pause-offline-player'));
        isYieldedToOfflineRef.current = false;
        setIsYieldedToOffline(false);
        userPausedRef.current = false;
        shouldPlayRef.current = true;
        bgResumeAttemptsRef.current = 0;
        setBackgroundBlockedHint(null);
        if (isBackgroundPlayRef.current) {
          startWebAudioKeepAlive();
          void acquirePlaybackWakeLock();
        }
        if (!audio.getAttribute('src') || audio.src.startsWith('data:')) {
          beginSynchronousNativeAudio(currentTrack, currentTime);
        } else {
          void audio.play().catch(() => {});
        }
      }
      return;
    }

    window.dispatchEvent(new CustomEvent('vibra:pause-offline-player'));
    isYieldedToOfflineRef.current = false;
    setIsYieldedToOffline(false);

    unlockAudioFromGesture();
    const p = ytPlayerRef.current;
    if (!p) return;
    const PS = window.YT?.PlayerState;
    let actuallyPlaying = isPlaying;
    try {
      if (PS) {
        actuallyPlaying = p.getPlayerState() === PS.PLAYING;
      }
    } catch {
      // ignore
    }

    if (actuallyPlaying) {
      userPausedRef.current = true;
      shouldPlayRef.current = false;
      stopWebAudioKeepAlive();
      void releasePlaybackWakeLock();
      p.pauseVideo();
    } else {
      userPausedRef.current = false;
      shouldPlayRef.current = true;
      bgResumeAttemptsRef.current = 0;
      setBackgroundBlockedHint(null);
      if (isBackgroundPlayRef.current) {
        startWebAudioKeepAlive();
        void acquirePlaybackWakeLock();
      }
      p.playVideo();
    }
  }, [isPlaying, currentTrack, currentTime, beginSynchronousNativeAudio, unlockAudioFromGesture]);

  const nextTrack = useCallback(() => {
    const q = queueRef.current;
    const idx = currentIndexRef.current;
    if (q.length === 0) return;
    shouldPlayRef.current = true;
    userPausedRef.current = false;
    bgResumeAttemptsRef.current = 0;
    if (isBackgroundPlayRef.current) {
      startWebAudioKeepAlive();
      void acquirePlaybackWakeLock();
    }
    if (isShuffleRef.current && q.length > 1) {
      const nextIdx = pickNextShuffleIndex(q, idx);
      if (q[nextIdx] && !isVideoModeRef.current) {
        beginSynchronousNativeAudio(q[nextIdx], 0);
      }
      setCurrentIndex(nextIdx);
      return;
    }
    if (idx + 1 < q.length) {
      if (q[idx + 1] && !isVideoModeRef.current) {
        beginSynchronousNativeAudio(q[idx + 1], 0);
      }
      setCurrentIndex(idx + 1);
    } else if (isRadioModeRef.current && q[idx]) {
      unlockAudioFromGesture();
      void replenishRadioQueue(q[idx], true);
    } else {
      if (q[0] && !isVideoModeRef.current) {
        beginSynchronousNativeAudio(q[0], 0);
      }
      setCurrentIndex(0);
    }
  }, [beginSynchronousNativeAudio, pickNextShuffleIndex, replenishRadioQueue, unlockAudioFromGesture]);

  const prevTrack = useCallback(() => {
    const q = queueRef.current;
    const idx = currentIndexRef.current;
    if (q.length === 0) return;
    shouldPlayRef.current = true;
    userPausedRef.current = false;
    bgResumeAttemptsRef.current = 0;
    if (isBackgroundPlayRef.current) {
      startWebAudioKeepAlive();
      void acquirePlaybackWakeLock();
    }
    if (currentTime > 4) {
      if (activeEngineRef.current === 'audio' && audioElRef.current) {
        audioElRef.current.currentTime = 0;
      } else {
        ytPlayerRef.current?.seekTo(0, true);
      }
      setCurrentTime(0);
      return;
    }
    const targetIdx = idx - 1 >= 0 ? idx - 1 : q.length - 1;
    if (q[targetIdx] && !isVideoModeRef.current) {
      beginSynchronousNativeAudio(q[targetIdx], 0);
    }
    setCurrentIndex(targetIdx);
  }, [beginSynchronousNativeAudio, currentTime]);

  const seekTo = useCallback((seconds: number) => {
    currentTimeRef.current = seconds;
    setCurrentTime(seconds);
    if (activeEngineRef.current === 'audio' && audioElRef.current) {
      const a = audioElRef.current;
      if (isSilentWarmupRef.current || !Number.isFinite(a.duration) || a.duration <= 3) {
        pendingSeekSecRef.current = seconds;
      } else {
        pendingSeekSecRef.current = 0;
        a.currentTime = seconds;
      }
    } else {
      pendingYtSeekSecRef.current = seconds;
      ytPlayerRef.current?.seekTo(seconds, true);
    }
  }, []);

  const setVolume = useCallback(
    (vol: number) => {
      const clamped = Math.max(0, Math.min(100, vol));
      setVolumeState(clamped);
      localStorage.setItem('vibra_volume', String(clamped));
      if (audioElRef.current) {
        audioElRef.current.volume = clamped / 100;
        if (clamped > 0) audioElRef.current.muted = false;
      }
      ytPlayerRef.current?.setVolume(clamped);
      if (clamped > 0 && isMuted) {
        ytPlayerRef.current?.unMute();
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
      ytPlayerRef.current?.unMute();
      setIsMuted(false);
    } else {
      if (audioElRef.current) {
        audioElRef.current.muted = true;
      }
      ytPlayerRef.current?.mute();
      setIsMuted(true);
    }
  }, [isMuted]);

  const cycleRepeat = useCallback(() => {
    setRepeatMode((prev) => (prev === 'off' ? 'all' : prev === 'all' ? 'one' : 'off'));
  }, []);

  const toggleShuffle = useCallback(() => {
    setIsShuffle((prev) => !prev);
  }, []);

  const toggleRadioMode = useCallback(() => {
    setIsRadioMode((prev) => {
      const next = !prev;
      localStorage.setItem('vibra_radio_mode', String(next));
      showToast(next ? 'Infinite Radio enabled' : 'Infinite Radio paused');
      return next;
    });
  }, [showToast]);

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
      showToast(next ? 'Background continuity & keep-awake enabled' : 'Background continuity paused');
      return next;
    });
  }, [isPlaying, showToast]);

  const jumpToQueueIndex = useCallback(
    (index: number) => {
      if (index >= 0 && index < queueRef.current.length) {
        shouldPlayRef.current = true;
        userPausedRef.current = false;
        bgResumeAttemptsRef.current = 0;
        if (isBackgroundPlayRef.current) {
          startWebAudioKeepAlive();
          void acquirePlaybackWakeLock();
        }
        const targetTrack = queueRef.current[index];
        if (targetTrack && !isVideoModeRef.current) {
          beginSynchronousNativeAudio(targetTrack, 0);
        } else {
          unlockAudioFromGesture();
        }
        setCurrentIndex(index);
      }
    },
    [beginSynchronousNativeAudio, unlockAudioFromGesture]
  );

  const nextTrackRef = useRef(nextTrack);
  const prevTrackRef = useRef(prevTrack);
  nextTrackRef.current = nextTrack;
  prevTrackRef.current = prevTrack;

  useEffect(() => {
    void registerVibraServiceWorker();

    const handlePauseFromOffline = () => {
      isYieldedToOfflineRef.current = true;
      setIsYieldedToOffline(true);
      setIsExpanded(false);
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
      try {
        ytPlayerRef.current?.pauseVideo();
      } catch {
        // ignore
      }
      setIsPlaying(false);
    };

    window.addEventListener('vibra:pause-online-player', handlePauseFromOffline);
    return () => {
      window.removeEventListener('vibra:pause-online-player', handlePauseFromOffline);
      stopWebAudioKeepAlive();
      void releasePlaybackWakeLock();
    };
  }, []);

  // Sync browser tab title with currently playing track (when online player is active)
  useEffect(() => {
    if (isYieldedToOffline) return;
    if (!currentTrack) {
      document.title = 'VIBRA — AI Music Discovery & Streaming';
      return;
    }

    document.title = `${isPlaying ? '▶ ' : ''}${currentTrack.title} · ${currentTrack.artist} — VIBRA`;
  }, [currentTrack, isPlaying, isYieldedToOffline]);

  // OS / Lock-screen / Android & Desktop Notification Shade MediaSession integration
  useEffect(() => {
    if (isYieldedToOffline) return;
    if (!('mediaSession' in navigator)) return;
    if (!currentTrack) {
      navigator.mediaSession.playbackState = 'none';
      return;
    }
    try {
      const artThumb = currentTrack.thumbnail || `https://i.ytimg.com/vi/${currentTrack.id}/mqdefault.jpg`;
      const artHigh = currentTrack.thumbnailHigh || `https://i.ytimg.com/vi/${currentTrack.id}/hqdefault.jpg`;
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.title,
        artist: currentTrack.artist,
        album: isRadioMode ? 'VIBRA · Infinite Radio' : 'VIBRA Music',
        artwork: [
          { src: artThumb, sizes: '320x180', type: 'image/jpeg' },
          { src: artHigh, sizes: '480x360', type: 'image/jpeg' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
        ],
      });
      navigator.mediaSession.playbackState =
        isPlaying || (shouldPlayRef.current && !userPausedRef.current && isBackgroundPlay)
          ? 'playing'
          : 'paused';

      navigator.mediaSession.setActionHandler('play', () => {
        userPausedRef.current = false;
        shouldPlayRef.current = true;
        bgResumeAttemptsRef.current = 0;
        if (isBackgroundPlayRef.current) void acquirePlaybackWakeLock();
        if (activeEngineRef.current === 'audio' && audioElRef.current) {
          void audioElRef.current.play().catch(() => {});
        } else {
          ytPlayerRef.current?.playVideo();
        }
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        userPausedRef.current = true;
        shouldPlayRef.current = false;
        void releasePlaybackWakeLock();
        if (activeEngineRef.current === 'audio' && audioElRef.current) {
          audioElRef.current.pause();
        } else {
          ytPlayerRef.current?.pauseVideo();
        }
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
        const cur =
          activeEngineRef.current === 'audio'
            ? (audioElRef.current?.currentTime ?? 0)
            : (ytPlayerRef.current?.getCurrentTime() ?? 0);
        seekTo(Math.max(0, cur - offset));
      });
      navigator.mediaSession.setActionHandler('seekforward', (details) => {
        const offset = details.seekOffset || 10;
        const cur =
          activeEngineRef.current === 'audio'
            ? (audioElRef.current?.currentTime ?? 0)
            : (ytPlayerRef.current?.getCurrentTime() ?? 0);
        const dur =
          activeEngineRef.current === 'audio'
            ? (audioElRef.current?.duration ?? 0)
            : (ytPlayerRef.current?.getDuration() ?? 0);
        seekTo(dur > 0 ? Math.min(dur, cur + offset) : cur + offset);
      });
    } catch {
      // ignore unsupported MediaSession handlers
    }
  }, [currentTrack, isPlaying, isRadioMode, isBackgroundPlay, isYieldedToOffline, seekTo]);

  return (
    <PlayerContext.Provider
      value={{
        currentTrack: isYieldedToOffline ? null : currentTrack,
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
        isRadioMode,
        isLoadingRadio,
        isExpanded,
        isVideoMode,
        isQueueOpen,
        isBackgroundPlay,
        relatedTracks,
        isLoadingRelated,
        playerError,
        backgroundBlockedHint,
        clearBackgroundBlockedHint: () => setBackgroundBlockedHint(null),
        playerHostRef,
        playTrack,
        startTrackRadio,
        addToQueue,
        playNextInQueue,
        removeFromQueue,
        moveQueueItem,
        shuffleUpcomingQueue,
        saveQueueAsPlaylist,
        clearQueue,
        togglePlay,
        nextTrack,
        prevTrack,
        seekTo,
        setVolume,
        toggleMute,
        cycleRepeat,
        toggleShuffle,
        toggleRadioMode,
        toggleBackgroundPlay,
        setIsExpanded,
        setMobilePlayerView,
        setIsVideoMode,
        setIsQueueOpen,
        jumpToQueueIndex,
        mobilePlayerView,
      }}
    >
      <audio
        ref={audioElRef}
        preload="auto"
        playsInline
        className="hidden"
        onPlaying={() => {
          if (activeEngineRef.current !== 'audio') return;
          audioUnlockedRef.current = true;
          if (isSilentWarmupRef.current) return;
          const a = audioElRef.current;
          if (a && pendingSeekSecRef.current > 0.5) {
            applyPendingAudioSeek(a);
          }
          consecutiveErrorsRef.current = 0;
          bgSkipStreakRef.current = 0;
          setIsPlaying(true);
          setIsBuffering(false);
          setPlayerError(null);
          setBackgroundBlockedHint(null);
          if (isBackgroundPlayRef.current) {
            void acquirePlaybackWakeLock();
          }
        }}
        onPause={() => {
          if (activeEngineRef.current !== 'audio') return;
          if (isSilentWarmupRef.current) return;
          const a = audioElRef.current;
          if (!a || a.src.startsWith('data:')) return;
          if (!a.ended) {
            const recentlyHidden =
              document.hidden || Date.now() - hiddenAtRef.current < 8000;
            if (
              isBackgroundPlayRef.current &&
              shouldPlayRef.current &&
              !userPausedRef.current &&
              recentlyHidden
            ) {
              for (const retryMs of [40, 180, 450, 950]) {
                window.setTimeout(() => {
                  if (
                    activeEngineRef.current === 'audio' &&
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
                  activeEngineRef.current === 'audio' &&
                  a.paused &&
                  !a.ended &&
                  (!shouldPlayRef.current || userPausedRef.current)
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
        onWaiting={() => {
          if (activeEngineRef.current !== 'audio') return;
          if (isSilentWarmupRef.current) return;
          const a = audioElRef.current;
          if (a?.src?.startsWith('data:')) return;
          setIsBuffering(true);
        }}
        onLoadedMetadata={(e) => {
          if (activeEngineRef.current !== 'audio') return;
          if (isSilentWarmupRef.current) return;
          const a = e.currentTarget;
          if (a.src.startsWith('data:')) return;
          if (pendingSeekSecRef.current > 0.5) {
            applyPendingAudioSeek(a);
          }
        }}
        onCanPlay={() => {
          if (activeEngineRef.current !== 'audio') return;
          if (isSilentWarmupRef.current) return;
          const a = audioElRef.current;
          if (!a || a.src.startsWith('data:')) return;
          if (pendingSeekSecRef.current > 0.5) {
            applyPendingAudioSeek(a);
          }
          setIsBuffering(false);
        }}
        onDurationChange={(e) => {
          if (activeEngineRef.current !== 'audio') return;
          if (isSilentWarmupRef.current) return;
          const a = e.currentTarget;
          const dur = a.duration;
          if (Number.isFinite(dur) && dur > 5) {
            setDuration(dur);
            if (pendingSeekSecRef.current > 0.5) {
              applyPendingAudioSeek(a);
            }
          }
        }}
        onTimeUpdate={(e) => {
          if (activeEngineRef.current !== 'audio') return;
          if (isSilentWarmupRef.current) return;
          const a = e.currentTarget;
          if (a.src.startsWith('data:')) return;
          if (pendingSeekSecRef.current > 0.5) {
            applyPendingAudioSeek(a);
            if (pendingSeekSecRef.current > 0.5) {
              return;
            }
          }
          const cur = a.currentTime;
          const dur = Number.isFinite(a.duration) && a.duration > 5 ? a.duration : currentTrack?.durationSeconds || 0;
          if (Number.isFinite(cur)) {
            currentTimeRef.current = cur;
            setCurrentTime(cur);
          }

          const now = Date.now();
          if (
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
          if (activeEngineRef.current !== 'audio') return;
          if (isSilentWarmupRef.current) return;
          const a = audioElRef.current;
          if (a?.src?.startsWith('data:') || a?.loop) return;
          setIsBuffering(false);
          handleTrackEnd();
        }}
        onError={() => {
          if (activeEngineRef.current !== 'audio') return;
          if (isSilentWarmupRef.current) return;
          const a = audioElRef.current;
          if (!a || !a.getAttribute('src') || a.src.startsWith('data:')) return;
          const resumeAt = a.currentTime || 0;
          const track = queueRef.current[currentIndexRef.current];
          stopNativeAudio();
          if (
            document.hidden &&
            isBackgroundPlayRef.current &&
            shouldPlayRef.current &&
            !userPausedRef.current &&
            queueRef.current.length > 1 &&
            bgSkipStreakRef.current < 8
          ) {
            bgSkipStreakRef.current += 1;
            const q = queueRef.current;
            const nextIdx = (currentIndexRef.current + 1) % q.length;
            const nextTrackItem = q[nextIdx];
            if (nextTrackItem && !isVideoModeRef.current) {
              beginSynchronousNativeAudio(nextTrackItem, 0);
            }
            setCurrentIndex(nextIdx);
            return;
          }
          if (track) {
            startYouTubeTrack(track.id, resumeAt);
          }
        }}
      />
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used within PlayerProvider');
  return ctx;
}
