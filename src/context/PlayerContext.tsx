import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { fetchRelatedTracks } from '../services/api';
import type { RepeatMode, Track } from '../types/music';
import { useLibrary } from './LibraryContext';

interface YTPlayerInstance {
  loadVideoById: (videoId: string) => void;
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
  isVideoMode: boolean;
  isQueueOpen: boolean;
  relatedTracks: Track[];
  isLoadingRelated: boolean;
  playerError: string | null;
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
  setIsExpanded: (val: boolean) => void;
  setIsVideoMode: (val: boolean) => void;
  setIsQueueOpen: (val: boolean) => void;
  jumpToQueueIndex: (index: number) => void;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

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
  const [isVideoMode, setIsVideoMode] = useState(false);
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [relatedTracks, setRelatedTracks] = useState<Track[]>([]);
  const [isLoadingRelated, setIsLoadingRelated] = useState(false);
  const [playerError, setPlayerError] = useState<string | null>(null);

  const playerHostRef = useRef<HTMLDivElement | null>(null);
  const ytPlayerRef = useRef<YTPlayerInstance | null>(null);
  const ytReadyRef = useRef(false);
  const pendingTrackIdRef = useRef<string | null>(null);
  const loadedTrackIdRef = useRef<string | null>(null);
  const consecutiveErrorsRef = useRef(0);
  const radioFetchingRef = useRef(false);
  const shuffleHistoryRef = useRef<Set<string>>(new Set());

  const queueRef = useRef(queue);
  const currentIndexRef = useRef(currentIndex);
  const repeatModeRef = useRef(repeatMode);
  const isShuffleRef = useRef(isShuffle);
  const isRadioModeRef = useRef(isRadioMode);
  const volumeRef = useRef(volume);
  const isMutedRef = useRef(isMuted);
  const relatedTracksRef = useRef(relatedTracks);

  queueRef.current = queue;
  currentIndexRef.current = currentIndex;
  repeatModeRef.current = repeatMode;
  isShuffleRef.current = isShuffle;
  isRadioModeRef.current = isRadioMode;
  volumeRef.current = volume;
  isMutedRef.current = isMuted;
  relatedTracksRef.current = relatedTracks;

  const currentTrack = currentIndex >= 0 && currentIndex < queue.length ? queue[currentIndex] : null;

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
        const uniqueAdditions = freshTracks.filter((t) => !existingIds.has(t.id)).slice(0, 8);

        if (uniqueAdditions.length > 0) {
          let insertStartIndex = queueRef.current.length;
          setQueue((prev) => {
            const seen = new Set(prev.map((t) => t.id));
            const cleanNew = uniqueAdditions.filter((t) => !seen.has(t.id));
            insertStartIndex = prev.length;
            return [...prev, ...cleanNew];
          });
          if (advanceToNewTrack) {
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
    []
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

    if (rep === 'one') {
      ytPlayerRef.current?.seekTo(0, true);
      ytPlayerRef.current?.playVideo();
      return;
    }

    if (shuf && q.length > 1) {
      setCurrentIndex(pickNextShuffleIndex(q, idx));
      return;
    }

    if (idx + 1 < q.length) {
      setCurrentIndex(idx + 1);
    } else if (radio && q[idx]) {
      void replenishRadioQueue(q[idx], true);
    } else if (rep === 'all') {
      setCurrentIndex(0);
    } else {
      setIsPlaying(false);
    }
  }, [pickNextShuffleIndex, replenishRadioQueue]);

  const handleEmbedErrorSkip = useCallback(
    (code: number) => {
      const q = queueRef.current;
      const idx = currentIndexRef.current;
      const isRecoverable = code === 100 || code === 101 || code === 150 || code === 2;

      if (isRecoverable && q.length > 1 && consecutiveErrorsRef.current < 3) {
        consecutiveErrorsRef.current += 1;
        showToast('Skipped restricted YouTube track — playing next');
        if (idx + 1 < q.length) {
          setCurrentIndex(idx + 1);
        } else if (repeatModeRef.current === 'all') {
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
    [replenishRadioQueue, showToast]
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
            if (pendingTrackIdRef.current) {
              e.target.loadVideoById(pendingTrackIdRef.current);
              pendingTrackIdRef.current = null;
            }
          },
          onStateChange: (e) => {
            const state = e.data;
            const PS = window.YT?.PlayerState;
            if (!PS) return;
            if (state === PS.PLAYING) {
              consecutiveErrorsRef.current = 0;
              setIsPlaying(true);
              setIsBuffering(false);
              setPlayerError(null);
              const dur = e.target.getDuration();
              if (dur > 0) setDuration(dur);
            } else if (state === PS.PAUSED) {
              setIsPlaying(false);
              setIsBuffering(false);
            } else if (state === PS.BUFFERING) {
              setIsBuffering(true);
            } else if (state === PS.ENDED) {
              setIsBuffering(false);
              handleTrackEnd();
            }
          },
          onError: (e) => {
            setIsBuffering(false);
            setIsPlaying(false);
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

  // Load new video only when the active track ID actually changes (immune to queue mutations)
  useEffect(() => {
    if (!currentTrack) {
      loadedTrackIdRef.current = null;
      return;
    }
    if (loadedTrackIdRef.current === currentTrack.id) {
      return;
    }

    loadedTrackIdRef.current = currentTrack.id;
    shuffleHistoryRef.current.add(currentTrack.id);
    setCurrentTime(0);
    setDuration(currentTrack.durationSeconds || 0);
    setPlayerError(null);
    setIsBuffering(true);
    recordPlayed(currentTrack);

    if (ytReadyRef.current && ytPlayerRef.current) {
      ytPlayerRef.current.loadVideoById(currentTrack.id);
    } else {
      pendingTrackIdRef.current = currentTrack.id;
    }
  }, [currentTrack, recordPlayed]);

  // Fetch related tracks when currentTrack changes (with AbortController cleanup)
  useEffect(() => {
    if (!currentTrack) {
      setRelatedTracks([]);
      return;
    }
    const controller = new AbortController();
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
          setRelatedTracks([]);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoadingRelated(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [currentTrack?.id]);

  // Proactively pre-fill Infinite Radio when reaching the final queued track
  useEffect(() => {
    if (!isRadioMode || !currentTrack) return;
    if (currentIndex >= 0 && currentIndex >= queue.length - 1 && relatedTracks.length > 0 && !radioFetchingRef.current) {
      const existing = new Set(queue.map((t) => t.id));
      const candidates = relatedTracks.filter((t) => !existing.has(t.id)).slice(0, 6);
      if (candidates.length > 0) {
        setQueue((prev) => {
          const seen = new Set(prev.map((t) => t.id));
          const add = candidates.filter((t) => !seen.has(t.id));
          return add.length > 0 ? [...prev, ...add] : prev;
        });
      }
    }
  }, [isRadioMode, currentTrack, currentIndex, queue.length, relatedTracks, queue]);

  // Poll playback progress & track real listening duration every 5 seconds
  useEffect(() => {
    if (!isPlaying) return;
    let tickCount = 0;
    const timer = window.setInterval(() => {
      const p = ytPlayerRef.current;
      if (p) {
        try {
          const cur = p.getCurrentTime();
          const dur = p.getDuration();
          if (typeof cur === 'number' && !Number.isNaN(cur)) setCurrentTime(cur);
          if (typeof dur === 'number' && dur > 0) setDuration(dur);
        } catch {
          // ignore
        }
      }
      tickCount += 1;
      if (tickCount % 10 === 0) {
        recordListeningSeconds(5);
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [isPlaying, recordListeningSeconds]);

  const playTrack = useCallback((track: Track, newQueue?: Track[], openVideo?: boolean) => {
    consecutiveErrorsRef.current = 0;
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
    if (openVideo || track.isVideo) {
      setIsVideoMode(true);
      setIsExpanded(true);
    }
  }, []);

  const startTrackRadio = useCallback(
    (track: Track) => {
      consecutiveErrorsRef.current = 0;
      setIsRadioMode(true);
      localStorage.setItem('vibra_radio_mode', 'true');
      setQueue([track]);
      setCurrentIndex(0);
      showToast(`Infinite Radio started from "${track.title}"`);
      void replenishRadioQueue(track, false);
    },
    [replenishRadioQueue, showToast]
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

  const removeFromQueue = useCallback((index: number) => {
    setQueue((prev) => {
      if (index < 0 || index >= prev.length) return prev;
      const next = prev.filter((_, i) => i !== index);
      if (next.length === 0) {
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
  }, []);

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
    const p = ytPlayerRef.current;
    if (!p || !currentTrack) return;
    if (isPlaying) {
      p.pauseVideo();
    } else {
      p.playVideo();
    }
  }, [isPlaying, currentTrack]);

  const nextTrack = useCallback(() => {
    const q = queueRef.current;
    const idx = currentIndexRef.current;
    if (q.length === 0) return;
    if (isShuffleRef.current && q.length > 1) {
      setCurrentIndex(pickNextShuffleIndex(q, idx));
      return;
    }
    if (idx + 1 < q.length) {
      setCurrentIndex(idx + 1);
    } else if (isRadioModeRef.current && q[idx]) {
      void replenishRadioQueue(q[idx], true);
    } else {
      setCurrentIndex(0);
    }
  }, [pickNextShuffleIndex, replenishRadioQueue]);

  const prevTrack = useCallback(() => {
    const q = queueRef.current;
    const idx = currentIndexRef.current;
    if (q.length === 0) return;
    if (currentTime > 4) {
      ytPlayerRef.current?.seekTo(0, true);
      setCurrentTime(0);
      return;
    }
    if (idx - 1 >= 0) {
      setCurrentIndex(idx - 1);
    } else {
      setCurrentIndex(q.length - 1);
    }
  }, [currentTime]);

  const seekTo = useCallback((seconds: number) => {
    setCurrentTime(seconds);
    ytPlayerRef.current?.seekTo(seconds, true);
  }, []);

  const setVolume = useCallback(
    (vol: number) => {
      const clamped = Math.max(0, Math.min(100, vol));
      setVolumeState(clamped);
      localStorage.setItem('vibra_volume', String(clamped));
      ytPlayerRef.current?.setVolume(clamped);
      if (clamped > 0 && isMuted) {
        ytPlayerRef.current?.unMute();
        setIsMuted(false);
      }
    },
    [isMuted]
  );

  const toggleMute = useCallback(() => {
    if (!ytPlayerRef.current) return;
    if (isMuted) {
      ytPlayerRef.current.unMute();
      setIsMuted(false);
    } else {
      ytPlayerRef.current.mute();
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

  const jumpToQueueIndex = useCallback((index: number) => {
    if (index >= 0 && index < queueRef.current.length) {
      setCurrentIndex(index);
    }
  }, []);

  // OS / Lock-screen MediaSession integration
  useEffect(() => {
    if (!('mediaSession' in navigator) || !currentTrack) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.title,
        artist: currentTrack.artist,
        album: 'VIBRA Radio',
        artwork: [
          {
            src: currentTrack.thumbnailHigh || currentTrack.thumbnail,
            sizes: '480x360',
            type: 'image/jpeg',
          },
        ],
      });
      navigator.mediaSession.setActionHandler('play', () => ytPlayerRef.current?.playVideo());
      navigator.mediaSession.setActionHandler('pause', () => ytPlayerRef.current?.pauseVideo());
      navigator.mediaSession.setActionHandler('previoustrack', () => prevTrack());
      navigator.mediaSession.setActionHandler('nexttrack', () => nextTrack());
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (typeof details.seekTime === 'number') {
          seekTo(details.seekTime);
        }
      });
    } catch {
      // ignore unsupported MediaSession handlers
    }
  }, [currentTrack, nextTrack, prevTrack, seekTo]);

  return (
    <PlayerContext.Provider
      value={{
        currentTrack,
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
        relatedTracks,
        isLoadingRelated,
        playerError,
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
        setIsExpanded,
        setIsVideoMode,
        setIsQueueOpen,
        jumpToQueueIndex,
      }}
    >
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used within PlayerProvider');
  return ctx;
}
