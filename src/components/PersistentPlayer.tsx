import React, { useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  BookmarkPlus,
  ChevronDown,
  Headphones,
  Heart,
  ListMusic,
  Maximize2,
  Music2,
  Pause,
  Play,
  PlusSquare,
  Radio,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Trash2,
  Tv,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useLibrary } from '../context/LibraryContext';
import { usePlayer } from '../context/PlayerContext';
import type { Track } from '../types/music';
import { formatSeconds } from '../utils/format';

interface PersistentPlayerProps {
  onAddToPlaylist: (track: Track) => void;
}

export function PersistentPlayer({ onAddToPlaylist }: PersistentPlayerProps) {
  const {
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
    mobilePlayerView: mobileView,
    setMobilePlayerView: setMobileView,
    setIsVideoMode,
    setIsQueueOpen,
    jumpToQueueIndex,
  } = usePlayer();

  const { isFavourite, toggleFavourite } = useLibrary();
  const [drawerTab, setDrawerTab] = useState<'queue' | 'related'>('queue');
  const isInIframe = (() => {
    try {
      return typeof window !== 'undefined' && window.self !== window.top;
    } catch {
      return true;
    }
  })();

  useEffect(() => {
    if (!isExpanded) {
      setMobileView('player');
    }
  }, [isExpanded, setMobileView]);

  const effectiveDuration = duration > 0 ? duration : currentTrack?.durationSeconds || 0;
  const progressPct =
    effectiveDuration > 0 ? Math.min(100, Math.max(0, (currentTime / effectiveDuration) * 100)) : 0;
  const effectiveVolumePct = isMuted ? 0 : Math.min(100, Math.max(0, volume));
  const fav = currentTrack ? isFavourite(currentTrack.id) : false;

  const RepeatIcon = repeatMode === 'one' ? Repeat1 : Repeat;

  return (
    <>
      {/* Persistent Full-Screen Player & Official YouTube IFrame Host */}
      <div
        className={`transition-opacity duration-200 ${
          isExpanded && currentTrack
            ? 'fixed inset-0 z-50 w-full max-w-full overflow-hidden opacity-100 pointer-events-auto bg-[#090A0F]/98 backdrop-blur-2xl'
            : 'fixed bottom-24 right-4 w-44 h-24 overflow-hidden pointer-events-none opacity-[0.02] z-[1]'
        }`}
        aria-hidden={!isExpanded || !currentTrack}
      >
        <div
          className={`w-full max-w-7xl mx-auto flex flex-col ${
            isExpanded && currentTrack
              ? 'h-[100dvh] px-3 sm:px-5 lg:px-8 py-2 sm:py-3 lg:py-4 overflow-hidden'
              : 'h-full overflow-hidden'
          }`}
        >
          {/* ZONE 1: Compact Top Header Bar (shrink-0) */}
          <div
            className={`${
              isExpanded && currentTrack ? 'flex' : 'hidden'
            } items-center justify-between gap-2 pb-2 border-b border-white/[0.08] shrink-0 min-w-0`}
          >
            <button
              type="button"
              onClick={() => setIsExpanded(false)}
              aria-label="Minimize player"
              className="min-h-[40px] min-w-[40px] px-2 sm:px-3 -ml-1 rounded-xl flex items-center justify-center sm:justify-start gap-1.5 text-slate-200 hover:text-white hover:bg-white/5 transition-colors shrink-0"
            >
              <ChevronDown className="w-5 h-5" />
              <span className="hidden sm:inline text-xs sm:text-sm font-medium whitespace-nowrap">
                Minimize
              </span>
            </button>

            {/* Video vs Artwork Segmented Switch */}
            <div className="flex items-center gap-1 p-1 rounded-xl bg-[#11131A] border border-white/[0.08] shrink-0">
              <button
                type="button"
                onClick={() => setIsVideoMode(false)}
                className={`px-3 sm:px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                  !isVideoMode ? 'bg-[#4F6BFF] text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Artwork
              </button>
              <button
                type="button"
                onClick={() => setIsVideoMode(true)}
                className={`px-3 sm:px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap inline-flex items-center gap-1.5 transition-colors ${
                  isVideoMode ? 'bg-[#4F6BFF] text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                <Tv className="w-3.5 h-3.5" />
                <span>Video</span>
              </button>
            </div>

            {currentTrack && (
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={toggleBackgroundPlay}
                  aria-label={isBackgroundPlay ? 'Turn off background playback' : 'Turn on background playback'}
                  title={isBackgroundPlay ? 'Background Play On' : 'Background Play Off'}
                  className={`hidden md:flex min-h-[38px] px-2.5 rounded-xl items-center gap-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                    isBackgroundPlay
                      ? 'bg-[#4F6BFF]/20 text-[#8CA2FF] border border-[#4F6BFF]/40'
                      : 'text-slate-300 hover:text-white hover:bg-white/5 border border-transparent'
                  }`}
                >
                  <Headphones className="w-4 h-4" />
                  <span>Bg Play</span>
                </button>
                <button
                  type="button"
                  onClick={toggleRadioMode}
                  aria-label={isRadioMode ? 'Turn off Infinite Radio' : 'Turn on Infinite Radio'}
                  title={isRadioMode ? 'Infinite Radio On' : 'Infinite Radio Off'}
                  className={`hidden md:flex min-h-[38px] px-2.5 rounded-xl items-center gap-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                    isRadioMode
                      ? 'bg-[#4F6BFF]/20 text-[#8CA2FF] border border-[#4F6BFF]/40'
                      : 'text-slate-300 hover:text-white hover:bg-white/5 border border-transparent'
                  }`}
                >
                  <Radio className={`w-4 h-4 ${isLoadingRadio ? 'animate-spin' : ''}`} />
                  <span>Radio</span>
                </button>

                <button
                  type="button"
                  onClick={() => onAddToPlaylist(currentTrack)}
                  className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-200 hover:text-white hover:bg-white/5 transition-colors"
                  aria-label="Add to playlist"
                  title="Add to playlist"
                >
                  <PlusSquare className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={() => toggleFavourite(currentTrack)}
                  className={`min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl transition-colors ${
                    fav ? 'text-rose-400 hover:bg-rose-500/10' : 'text-slate-200 hover:text-white hover:bg-white/5'
                  }`}
                  aria-label={fav ? 'Remove from favourites' : 'Save to favourites'}
                  title={fav ? 'Remove from favourites' : 'Save to favourites'}
                >
                  <Heart className={`w-5 h-5 ${fav ? 'fill-current' : ''}`} />
                </button>
              </div>
            )}
          </div>

          {/* Mobile Sub-View Switcher (< 768px only; Tablet, Laptop & PC show 2-column side-by-side studio) */}
          {isExpanded && currentTrack && (
            <div className="md:hidden grid grid-cols-3 gap-1 p-1 mt-1.5 rounded-xl bg-[#11131A] border border-white/[0.08] shrink-0">
              <button
                type="button"
                onClick={() => setMobileView('player')}
                className={`py-1.5 px-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                  mobileView === 'player' ? 'bg-[#181B26] text-white shadow-sm' : 'text-slate-400 hover:text-white'
                }`}
              >
                Now Playing
              </button>
              <button
                type="button"
                onClick={() => {
                  setMobileView('queue');
                  setDrawerTab('queue');
                }}
                className={`py-1.5 px-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                  mobileView === 'queue' ? 'bg-[#181B26] text-white shadow-sm' : 'text-slate-400 hover:text-white'
                }`}
              >
                Up Next ({queue.length})
              </button>
              <button
                type="button"
                onClick={() => {
                  setMobileView('related');
                  setDrawerTab('related');
                }}
                className={`py-1.5 px-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                  mobileView === 'related' ? 'bg-[#181B26] text-white shadow-sm' : 'text-slate-400 hover:text-white'
                }`}
              >
                Related
              </button>
            </div>
          )}

          {/* ZONE 2: Middle Content Area (flex-1 min-h-0) — Stage + Caption on Left, Queue/Related on Right */}
          <div
            className={`flex-1 min-h-0 overflow-hidden flex flex-col md:grid md:grid-cols-12 md:grid-rows-[minmax(0,1fr)] ${
              isExpanded && currentTrack ? 'py-2 md:py-3 md:gap-4 lg:gap-6' : ''
            }`}
          >
            {/* Left Stage Column - Keep mounted across mobile tabs so playerHostRef is never destroyed */}
            <div
              className={`${
                isExpanded && currentTrack && mobileView !== 'player'
                  ? 'fixed bottom-24 right-4 w-44 h-24 overflow-hidden pointer-events-none opacity-[0.02] z-[1] md:static md:w-auto md:h-full md:min-h-0 md:overflow-hidden md:pointer-events-auto md:opacity-100 md:z-auto md:flex'
                  : 'flex flex-1 min-h-0 md:h-full overflow-hidden'
              } md:col-span-7 flex-col justify-between gap-2 sm:gap-2.5 min-w-0`}
            >
              {/* Artwork / Video Stage Container */}
              <div
                className={`relative w-full overflow-hidden bg-[#11131A] border border-white/[0.08] shadow-2xl ${
                  isExpanded && currentTrack && mobileView !== 'player'
                    ? 'h-full rounded-xl md:flex-1 md:min-h-[120px] md:rounded-2xl'
                    : 'flex-1 min-h-[120px] rounded-2xl'
                }`}
              >
                {/* Persistent Official YouTube IFrame Host - Never Unmounted */}
                <div
                  ref={playerHostRef}
                  className={`absolute inset-0 w-full h-full transition-opacity duration-200 ${
                    isExpanded && isVideoMode ? 'opacity-100 z-10' : 'opacity-100 pointer-events-none z-0'
                  }`}
                />

                {/* Artwork Backdrop (visible when not in Music Video mode) */}
                {currentTrack && (!isVideoMode || !isExpanded) && (
                  <div className="absolute inset-0 z-10 w-full h-full bg-[#0D0F16] overflow-hidden">
                    <img
                      src={currentTrack.thumbnailHigh || currentTrack.thumbnail}
                      alt=""
                      aria-hidden="true"
                      referrerPolicy="no-referrer"
                      className="absolute inset-0 w-full h-full object-cover blur-2xl opacity-35 scale-110"
                    />
                    <img
                      src={currentTrack.thumbnailHigh || currentTrack.thumbnail}
                      alt={currentTrack.title}
                      referrerPolicy="no-referrer"
                      className="absolute inset-0 z-10 w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 z-10 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                    <button
                      type="button"
                      onClick={() => setIsVideoMode(true)}
                      className="absolute bottom-2.5 right-2.5 sm:bottom-3 sm:right-3 z-20 px-3 py-1.5 rounded-xl bg-black/80 hover:bg-black/95 border border-white/20 text-xs font-semibold text-white inline-flex items-center gap-1.5 backdrop-blur-md transition-colors whitespace-nowrap shadow-lg"
                    >
                      <Tv className="w-3.5 h-3.5 text-[#8CA2FF]" />
                      <span>Switch to Video</span>
                    </button>
                  </div>
                )}

                {playerError && (
                  <div className="absolute inset-x-3 bottom-3 z-20 rounded-xl bg-rose-950/90 border border-rose-500/40 px-3 py-2 text-xs text-rose-100">
                    {playerError}
                  </div>
                )}

                {!playerError && backgroundBlockedHint && (
                  <div className="absolute inset-x-2.5 top-2.5 z-20 rounded-xl bg-[#0D101B]/95 border border-[#4F6BFF]/40 px-3 py-2 text-xs text-slate-200 flex items-start justify-between gap-2 shadow-xl backdrop-blur-md">
                    <div className="min-w-0 space-y-1">
                      <p className="leading-snug">{backgroundBlockedHint}</p>
                      {isInIframe && (
                        <a
                          href={typeof window !== 'undefined' ? window.location.href : '/'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[#7A90FF] hover:text-white font-semibold underline"
                        >
                          Open Full App
                        </a>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={clearBackgroundBlockedHint}
                      aria-label="Dismiss background notice"
                      className="p-1 text-slate-400 hover:text-white shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              {/* High-Contrast Multi-Line Track Title & Artist/Metadata Caption Card (Never Trimmed to 1 Line) */}
              {currentTrack && (
                <div
                  className={`${
                    mobileView !== 'player' ? 'hidden md:block' : 'block'
                  } min-w-0 shrink-0 rounded-2xl bg-[#11141F]/95 border border-white/[0.08] px-3.5 py-2.5 sm:px-4 sm:py-3 shadow-md`}
                >
                  <h2 className="text-[15px] sm:text-lg md:text-xl font-bold text-white leading-snug line-clamp-2 break-words tracking-tight">
                    {currentTrack.title}
                  </h2>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs sm:text-[13px] md:text-sm font-medium text-slate-200 leading-snug">
                    <span className="text-white/95 font-semibold break-words">
                      {currentTrack.artist}
                    </span>
                    {currentTrack.viewCount && (
                      <>
                        <span aria-hidden="true" className="text-slate-500">·</span>
                        <span className="font-mono-tabular text-slate-200 whitespace-nowrap">
                          {currentTrack.viewCount}
                        </span>
                      </>
                    )}
                    {currentTrack.duration && (
                      <>
                        <span aria-hidden="true" className="text-slate-500">·</span>
                        <span className="font-mono-tabular text-slate-300 whitespace-nowrap">
                          {currentTrack.duration}
                        </span>
                      </>
                    )}
                    {isRadioMode && (
                      <>
                        <span aria-hidden="true" className="text-slate-500">·</span>
                        <span className="text-[#8CA2FF] font-semibold whitespace-nowrap">
                          Infinite Radio
                        </span>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Right Column: Queue & Related Recommendations (Side-by-Side on Tablet, Laptop & PC) */}
            <div
              className={`${
                mobileView === 'player' ? 'hidden md:flex' : 'flex flex-1 min-h-0'
              } md:col-span-5 md:h-full flex-col rounded-2xl bg-[#11131A] border border-white/[0.08] overflow-hidden min-h-0`}
            >
              <div className="flex items-center justify-between gap-2 px-3 sm:px-4 py-2.5 border-b border-white/[0.07] shrink-0">
                <div className="hidden md:flex items-center gap-1 p-1 rounded-lg bg-[#090A0F]">
                  <button
                    type="button"
                    onClick={() => setDrawerTab('queue')}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-colors ${
                      drawerTab === 'queue' ? 'bg-[#181B26] text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Up Next ({queue.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setDrawerTab('related')}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-colors ${
                      drawerTab === 'related' ? 'bg-[#181B26] text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Related Tracks
                  </button>
                </div>

                <span className="md:hidden text-xs font-semibold text-white">
                  {drawerTab === 'queue' ? `Up Next (${queue.length})` : 'Related Tracks'}
                </span>

                {drawerTab === 'queue' && queue.length > 0 && (
                  <div className="flex items-center gap-1">
                    {queue.length - (currentIndex + 1) >= 2 && (
                      <button
                        type="button"
                        onClick={shuffleUpcomingQueue}
                        title="Shuffle upcoming tracks"
                        aria-label="Shuffle upcoming tracks"
                        className="p-2 rounded-lg text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
                      >
                        <Shuffle className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => saveQueueAsPlaylist()}
                      title="Save queue as playlist"
                      aria-label="Save queue as playlist"
                      className="p-2 rounded-lg text-slate-300 hover:text-[#7A90FF] hover:bg-white/5 transition-colors"
                    >
                      <BookmarkPlus className="w-3.5 h-3.5" />
                    </button>
                    {queue.length > 1 && (
                      <button
                        type="button"
                        onClick={clearQueue}
                        className="text-xs text-slate-300 hover:text-white px-2.5 py-1.5 rounded-lg hover:bg-white/5 transition-colors"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto p-2.5 sm:p-3 space-y-1.5">
                {drawerTab === 'queue' ? (
                  queue.length === 0 ? (
                    <p className="text-xs text-slate-500 text-center py-10">Your queue is empty.</p>
                  ) : (
                    queue.map((item, idx) => {
                      const active = idx === currentIndex;
                      return (
                        <div
                          key={`${item.id}_${idx}`}
                          className={`flex items-center gap-2 p-2 rounded-xl transition-colors ${
                            active
                              ? 'bg-[#4F6BFF]/15 border border-[#4F6BFF]/30'
                              : 'hover:bg-white/[0.04] border border-transparent'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => jumpToQueueIndex(idx)}
                            className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
                          >
                            <img
                              src={item.thumbnail}
                              alt={item.title}
                              referrerPolicy="no-referrer"
                              className="w-11 h-8 rounded-md object-cover bg-[#181B26] shrink-0"
                            />
                            <div className="min-w-0 flex-1">
                              <p
                                className={`text-xs sm:text-[13px] font-semibold leading-snug line-clamp-2 break-words ${
                                  active ? 'text-[#8CA2FF]' : 'text-white'
                                }`}
                              >
                                {item.title}
                              </p>
                              <p className="text-[11px] sm:text-xs text-slate-300 mt-0.5 truncate">
                                {item.artist} · {item.duration}
                              </p>
                            </div>
                          </button>

                          <div className="flex items-center shrink-0">
                            {queue.length > 1 && (
                              <>
                                <button
                                  type="button"
                                  disabled={idx === 0}
                                  onClick={() => moveQueueItem(idx, idx - 1)}
                                  aria-label={`Move ${item.title} up`}
                                  className="min-h-[32px] min-w-[28px] flex items-center justify-center rounded-lg text-slate-400 hover:text-white disabled:opacity-25 hover:bg-white/5"
                                >
                                  <ArrowUp className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  disabled={idx === queue.length - 1}
                                  onClick={() => moveQueueItem(idx, idx + 1)}
                                  aria-label={`Move ${item.title} down`}
                                  className="min-h-[32px] min-w-[28px] flex items-center justify-center rounded-lg text-slate-400 hover:text-white disabled:opacity-25 hover:bg-white/5"
                                >
                                  <ArrowDown className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                            <button
                              type="button"
                              onClick={() => onAddToPlaylist(item)}
                              aria-label={`Add ${item.title} to playlist`}
                              title="Add to playlist"
                              className="min-h-[32px] min-w-[30px] flex items-center justify-center rounded-lg text-slate-300 hover:text-[#7A90FF] hover:bg-white/5"
                            >
                              <PlusSquare className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => removeFromQueue(idx)}
                              aria-label={`Remove ${item.title} from queue`}
                              className="min-h-[32px] min-w-[30px] flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-400 hover:bg-white/5"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )
                ) : isLoadingRelated ? (
                  <div className="space-y-2 p-2">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="h-12 rounded-xl bg-white/[0.04] animate-pulse" />
                    ))}
                  </div>
                ) : relatedTracks.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-10">
                    Related recommendations appear once YouTube Data API is active.
                  </p>
                ) : (
                  relatedTracks.map((rel) => (
                    <div
                      key={rel.id}
                      className="flex items-center gap-3 p-2 rounded-xl hover:bg-white/[0.04] transition-colors"
                    >
                      <button
                        type="button"
                        onClick={() => playTrack(rel, [rel, ...relatedTracks.filter((r) => r.id !== rel.id)])}
                        className="flex items-center gap-3 flex-1 min-w-0 text-left"
                      >
                        <img
                          src={rel.thumbnail}
                          alt={rel.title}
                          referrerPolicy="no-referrer"
                          className="w-12 h-9 rounded-md object-cover bg-[#181B26] shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs sm:text-[13px] font-semibold text-white leading-snug line-clamp-2 break-words">
                            {rel.title}
                          </p>
                          <p className="text-[11px] sm:text-xs text-slate-300 mt-0.5 truncate">
                            {rel.artist} · {rel.duration}
                          </p>
                        </div>
                      </button>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => onAddToPlaylist(rel)}
                          aria-label={`Add ${rel.title} to playlist`}
                          title="Add to playlist"
                          className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg text-slate-300 hover:text-[#7A90FF] hover:bg-white/5"
                        >
                          <PlusSquare className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => addToQueue(rel)}
                          className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-white/[0.08] hover:bg-white/[0.14] text-white shrink-0"
                        >
                          Queue
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* ZONE 3: Pinned Bottom Transport & Sound Control Deck (shrink-0 — ALWAYS visible on Mobile, Tablet, Laptop & PC!) */}
          {isExpanded && currentTrack && (
            <div className="shrink-0 rounded-2xl bg-[#11141F]/95 border border-white/[0.09] px-3.5 py-2.5 sm:px-5 sm:py-3 space-y-2 shadow-2xl">
              {/* Row 1: Full-Width Colored Seek Progress Bar with Timestamps */}
              <div className="flex items-center gap-2.5 sm:gap-3">
                <span className="font-mono-tabular text-xs font-semibold text-[#8CA2FF] w-10 text-right shrink-0">
                  {formatSeconds(currentTime)}
                </span>
                <div className="relative flex-1 h-5 flex items-center group px-1">
                  <div className="w-full h-2 rounded-full bg-white/15 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#4F6BFF] via-[#6880FF] to-[#8B5CF6]"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                  <div
                    className="pointer-events-none absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-white shadow-[0_0_10px_rgba(79,107,255,0.9)] ring-2 ring-[#4F6BFF] transition-transform group-hover:scale-110 group-active:scale-125"
                    style={{ left: `calc(4px + (100% - 8px) * ${progressPct / 100})` }}
                  />
                  <input
                    type="range"
                    min={0}
                    max={Math.max(1, effectiveDuration)}
                    step="any"
                    value={Math.min(currentTime, Math.max(1, effectiveDuration))}
                    onChange={(e) => seekTo(Number(e.target.value))}
                    aria-label="Seek playback position"
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  />
                </div>
                <span className="font-mono-tabular text-xs font-medium text-slate-300 w-10 shrink-0">
                  {formatSeconds(effectiveDuration)}
                </span>
              </div>

              {/* Row 2: Transport Controls + Colored Sound/Volume Slider + Quick Actions */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-4">
                {/* Transport Buttons (Centered on Mobile, Left/Center on Tablet & Laptop) */}
                <div className="flex items-center justify-between sm:justify-start gap-2 sm:gap-3">
                  <button
                    type="button"
                    onClick={toggleShuffle}
                    aria-label="Toggle shuffle"
                    title="Shuffle"
                    className={`min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl transition-colors ${
                      isShuffle ? 'text-[#8CA2FF] bg-[#4F6BFF]/20' : 'text-slate-300 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <Shuffle className="w-4 h-4 sm:w-5 sm:h-5" />
                  </button>

                  <div className="flex items-center gap-3 sm:gap-4">
                    <button
                      type="button"
                      onClick={prevTrack}
                      aria-label="Previous track"
                      title="Previous track"
                      className="min-h-[40px] min-w-[40px] sm:min-h-[42px] sm:min-w-[42px] flex items-center justify-center rounded-full text-white hover:bg-white/10 transition-colors"
                    >
                      <SkipBack className="w-5 h-5 sm:w-6 sm:h-6 fill-current" />
                    </button>

                    <button
                      type="button"
                      onClick={togglePlay}
                      aria-label={isPlaying ? 'Pause' : 'Play'}
                      title={isPlaying ? 'Pause' : 'Play'}
                      className="w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-white text-[#090A0F] hover:scale-105 active:scale-95 flex items-center justify-center shadow-xl transition-transform shrink-0"
                    >
                      {isBuffering ? (
                        <span className="w-5 h-5 border-2 border-[#090A0F]/30 border-t-[#090A0F] rounded-full animate-spin" />
                      ) : isPlaying ? (
                        <Pause className="w-5 h-5 fill-current" />
                      ) : (
                        <Play className="w-5 h-5 fill-current ml-0.5" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={nextTrack}
                      aria-label="Next track"
                      title="Next track"
                      className="min-h-[40px] min-w-[40px] sm:min-h-[42px] sm:min-w-[42px] flex items-center justify-center rounded-full text-white hover:bg-white/10 transition-colors"
                    >
                      <SkipForward className="w-5 h-5 sm:w-6 sm:h-6 fill-current" />
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={cycleRepeat}
                    aria-label={`Repeat mode: ${repeatMode}`}
                    title={`Repeat mode: ${repeatMode}`}
                    className={`min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl transition-colors ${
                      repeatMode !== 'off'
                        ? 'text-[#8CA2FF] bg-[#4F6BFF]/20'
                        : 'text-slate-300 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <RepeatIcon className="w-4 h-4 sm:w-5 sm:h-5" />
                  </button>
                </div>

                {/* Sound / Volume Slider + Song Radio Action */}
                <div className="flex items-center justify-between sm:justify-end gap-2.5 sm:gap-3 flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-1 sm:max-w-[240px] md:max-w-[260px] min-w-0">
                    <button
                      type="button"
                      onClick={toggleMute}
                      aria-label={isMuted ? 'Unmute' : 'Mute'}
                      title={isMuted ? 'Unmute' : 'Mute'}
                      className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg text-slate-200 hover:text-white shrink-0"
                    >
                      {isMuted || volume === 0 ? (
                        <VolumeX className="w-4 h-4 text-rose-400" />
                      ) : (
                        <Volume2 className="w-4 h-4 text-[#7A90FF]" />
                      )}
                    </button>
                    <div className="relative flex-1 min-w-[80px] h-5 flex items-center group px-1">
                      <div className="w-full h-2 rounded-full bg-white/15 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-[#4F6BFF] to-[#38BDF8]"
                          style={{ width: `${effectiveVolumePct}%` }}
                        />
                      </div>
                      <div
                        className="pointer-events-none absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-white shadow-[0_0_10px_rgba(56,189,248,0.85)] ring-2 ring-[#4F6BFF] transition-transform group-hover:scale-110 group-active:scale-125"
                        style={{ left: `calc(4px + (100% - 8px) * ${effectiveVolumePct / 100})` }}
                      />
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={effectiveVolumePct}
                        onChange={(e) => setVolume(Number(e.target.value))}
                        aria-label="Volume"
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                      />
                    </div>
                    <span className="font-mono-tabular text-xs font-semibold text-[#8CA2FF] w-9 text-right shrink-0">
                      {effectiveVolumePct}%
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => startTrackRadio(currentTrack)}
                    className="hidden sm:inline-flex h-9 px-3.5 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] text-xs font-semibold text-white items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
                  >
                    <Radio className="w-3.5 h-3.5 text-[#8CA2FF]" />
                    <span>Song Mix</span>
                  </button>
                </div>

                {/* Mobile Quick Utility Row (< 640px) */}
                <div className="sm:hidden grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    onClick={toggleBackgroundPlay}
                    className={`min-h-[38px] px-2 py-1 rounded-xl flex items-center justify-center gap-1.5 text-[11px] font-semibold whitespace-nowrap transition-colors border ${
                      isBackgroundPlay
                        ? 'bg-[#4F6BFF]/20 text-[#8CA2FF] border-[#4F6BFF]/40'
                        : 'bg-[#090A0F] text-slate-300 border-white/[0.08] hover:text-white'
                    }`}
                  >
                    <Headphones className="w-3.5 h-3.5" />
                    <span>Bg Play</span>
                  </button>

                  <button
                    type="button"
                    onClick={toggleRadioMode}
                    className={`min-h-[38px] px-2 py-1 rounded-xl flex items-center justify-center gap-1.5 text-[11px] font-semibold whitespace-nowrap transition-colors border ${
                      isRadioMode
                        ? 'bg-[#4F6BFF]/20 text-[#8CA2FF] border-[#4F6BFF]/40'
                        : 'bg-[#090A0F] text-slate-300 border-white/[0.08] hover:text-white'
                    }`}
                  >
                    <Radio className={`w-3.5 h-3.5 ${isLoadingRadio ? 'animate-spin' : ''}`} />
                    <span>Radio</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => startTrackRadio(currentTrack)}
                    className="min-h-[38px] px-2 py-1 rounded-xl flex items-center justify-center gap-1.5 text-[11px] font-semibold whitespace-nowrap bg-[#090A0F] text-slate-300 border border-white/[0.08] hover:text-white transition-colors"
                  >
                    <Radio className="w-3.5 h-3.5 text-[#8CA2FF]" />
                    <span>Song Mix</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Side Queue Drawer (when not expanded) */}
      {isQueueOpen && !isExpanded && currentTrack && (
        <div className="fixed right-3 sm:right-4 bottom-[136px] md:bottom-24 z-40 w-[calc(100vw-1.5rem)] max-w-sm rounded-2xl bg-[#11131A]/95 backdrop-blur-xl border border-white/10 shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.07]">
            <div className="flex items-center gap-2">
              <ListMusic className="w-4 h-4 text-[#7A90FF]" />
              <h4 className="text-sm font-semibold text-white">Queue ({queue.length})</h4>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={toggleRadioMode}
                title={isRadioMode ? 'Infinite Radio On' : 'Infinite Radio Off'}
                aria-label="Toggle Infinite Radio"
                className={`p-1.5 rounded-lg transition-colors ${
                  isRadioMode ? 'text-[#7A90FF] bg-[#4F6BFF]/15' : 'text-slate-400 hover:text-white'
                }`}
              >
                <Radio className={`w-3.5 h-3.5 ${isLoadingRadio ? 'animate-spin' : ''}`} />
              </button>
              {queue.length - (currentIndex + 1) >= 2 && (
                <button
                  type="button"
                  onClick={shuffleUpcomingQueue}
                  title="Shuffle upcoming"
                  aria-label="Shuffle upcoming"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5"
                >
                  <Shuffle className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => saveQueueAsPlaylist()}
                title="Save queue as playlist"
                aria-label="Save queue as playlist"
                className="p-1.5 rounded-lg text-slate-400 hover:text-[#7A90FF] hover:bg-white/5"
              >
                <BookmarkPlus className="w-3.5 h-3.5" />
              </button>
              {queue.length > 1 && (
                <button
                  type="button"
                  onClick={clearQueue}
                  className="text-xs text-slate-400 hover:text-white px-2 py-1 rounded-md hover:bg-white/5"
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsQueueOpen(false)}
                className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/5"
                aria-label="Close queue"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="max-h-72 overflow-y-auto p-2 space-y-1">
            {queue.map((item, idx) => {
              const active = idx === currentIndex;
              return (
                <div
                  key={`${item.id}_drawer_${idx}`}
                  className={`flex items-center gap-2 p-2 rounded-xl ${
                    active ? 'bg-[#4F6BFF]/15' : 'hover:bg-white/5'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => jumpToQueueIndex(idx)}
                    className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
                  >
                    <img
                      src={item.thumbnail}
                      alt={item.title}
                      referrerPolicy="no-referrer"
                      className="w-10 h-8 rounded object-cover shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <p
                        className={`text-[13px] font-semibold leading-snug line-clamp-1 ${
                          active ? 'text-[#8CA2FF]' : 'text-white'
                        }`}
                      >
                        {item.title}
                      </p>
                      <p className="text-xs text-slate-300 truncate">{item.artist}</p>
                    </div>
                  </button>
                  {queue.length > 1 && (
                    <div className="flex items-center shrink-0">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => moveQueueItem(idx, idx - 1)}
                        className="p-1.5 rounded text-slate-400 hover:text-white disabled:opacity-25"
                        aria-label="Move up"
                      >
                        <ArrowUp className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === queue.length - 1}
                        onClick={() => moveQueueItem(idx, idx + 1)}
                        className="p-1.5 rounded text-slate-400 hover:text-white disabled:opacity-25"
                        aria-label="Move down"
                      >
                        <ArrowDown className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => removeFromQueue(idx)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400"
                    aria-label="Remove from queue"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Persistent 2-Row Bottom Docked Mini-Player Bar (Visible on Mobile, Tablet, Laptop & PC — Zero Overlap or Cutoffs!) */}
      {currentTrack && !isExpanded && (
        <div className="fixed bottom-[56px] md:bottom-0 left-0 md:left-[76px] lg:left-56 xl:left-64 right-0 z-40 bg-[#0E1017]/98 backdrop-blur-xl border-t border-white/[0.09] shadow-[0_-8px_30px_rgba(0,0,0,0.65)]">
          {/* Row 1: Full-Width Interactive Colored Seek Bar with Timestamps */}
          <div className="px-3 sm:px-4 lg:px-6 pt-1.5 pb-0.5 flex items-center gap-2">
            <span className="font-mono-tabular text-[11px] font-semibold text-[#8CA2FF] w-8 sm:w-9 text-right shrink-0">
              {formatSeconds(currentTime)}
            </span>
            <div className="relative flex-1 h-4 flex items-center group px-1">
              <div className="w-full h-1.5 bg-white/15 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[#4F6BFF] via-[#6880FF] to-[#8B5CF6] rounded-full"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <div
                className="pointer-events-none absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-white shadow-[0_0_8px_rgba(79,107,255,0.9)] ring-2 ring-[#4F6BFF] transition-transform group-hover:scale-110"
                style={{ left: `calc(4px + (100% - 8px) * ${progressPct / 100})` }}
              />
              <input
                type="range"
                min={0}
                max={Math.max(1, effectiveDuration)}
                step="any"
                value={Math.min(currentTime, Math.max(1, effectiveDuration))}
                onChange={(e) => seekTo(Number(e.target.value))}
                aria-label="Track progress"
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
            </div>
            <span className="font-mono-tabular text-[11px] font-medium text-slate-300 w-8 sm:w-9 shrink-0">
              {formatSeconds(effectiveDuration)}
            </span>
          </div>

          {/* Row 2: Track Info (Left), Transport Controls (Center), Sound/Volume & Actions (Right) */}
          <div className="h-[54px] sm:h-[58px] px-3 sm:px-4 lg:px-6 pb-1 flex items-center justify-between gap-2 sm:gap-3 lg:gap-4">
            {/* Left: Track Artwork & Info — overflow-hidden prevents any icon from bleeding into Center controls */}
            <div className="flex items-center gap-2 sm:gap-2.5 min-w-0 flex-1 overflow-hidden pr-1">
              <button
                type="button"
                onClick={() => setIsExpanded(true)}
                className="relative w-10 h-10 sm:w-10 sm:h-10 lg:w-11 lg:h-11 rounded-lg overflow-hidden bg-[#181B26] shrink-0 group"
                aria-label="Expand player"
              >
                {currentTrack.thumbnail ? (
                  <img
                    src={currentTrack.thumbnail}
                    alt={currentTrack.title}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-400">
                    <Music2 className="w-5 h-5" />
                  </div>
                )}
              </button>

              <button
                type="button"
                onClick={() => setIsExpanded(true)}
                className="min-w-[72px] flex-1 text-left overflow-hidden"
              >
                <p className="text-xs sm:text-[13px] lg:text-sm font-semibold text-white truncate leading-snug">
                  {currentTrack.title}
                </p>
                <p className="text-[11px] sm:text-xs text-slate-300 truncate">
                  {currentTrack.artist}
                </p>
              </button>

              <div className="hidden md:flex items-center gap-0.5 shrink-0">
                <button
                  type="button"
                  onClick={() => toggleFavourite(currentTrack)}
                  aria-label={fav ? 'Remove from favourites' : 'Save to favourites'}
                  title={fav ? 'Remove from favourites' : 'Save to favourites'}
                  className={`h-8 w-8 flex items-center justify-center rounded-lg transition-colors shrink-0 ${
                    fav ? 'text-rose-400' : 'text-slate-300 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <Heart className={`w-4 h-4 ${fav ? 'fill-current' : ''}`} />
                </button>

                <button
                  type="button"
                  onClick={() => onAddToPlaylist(currentTrack)}
                  aria-label="Add playing song to playlist"
                  title="Add to playlist"
                  className="hidden xl:flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 hover:text-[#7A90FF] hover:bg-white/5 transition-colors shrink-0"
                >
                  <PlusSquare className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Center: Transport Controls (Always Visible & Separated from Left/Right) */}
            <div className="flex items-center gap-0.5 sm:gap-1 lg:gap-1.5 shrink-0">
              <button
                type="button"
                onClick={toggleShuffle}
                aria-label="Shuffle"
                title="Shuffle"
                className={`hidden md:flex h-8 w-8 lg:h-9 lg:w-9 items-center justify-center rounded-lg transition-colors shrink-0 ${
                  isShuffle ? 'text-[#8CA2FF] bg-[#4F6BFF]/15' : 'text-slate-300 hover:text-white hover:bg-white/5'
                }`}
              >
                <Shuffle className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={prevTrack}
                aria-label="Previous"
                title="Previous"
                className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg text-slate-200 hover:text-white hover:bg-white/5 shrink-0"
              >
                <SkipBack className="w-4 h-4 sm:w-[18px] sm:h-[18px] fill-current" />
              </button>

              <button
                type="button"
                onClick={togglePlay}
                aria-label={isPlaying ? 'Pause' : 'Play'}
                title={isPlaying ? 'Pause' : 'Play'}
                className="w-9 h-9 sm:w-10 sm:h-10 mx-0.5 rounded-full bg-white text-[#090A0F] hover:scale-105 active:scale-95 flex items-center justify-center shadow-md transition-transform shrink-0"
              >
                {isBuffering ? (
                  <span className="w-4 h-4 border-2 border-[#090A0F]/30 border-t-[#090A0F] rounded-full animate-spin" />
                ) : isPlaying ? (
                  <Pause className="w-4 h-4 sm:w-[18px] sm:h-[18px] fill-current" />
                ) : (
                  <Play className="w-4 h-4 sm:w-[18px] sm:h-[18px] fill-current ml-0.5" />
                )}
              </button>

              <button
                type="button"
                onClick={nextTrack}
                aria-label="Next"
                title="Next"
                className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg text-slate-200 hover:text-white hover:bg-white/5 shrink-0"
              >
                <SkipForward className="w-4 h-4 sm:w-[18px] sm:h-[18px] fill-current" />
              </button>

              <button
                type="button"
                onClick={cycleRepeat}
                aria-label={`Repeat: ${repeatMode}`}
                title={`Repeat: ${repeatMode}`}
                className={`hidden md:flex h-8 w-8 lg:h-9 lg:w-9 items-center justify-center rounded-lg transition-colors shrink-0 ${
                  repeatMode !== 'off' ? 'text-[#8CA2FF] bg-[#4F6BFF]/15' : 'text-slate-300 hover:text-white hover:bg-white/5'
                }`}
              >
                <RepeatIcon className="w-4 h-4" />
              </button>
            </div>

            {/* Right: Sound/Volume Slider, Radio, Video, Queue, Expand */}
            <div className="flex items-center justify-end gap-0.5 sm:gap-1 shrink-0">
              {/* Sound / Volume Control */}
              <div className="flex items-center gap-1 sm:px-0.5">
                <button
                  type="button"
                  onClick={toggleMute}
                  aria-label={isMuted ? 'Unmute' : 'Mute'}
                  title={isMuted ? 'Unmute' : `Volume: ${effectiveVolumePct}%`}
                  className="h-8 w-8 flex items-center justify-center rounded-lg text-slate-200 hover:text-white shrink-0"
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX className="w-4 h-4 text-rose-400" />
                  ) : (
                    <Volume2 className="w-4 h-4 text-[#7A90FF]" />
                  )}
                </button>
                <div className="hidden sm:flex relative w-14 md:w-20 lg:w-24 xl:w-28 h-5 items-center group px-1">
                  <div className="w-full h-1.5 rounded-full bg-white/15 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#4F6BFF] to-[#38BDF8]"
                      style={{ width: `${effectiveVolumePct}%` }}
                    />
                  </div>
                  <div
                    className="pointer-events-none absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-white shadow ring-2 ring-[#4F6BFF]"
                    style={{ left: `calc(4px + (100% - 8px) * ${effectiveVolumePct / 100})` }}
                  />
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={effectiveVolumePct}
                    onChange={(e) => setVolume(Number(e.target.value))}
                    aria-label="Volume"
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  />
                </div>
                <span className="hidden xl:inline font-mono-tabular text-[11px] font-semibold text-[#8CA2FF] w-8 text-right shrink-0">
                  {effectiveVolumePct}%
                </span>
              </div>

              <button
                type="button"
                onClick={() => onAddToPlaylist(currentTrack)}
                aria-label="Add playing song to playlist"
                title="Add to playlist"
                className="hidden sm:flex xl:hidden h-8 w-8 items-center justify-center rounded-lg text-slate-300 hover:text-[#7A90FF] hover:bg-white/5 transition-colors shrink-0"
              >
                <PlusSquare className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={toggleRadioMode}
                aria-label={isRadioMode ? 'Disable Infinite Radio' : 'Enable Infinite Radio'}
                title={isRadioMode ? 'Infinite Radio: On' : 'Infinite Radio: Off'}
                className={`hidden lg:flex h-8 w-8 items-center justify-center rounded-lg transition-colors shrink-0 ${
                  isRadioMode ? 'text-[#8CA2FF] bg-[#4F6BFF]/15' : 'text-slate-300 hover:text-white hover:bg-white/5'
                }`}
              >
                <Radio className={`w-4 h-4 ${isLoadingRadio ? 'animate-spin' : ''}`} />
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsVideoMode(true);
                  setIsExpanded(true);
                }}
                aria-label="Watch music video"
                title="Watch music video"
                className="hidden lg:flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 hover:text-white hover:bg-white/5 transition-colors shrink-0"
              >
                <Tv className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => setIsQueueOpen(!isQueueOpen)}
                aria-label="Toggle queue"
                title="Queue"
                className={`h-8 w-8 flex items-center justify-center rounded-lg transition-colors shrink-0 ${
                  isQueueOpen ? 'text-[#8CA2FF] bg-[#4F6BFF]/15' : 'text-slate-300 hover:text-white hover:bg-white/5'
                }`}
              >
                <ListMusic className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => setIsExpanded(true)}
                aria-label="Expand full screen player"
                title="Expand player"
                className="h-8 w-8 flex items-center justify-center rounded-lg text-slate-300 hover:text-white hover:bg-white/5 transition-colors shrink-0"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
