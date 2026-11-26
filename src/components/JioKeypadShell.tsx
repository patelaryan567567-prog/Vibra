import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Compass,
  Heart,
  Home,
  Library,
  Mic2,
  Music,
  Pause,
  Play,
  Repeat,
  Search,
  Shuffle,
  SkipBack,
  SkipForward,
  Sparkles,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  discoverWithAi,
  fetchCategoryTracks,
  fetchTrackLyrics,
  searchYouTube,
} from '../services/api';
import type {
  CategoryId,
  IndiaLanguageFilter,
  LyricsResponse,
  Track,
} from '../types/music';
import { formatSeconds, parseDurationLabel } from '../utils/format';

type JioTab = 'home' | 'search' | 'player' | 'lyrics' | 'saved';

const STORAGE_FAVOURITES_KEY = 'vibra_favourites_v1';
const STORAGE_RECENT_KEY = 'vibra_recent_v1';
const STORAGE_POSITIONS_KEY = 'vibra_track_positions_v1';
const ONLINE_SESSION_KEY = 'vibra_online_session_v1';

const JIO_CATEGORIES: Array<{ id: CategoryId; label: string }> = [
  { id: 'trending', label: 'Trending' },
  { id: 'energetic', label: 'Energetic' },
  { id: 'sad', label: 'Sad' },
  { id: 'discover', label: 'Chill' },
];

const JIO_LANGS: Array<{ id: IndiaLanguageFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'hindi', label: 'Hindi' },
  { id: 'punjabi', label: 'Punjabi' },
  { id: 'mix', label: 'Mix' },
  { id: 'english', label: 'English' },
];

function readLocalJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeLocalJson<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota errors on 512MB feature phone storage
  }
}

function buildStreamUrl(track: Track): string {
  const qs = new URLSearchParams({
    videoId: track.id,
    title: track.title,
    artist: track.artist,
    duration: String(track.durationSeconds || parseDurationLabel(track.duration) || 0),
  });
  return `/api/audio/stream?${qs.toString()}`;
}

export function isJioKeypadDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  const search = window.location.search || '';
  if (search.indexOf('desktop=1') !== -1) return false;
  if (search.indexOf('jio=1') !== -1 || search.indexOf('kaios=1') !== -1) return true;
  if (/KAIOS|JioPhone|JioBrowser|LYF\/|F220B|F320B|F271i|F120B|F90M|F250Y|F300B/i.test(ua)) {
    return true;
  }
  // Standard JioPhone 4G / KaiOS screen width is 240px (QVGA 240x320) or landscape 320x240
  const w = window.innerWidth || document.documentElement.clientWidth || 1024;
  const h = window.innerHeight || document.documentElement.clientHeight || 768;
  return w <= 265 || (w <= 330 && h <= 260);
}

export function JioKeypadShell({ onExitJioMode }: { onExitJioMode?: () => void }) {
  const [tab, setTab] = useState<JioTab>('home');
  const [category, setCategory] = useState<CategoryId>('trending');
  const [lang, setLang] = useState<IndiaLanguageFilter>('all');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchMode, setSearchMode] = useState<'songs' | 'ai'>('songs');
  const [searchResults, setSearchResults] = useState<Track[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const [favourites, setFavourites] = useState<Track[]>(() =>
    readLocalJson<Track[]>(STORAGE_FAVOURITES_KEY, [])
  );
  const [recentTracks, setRecentTracks] = useState<Track[]>(() => {
    const raw = readLocalJson<Array<{ track?: Track } | Track>>(STORAGE_RECENT_KEY, []);
    const out: Track[] = [];
    for (const item of raw) {
      const t = item && typeof item === 'object' && 'track' in item ? item.track : (item as Track);
      if (t && t.id && t.title) out.push(t);
    }
    return out.slice(0, 25);
  });

  const [queue, setQueue] = useState<Track[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState<number>(() => {
    const saved = Number(localStorage.getItem('vibra_volume'));
    return Number.isFinite(saved) && saved >= 0 && saved <= 100 ? saved : 85;
  });
  const [isMuted, setIsMuted] = useState(false);
  const [repeatOne, setRepeatOne] = useState(false);
  const [isShuffle, setIsShuffle] = useState(false);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const [lyrics, setLyrics] = useState<LyricsResponse | null>(null);
  const [isLoadingLyrics, setIsLoadingLyrics] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pendingResumeTimeRef = useRef<number>(0);

  const currentTrack = currentIndex >= 0 && currentIndex < queue.length ? queue[currentIndex] : null;

  const showNotice = useCallback((msg: string) => {
    setStatusNotice(msg);
  }, []);

  useEffect(() => {
    if (!statusNotice) return;
    const t = window.setTimeout(() => setStatusNotice(null), 2200);
    return () => window.clearTimeout(t);
  }, [statusNotice]);

  // Restore last paused session on startup without auto-playing
  useEffect(() => {
    try {
      const saved = readLocalJson<{
        queue?: Track[];
        currentIndex?: number;
        currentTime?: number;
      } | null>(ONLINE_SESSION_KEY, null);
      if (!saved || !Array.isArray(saved.queue) || saved.queue.length === 0) return;
      const validQ = saved.queue.filter((t) => Boolean(t && t.id && t.title));
      if (validQ.length === 0) return;
      const idx = Math.max(0, Math.min(validQ.length - 1, saved.currentIndex ?? 0));
      const tr = validQ[idx];
      const positions = readLocalJson<Record<string, { positionSeconds?: number }>>(
        STORAGE_POSITIONS_KEY,
        {}
      );
      const savedSec =
        positions[tr.id]?.positionSeconds ??
        (typeof saved.currentTime === 'number' ? saved.currentTime : 0);
      const dur = tr.durationSeconds || parseDurationLabel(tr.duration) || 0;

      setQueue(validQ);
      setCurrentIndex(idx);
      setCurrentTime(Math.max(0, savedSec));
      setDuration(dur);
      pendingResumeTimeRef.current = Math.max(0, savedSec);
      setIsPlaying(false);
    } catch {
      // ignore
    }
  }, []);

  // Persist current session so smartphone/desktop and Jio Mode share exact resume position
  useEffect(() => {
    if (!currentTrack || queue.length === 0) return;
    writeLocalJson(ONLINE_SESSION_KEY, {
      queue: queue.slice(0, 40),
      currentIndex,
      currentTime: Math.floor(currentTime),
      repeatMode: repeatOne ? 'one' : 'all',
      isShuffle,
      isRadioMode: true,
      wasPlaying: isPlaying,
      savedAt: Date.now(),
    });
  }, [currentTrack, queue, currentIndex, isPlaying, repeatOne, isShuffle, currentTime]);

  // Load discovery category tracks
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setErrorMsg(null);
    fetchCategoryTracks({ category, lang })
      .then((list) => {
        if (!cancelled) {
          setTracks(list.slice(0, 20));
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setErrorMsg(err instanceof Error ? err.message : 'Unable to load songs');
          setIsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [category, lang]);

  // Fetch lyrics when currentTrack changes and user opens Lyrics tab (or preloads)
  useEffect(() => {
    if (!currentTrack) {
      setLyrics(null);
      return;
    }
    let cancelled = false;
    setIsLoadingLyrics(true);
    fetchTrackLyrics({
      title: currentTrack.title,
      artist: currentTrack.artist,
      durationSeconds: currentTrack.durationSeconds || parseDurationLabel(currentTrack.duration),
    })
      .then((res) => {
        if (!cancelled) {
          setLyrics(res);
          setIsLoadingLyrics(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLyrics({ found: false, syncedLines: [], plainLyrics: null });
          setIsLoadingLyrics(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [currentTrack?.id]);

  const recordTrackToHistory = useCallback((track: Track) => {
    setRecentTracks((prev) => {
      const next = [track, ...prev.filter((t) => t.id !== track.id)].slice(0, 25);
      writeLocalJson(
        STORAGE_RECENT_KEY,
        next.map((t) => ({ track: t, playedAt: Date.now() }))
      );
      return next;
    });
  }, []);

  const startPlayback = useCallback(
    (track: Track, newQueue?: Track[], startAt = 0) => {
      const list = newQueue && newQueue.length > 0 ? newQueue : [track];
      let idx = list.findIndex((t) => t.id === track.id);
      if (idx === -1) idx = 0;

      const dur = track.durationSeconds || parseDurationLabel(track.duration) || 0;
      setQueue(list);
      setCurrentIndex(idx);
      setCurrentTime(startAt);
      setDuration(dur);
      pendingResumeTimeRef.current = startAt;
      setIsBuffering(true);
      setIsPlaying(true);
      recordTrackToHistory(track);

      const audio = audioRef.current;
      if (audio) {
        const nextSrc = buildStreamUrl(track);
        audio.src = nextSrc;
        audio.volume = isMuted ? 0 : volume / 100;
        audio.load();
        const playPromise = audio.play();
        if (playPromise && typeof playPromise.catch === 'function') {
          playPromise.catch(() => {
            setIsPlaying(false);
            setIsBuffering(false);
            showNotice('Press OK / 5 to play');
          });
        }
      }
    },
    [isMuted, recordTrackToHistory, showNotice, volume]
  );

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!currentTrack) {
      if (tracks.length > 0) {
        startPlayback(tracks[0], tracks, 0);
      }
      return;
    }
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      return;
    }

    if (!audio.src || audio.src === window.location.href) {
      startPlayback(currentTrack, queue, pendingResumeTimeRef.current || currentTime || 0);
      return;
    }

    const playPromise = audio.play();
    setIsPlaying(true);
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {
        startPlayback(currentTrack, queue, currentTime || 0);
      });
    }
  }, [currentTime, currentTrack, isPlaying, queue, startPlayback, tracks]);

  const playNext = useCallback(() => {
    if (queue.length === 0) return;
    let nextIdx = currentIndex + 1;
    if (isShuffle && queue.length > 1) {
      nextIdx = Math.floor(Math.random() * queue.length);
      if (nextIdx === currentIndex) nextIdx = (currentIndex + 1) % queue.length;
    } else if (nextIdx >= queue.length) {
      nextIdx = 0;
    }
    startPlayback(queue[nextIdx], queue, 0);
  }, [currentIndex, isShuffle, queue, startPlayback]);

  const playPrev = useCallback(() => {
    if (queue.length === 0) return;
    if (currentTime > 4 && audioRef.current) {
      audioRef.current.currentTime = 0;
      setCurrentTime(0);
      return;
    }
    const prevIdx = currentIndex > 0 ? currentIndex - 1 : queue.length - 1;
    startPlayback(queue[prevIdx], queue, 0);
  }, [currentIndex, currentTime, queue, startPlayback]);

  const seekBy = useCallback(
    (delta: number) => {
      const audio = audioRef.current;
      const maxDur = duration || currentTrack?.durationSeconds || 0;
      const target = Math.max(0, maxDur > 0 ? Math.min(maxDur - 1, currentTime + delta) : currentTime + delta);
      setCurrentTime(target);
      pendingResumeTimeRef.current = target;
      if (audio && audio.readyState >= 1) {
        try {
          audio.currentTime = target;
        } catch {
          // ignore
        }
      }
    },
    [currentTime, currentTrack?.durationSeconds, duration]
  );

  const changeVolume = useCallback(
    (delta: number) => {
      setVolume((prev) => {
        const next = Math.max(0, Math.min(100, prev + delta));
        try {
          localStorage.setItem('vibra_volume', String(next));
        } catch {
          // ignore
        }
        if (audioRef.current) {
          audioRef.current.muted = false;
          audioRef.current.volume = next / 100;
        }
        setIsMuted(false);
        showNotice(`Volume ${next}%`);
        return next;
      });
    },
    [showNotice]
  );

  const toggleFavourite = useCallback(
    (track: Track) => {
      setFavourites((prev) => {
        const exists = prev.some((t) => t.id === track.id);
        const next = exists ? prev.filter((t) => t.id !== track.id) : [track, ...prev];
        writeLocalJson(STORAGE_FAVOURITES_KEY, next);
        showNotice(exists ? 'Removed from Saved' : 'Saved to Favourites');
        return next;
      });
    },
    [showNotice]
  );

  const isTrackLiked = useCallback(
    (trackId?: string) => Boolean(trackId && favourites.some((f) => f.id === trackId)),
    [favourites]
  );

  const handleSearchSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;
    setIsSearching(true);
    setErrorMsg(null);
    try {
      if (searchMode === 'ai') {
        const res = await discoverWithAi(q);
        setSearchResults(res.tracks.slice(0, 20));
      } else {
        const res = await searchYouTube({ query: q, type: 'songs', maxResults: 18 });
        setSearchResults(res.tracks.slice(0, 20));
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setIsSearching(false);
    }
  };

  // D-Pad & JioPhone Numeric Keypad Navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement as HTMLElement | null;
      const tag = activeEl?.tagName?.toLowerCase();
      const isTyping = tag === 'input' || tag === 'textarea';

      // Allow D-Pad Up/Down to leave search input so keypad users aren't trapped in input box
      if (isTyping && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        activeEl?.blur();
      } else if (isTyping) {
        return;
      }

      const focusables = Array.from(
        containerRef.current?.querySelectorAll<HTMLElement>('[data-jio-focus="true"]') ?? []
      ).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (focusables.length === 0) return;
        const curIdx = activeEl ? focusables.indexOf(activeEl) : -1;
        const nextIdx =
          e.key === 'ArrowDown'
            ? curIdx < focusables.length - 1
              ? curIdx + 1
              : 0
            : curIdx > 0
              ? curIdx - 1
              : focusables.length - 1;
        const target = focusables[nextIdx];
        if (target) {
          target.focus();
          target.scrollIntoView({ block: 'nearest' });
        }
        return;
      }

      if (e.key === 'ArrowLeft') {
        if (tab === 'player') {
          e.preventDefault();
          seekBy(-10);
          showNotice('-10s');
        }
        return;
      }

      if (e.key === 'ArrowRight') {
        if (tab === 'player') {
          e.preventDefault();
          seekBy(10);
          showNotice('+10s');
        }
        return;
      }

      // JioPhone Hardware Numeric Keypad Shortcuts
      switch (e.key) {
        case '1':
          e.preventDefault();
          setTab('home');
          break;
        case '2':
          e.preventDefault();
          setTab('search');
          window.setTimeout(() => searchInputRef.current?.focus(), 60);
          break;
        case '3':
          e.preventDefault();
          setTab('player');
          break;
        case '4':
          e.preventDefault();
          playPrev();
          showNotice('Previous Song');
          break;
        case '5':
        case ' ':
          if (tag !== 'button') {
            e.preventDefault();
            togglePlay();
          }
          break;
        case '6':
          e.preventDefault();
          playNext();
          showNotice('Next Song');
          break;
        case '7':
          e.preventDefault();
          seekBy(-10);
          showNotice('Rewind -10s');
          break;
        case '8':
          e.preventDefault();
          setTab('lyrics');
          break;
        case '9':
          e.preventDefault();
          seekBy(10);
          showNotice('Forward +10s');
          break;
        case '0':
          e.preventDefault();
          if (currentTrack) {
            toggleFavourite(currentTrack);
          } else {
            setTab('saved');
          }
          break;
        case '*':
          e.preventDefault();
          changeVolume(-10);
          break;
        case '#':
          e.preventDefault();
          changeVolume(10);
          break;
        case 'SoftLeft':
        case 'F1':
          e.preventDefault();
          setTab((prev) =>
            prev === 'home'
              ? 'search'
              : prev === 'search'
                ? 'player'
                : prev === 'player'
                  ? 'lyrics'
                  : prev === 'lyrics'
                    ? 'saved'
                    : 'home'
          );
          break;
        case 'SoftRight':
        case 'F2':
          e.preventDefault();
          togglePlay();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [changeVolume, currentTrack, playNext, playPrev, seekBy, showNotice, tab, toggleFavourite, togglePlay]);

  const activeLyricIndex = useMemo(() => {
    const lines = lyrics?.syncedLines ?? [];
    if (lines.length === 0) return -1;
    let found = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].timeSeconds <= currentTime + 0.3) {
        found = i;
      } else {
        break;
      }
    }
    return found;
  }, [currentTime, lyrics?.syncedLines]);

  const activeLyricRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (tab === 'lyrics' && activeLyricIndex >= 0 && activeLyricRef.current) {
      activeLyricRef.current.scrollIntoView({ block: 'center' });
    }
  }, [activeLyricIndex, tab]);

  const effectiveDuration =
    duration > 0
      ? duration
      : currentTrack?.durationSeconds || parseDurationLabel(currentTrack?.duration) || 0;
  const progressPct =
    effectiveDuration > 0 ? Math.min(100, Math.round((currentTime / effectiveDuration) * 100)) : 0;

  const renderTrackList = (list: Track[], emptyText: string) => {
    if (list.length === 0) {
      return <p className="text-[11px] text-slate-400 py-4 text-center">{emptyText}</p>;
    }
    return (
      <div className="space-y-1">
        {list.map((t, idx) => {
          const isCurrent = currentTrack?.id === t.id;
          const liked = isTrackLiked(t.id);
          return (
            <div
              key={`${t.id}_${idx}`}
              className={`rounded-lg border p-1.5 flex items-center gap-1.5 ${
                isCurrent
                  ? 'bg-[#182042] border-[#7A90FF]'
                  : 'bg-[#11131A] border-white/10'
              }`}
            >
              <button
                type="button"
                data-jio-focus="true"
                onClick={() => startPlayback(t, list, 0)}
                className="flex-1 min-w-0 text-left focus:outline-none focus:ring-2 focus:ring-[#7A90FF] rounded px-1 py-0.5"
              >
                <div className="flex items-center gap-1.5">
                  <span className="font-mono-tabular text-[10px] text-[#7A90FF] shrink-0">
                    {isCurrent && isPlaying ? '▶' : `${idx + 1}.`}
                  </span>
                  <p className="text-[12px] font-semibold text-white truncate">{t.title}</p>
                </div>
                <div className="flex items-center justify-between gap-1 text-[10px] text-slate-400 pl-3">
                  <span className="truncate">{t.artist}</span>
                  <span className="font-mono-tabular shrink-0">{t.duration || ''}</span>
                </div>
              </button>

              <button
                type="button"
                data-jio-focus="true"
                onClick={() => toggleFavourite(t)}
                aria-label="Save song"
                className={`px-1.5 py-1 rounded text-[10px] font-bold focus:outline-none focus:ring-2 focus:ring-[#7A90FF] ${
                  liked ? 'text-rose-400 bg-rose-500/15' : 'text-slate-400 bg-white/5'
                }`}
              >
                ♥
              </button>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div
      ref={containerRef}
      className="min-h-screen bg-[#090A0F] text-[#F4F5F8] flex flex-col select-none text-[12px]"
    >
      {/* Hidden Native HTML5 Audio Engine for JioPhone 4G */}
      <audio
        ref={audioRef}
        preload="none"
        onLoadedMetadata={(e) => {
          const el = e.currentTarget;
          if (el.duration && Number.isFinite(el.duration) && el.duration > 0) {
            setDuration(Math.round(el.duration));
          }
          if (pendingResumeTimeRef.current > 1) {
            try {
              el.currentTime = pendingResumeTimeRef.current;
            } catch {
              // ignore
            }
            pendingResumeTimeRef.current = 0;
          }
        }}
        onTimeUpdate={(e) => {
          const sec = e.currentTarget.currentTime || 0;
          setCurrentTime(sec);
          if (currentTrack && Math.floor(sec) % 4 === 0 && sec > 2) {
            const positions = readLocalJson<Record<string, unknown>>(STORAGE_POSITIONS_KEY, {});
            positions[currentTrack.id] = {
              positionSeconds: Math.floor(sec),
              durationSeconds: effectiveDuration,
              updatedAt: Date.now(),
            };
            writeLocalJson(STORAGE_POSITIONS_KEY, positions);
          }
        }}
        onPlaying={() => {
          setIsBuffering(false);
          setIsPlaying(true);
        }}
        onPause={() => setIsPlaying(false)}
        onWaiting={() => setIsBuffering(true)}
        onEnded={() => {
          if (repeatOne && currentTrack) {
            startPlayback(currentTrack, queue, 0);
          } else {
            playNext();
          }
        }}
        onError={() => {
          setIsBuffering(false);
          showNotice('Loading next available stream...');
        }}
      />

      {/* Compact Top Header Bar (26px) */}
      <header className="sticky top-0 z-30 bg-[#0D0E14] border-b border-white/15 px-2 py-1 flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <Music className="w-3.5 h-3.5 text-[#7A90FF] shrink-0" />
          <span className="font-display font-extrabold text-[12px] tracking-tight text-white">
            VIBRA 4G
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0 text-[10px] text-slate-300">
          {currentTrack && (
            <button
              type="button"
              data-jio-focus="true"
              onClick={togglePlay}
              className="px-1.5 py-0.5 rounded bg-[#4F6BFF] text-white font-semibold focus:outline-none focus:ring-2 focus:ring-white"
            >
              {isBuffering ? '...' : isPlaying ? 'Pause (5)' : 'Play (5)'}
            </button>
          )}
          {onExitJioMode && (
            <button
              type="button"
              data-jio-focus="true"
              onClick={onExitJioMode}
              className="px-1.5 py-0.5 rounded bg-white/10 text-slate-300 focus:outline-none focus:ring-2 focus:ring-[#7A90FF]"
            >
              Full UI
            </button>
          )}
        </div>
      </header>

      {/* Top Keypad Tab Strip (1-Home, 2-Search, 3-Player, 8-Lyrics, 0-Saved) */}
      <nav
        aria-label="JioPhone navigation"
        className="grid grid-cols-5 bg-[#11131A] border-b border-white/10 text-[10px] font-semibold"
      >
        {[
          { id: 'home' as JioTab, label: '1:Home', icon: Home },
          { id: 'search' as JioTab, label: '2:Find', icon: Search },
          { id: 'player' as JioTab, label: '3:Play', icon: Compass },
          { id: 'lyrics' as JioTab, label: '8:Lyric', icon: Mic2 },
          { id: 'saved' as JioTab, label: '0:Saved', icon: Library },
        ].map((item) => {
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              data-jio-focus="true"
              onClick={() => setTab(item.id)}
              className={`py-1.5 px-0.5 text-center truncate focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#7A90FF] ${
                active
                  ? 'bg-[#4F6BFF] text-white font-bold'
                  : 'text-slate-300 hover:bg-white/5'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* Status Notice Toast */}
      {statusNotice && (
        <div className="bg-[#4F6BFF] text-white text-[11px] font-semibold px-2 py-0.5 text-center">
          {statusNotice}
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 px-2 py-1.5 pb-16 overflow-y-auto space-y-2">
        {tab === 'home' && (
          <div className="space-y-2">
            {/* Mood Category Filter Row */}
            <div className="grid grid-cols-4 gap-1">
              {JIO_CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  data-jio-focus="true"
                  onClick={() => setCategory(c.id)}
                  className={`py-1 px-1 rounded text-[10px] font-semibold truncate focus:outline-none focus:ring-2 focus:ring-[#7A90FF] ${
                    category === c.id
                      ? 'bg-[#4F6BFF] text-white'
                      : 'bg-[#151824] text-slate-300'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>

            {/* Language Filter Row */}
            <div className="grid grid-cols-5 gap-1">
              {JIO_LANGS.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  data-jio-focus="true"
                  onClick={() => setLang(l.id)}
                  className={`py-1 px-0.5 rounded text-[10px] font-medium truncate focus:outline-none focus:ring-2 focus:ring-[#7A90FF] ${
                    lang === l.id
                      ? 'bg-white/20 text-white font-bold'
                      : 'bg-[#11131A] text-slate-400'
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>

            {errorMsg && (
              <p className="text-[11px] text-amber-300 bg-amber-500/10 rounded p-1.5">
                {errorMsg}
              </p>
            )}

            {isLoading ? (
              <p className="text-[11px] text-slate-400 py-6 text-center">Loading songs...</p>
            ) : (
              renderTrackList(tracks, 'No songs found.')
            )}
          </div>
        )}

        {tab === 'search' && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-1">
              <button
                type="button"
                data-jio-focus="true"
                onClick={() => setSearchMode('songs')}
                className={`py-1 rounded text-[11px] font-semibold focus:outline-none focus:ring-2 focus:ring-[#7A90FF] ${
                  searchMode === 'songs' ? 'bg-[#4F6BFF] text-white' : 'bg-[#151824] text-slate-300'
                }`}
              >
                Song Search
              </button>
              <button
                type="button"
                data-jio-focus="true"
                onClick={() => setSearchMode('ai')}
                className={`py-1 rounded text-[11px] font-semibold inline-flex items-center justify-center gap-1 focus:outline-none focus:ring-2 focus:ring-[#7A90FF] ${
                  searchMode === 'ai' ? 'bg-[#4F6BFF] text-white' : 'bg-[#151824] text-slate-300'
                }`}
              >
                <Sparkles className="w-3 h-3" />
                <span>AI Mood</span>
              </button>
            </div>

            <form onSubmit={handleSearchSubmit} className="flex gap-1">
              <input
                ref={searchInputRef}
                data-jio-focus="true"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  searchMode === 'ai' ? 'Mood (e.g. Hindi sad)...' : 'Song or artist...'
                }
                className="flex-1 min-w-0 h-8 px-2 rounded bg-[#151824] border border-white/15 text-[12px] text-white placeholder:text-slate-500 focus:outline-none focus:border-[#7A90FF]"
              />
              <button
                type="submit"
                data-jio-focus="true"
                className="h-8 px-2.5 rounded bg-[#4F6BFF] text-white text-[11px] font-bold shrink-0 focus:outline-none focus:ring-2 focus:ring-white"
              >
                Go
              </button>
            </form>

            {isSearching ? (
              <p className="text-[11px] text-slate-400 py-6 text-center">Searching...</p>
            ) : (
              renderTrackList(
                searchResults,
                'Enter a song or artist above and press Go.'
              )
            )}
          </div>
        )}

        {tab === 'player' && (
          <div className="space-y-2 pt-1">
            {currentTrack ? (
              <div className="rounded-xl bg-[#11131A] border border-white/15 p-2.5 space-y-2.5">
                <div className="flex items-center gap-2">
                  <img
                    src={currentTrack.thumbnail}
                    alt={currentTrack.title}
                    referrerPolicy="no-referrer"
                    className="w-12 h-12 rounded-lg object-cover shrink-0 bg-[#181B26]"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-bold text-white leading-snug line-clamp-2">
                      {currentTrack.title}
                    </p>
                    <p className="text-[11px] text-slate-400 truncate">{currentTrack.artist}</p>
                  </div>
                </div>

                {/* Progress Bar & Timestamps */}
                <div className="space-y-1">
                  <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden">
                    <div
                      className="h-full bg-[#4F6BFF]"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between font-mono-tabular text-[10px] text-slate-300">
                    <span>{formatSeconds(Math.floor(currentTime))}</span>
                    <span>{isBuffering ? 'Loading...' : `${progressPct}%`}</span>
                    <span>{formatSeconds(Math.floor(effectiveDuration))}</span>
                  </div>
                </div>

                {/* Primary Keypad Transport Controls */}
                <div className="grid grid-cols-5 gap-1">
                  <button
                    type="button"
                    data-jio-focus="true"
                    onClick={playPrev}
                    className="py-2 rounded-lg bg-[#181B26] text-white flex flex-col items-center justify-center gap-0.5 focus:outline-none focus:ring-2 focus:ring-[#7A90FF]"
                  >
                    <SkipBack className="w-3.5 h-3.5" />
                    <span className="text-[9px] text-slate-400">4:Prev</span>
                  </button>

                  <button
                    type="button"
                    data-jio-focus="true"
                    onClick={() => seekBy(-10)}
                    className="py-2 rounded-lg bg-[#181B26] text-white flex flex-col items-center justify-center gap-0.5 focus:outline-none focus:ring-2 focus:ring-[#7A90FF]"
                  >
                    <span className="text-[11px] font-bold">-10s</span>
                    <span className="text-[9px] text-slate-400">Key 7</span>
                  </button>

                  <button
                    type="button"
                    data-jio-focus="true"
                    onClick={togglePlay}
                    className="py-2 rounded-lg bg-[#4F6BFF] text-white flex flex-col items-center justify-center gap-0.5 font-bold focus:outline-none focus:ring-2 focus:ring-white"
                  >
                    {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                    <span className="text-[9px]">5:{isPlaying ? 'Pause' : 'Play'}</span>
                  </button>

                  <button
                    type="button"
                    data-jio-focus="true"
                    onClick={() => seekBy(10)}
                    className="py-2 rounded-lg bg-[#181B26] text-white flex flex-col items-center justify-center gap-0.5 focus:outline-none focus:ring-2 focus:ring-[#7A90FF]"
                  >
                    <span className="text-[11px] font-bold">+10s</span>
                    <span className="text-[9px] text-slate-400">Key 9</span>
                  </button>

                  <button
                    type="button"
                    data-jio-focus="true"
                    onClick={playNext}
                    className="py-2 rounded-lg bg-[#181B26] text-white flex flex-col items-center justify-center gap-0.5 focus:outline-none focus:ring-2 focus:ring-[#7A90FF]"
                  >
                    <SkipForward className="w-3.5 h-3.5" />
                    <span className="text-[9px] text-slate-400">6:Next</span>
                  </button>
                </div>

                {/* Secondary Controls: Volume, Like, Repeat, Shuffle, Lyrics */}
                <div className="grid grid-cols-5 gap-1">
                  <button
                    type="button"
                    data-jio-focus="true"
                    onClick={() => changeVolume(-10)}
                    className="py-1.5 rounded bg-white/5 text-slate-200 flex flex-col items-center justify-center focus:outline-none focus:ring-2 focus:ring-[#7A90FF]"
                  >
                    <VolumeX className="w-3.5 h-3.5" />
                    <span className="text-[9px]">*:Vol-</span>
                  </button>

                  <button
                    type="button"
                    data-jio-focus="true"
                    onClick={() => changeVolume(10)}
                    className="py-1.5 rounded bg-white/5 text-slate-200 flex flex-col items-center justify-center focus:outline-none focus:ring-2 focus:ring-[#7A90FF]"
                  >
                    <Volume2 className="w-3.5 h-3.5" />
                    <span className="text-[9px]">#:Vol+</span>
                  </button>

                  <button
                    type="button"
                    data-jio-focus="true"
                    onClick={() => toggleFavourite(currentTrack)}
                    className={`py-1.5 rounded flex flex-col items-center justify-center focus:outline-none focus:ring-2 focus:ring-[#7A90FF] ${
                      isTrackLiked(currentTrack.id)
                        ? 'bg-rose-500/20 text-rose-300'
                        : 'bg-white/5 text-slate-300'
                    }`}
                  >
                    <Heart className="w-3.5 h-3.5" />
                    <span className="text-[9px]">0:Save</span>
                  </button>

                  <button
                    type="button"
                    data-jio-focus="true"
                    onClick={() => {
                      setRepeatOne((r) => !r);
                      showNotice(!repeatOne ? 'Repeat 1 ON' : 'Repeat All');
                    }}
                    className={`py-1.5 rounded flex flex-col items-center justify-center focus:outline-none focus:ring-2 focus:ring-[#7A90FF] ${
                      repeatOne ? 'bg-[#4F6BFF]/30 text-[#7A90FF]' : 'bg-white/5 text-slate-300'
                    }`}
                  >
                    <Repeat className="w-3.5 h-3.5" />
                    <span className="text-[9px]">{repeatOne ? 'Rep:1' : 'Rep:All'}</span>
                  </button>

                  <button
                    type="button"
                    data-jio-focus="true"
                    onClick={() => {
                      setIsShuffle((s) => !s);
                      showNotice(!isShuffle ? 'Shuffle ON' : 'Shuffle OFF');
                    }}
                    className={`py-1.5 rounded flex flex-col items-center justify-center focus:outline-none focus:ring-2 focus:ring-[#7A90FF] ${
                      isShuffle ? 'bg-[#4F6BFF]/30 text-[#7A90FF]' : 'bg-white/5 text-slate-300'
                    }`}
                  >
                    <Shuffle className="w-3.5 h-3.5" />
                    <span className="text-[9px]">Shuf</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-xl bg-[#11131A] border border-white/10 p-4 text-center space-y-2">
                <p className="text-[12px] text-slate-300">No song playing right now.</p>
                <button
                  type="button"
                  data-jio-focus="true"
                  onClick={() => setTab('home')}
                  className="px-3 py-1.5 rounded bg-[#4F6BFF] text-white text-[11px] font-semibold focus:outline-none focus:ring-2 focus:ring-white"
                >
                  Browse Trending Songs (Key 1)
                </button>
              </div>
            )}

            {/* Up Next Queue List */}
            {queue.length > 1 && (
              <div className="space-y-1">
                <p className="text-[11px] font-bold text-slate-300 px-1">
                  Up Next ({queue.length})
                </p>
                {renderTrackList(queue, 'Queue is empty')}
              </div>
            )}
          </div>
        )}

        {tab === 'lyrics' && (
          <div className="space-y-1.5">
            {!currentTrack ? (
              <p className="text-[11px] text-slate-400 py-6 text-center">
                Play a song first to view matching lyrics.
              </p>
            ) : isLoadingLyrics ? (
              <p className="text-[11px] text-slate-400 py-6 text-center">
                Loading lyrics for {currentTrack.title}...
              </p>
            ) : !lyrics?.found ? (
              <p className="text-[11px] text-slate-400 py-6 text-center">
                Verified lyrics not found for {currentTrack.title}.
              </p>
            ) : (
              <div className="rounded-xl bg-[#11131A] border border-white/10 p-2 space-y-1.5">
                <div className="border-b border-white/10 pb-1">
                  <p className="text-[11px] font-bold text-white truncate">
                    {lyrics.trackName || currentTrack.title}
                  </p>
                  <p className="text-[10px] text-slate-400 truncate">
                    {lyrics.artistName || currentTrack.artist}
                  </p>
                </div>

                {lyrics.syncedLines.length > 0 ? (
                  <div className="space-y-1">
                    {lyrics.syncedLines.map((line, idx) => {
                      const active = idx === activeLyricIndex;
                      return (
                        <button
                          key={`${line.timeSeconds}_${idx}`}
                          ref={active ? activeLyricRef : undefined}
                          type="button"
                          data-jio-focus="true"
                          onClick={() => {
                            seekBy(line.timeSeconds - currentTime);
                          }}
                          className={`w-full text-left px-2 py-1 rounded text-[12px] leading-snug focus:outline-none focus:ring-2 focus:ring-[#7A90FF] ${
                            active
                              ? 'bg-[#4F6BFF]/25 text-white font-bold'
                              : 'text-slate-300'
                          }`}
                        >
                          {line.text}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="space-y-1 text-[12px] leading-relaxed text-slate-200 whitespace-pre-wrap">
                    {lyrics.plainLyrics}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {tab === 'saved' && (
          <div className="space-y-3">
            <div className="space-y-1">
              <p className="text-[11px] font-bold text-white">
                Saved Favourites ({favourites.length})
              </p>
              {renderTrackList(
                favourites,
                'Press ♥ or Key 0 while playing to save favourite songs.'
              )}
            </div>

            {recentTracks.length > 0 && (
              <div className="space-y-1 pt-2 border-t border-white/10">
                <p className="text-[11px] font-bold text-slate-300">
                  Recently Played ({recentTracks.length})
                </p>
                {renderTrackList(recentTracks, '')}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Bottom Mini-Player & Softkey Bar (Fixed for JioPhone 240x320 screen) */}
      <footer className="fixed bottom-0 left-0 right-0 z-40 bg-[#0D0E14] border-t border-white/15">
        {currentTrack && tab !== 'player' && (
          <button
            type="button"
            data-jio-focus="true"
            onClick={() => setTab('player')}
            className="w-full px-2 py-1 bg-[#141829] border-b border-white/10 flex items-center justify-between gap-2 text-left focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#7A90FF]"
          >
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold text-white truncate">
                {isPlaying ? '▶ ' : '❚❚ '}
                {currentTrack.title}
              </p>
            </div>
            <span className="font-mono-tabular text-[10px] text-[#7A90FF] shrink-0">
              {formatSeconds(Math.floor(currentTime))} / {formatSeconds(Math.floor(effectiveDuration))}
            </span>
          </button>
        )}

        {/* JioPhone Hardware Softkey Legend Bar */}
        <div className="px-2 py-1 flex items-center justify-between text-[10px] font-semibold text-slate-300">
          <button
            type="button"
            onClick={() =>
              setTab((prev) =>
                prev === 'home'
                  ? 'search'
                  : prev === 'search'
                    ? 'player'
                    : prev === 'player'
                      ? 'lyrics'
                      : prev === 'lyrics'
                        ? 'saved'
                        : 'home'
              )
            }
            className="text-left hover:text-white"
          >
            L-Soft: Tab
          </button>
          <span className="text-white font-bold">OK/5: Play·Select</span>
          <button
            type="button"
            onClick={togglePlay}
            className="text-right text-[#7A90FF] hover:text-white"
          >
            {isPlaying ? 'Pause' : 'Play'}
          </button>
        </div>
      </footer>
    </div>
  );
}
