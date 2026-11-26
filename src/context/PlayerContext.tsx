import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type Hls from 'hls.js';
import { fetchRelatedTracks, getCachedAudioMode, prewarmTrackBatch } from '../services/api';
import type { RepeatMode, Track } from '../types/music';
import {
  acquirePlaybackWakeLock,
  getSilentLoopBlobUrl,
  pauseKeepAliveBridgeIfForeground,
  pokeBackgroundKeepAlive,
  registerVibraServiceWorker,
  releasePlaybackWakeLock,
  startWebAudioKeepAlive,
  stopWebAudioKeepAlive,
} from '../utils/backgroundAudio';
import { parseDurationLabel } from '../utils/format';
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
  isMuted?: () => boolean;
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

interface PlayerTimeContextValue {
  currentTime: number;
  duration: number;
}

interface PlayerContextValue {
  currentTrack: Track | null;
  queue: Track[];
  currentIndex: number;
  isPlaying: boolean;
  isBuffering: boolean;
  volume: number;
  isMuted: boolean;
  repeatMode: RepeatMode;
  isShuffle: boolean;
  isRadioMode: boolean;
  isLoadingRadio: boolean;
  isExpanded: boolean;
  mobilePlayerView: 'player' | 'queue' | 'related' | 'lyrics';
  isVideoMode: boolean;
  isQueueOpen: boolean;
  isBackgroundPlay: boolean;
  relatedTracks: Track[];
  isLoadingRelated: boolean;
  playerError: string | null;
  backgroundBlockedHint: string | null;
  clearBackgroundBlockedHint: () => void;
  playerHostRef: React.RefObject<HTMLDivElement | null>;
  playTrack: (track: Track, newQueue?: Track[], openVideo?: boolean, startAtSeconds?: number) => void;
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
  seekBy: (deltaSeconds: number) => void;
  setVolume: (vol: number) => void;
  toggleMute: () => void;
  cycleRepeat: () => void;
  toggleShuffle: () => void;
  toggleRadioMode: () => void;
  toggleBackgroundPlay: () => void;
  setIsExpanded: (val: boolean) => void;
  setMobilePlayerView: (view: 'player' | 'queue' | 'related' | 'lyrics') => void;
  setIsVideoMode: (val: boolean) => void;
  setIsQueueOpen: (val: boolean) => void;
  jumpToQueueIndex: (index: number) => void;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);
const PlayerTimeContext = createContext<PlayerTimeContextValue | null>(null);

const ONLINE_SESSION_KEY = 'vibra_online_session_v1';
const ACTIVE_PLAYER_KEY = 'vibra_active_player';

// Strictly cap in-RAM Blob URLs to at most 2 tracks (current + 1 immediate next)
// and revoke old Blobs immediately so background RAM never exceeds ~12 MB across 100+ songs!
const MAX_ONLINE_BLOB_CACHE = 2;
const audioBlobCache = new Map<string, string>();
const inFlightBlobFetches = new Map<string, Promise<string | null>>();
const prewarmedServerIds = new Set<string>();

function pruneOnlineBlobCache(keepIds: Set<string>) {
  for (const [id, url] of audioBlobCache.entries()) {
    if (!keepIds.has(id) && audioBlobCache.size > 1) {
      audioBlobCache.delete(id);
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    }
  }
  while (audioBlobCache.size > MAX_ONLINE_BLOB_CACHE) {
    const oldestKey = audioBlobCache.keys().next().value;
    if (oldestKey === undefined || keepIds.has(oldestKey)) break;
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

function buildDirectAudioStreamUrl(track: Track, wantsSeek = false): string {
  const qs = new URLSearchParams({
    videoId: track.id,
    title: track.title,
    artist: track.artist,
    duration: String(track.durationSeconds || 0),
  });
  if (wantsSeek) {
    qs.set('seek', '1');
  }
  return `/api/audio/stream?${qs.toString()}`;
}

function buildAudioResolveUrl(track: Track): string {
  const qs = new URLSearchParams({
    videoId: track.id,
    title: track.title,
    artist: track.artist,
    duration: String(track.durationSeconds || 0),
  });
  return `/api/audio/resolve?${qs.toString()}`;
}

/**
 * Lightweight (<1 KB RAM) server-side stream pre-resolution.
 * Warms the backend stream cache for upcoming tracks without allocating 15-30 MB MP4 Blobs in browser RAM!
 */
async function prewarmServerStreamResolve(track: Track): Promise<void> {
  if (!track?.id || prewarmedServerIds.has(track.id)) return;
  prewarmedServerIds.add(track.id);
  if (prewarmedServerIds.size > 80) {
    const first = prewarmedServerIds.values().next().value;
    if (first) prewarmedServerIds.delete(first);
  }
  try {
    await window.fetch(buildAudioResolveUrl(track), { credentials: 'include' });
  } catch {
    prewarmedServerIds.delete(track.id);
  }
}

async function fetchTrackAudioBlobUrl(track: Track, keepIds?: Set<string>): Promise<string | null> {
  const cached = audioBlobCache.get(track.id);
  if (cached) {
    audioBlobCache.delete(track.id);
    audioBlobCache.set(track.id, cached);
    return cached;
  }

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
      // Avoid storing huge > 25 MB files in RAM Blob cache to protect mobile memory
      if (blob.size > 25 * 1024 * 1024) {
        return null;
      }
      const typedBlob = blob.type.startsWith('audio/')
        ? blob
        : new Blob([blob], { type: 'audio/mp4' });
      const blobUrl = URL.createObjectURL(typedBlob);

      const protectedIds = keepIds ? new Set(keepIds) : new Set<string>();
      protectedIds.add(track.id);
      pruneOnlineBlobCache(protectedIds);

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
  const {
    recordPlayed,
    recordListeningSeconds,
    createPlaylistWithTracks,
    saveTrackPosition,
    clearTrackPosition,
    getTrackPosition,
    showToast,
  } = useLibrary();

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
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('all');
  const [isShuffle, setIsShuffle] = useState(false);
  const [isRadioMode, setIsRadioMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('vibra_radio_mode');
    return saved === null ? true : saved === 'true';
  });
  const [isLoadingRadio, setIsLoadingRadio] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [mobilePlayerView, setMobilePlayerView] = useState<'player' | 'queue' | 'related' | 'lyrics'>('player');
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
  const pendingSeekMuteGuardRef = useRef(false);
  const pendingSeekSetAtRef = useRef(0);
  const pendingYtSeekSecRef = useRef<number>(0);
  const pendingTrackIdRef = useRef<string | null>(null);
  const loadedTrackIdRef = useRef<string | null>(null);
  const loadedAudioTrackIdRef = useRef<string | null>(null);
  const loadedYtVideoIdRef = useRef<string | null>(null);
  const audioKickDoneForLoadRef = useRef<string | null>(null);
  const resolveAbortRef = useRef<AbortController | null>(null);
  const consecutiveErrorsRef = useRef(0);
  const bgSkipStreakRef = useRef(0);
  const radioFetchingRef = useRef(false);
  const shuffleHistoryRef = useRef<Set<string>>(new Set());
  const sessionSeenIdsRef = useRef<Set<string>>(new Set());
  const shouldPlayRef = useRef(false);
  const userPausedRef = useRef(false);
  const hiddenAtRef = useRef(0);
  const bgResumeAttemptsRef = useRef(0);
  const endedHandledForLoadRef = useRef<string | null>(null);
  const relatedFetchedForIdRef = useRef<string | null>(null);
  const lastMediaPosSyncRef = useRef<number>(0);
  const lastSessionSaveRef = useRef<number>(0);
  const lastPosSaveRef = useRef<number>(0);
  const sessionRestoredRef = useRef(false);
  const restoredPausedTrackIdRef = useRef<string | null>(null);
  const isYieldedToOfflineRef = useRef(false);
  const [isYieldedToOffline, setIsYieldedToOffline] = useState(false);

  const queueRef = useRef(queue);
  const currentIndexRef = useRef(currentIndex);
  const currentTimeRef = useRef(currentTime);
  const durationRef = useRef(duration);
  const expectedDurationRef = useRef(0);
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
  durationRef.current = duration;
  repeatModeRef.current = repeatMode;
  isShuffleRef.current = isShuffle;
  isRadioModeRef.current = isRadioMode;
  isBackgroundPlayRef.current = isBackgroundPlay;
  isVideoModeRef.current = isVideoMode;
  volumeRef.current = volume;
  isMutedRef.current = isMuted;
  relatedTracksRef.current = relatedTracks;

  const currentTrack = currentIndex >= 0 && currentIndex < queue.length ? queue[currentIndex] : null;

  const persistCurrentTrackResume = useCallback(
    (overrideSec?: number) => {
      const curTrack = queueRef.current[currentIndexRef.current];
      if (!curTrack) return;
      // Never let a premature 0..4s audio clock overwrite an uncompleted resume seek target
      if (pendingSeekSecRef.current > 0.5) {
        const safePending = Math.max(pendingSeekSecRef.current, currentTimeRef.current ?? 0);
        const dur = durationRef.current || curTrack.durationSeconds || 0;
        saveTrackPosition(curTrack.id, safePending, dur);
        saveTrackPosition(`dl_${curTrack.id}`, safePending, dur);
        return;
      }
      const sec = overrideSec ?? currentTimeRef.current ?? 0;
      const dur = durationRef.current || curTrack.durationSeconds || 0;
      saveTrackPosition(curTrack.id, sec, dur);
      saveTrackPosition(`dl_${curTrack.id}`, sec, dur);
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

  const applyPendingAudioSeek = useCallback(
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
      if (Math.abs((a.currentTime || 0) - clamped) <= 1.8) {
        pendingSeekSecRef.current = 0;
        pendingSeekSetAtRef.current = 0;
        currentTimeRef.current = a.currentTime;
        setCurrentTime(a.currentTime);
        releaseSeekMuteGuard(a);
        return;
      }

      // Check seekable range so Chromium doesn't silently clamp a.currentTime back to 0:00
      let canSeekNow = true;
      if (a.seekable && a.seekable.length > 0) {
        canSeekNow = false;
        for (let i = 0; i < a.seekable.length; i++) {
          if (clamped >= a.seekable.start(i) - 0.5 && clamped <= a.seekable.end(i) + 0.5) {
            canSeekNow = true;
            break;
          }
        }
      }

      if (!canSeekNow) {
        // Safety fallback: if stream still isn't seekable after 5s, unmute instead of staying silent
        if (pendingSeekSetAtRef.current > 0 && Date.now() - pendingSeekSetAtRef.current > 5000) {
          pendingSeekSecRef.current = 0;
          pendingSeekSetAtRef.current = 0;
          releaseSeekMuteGuard(a);
        }
        return;
      }

      if (a.seeking) return;

      try {
        a.currentTime = clamped;
        currentTimeRef.current = clamped;
        setCurrentTime(clamped);
        if (Math.abs((a.currentTime || 0) - clamped) <= 1.8) {
          pendingSeekSecRef.current = 0;
          pendingSeekSetAtRef.current = 0;
          releaseSeekMuteGuard(a);
        }
      } catch {
        // wait for next readiness event
      }
    },
    [releaseSeekMuteGuard]
  );

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

    const syncYtVolume = (p: YTPlayerInstance) => {
      try {
        if (isMutedRef.current) {
          p.mute();
        } else {
          p.unMute();
          p.setVolume(volumeRef.current);
        }
      } catch {
        // ignore
      }
    };

    if (ytReadyRef.current && ytPlayerRef.current) {
      syncYtVolume(ytPlayerRef.current);
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
            syncYtVolume(ytPlayerRef.current);
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
   * Starts native HTML5 <audio> playback synchronously (0ms delay) with minimal RAM footprint:
   * 1. If the track's Blob URL is already in the 2-entry LRU cache, plays it in 0ms.
   * 2. Otherwise, streams directly via native HTTP 206 byte-range requests (`/api/audio/stream?...`)
   *    while the secondary bridge <audio> element in `backgroundAudio.ts` holds the OS AudioSession locked!
   */
  const beginSynchronousNativeAudio = useCallback(
    (track: Track, resumeSec = 0) => {
      // If we already pre-resolved this track and know it's YouTube-only, jump straight to YouTube IFrame in 0ms
      if (getCachedAudioMode(track.id) === 'youtube') {
        startYouTubeTrack(track.id, resumeSec);
        return;
      }

      const audio = audioElRef.current;
      if (!audio) {
        startYouTubeTrack(track.id, resumeSec);
        return;
      }

      destroyHls();
      activeEngineRef.current = 'audio';
      loadedAudioTrackIdRef.current = track.id;
      audioKickDoneForLoadRef.current = null;
      const hasResumeSeek = resumeSec > 0.5;
      pendingSeekSecRef.current = hasResumeSeek ? resumeSec : 0;
      pendingSeekSetAtRef.current = hasResumeSeek ? Date.now() : 0;
      pendingSeekMuteGuardRef.current = hasResumeSeek;
      currentTimeRef.current = hasResumeSeek ? resumeSec : 0;
      setCurrentTime(hasResumeSeek ? resumeSec : 0);
      const initialDur =
        track.durationSeconds && track.durationSeconds > 0
          ? track.durationSeconds
          : parseDurationLabel(track.duration);
      if (initialDur > 0) {
        expectedDurationRef.current = initialDur;
        durationRef.current = initialDur;
        setDuration(initialDur);
      }

      // Hold audio muted while jumping directly to resumeSec so 0:00 never blasts briefly
      audio.muted = hasResumeSeek ? true : isMutedRef.current;
      audio.volume = isMutedRef.current ? 0 : volumeRef.current / 100;
      audio.playbackRate = 1;

      if (isBackgroundPlayRef.current && shouldPlayRef.current && !userPausedRef.current && document.hidden) {
        startWebAudioKeepAlive();
        pokeBackgroundKeepAlive();
      } else {
        pauseKeepAliveBridgeIfForeground();
      }

      try {
        ytPlayerRef.current?.pauseVideo();
      } catch {
        // ignore
      }

      // Prune any old RAM blobs except current and immediate next
      const keepIds = new Set<string>([track.id]);
      const q = queueRef.current;
      const idx = currentIndexRef.current;
      if (q[idx + 1]) keepIds.add(q[idx + 1].id);
      pruneOnlineBlobCache(keepIds);

      const cachedBlobUrl = audioBlobCache.get(track.id);
      if (cachedBlobUrl) {
        isSilentWarmupRef.current = false;
        audio.loop = false;
        if (audio.src !== cachedBlobUrl) {
          audio.src = cachedBlobUrl;
        } else if (!hasResumeSeek) {
          try {
            audio.currentTime = 0;
          } catch {
            // ignore
          }
        }
        if (audio.readyState >= 1 && pendingSeekSecRef.current > 0.5) {
          applyPendingAudioSeek(audio);
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
                  applyPendingAudioSeek(audio);
                } else {
                  releaseSeekMuteGuard(audio);
                }
              })
              .catch((err) => {
                if (err instanceof Error && err.name === 'AbortError') return;
                if (err instanceof Error && err.name === 'NotAllowedError') {
                  shouldPlayRef.current = false;
                  userPausedRef.current = true;
                  releaseSeekMuteGuard(audio);
                  setIsPlaying(false);
                  setIsBuffering(false);
                  return;
                }
              });
          }
        }
        return;
      }

      // Stream directly via native HTTP 206 `/api/audio/stream` for both foreground and background!
      isSilentWarmupRef.current = false;
      audio.loop = false;
      audio.muted = hasResumeSeek ? true : isMutedRef.current;
      audio.volume = isMutedRef.current ? 0 : volumeRef.current / 100;
      const directUrl = buildDirectAudioStreamUrl(track, hasResumeSeek);
      const baseDirectUrl = buildDirectAudioStreamUrl(track, false);
      const absoluteDirectUrl =
        typeof window !== 'undefined' ? new URL(directUrl, window.location.origin).href : directUrl;
      const absoluteBaseUrl =
        typeof window !== 'undefined' ? new URL(baseDirectUrl, window.location.origin).href : baseDirectUrl;
      const sameTrackStreamLoaded =
        audio.src === absoluteDirectUrl ||
        audio.src === directUrl ||
        audio.src === absoluteBaseUrl ||
        audio.src === baseDirectUrl;

      if (!sameTrackStreamLoaded) {
        audio.src = directUrl;
        setIsBuffering(true);
      } else if (!hasResumeSeek) {
        try {
          audio.currentTime = 0;
        } catch {
          // ignore
        }
        setIsBuffering(audio.readyState < 2);
      } else if (audio.readyState >= 1) {
        applyPendingAudioSeek(audio);
        setIsBuffering(false);
      } else {
        setIsBuffering(true);
      }

      if (shouldPlayRef.current && !userPausedRef.current) {
        const directPlay = audio.play();
        if (directPlay) {
          void directPlay
            .then(() => {
              audioUnlockedRef.current = true;
              if (pendingSeekSecRef.current > 0.5) {
                applyPendingAudioSeek(audio);
              } else {
                releaseSeekMuteGuard(audio);
              }
            })
            .catch((err) => {
              if (err instanceof Error && err.name === 'AbortError') return;
              if (err instanceof Error && err.name === 'NotAllowedError') {
                shouldPlayRef.current = false;
                userPausedRef.current = true;
                releaseSeekMuteGuard(audio);
                setIsPlaying(false);
                setIsBuffering(false);
              }
            });
        }
      }
    },
    [applyPendingAudioSeek, destroyHls, releaseSeekMuteGuard, startYouTubeTrack]
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
      const prevMuted = audio.muted;
      audio.muted = true;
      const p = audio.play();
      if (p) {
        void p
          .then(() => {
            audioUnlockedRef.current = true;
            if (activeEngineRef.current !== 'audio') {
              audio.pause();
            }
            audio.muted = prevMuted || isMutedRef.current;
            audio.volume = isMutedRef.current ? 0 : volumeRef.current / 100;
          })
          .catch(() => {
            audio.muted = isMutedRef.current;
            audio.volume = isMutedRef.current ? 0 : volumeRef.current / 100;
          });
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

      const normTitleKey = (title: string) =>
        title
          .toLowerCase()
          .replace(/\(.*?\)|\[.*?\]/g, ' ')
          .replace(/[^a-z0-9\s]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

      try {
        for (const t of queueRef.current) {
          sessionSeenIdsRef.current.add(t.id);
        }
        const excludeAllIds = Array.from(sessionSeenIdsRef.current);
        const existingIdSet = new Set(excludeAllIds);
        const existingTitleKeys = new Set(
          queueRef.current.map((t) => normTitleKey(t.title)).filter(Boolean)
        );

        const localCandidates = relatedTracksRef.current.filter(
          (t) => !existingIdSet.has(t.id) && !existingTitleKeys.has(normTitleKey(t.title))
        );

        let freshTracks = localCandidates;
        if (freshTracks.length < 8) {
          const remoteTracks = await fetchRelatedTracks(seedTrack, excludeAllIds);
          freshTracks = [...localCandidates, ...remoteTracks];
        }

        const uniqueAdditions: Track[] = [];
        const batchIds = new Set<string>(existingIdSet);
        const batchTitles = new Set<string>(existingTitleKeys);

        for (const cand of freshTracks) {
          if (!cand?.id || batchIds.has(cand.id)) continue;
          const tk = normTitleKey(cand.title);
          if (tk && batchTitles.has(tk)) continue;
          batchIds.add(cand.id);
          if (tk) batchTitles.add(tk);
          sessionSeenIdsRef.current.add(cand.id);
          uniqueAdditions.push(cand);
          if (uniqueAdditions.length >= 18) break;
        }

        if (uniqueAdditions.length > 0) {
          let insertStartIndex = queueRef.current.length;
          setQueue((prev) => {
            const seen = new Set(prev.map((t) => t.id));
            const cleanNew = uniqueAdditions.filter((t) => !seen.has(t.id));
            insertStartIndex = prev.length;
            return [...prev, ...cleanNew];
          });
          // Lightweight server-side stream pre-resolution for newly added tracks
          for (const added of uniqueAdditions.slice(0, 4)) {
            void prewarmServerStreamResolve(added);
          }
          if (advanceToNewTrack) {
            const firstNewTrack = uniqueAdditions[0];
            if (firstNewTrack && !isVideoModeRef.current) {
              beginSynchronousNativeAudio(firstNewTrack, 0);
            }
            setCurrentIndex(insertStartIndex);
          }
        } else if (advanceToNewTrack) {
          // Endless fallback: if network is offline or no new radio tracks found, loop back to queue[0]
          const q = queueRef.current;
          if (q.length > 0 && q[0]) {
            if (!isVideoModeRef.current) {
              beginSynchronousNativeAudio(q[0], 0);
            }
            setCurrentIndex(0);
          }
        }
      } catch {
        if (advanceToNewTrack) {
          const q = queueRef.current;
          if (q.length > 0 && q[0]) {
            if (!isVideoModeRef.current) {
              beginSynchronousNativeAudio(q[0], 0);
            }
            setCurrentIndex(0);
          }
        }
      } finally {
        radioFetchingRef.current = false;
        setIsLoadingRadio(false);
      }
    },
    [beginSynchronousNativeAudio]
  );

  const pickNextShuffleIndex = useCallback(
    (q: Track[], currentIdx: number): number => {
      if (q.length <= 1) return currentIdx;
      const unplayedIndices: number[] = [];
      for (let i = 0; i < q.length; i++) {
        if (i !== currentIdx && !shuffleHistoryRef.current.has(q[i].id)) {
          unplayedIndices.push(i);
        }
      }
      // Proactively expand the queue when shuffle has <= 3 unplayed tracks left so it never loops the same 10-12 songs
      if (unplayedIndices.length <= 3 && q[currentIdx]) {
        void replenishRadioQueue(q[currentIdx], false);
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
    },
    [replenishRadioQueue]
  );

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

    if (finishedTrack) {
      sessionSeenIdsRef.current.add(finishedTrack.id);
      clearTrackPosition(finishedTrack.id);
      clearTrackPosition(`dl_${finishedTrack.id}`);
    }

    shouldPlayRef.current = true;
    userPausedRef.current = false;

    if (isBackgroundPlayRef.current) {
      startWebAudioKeepAlive();
      pokeBackgroundKeepAlive();
    }

    if (rep === 'one') {
      if (activeEngineRef.current === 'audio' && audioElRef.current) {
        audioElRef.current.currentTime = 0;
        void audioElRef.current.play().catch(() => {});
      } else {
        ytPlayerRef.current?.seekTo(0, true);
        ytPlayerRef.current?.playVideo();
      }
      return;
    }

    if (shuf && q.length > 1) {
      const unplayedCount = q.filter((t, i) => i !== idx && !shuffleHistoryRef.current.has(t.id)).length;
      if (unplayedCount === 0 && q[idx]) {
        void replenishRadioQueue(q[idx], true);
        return;
      }
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
      // If approaching end of queue, fetch fresh songs immediately so queue never loops at 10-12 songs
      if (q.length - 1 - (idx + 1) < 5 && nextTrackItem) {
        void replenishRadioQueue(nextTrackItem, false);
      }
    } else if (q[idx]) {
      // Always replenish and play song #13, #14, #15... instead of looping back to index 0!
      void replenishRadioQueue(q[idx], true);
    } else if (q[0]) {
      if (!isVideoModeRef.current) {
        beginSynchronousNativeAudio(q[0], 0);
      }
      setCurrentIndex(0);
    }
  }, [beginSynchronousNativeAudio, clearTrackPosition, pickNextShuffleIndex, replenishRadioQueue]);

  // Restore saved online session on initial mount if user was last listening to Online Player
  useEffect(() => {
    if (sessionRestoredRef.current) return;
    sessionRestoredRef.current = true;
    try {
      const activePlayer = localStorage.getItem(ACTIVE_PLAYER_KEY);
      if (activePlayer === 'offline') return;
      const raw = localStorage.getItem(ONLINE_SESSION_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        queue?: Track[];
        currentIndex?: number;
        currentTime?: number;
        repeatMode?: RepeatMode;
        isShuffle?: boolean;
        isRadioMode?: boolean;
        wasPlaying?: boolean;
        savedAt?: number;
      };
      if (!parsed.queue || !Array.isArray(parsed.queue) || parsed.queue.length === 0) return;

      const restoredQueue = parsed.queue.filter((t) => Boolean(t && t.id && t.title));
      if (restoredQueue.length === 0) return;

      const restoredIdx = Math.max(0, Math.min(restoredQueue.length - 1, parsed.currentIndex ?? 0));
      const track = restoredQueue[restoredIdx];
      const savedPos = getTrackPosition(track.id) || getTrackPosition(`dl_${track.id}`);
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
      if (typeof parsed.isRadioMode === 'boolean') setIsRadioMode(parsed.isRadioMode);

      // Always restore the previous song in PAUSED state on app open so the user chooses when to resume
      restoredPausedTrackIdRef.current = track.id;
      shouldPlayRef.current = false;
      userPausedRef.current = true;
      loadedTrackIdRef.current = track.id;
      loadedAudioTrackIdRef.current = null;
      activeEngineRef.current = 'audio';
      pendingSeekSecRef.current = restoredTime;
      currentTimeRef.current = restoredTime;
      const restoredDur =
        track.durationSeconds && track.durationSeconds > 0
          ? track.durationSeconds
          : parseDurationLabel(track.duration);
      expectedDurationRef.current = restoredDur;
      durationRef.current = restoredDur;
      setIsPlaying(false);
      setIsBuffering(false);
      setCurrentTime(restoredTime);
      setDuration(restoredDur);
      setQueue(restoredQueue);
      setCurrentIndex(restoredIdx);

      // Pause any active audio without downloading stream bytes until the user chooses to resume
      const audio = audioElRef.current;
      if (audio) {
        audio.pause();
        audio.muted = isMutedRef.current;
        audio.volume = isMutedRef.current ? 0 : volumeRef.current / 100;
      }
      // Lightweight server-side stream resolution prewarm (<1 KB) so Play resumes instantly when tapped
      prewarmTrackBatch([track]);
    } catch {
      // ignore malformed storage
    }
  }, [getTrackPosition]);

  const saveOnlineSession = useCallback((overrideTime?: number, overridePlaying?: boolean) => {
    if (isYieldedToOfflineRef.current || queueRef.current.length === 0 || currentIndexRef.current < 0) {
      return;
    }
    try {
      const payload = {
        queue: queueRef.current.slice(0, 80),
        currentIndex: currentIndexRef.current,
        currentTime: Math.floor(overrideTime ?? currentTimeRef.current ?? 0),
        repeatMode: repeatModeRef.current,
        isShuffle: isShuffleRef.current,
        isRadioMode: isRadioModeRef.current,
        wasPlaying: overridePlaying ?? (shouldPlayRef.current && !userPausedRef.current),
        savedAt: Date.now(),
      };
      localStorage.setItem(ONLINE_SESSION_KEY, JSON.stringify(payload));
      localStorage.setItem(ACTIVE_PLAYER_KEY, 'online');
    } catch {
      // ignore storage quota errors
    }
  }, []);

  useEffect(() => {
    saveOnlineSession();
  }, [queue, currentIndex, repeatMode, isShuffle, isRadioMode, isPlaying, saveOnlineSession]);

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
        } else if (isRadioModeRef.current && q[idx]) {
          void replenishRadioQueue(q[idx], true);
        } else {
          if (q[0] && !isVideoModeRef.current) {
            beginSynchronousNativeAudio(q[0], 0);
          }
          setCurrentIndex(0);
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
              try {
                if (isMutedRef.current) {
                  e.target.mute();
                } else {
                  e.target.unMute();
                  e.target.setVolume(volumeRef.current);
                }
              } catch {
                // ignore
              }
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
                pokeBackgroundKeepAlive();
                void acquirePlaybackWakeLock();
              }
            } else if (state === PS.PAUSED) {
              if (
                isBackgroundPlayRef.current &&
                shouldPlayRef.current &&
                !userPausedRef.current
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

  // Sync state & pre-warm upcoming tracks when currentTrack changes (with strict RAM cap!)
  useEffect(() => {
    if (!currentTrack) {
      if (restoredPausedTrackIdRef.current) {
        return;
      }
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
    if (isYieldedToOfflineRef.current) {
      return;
    }
    if (loadedTrackIdRef.current === currentTrack.id) {
      return;
    }

    resolveAbortRef.current?.abort();
    const controller = new AbortController();
    resolveAbortRef.current = controller;

    const alreadyStartedInGesture =
      (activeEngineRef.current === 'audio' && loadedAudioTrackIdRef.current === currentTrack.id) ||
      (activeEngineRef.current === 'youtube' &&
        (loadedYtVideoIdRef.current === currentTrack.id ||
          pendingTrackIdRef.current === currentTrack.id));

    loadedTrackIdRef.current = currentTrack.id;
    endedHandledForLoadRef.current = null;
    bgResumeAttemptsRef.current = 0;
    if (!alreadyStartedInGesture) {
      pendingSeekSecRef.current = 0;
      pendingYtSeekSecRef.current = 0;
      currentTimeRef.current = 0;
      setCurrentTime(0);
    }
    shouldPlayRef.current = true;
    userPausedRef.current = false;
    shuffleHistoryRef.current.add(currentTrack.id);
    const trackDur =
      currentTrack.durationSeconds && currentTrack.durationSeconds > 0
        ? currentTrack.durationSeconds
        : parseDurationLabel(currentTrack.duration);
    expectedDurationRef.current = trackDur;
    durationRef.current = trackDur;
    setDuration(trackDur);
    setPlayerError(null);
    setBackgroundBlockedHint(null);
    setIsBuffering(true);
    recordPlayed(currentTrack);

    if (isBackgroundPlayRef.current) {
      startWebAudioKeepAlive();
      pokeBackgroundKeepAlive();
      void acquirePlaybackWakeLock();
    }

    // Pre-resolve upcoming +1..+4 in ONE batch request (<1 KB RAM), and wait until active song
    // has started (~1.8s) before fetching the next song's full Blob so it never steals initial startup bandwidth!
    const prewarmTimer = window.setTimeout(() => {
      if (controller.signal.aborted) return;
      const q = queueRef.current;
      const idx = currentIndexRef.current;
      const nextImmediate = q[(idx + 1) % Math.max(1, q.length)];
      const keepIds = new Set<string>([currentTrack.id]);
      if (nextImmediate) keepIds.add(nextImmediate.id);
      pruneOnlineBlobCache(keepIds);

      const upcomingList: Track[] = [];
      for (const offset of [1, 2, 3, 4]) {
        const upcoming = q[idx + offset];
        if (upcoming && upcoming.id !== currentTrack.id) {
          upcomingList.push(upcoming);
        }
      }
      if (upcomingList.length > 0) {
        prewarmTrackBatch(upcomingList);
      }

      if (nextImmediate && nextImmediate.id !== currentTrack.id) {
        window.setTimeout(() => {
          if (!controller.signal.aborted) {
            void fetchTrackAudioBlobUrl(nextImmediate, keepIds);
          }
        }, 1400);
      }
    }, 500);

    if (isVideoModeRef.current) {
      stopNativeAudio();
      if (!alreadyStartedInGesture) {
        startYouTubeTrack(currentTrack.id, pendingYtSeekSecRef.current);
      }
      return () => window.clearTimeout(prewarmTimer);
    }

    if (alreadyStartedInGesture) {
      return () => window.clearTimeout(prewarmTimer);
    }

    beginSynchronousNativeAudio(currentTrack, pendingSeekSecRef.current);
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

  // Lazy-fetch related tracks when user expands the player OR queue has < 10 upcoming tracks
  useEffect(() => {
    if (!currentTrack) {
      relatedFetchedForIdRef.current = null;
      setRelatedTracks([]);
      return;
    }

    sessionSeenIdsRef.current.add(currentTrack.id);
    for (const t of queueRef.current) {
      sessionSeenIdsRef.current.add(t.id);
    }

    if (relatedFetchedForIdRef.current !== currentTrack.id) {
      setRelatedTracks([]);
    }

    const remainingCount = queue.length - 1 - currentIndex;
    const needsRelatedNow = isExpanded || remainingCount < 10;
    if (!needsRelatedNow || relatedFetchedForIdRef.current === currentTrack.id) {
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      relatedFetchedForIdRef.current = currentTrack.id;
      setIsLoadingRelated(true);
      const exclude = Array.from(
        new Set([...queueRef.current.map((t) => t.id), ...sessionSeenIdsRef.current])
      );

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
    }, 450);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [currentTrack?.id, isExpanded, isRadioMode, currentIndex, queue.length]);

  // Proactively pre-fill queue whenever < 6 upcoming tracks remain so playback never loops a 10-12 song batch
  useEffect(() => {
    if (!currentTrack || currentIndex < 0) return;
    const remainingCount = queue.length - 1 - currentIndex;
    if (remainingCount >= 8 || radioFetchingRef.current) return;

    if (relatedTracks.length > 0) {
      const existing = new Set(queue.map((t) => t.id));
      const candidates = relatedTracks.filter((t) => !existing.has(t.id)).slice(0, 16);
      if (candidates.length > 0) {
        for (const c of candidates) {
          sessionSeenIdsRef.current.add(c.id);
        }
        setQueue((prev) => {
          const seen = new Set(prev.map((t) => t.id));
          const add = candidates.filter((t) => !seen.has(t.id));
          return add.length > 0 ? [...prev, ...add] : prev;
        });
        return;
      }
    }

    if (remainingCount < 5) {
      void replenishRadioQueue(currentTrack, false);
    }
  }, [currentTrack, currentIndex, queue.length, relatedTracks, queue, replenishRadioQueue]);

  // Background & Screen-Wake Continuity (handles BOTH screen off AND screen on/unlock + auto-handoff from Video to Audio!)
  useEffect(() => {
    const ensureOnlinePlaybackAlive = () => {
      if (isYieldedToOfflineRef.current) return;
      if (!shouldPlayRef.current || userPausedRef.current) return;

      if (isBackgroundPlayRef.current) {
        startWebAudioKeepAlive();
        pokeBackgroundKeepAlive();
        if (!document.hidden) {
          void acquirePlaybackWakeLock();
        }
      }

      if (document.hidden && activeEngineRef.current === 'youtube' && isBackgroundPlayRef.current) {
        // Hand off immediately from Video (YouTube IFrame) to native <audio> whenever app enters background or screen locks!
        const curTrack = queueRef.current[currentIndexRef.current];
        if (curTrack) {
          const resumeSec = ytPlayerRef.current?.getCurrentTime() ?? currentTimeRef.current ?? 0;
          isVideoModeRef.current = false;
          setIsVideoMode(false);
          beginSynchronousNativeAudio(curTrack, resumeSec);
          return;
        }
      }

      if (activeEngineRef.current === 'audio') {
        const a = audioElRef.current;
        if (!a) return;

        if (
          !isSilentWarmupRef.current &&
          (a.ended || (Number.isFinite(a.duration) && a.duration > 5 && a.currentTime >= a.duration - 0.25))
        ) {
          handleTrackEnd();
          return;
        }

        for (const waitMs of [0, 60, 220, 600, 1200]) {
          window.setTimeout(() => {
            const el = audioElRef.current;
            if (
              !isYieldedToOfflineRef.current &&
              activeEngineRef.current === 'audio' &&
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
      } else if (activeEngineRef.current === 'youtube') {
        const p = ytPlayerRef.current;
        const PS = window.YT?.PlayerState;
        if (p && PS) {
          try {
            const st = p.getPlayerState();
            if (st === PS.ENDED) {
              handleTrackEnd();
            } else if (st === PS.PAUSED || st === PS.CUED) {
              p.playVideo();
            }
          } catch {
            // ignore
          }
        }
      }
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        hiddenAtRef.current = Date.now();
        bgResumeAttemptsRef.current = 0;
      }
      persistCurrentTrackResume();
      saveOnlineSession();
      ensureOnlinePlaybackAlive();
    };

    const flushPlaybackSnapshot = () => {
      persistCurrentTrackResume();
      saveOnlineSession();
    };

    const onWindowFocusOrShow = () => {
      ensureOnlinePlaybackAlive();
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
  }, [beginSynchronousNativeAudio, handleTrackEnd, persistCurrentTrackResume, saveOnlineSession]);

  // Continuous 2-second watchdog for native <audio> engine: catches throttled `ended` events or involuntary OS pauses while screen is off
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (isYieldedToOfflineRef.current) return;
      if (activeEngineRef.current !== 'audio') return;
      if (!shouldPlayRef.current || userPausedRef.current) return;
      const a = audioElRef.current;
      if (!a || queueRef.current.length === 0) return;

      if (isBackgroundPlayRef.current) {
        pokeBackgroundKeepAlive();
      }

      if (!isSilentWarmupRef.current && !a.src.startsWith('data:')) {
        const dur = a.duration;
        const cur = a.currentTime;
        if (a.ended || (Number.isFinite(dur) && dur > 5 && cur >= dur - 0.22)) {
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

  // Poll YouTube playback progress when YouTube engine is active
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
              if (st === PS.PLAYING && !isMutedRef.current && volumeRef.current > 0 && p.isMuted?.()) {
                try {
                  p.unMute();
                  p.setVolume(volumeRef.current);
                } catch {
                  // ignore
                }
              }
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
    (track: Track, newQueue?: Track[], openVideo?: boolean, startAtSeconds?: number) => {
      persistCurrentTrackResume();

      window.dispatchEvent(new CustomEvent('vibra:pause-offline-player'));
      isYieldedToOfflineRef.current = false;
      setIsYieldedToOffline(false);
      localStorage.setItem(ACTIVE_PLAYER_KEY, 'online');
      consecutiveErrorsRef.current = 0;
      bgSkipStreakRef.current = 0;
      shouldPlayRef.current = true;
      userPausedRef.current = false;
      bgResumeAttemptsRef.current = 0;
      setBackgroundBlockedHint(null);
      if (isBackgroundPlayRef.current) {
        startWebAudioKeepAlive();
        pokeBackgroundKeepAlive();
        void acquirePlaybackWakeLock();
      }

      let resumeSec = 0;
      if (typeof startAtSeconds === 'number' && startAtSeconds > 0) {
        resumeSec = Math.max(0, startAtSeconds);
      } else {
        // Fresh track click always starts from 0:00 — never jump 1 minute into a song from a stale position!
        clearTrackPosition(track.id);
        clearTrackPosition(`dl_${track.id}`);
      }

      sessionSeenIdsRef.current.add(track.id);
      if (newQueue) {
        for (const t of newQueue) {
          sessionSeenIdsRef.current.add(t.id);
        }
      }

      const wantVideo = Boolean(openVideo || track.isVideo);
      if (wantVideo) {
        isVideoModeRef.current = true;
        setIsVideoMode(true);
        setIsExpanded(true);
        stopNativeAudio();
        startYouTubeTrack(track.id, resumeSec);
      } else {
        isVideoModeRef.current = false;
        setIsVideoMode(false);
        beginSynchronousNativeAudio(track, resumeSec);
      }
      recordPlayed(track);

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
      beginSynchronousNativeAudio,
      clearTrackPosition,
      persistCurrentTrackResume,
      recordPlayed,
      startYouTubeTrack,
      stopNativeAudio,
    ]
  );

  const startTrackRadio = useCallback(
    (track: Track) => {
      persistCurrentTrackResume();
      window.dispatchEvent(new CustomEvent('vibra:pause-offline-player'));
      isYieldedToOfflineRef.current = false;
      setIsYieldedToOffline(false);
      localStorage.setItem(ACTIVE_PLAYER_KEY, 'online');
      consecutiveErrorsRef.current = 0;
      bgSkipStreakRef.current = 0;
      shouldPlayRef.current = true;
      userPausedRef.current = false;
      bgResumeAttemptsRef.current = 0;
      setBackgroundBlockedHint(null);
      if (isBackgroundPlayRef.current) {
        startWebAudioKeepAlive();
        pokeBackgroundKeepAlive();
        void acquirePlaybackWakeLock();
      }
      clearTrackPosition(track.id);
      clearTrackPosition(`dl_${track.id}`);
      sessionSeenIdsRef.current.add(track.id);
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
    [beginSynchronousNativeAudio, clearTrackPosition, persistCurrentTrackResume, replenishRadioQueue, showToast]
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
    const curSec = currentTimeRef.current;

    if (activeEngineRef.current === 'audio' && audioElRef.current) {
      const audio = audioElRef.current;
      if (!audio.paused && shouldPlayRef.current) {
        userPausedRef.current = true;
        shouldPlayRef.current = false;
        stopWebAudioKeepAlive();
        void releasePlaybackWakeLock();
        audio.pause();
        setIsPlaying(false);
        persistCurrentTrackResume(curSec);
        saveOnlineSession(curSec, false);
      } else {
        window.dispatchEvent(new CustomEvent('vibra:pause-offline-player'));
        isYieldedToOfflineRef.current = false;
        setIsYieldedToOffline(false);
        localStorage.setItem(ACTIVE_PLAYER_KEY, 'online');
        userPausedRef.current = false;
        shouldPlayRef.current = true;
        bgResumeAttemptsRef.current = 0;
        setBackgroundBlockedHint(null);
        if (isBackgroundPlayRef.current) {
          startWebAudioKeepAlive();
          pokeBackgroundKeepAlive();
          void acquirePlaybackWakeLock();
        }
        const savedPos =
          getTrackPosition(currentTrack.id)?.positionSeconds ??
          getTrackPosition(`dl_${currentTrack.id}`)?.positionSeconds ??
          0;
        const effectiveResume = curSec > 0.5 ? curSec : savedPos;
        if (
          !audio.getAttribute('src') ||
          audio.src.startsWith('data:') ||
          audio.error ||
          loadedAudioTrackIdRef.current !== currentTrack.id
        ) {
          beginSynchronousNativeAudio(currentTrack, effectiveResume);
        } else {
          const needsSeek = effectiveResume > 0.5 && Math.abs((audio.currentTime || 0) - effectiveResume) > 1.8;
          if (needsSeek) {
            pendingSeekSecRef.current = effectiveResume;
            pendingSeekSetAtRef.current = Date.now();
            pendingSeekMuteGuardRef.current = true;
            audio.muted = true;
            applyPendingAudioSeek(audio);
          } else {
            releaseSeekMuteGuard(audio);
          }
          void audio.play().catch(() => {
            beginSynchronousNativeAudio(currentTrack, effectiveResume);
          });
        }
        saveOnlineSession(effectiveResume, true);
      }
      return;
    }

    window.dispatchEvent(new CustomEvent('vibra:pause-offline-player'));
    isYieldedToOfflineRef.current = false;
    setIsYieldedToOffline(false);
    localStorage.setItem(ACTIVE_PLAYER_KEY, 'online');

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
      persistCurrentTrackResume(curSec);
      saveOnlineSession(curSec, false);
    } else {
      userPausedRef.current = false;
      shouldPlayRef.current = true;
      bgResumeAttemptsRef.current = 0;
      setBackgroundBlockedHint(null);
      if (isBackgroundPlayRef.current) {
        startWebAudioKeepAlive();
        pokeBackgroundKeepAlive();
        void acquirePlaybackWakeLock();
      }
      const savedYtPos =
        getTrackPosition(currentTrack.id)?.positionSeconds ??
        getTrackPosition(`dl_${currentTrack.id}`)?.positionSeconds ??
        0;
      const effectiveYtResume = curSec > 0.5 ? curSec : savedYtPos;
      if (effectiveYtResume > 0.5) {
        try {
          const curYt = p.getCurrentTime() || 0;
          if (Math.abs(curYt - effectiveYtResume) > 2.2) {
            pendingYtSeekSecRef.current = effectiveYtResume;
            p.seekTo(effectiveYtResume, true);
          }
        } catch {
          // ignore
        }
      }
      if (!isMutedRef.current) {
        p.unMute();
        p.setVolume(volumeRef.current);
      }
      p.playVideo();
      saveOnlineSession(effectiveYtResume, true);
    }
  }, [
    applyPendingAudioSeek,
    beginSynchronousNativeAudio,
    currentTrack,
    getTrackPosition,
    isPlaying,
    persistCurrentTrackResume,
    releaseSeekMuteGuard,
    saveOnlineSession,
    unlockAudioFromGesture,
  ]);

  const nextTrack = useCallback(() => {
    const q = queueRef.current;
    const idx = currentIndexRef.current;
    if (q.length === 0) return;
    persistCurrentTrackResume();
    window.dispatchEvent(new CustomEvent('vibra:pause-offline-player'));
    isYieldedToOfflineRef.current = false;
    setIsYieldedToOffline(false);
    localStorage.setItem(ACTIVE_PLAYER_KEY, 'online');
    shouldPlayRef.current = true;
    userPausedRef.current = false;
    bgResumeAttemptsRef.current = 0;
    if (isBackgroundPlayRef.current) {
      startWebAudioKeepAlive();
      pokeBackgroundKeepAlive();
      void acquirePlaybackWakeLock();
    }
    if (isShuffleRef.current && q.length > 1) {
      const unplayedCount = q.filter((t, i) => i !== idx && !shuffleHistoryRef.current.has(t.id)).length;
      if (unplayedCount === 0 && q[idx]) {
        unlockAudioFromGesture();
        void replenishRadioQueue(q[idx], true);
        return;
      }
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
      if (q.length - 1 - (idx + 1) < 5 && q[idx + 1]) {
        void replenishRadioQueue(q[idx + 1], false);
      }
    } else if (q[idx]) {
      unlockAudioFromGesture();
      void replenishRadioQueue(q[idx], true);
    } else if (q[0]) {
      if (!isVideoModeRef.current) {
        beginSynchronousNativeAudio(q[0], 0);
      }
      setCurrentIndex(0);
    }
  }, [beginSynchronousNativeAudio, persistCurrentTrackResume, pickNextShuffleIndex, replenishRadioQueue, unlockAudioFromGesture]);

  const prevTrack = useCallback(() => {
    const q = queueRef.current;
    const idx = currentIndexRef.current;
    if (q.length === 0) return;
    window.dispatchEvent(new CustomEvent('vibra:pause-offline-player'));
    isYieldedToOfflineRef.current = false;
    setIsYieldedToOffline(false);
    localStorage.setItem(ACTIVE_PLAYER_KEY, 'online');
    shouldPlayRef.current = true;
    userPausedRef.current = false;
    bgResumeAttemptsRef.current = 0;
    if (isBackgroundPlayRef.current) {
      startWebAudioKeepAlive();
      pokeBackgroundKeepAlive();
      void acquirePlaybackWakeLock();
    }
    if (currentTimeRef.current > 4) {
      if (activeEngineRef.current === 'audio' && audioElRef.current) {
        audioElRef.current.currentTime = 0;
      } else {
        ytPlayerRef.current?.seekTo(0, true);
      }
      currentTimeRef.current = 0;
      setCurrentTime(0);
      if (q[idx]) clearTrackPosition(q[idx].id);
      return;
    }
    persistCurrentTrackResume();
    const targetIdx = idx - 1 >= 0 ? idx - 1 : q.length - 1;
    if (q[targetIdx] && !isVideoModeRef.current) {
      beginSynchronousNativeAudio(q[targetIdx], 0);
    }
    setCurrentIndex(targetIdx);
  }, [beginSynchronousNativeAudio, clearTrackPosition, persistCurrentTrackResume]);

  const seekTo = useCallback(
    (seconds: number) => {
      currentTimeRef.current = seconds;
      setCurrentTime(seconds);
      persistCurrentTrackResume(seconds);
      saveOnlineSession(seconds);
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
    },
    [persistCurrentTrackResume, saveOnlineSession]
  );

  const seekBy = useCallback(
    (deltaSeconds: number) => {
      const curTrack = queueRef.current[currentIndexRef.current];
      const effDur =
        durationRef.current > 0
          ? durationRef.current
          : curTrack?.durationSeconds || expectedDurationRef.current || 0;
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
        pokeBackgroundKeepAlive();
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
        window.dispatchEvent(new CustomEvent('vibra:pause-offline-player'));
        isYieldedToOfflineRef.current = false;
        setIsYieldedToOffline(false);
        localStorage.setItem(ACTIVE_PLAYER_KEY, 'online');
        shouldPlayRef.current = true;
        userPausedRef.current = false;
        bgResumeAttemptsRef.current = 0;
        if (isBackgroundPlayRef.current) {
          startWebAudioKeepAlive();
          pokeBackgroundKeepAlive();
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
        if (isBackgroundPlayRef.current) {
          startWebAudioKeepAlive();
          pokeBackgroundKeepAlive();
          void acquirePlaybackWakeLock();
        }
        if (activeEngineRef.current === 'audio' && audioElRef.current) {
          void audioElRef.current.play().catch(() => {});
        } else {
          ytPlayerRef.current?.playVideo();
        }
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        userPausedRef.current = true;
        shouldPlayRef.current = false;
        stopWebAudioKeepAlive();
        void releasePlaybackWakeLock();
        if (activeEngineRef.current === 'audio' && audioElRef.current) {
          audioElRef.current.pause();
        } else {
          ytPlayerRef.current?.pauseVideo();
        }
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

  const clearBackgroundBlockedHint = useCallback(() => setBackgroundBlockedHint(null), []);

  const effectiveCurrentTrack = isYieldedToOffline ? null : currentTrack;

  const playerContextValue = useMemo<PlayerContextValue>(
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
      isRadioMode,
      isLoadingRadio,
      isExpanded,
      mobilePlayerView,
      isVideoMode,
      isQueueOpen,
      isBackgroundPlay,
      relatedTracks,
      isLoadingRelated,
      playerError,
      backgroundBlockedHint,
      clearBackgroundBlockedHint,
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
      seekBy,
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
      isRadioMode,
      isLoadingRadio,
      isExpanded,
      mobilePlayerView,
      isVideoMode,
      isQueueOpen,
      isBackgroundPlay,
      relatedTracks,
      isLoadingRelated,
      playerError,
      backgroundBlockedHint,
      clearBackgroundBlockedHint,
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
      seekBy,
      setVolume,
      toggleMute,
      cycleRepeat,
      toggleShuffle,
      toggleRadioMode,
      toggleBackgroundPlay,
      jumpToQueueIndex,
    ]
  );

  const playerTimeValue = useMemo<PlayerTimeContextValue>(
    () => ({ currentTime, duration }),
    [currentTime, duration]
  );

  return (
    <PlayerContext.Provider value={playerContextValue}>
      <PlayerTimeContext.Provider value={playerTimeValue}>
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
          if (a) {
            a.playbackRate = 1;
            if (pendingSeekSecRef.current > 0.5) {
              // Keep muted until the resume seek lands so 0:00 never blasts briefly
              a.muted = true;
              applyPendingAudioSeek(a);
            } else {
              releaseSeekMuteGuard(a);
              if (
                a.currentTime === 0 &&
                audioKickDoneForLoadRef.current !== loadedAudioTrackIdRef.current
              ) {
                const loadTrackId = loadedAudioTrackIdRef.current;
                audioKickDoneForLoadRef.current = loadTrackId;
                // Guard against rare Chromium frame-0 silent decoder stall without interrupting normal starts
                window.setTimeout(() => {
                  const el = audioElRef.current;
                  if (
                    !el ||
                    activeEngineRef.current !== 'audio' ||
                    loadedAudioTrackIdRef.current !== loadTrackId ||
                    el.paused ||
                    el.ended ||
                    isSilentWarmupRef.current ||
                    pendingSeekSecRef.current > 0.5
                  ) {
                    return;
                  }
                  releaseSeekMuteGuard(el);
                  if (Number.isFinite(el.duration) && el.duration > 3 && el.currentTime === 0) {
                    try {
                      el.currentTime = 0.05;
                    } catch {
                      // ignore
                    }
                  }
                }, 650);
              }
            }
          }
          pauseKeepAliveBridgeIfForeground();
          consecutiveErrorsRef.current = 0;
          bgSkipStreakRef.current = 0;
          setIsPlaying(true);
          setIsBuffering(false);
          setPlayerError(null);
          setBackgroundBlockedHint(null);
          if (isBackgroundPlayRef.current) {
            startWebAudioKeepAlive();
            pokeBackgroundKeepAlive();
            void acquirePlaybackWakeLock();
          }
        }}
        onSeeked={(e) => {
          if (activeEngineRef.current !== 'audio') return;
          if (isSilentWarmupRef.current) return;
          const a = e.currentTarget;
          if (a.src.startsWith('data:')) return;
          const pending = pendingSeekSecRef.current;
          if (pending > 0.5) {
            if (Math.abs((a.currentTime || 0) - pending) <= 2.5) {
              pendingSeekSecRef.current = 0;
              pendingSeekSetAtRef.current = 0;
              currentTimeRef.current = a.currentTime;
              setCurrentTime(a.currentTime);
              releaseSeekMuteGuard(a);
            } else {
              applyPendingAudioSeek(a);
            }
          } else if (pendingSeekMuteGuardRef.current) {
            releaseSeekMuteGuard(a);
          }
        }}
        onPause={() => {
          if (activeEngineRef.current !== 'audio') return;
          if (isSilentWarmupRef.current) return;
          const a = audioElRef.current;
          if (!a || a.src.startsWith('data:')) return;
          if (!a.ended) {
            persistCurrentTrackResume(pendingSeekSecRef.current > 0.5 ? undefined : a.currentTime);
            // Whenever shouldPlayRef is true and userPausedRef is false, ANY pause event
            // (whether in background for 20 minutes OR when waking/unlocking the screen!)
            // is an involuntary OS interruption and must be auto-resumed immediately.
            if (
              !isYieldedToOfflineRef.current &&
              isBackgroundPlayRef.current &&
              shouldPlayRef.current &&
              !userPausedRef.current
            ) {
              pokeBackgroundKeepAlive();
              for (const retryMs of [25, 120, 350, 800, 1600, 2800]) {
                window.setTimeout(() => {
                  if (
                    !isYieldedToOfflineRef.current &&
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
              return;
            }
            setIsPlaying(false);
            setIsBuffering(false);
          }
        }}
        onWaiting={() => {
          if (activeEngineRef.current !== 'audio') return;
          if (isSilentWarmupRef.current) return;
          if (!shouldPlayRef.current || userPausedRef.current) return;
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
          const expected = expectedDurationRef.current;
          // Guard against progressive fMP4 chunks reporting partial loaded segment duration (e.g. 12s instead of 4:56)
          const isReliableDur =
            Number.isFinite(dur) &&
            dur > 5 &&
            (expected <= 0 || dur >= expected * 0.55 || a.readyState === 4);
          if (isReliableDur) {
            durationRef.current = dur;
            setDuration(dur);
            if (pendingSeekSecRef.current > 0.5) {
              applyPendingAudioSeek(a);
            }
          } else if (expected > 0 && durationRef.current <= 0) {
            durationRef.current = expected;
            setDuration(expected);
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
          const expected = expectedDurationRef.current;
          const dur =
            Number.isFinite(a.duration) &&
            a.duration > 5 &&
            (expected <= 0 || a.duration >= expected * 0.55 || a.readyState === 4)
              ? a.duration
              : expected || durationRef.current || 0;
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
            saveOnlineSession(cur);
          }

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
          const actualAudioTime = a.currentTime || 0;
          const resumeAt =
            actualAudioTime >= 2
              ? actualAudioTime
              : pendingSeekSecRef.current > 0.5
                ? pendingSeekSecRef.current
                : 0;
          releaseSeekMuteGuard(a);
          const track = queueRef.current[currentIndexRef.current];
          stopNativeAudio();
          // Never auto-switch to YouTube (which autoplays) when the track is currently paused (e.g. restored session)
          if (!shouldPlayRef.current || userPausedRef.current) {
            setIsBuffering(false);
            setIsPlaying(false);
            return;
          }
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
            const curIdx = currentIndexRef.current;
            if (curIdx + 1 < q.length) {
              const nextTrackItem = q[curIdx + 1];
              if (nextTrackItem && !isVideoModeRef.current) {
                beginSynchronousNativeAudio(nextTrackItem, 0);
              }
              setCurrentIndex(curIdx + 1);
            } else if (q[curIdx]) {
              void replenishRadioQueue(q[curIdx], true);
            }
            return;
          }
          if (track) {
            startYouTubeTrack(track.id, resumeAt);
          }
        }}
      />
      {children}
      </PlayerTimeContext.Provider>
    </PlayerContext.Provider>
  );
}

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used within PlayerProvider');
  return ctx;
}

export function usePlayerTime(): PlayerTimeContextValue {
  const ctx = useContext(PlayerTimeContext);
  if (!ctx) throw new Error('usePlayerTime must be used within PlayerProvider');
  return ctx;
}
