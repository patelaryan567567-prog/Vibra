import React, { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  BookmarkPlus,
  ChevronDown,
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
    relatedTracks,
    isLoadingRelated,
    playerError,
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
    setIsExpanded,
    setIsVideoMode,
    setIsQueueOpen,
    jumpToQueueIndex,
  } = usePlayer();

  const { isFavourite, toggleFavourite } = useLibrary();
  const [drawerTab, setDrawerTab] = useState<'queue' | 'related'>('queue');

  const effectiveDuration = duration > 0 ? duration : currentTrack?.durationSeconds || 0;
  const progressPct = effectiveDuration > 0 ? Math.min(100, (currentTime / effectiveDuration) * 100) : 0;
  const fav = currentTrack ? isFavourite(currentTrack.id) : false;

  const RepeatIcon = repeatMode === 'one' ? Repeat1 : Repeat;

  return (
    <>
      {/* Persistent Full-Screen Player & Official YouTube IFrame Host */}
      <div
        className={`fixed inset-0 z-50 transition-opacity duration-200 ${
          isExpanded && currentTrack
            ? 'opacity-100 pointer-events-auto bg-[#090A0F]/95 backdrop-blur-2xl'
            : 'opacity-0 pointer-events-none'
        }`}
        aria-hidden={!isExpanded || !currentTrack}
      >
        <div className="h-full flex flex-col max-w-7xl mx-auto px-4 sm:px-8 py-4 sm:py-6 overflow-y-auto">
          {/* Top Bar inside Full-Screen Player */}
          <div className="flex items-center justify-between gap-2 sm:gap-4 pb-4 border-b border-white/[0.07] shrink-0">
            <button
              type="button"
              onClick={() => setIsExpanded(false)}
              className="min-h-[44px] px-2.5 sm:px-3 -ml-2 rounded-xl flex items-center gap-1.5 text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
            >
              <ChevronDown className="w-5 h-5" />
              <span className="text-xs sm:text-sm font-medium whitespace-nowrap">Minimize</span>
            </button>

            {/* Video vs Artwork Segmented Switch */}
            <div className="flex items-center gap-1 p-1 rounded-xl bg-[#11131A] border border-white/[0.08]">
              <button
                type="button"
                onClick={() => setIsVideoMode(false)}
                className={`px-3 sm:px-3.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                  !isVideoMode ? 'bg-[#4F6BFF] text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Artwork
              </button>
              <button
                type="button"
                onClick={() => setIsVideoMode(true)}
                className={`px-3 sm:px-3.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap inline-flex items-center gap-1.5 transition-colors ${
                  isVideoMode ? 'bg-[#4F6BFF] text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                <Tv className="w-3.5 h-3.5" />
                <span>Video</span>
              </button>
            </div>

            {currentTrack && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={toggleRadioMode}
                  aria-label={isRadioMode ? 'Turn off Infinite Radio' : 'Turn on Infinite Radio'}
                  title={isRadioMode ? 'Infinite Radio On' : 'Infinite Radio Off'}
                  className={`min-h-[40px] px-2.5 rounded-xl flex items-center gap-1.5 text-xs font-medium transition-colors ${
                    isRadioMode
                      ? 'bg-[#4F6BFF]/20 text-[#7A90FF] border border-[#4F6BFF]/40'
                      : 'text-slate-400 hover:text-white hover:bg-white/5 border border-transparent'
                  }`}
                >
                  <Radio className={`w-4 h-4 ${isLoadingRadio ? 'animate-spin' : ''}`} />
                  <span className="hidden sm:inline">Radio</span>
                </button>
                <button
                  type="button"
                  onClick={() => onAddToPlaylist(currentTrack)}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
                  aria-label="Add to playlist"
                >
                  <PlusSquare className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={() => toggleFavourite(currentTrack)}
                  className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl transition-colors ${
                    fav ? 'text-rose-400 hover:bg-rose-500/10' : 'text-slate-300 hover:text-white hover:bg-white/5'
                  }`}
                  aria-label={fav ? 'Remove from favourites' : 'Save to favourites'}
                >
                  <Heart className={`w-5 h-5 ${fav ? 'fill-current' : ''}`} />
                </button>
              </div>
            )}
          </div>

          {/* Main Full-Screen Grid: Stage (Left) + Queue & Related (Right) */}
          <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 py-6 min-h-0">
            {/* Stage Column */}
            <div className="lg:col-span-7 flex flex-col justify-between gap-6">
              <div className="relative w-full aspect-video rounded-2xl overflow-hidden bg-[#11131A] border border-white/[0.08] shadow-2xl">
                {/* Persistent Official YouTube IFrame Host - Never Unmounted */}
                <div
                  ref={playerHostRef}
                  className={`absolute inset-0 w-full h-full transition-opacity duration-200 ${
                    isExpanded && isVideoMode ? 'opacity-100 z-10' : 'opacity-0 pointer-events-none z-0'
                  }`}
                />

                {/* Artwork Backdrop (visible when not in Music Video mode) */}
                {currentTrack && (!isVideoMode || !isExpanded) && (
                  <div className="relative z-10 w-full h-full flex items-center justify-center bg-[#0D0F16]">
                    <img
                      src={currentTrack.thumbnailHigh || currentTrack.thumbnail}
                      alt={currentTrack.title}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent" />
                    <button
                      type="button"
                      onClick={() => setIsVideoMode(true)}
                      className="absolute bottom-4 right-4 px-3.5 py-2 rounded-xl bg-black/70 hover:bg-black/90 border border-white/15 text-xs font-medium text-white inline-flex items-center gap-2 backdrop-blur-md transition-colors"
                    >
                      <Tv className="w-3.5 h-3.5 text-[#7A90FF]" />
                      <span>Switch to Video</span>
                    </button>
                  </div>
                )}

                {playerError && (
                  <div className="absolute inset-x-4 bottom-4 z-20 rounded-xl bg-rose-950/90 border border-rose-500/40 px-4 py-2.5 text-xs text-rose-100">
                    {playerError}
                  </div>
                )}
              </div>

              {/* Track Info & Full Controls */}
              {currentTrack && (
                <div className="space-y-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h2 className="text-xl sm:text-2xl font-bold text-white leading-tight line-clamp-2">
                        {currentTrack.title}
                      </h2>
                      <p className="text-sm text-slate-400 mt-1 flex flex-wrap items-center gap-2">
                        <span>{currentTrack.artist}</span>
                        {currentTrack.viewCount && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono-tabular">{currentTrack.viewCount}</span>
                          </>
                        )}
                        {isRadioMode && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="text-[#7A90FF] font-medium">Infinite Radio</span>
                          </>
                        )}
                      </p>
                    </div>
                  </div>

                  {/* Seek Progress Bar */}
                  <div className="space-y-1.5">
                    <input
                      type="range"
                      min={0}
                      max={Math.max(1, effectiveDuration)}
                      value={Math.min(currentTime, Math.max(1, effectiveDuration))}
                      onChange={(e) => seekTo(Number(e.target.value))}
                      aria-label="Seek playback position"
                      className="w-full h-1.5 accent-[#4F6BFF] bg-white/15 rounded-full cursor-pointer"
                    />
                    <div className="flex items-center justify-between font-mono-tabular text-xs text-slate-400">
                      <span>{formatSeconds(currentTime)}</span>
                      <span>{formatSeconds(effectiveDuration)}</span>
                    </div>
                  </div>

                  {/* Primary Transport Controls */}
                  <div className="flex items-center justify-between gap-4">
                    <button
                      type="button"
                      onClick={toggleShuffle}
                      aria-label="Toggle shuffle"
                      className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl transition-colors ${
                        isShuffle ? 'text-[#7A90FF] bg-[#4F6BFF]/15' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      <Shuffle className="w-5 h-5" />
                    </button>

                    <div className="flex items-center gap-3 sm:gap-5">
                      <button
                        type="button"
                        onClick={prevTrack}
                        aria-label="Previous track"
                        className="min-h-[48px] min-w-[48px] flex items-center justify-center rounded-full text-white hover:bg-white/10 transition-colors"
                      >
                        <SkipBack className="w-6 h-6 fill-current" />
                      </button>

                      <button
                        type="button"
                        onClick={togglePlay}
                        aria-label={isPlaying ? 'Pause' : 'Play'}
                        className="w-14 h-14 rounded-full bg-white text-[#090A0F] hover:scale-105 active:scale-95 flex items-center justify-center shadow-xl transition-transform"
                      >
                        {isBuffering ? (
                          <span className="w-5 h-5 border-2 border-[#090A0F]/30 border-t-[#090A0F] rounded-full animate-spin" />
                        ) : isPlaying ? (
                          <Pause className="w-6 h-6 fill-current" />
                        ) : (
                          <Play className="w-6 h-6 fill-current ml-0.5" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={nextTrack}
                        aria-label="Next track"
                        className="min-h-[48px] min-w-[48px] flex items-center justify-center rounded-full text-white hover:bg-white/10 transition-colors"
                      >
                        <SkipForward className="w-6 h-6 fill-current" />
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={cycleRepeat}
                      aria-label={`Repeat mode: ${repeatMode}`}
                      className={`min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl transition-colors ${
                        repeatMode !== 'off'
                          ? 'text-[#7A90FF] bg-[#4F6BFF]/15'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      <RepeatIcon className="w-5 h-5" />
                    </button>
                  </div>

                  {/* Volume Slider + Start Fresh Radio */}
                  <div className="flex items-center justify-between gap-3 pt-1">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={toggleMute}
                        aria-label={isMuted ? 'Unmute' : 'Mute'}
                        className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:text-white"
                      >
                        {isMuted || volume === 0 ? (
                          <VolumeX className="w-4 h-4" />
                        ) : (
                          <Volume2 className="w-4 h-4" />
                        )}
                      </button>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={isMuted ? 0 : volume}
                        onChange={(e) => setVolume(Number(e.target.value))}
                        aria-label="Volume"
                        className="w-28 sm:w-36 h-1.5 accent-[#4F6BFF] bg-white/15 rounded-full cursor-pointer"
                      />
                      <span className="font-mono-tabular text-xs text-slate-400 w-9">
                        {isMuted ? 0 : volume}%
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => startTrackRadio(currentTrack)}
                      className="h-9 px-3 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-xs font-medium text-slate-200 inline-flex items-center gap-1.5 transition-colors"
                    >
                      <Radio className="w-3.5 h-3.5 text-[#7A90FF]" />
                      <span>Restart Song Radio</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Right Column: Queue & Related Recommendations */}
            <div className="lg:col-span-5 flex flex-col rounded-2xl bg-[#11131A] border border-white/[0.08] overflow-hidden min-h-[340px]">
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-white/[0.07]">
                <div className="flex items-center gap-1 p-1 rounded-lg bg-[#090A0F]">
                  <button
                    type="button"
                    onClick={() => setDrawerTab('queue')}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                      drawerTab === 'queue' ? 'bg-[#181B26] text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Up Next ({queue.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setDrawerTab('related')}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                      drawerTab === 'related' ? 'bg-[#181B26] text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Related Tracks
                  </button>
                </div>

                {drawerTab === 'queue' && queue.length > 0 && (
                  <div className="flex items-center gap-1">
                    {queue.length - (currentIndex + 1) >= 2 && (
                      <button
                        type="button"
                        onClick={shuffleUpcomingQueue}
                        title="Shuffle upcoming tracks"
                        aria-label="Shuffle upcoming tracks"
                        className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
                      >
                        <Shuffle className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => saveQueueAsPlaylist()}
                      title="Save queue as playlist"
                      aria-label="Save queue as playlist"
                      className="p-2 rounded-lg text-slate-400 hover:text-[#7A90FF] hover:bg-white/5 transition-colors"
                    >
                      <BookmarkPlus className="w-3.5 h-3.5" />
                    </button>
                    {queue.length > 1 && (
                      <button
                        type="button"
                        onClick={clearQueue}
                        className="text-xs text-slate-400 hover:text-white px-2.5 py-1.5 rounded-lg hover:bg-white/5 transition-colors"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
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
                            <div className="min-w-0">
                              <p className={`text-xs font-medium truncate ${active ? 'text-[#7A90FF]' : 'text-white'}`}>
                                {item.title}
                              </p>
                              <p className="text-[11px] text-slate-400 truncate">
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
                                  className="min-h-[32px] min-w-[28px] flex items-center justify-center rounded-lg text-slate-500 hover:text-white disabled:opacity-25 hover:bg-white/5"
                                >
                                  <ArrowUp className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  disabled={idx === queue.length - 1}
                                  onClick={() => moveQueueItem(idx, idx + 1)}
                                  aria-label={`Move ${item.title} down`}
                                  className="min-h-[32px] min-w-[28px] flex items-center justify-center rounded-lg text-slate-500 hover:text-white disabled:opacity-25 hover:bg-white/5"
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
                              className="min-h-[32px] min-w-[30px] flex items-center justify-center rounded-lg text-slate-400 hover:text-[#7A90FF] hover:bg-white/5"
                            >
                              <PlusSquare className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => removeFromQueue(idx)}
                              aria-label={`Remove ${item.title} from queue`}
                              className="min-h-[32px] min-w-[30px] flex items-center justify-center rounded-lg text-slate-500 hover:text-rose-400 hover:bg-white/5"
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
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-white truncate">{rel.title}</p>
                          <p className="text-[11px] text-slate-400 truncate">
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
                          className="min-h-[32px] min-w-[32px] flex items-center justify-center rounded-lg text-slate-400 hover:text-[#7A90FF] hover:bg-white/5"
                        >
                          <PlusSquare className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => addToQueue(rel)}
                          className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-white/[0.06] hover:bg-white/[0.12] text-slate-200 shrink-0"
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
        </div>
      </div>

      {/* Side Queue Drawer (when not expanded) */}
      {isQueueOpen && !isExpanded && currentTrack && (
        <div className="fixed right-3 sm:right-4 bottom-[118px] lg:bottom-24 z-40 w-[calc(100vw-1.5rem)] max-w-sm rounded-2xl bg-[#11131A]/95 backdrop-blur-xl border border-white/10 shadow-2xl overflow-hidden">
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
                className="min-h-[32px] min-w-[32px] flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/5"
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
                    <div className="min-w-0">
                      <p className={`text-xs font-medium truncate ${active ? 'text-[#7A90FF]' : 'text-white'}`}>
                        {item.title}
                      </p>
                      <p className="text-[11px] text-slate-400 truncate">{item.artist}</p>
                    </div>
                  </button>
                  {queue.length > 1 && (
                    <div className="flex items-center shrink-0">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => moveQueueItem(idx, idx - 1)}
                        className="p-1 rounded text-slate-500 hover:text-white disabled:opacity-25"
                        aria-label="Move up"
                      >
                        <ArrowUp className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === queue.length - 1}
                        onClick={() => moveQueueItem(idx, idx + 1)}
                        className="p-1 rounded text-slate-500 hover:text-white disabled:opacity-25"
                        aria-label="Move down"
                      >
                        <ArrowDown className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => removeFromQueue(idx)}
                    className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400"
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

      {/* Persistent Bottom Mini-Player Bar */}
      {currentTrack && (
        <div className="fixed bottom-[54px] lg:bottom-0 left-0 right-0 z-40 bg-[#0E1017]/95 backdrop-blur-xl border-t border-white/[0.08]">
          {/* Thin Interactive Progress Line at Top of Mini-Player */}
          <div className="relative h-1 w-full bg-white/10 group cursor-pointer">
            <div
              className="h-full bg-gradient-to-r from-[#4F6BFF] to-[#8B5CF6] transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
            <input
              type="range"
              min={0}
              max={Math.max(1, effectiveDuration)}
              value={Math.min(currentTime, Math.max(1, effectiveDuration))}
              onChange={(e) => seekTo(Number(e.target.value))}
              aria-label="Track progress"
              className="absolute inset-0 w-full h-3 -top-1 opacity-0 cursor-pointer"
            />
          </div>

          <div className="h-[54px] lg:h-[74px] px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-3">
            {/* Left: Track Artwork & Info */}
            <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1 lg:flex-initial lg:w-[30%]">
              <button
                type="button"
                onClick={() => setIsExpanded(true)}
                className="relative w-10 h-10 lg:w-12 lg:h-12 rounded-lg overflow-hidden bg-[#181B26] shrink-0 group"
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
                className="min-w-0 text-left flex-1"
              >
                <p className="text-xs sm:text-sm font-semibold text-white truncate">
                  {currentTrack.title}
                </p>
                <p className="text-[11px] sm:text-xs text-slate-400 truncate">
                  {currentTrack.artist}
                </p>
              </button>

              <button
                type="button"
                onClick={() => toggleFavourite(currentTrack)}
                aria-label={fav ? 'Remove from favourites' : 'Save to favourites'}
                title={fav ? 'Remove from favourites' : 'Save to favourites'}
                className={`hidden sm:flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg transition-colors shrink-0 ${
                  fav ? 'text-rose-400' : 'text-slate-400 hover:text-white'
                }`}
              >
                <Heart className={`w-4 h-4 ${fav ? 'fill-current' : ''}`} />
              </button>

              <button
                type="button"
                onClick={() => onAddToPlaylist(currentTrack)}
                aria-label="Add playing song to playlist"
                title="Add to playlist"
                className="flex min-h-[36px] min-w-[36px] sm:min-h-[40px] sm:min-w-[40px] items-center justify-center rounded-lg text-slate-300 hover:text-[#7A90FF] hover:bg-white/5 transition-colors shrink-0"
              >
                <PlusSquare className="w-4 h-4" />
              </button>
            </div>

            {/* Center: Transport Controls */}
            <div className="flex items-center gap-0.5 sm:gap-2 lg:flex-col lg:w-[40%]">
              <div className="flex items-center gap-0.5 sm:gap-3">
                <button
                  type="button"
                  onClick={toggleShuffle}
                  aria-label="Shuffle"
                  className={`hidden lg:flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg transition-colors ${
                    isShuffle ? 'text-[#7A90FF]' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Shuffle className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={prevTrack}
                  aria-label="Previous"
                  className="hidden sm:flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-slate-300 hover:text-white"
                >
                  <SkipBack className="w-4 h-4 fill-current" />
                </button>

                <button
                  type="button"
                  onClick={() => setIsQueueOpen(!isQueueOpen)}
                  aria-label="Toggle queue"
                  className={`sm:hidden min-h-[40px] min-w-[38px] flex items-center justify-center rounded-lg transition-colors ${
                    isQueueOpen ? 'text-[#7A90FF]' : 'text-slate-300 hover:text-white'
                  }`}
                >
                  <ListMusic className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={togglePlay}
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                  className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-white text-[#090A0F] hover:scale-105 active:scale-95 flex items-center justify-center transition-transform shrink-0"
                >
                  {isBuffering ? (
                    <span className="w-4 h-4 border-2 border-[#090A0F]/30 border-t-[#090A0F] rounded-full animate-spin" />
                  ) : isPlaying ? (
                    <Pause className="w-4 h-4 fill-current" />
                  ) : (
                    <Play className="w-4 h-4 fill-current ml-0.5" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={nextTrack}
                  aria-label="Next"
                  className="min-h-[40px] min-w-[38px] sm:min-w-[40px] flex items-center justify-center rounded-lg text-slate-300 hover:text-white"
                >
                  <SkipForward className="w-4 h-4 fill-current" />
                </button>

                <button
                  type="button"
                  onClick={cycleRepeat}
                  aria-label={`Repeat: ${repeatMode}`}
                  className={`hidden lg:flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg transition-colors ${
                    repeatMode !== 'off' ? 'text-[#7A90FF]' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <RepeatIcon className="w-4 h-4" />
                </button>
              </div>

              <div className="hidden lg:flex items-center gap-2 w-full max-w-md font-mono-tabular text-[11px] text-slate-400">
                <span className="w-10 text-right">{formatSeconds(currentTime)}</span>
                <div className="relative flex-1 h-1 bg-white/15 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-white rounded-full"
                    style={{ width: `${progressPct}%` }}
                  />
                  <input
                    type="range"
                    min={0}
                    max={Math.max(1, effectiveDuration)}
                    value={Math.min(currentTime, Math.max(1, effectiveDuration))}
                    onChange={(e) => seekTo(Number(e.target.value))}
                    aria-label="Seek"
                    className="absolute inset-0 w-full opacity-0 cursor-pointer"
                  />
                </div>
                <span className="w-10">{formatSeconds(effectiveDuration)}</span>
              </div>
            </div>

            {/* Right: Radio, Video, Queue, Volume, Expand */}
            <div className="hidden sm:flex items-center justify-end gap-1 lg:w-[30%]">
              <button
                type="button"
                onClick={toggleRadioMode}
                aria-label={isRadioMode ? 'Disable Infinite Radio' : 'Enable Infinite Radio'}
                title={isRadioMode ? 'Infinite Radio: On' : 'Infinite Radio: Off'}
                className={`min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg transition-colors ${
                  isRadioMode ? 'text-[#7A90FF] bg-[#4F6BFF]/15' : 'text-slate-400 hover:text-white hover:bg-white/5'
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
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
              >
                <Tv className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => setIsQueueOpen(!isQueueOpen)}
                aria-label="Toggle queue"
                title="Queue"
                className={`min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg transition-colors ${
                  isQueueOpen ? 'text-[#7A90FF] bg-[#4F6BFF]/15' : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <ListMusic className="w-4 h-4" />
              </button>

              <div className="hidden xl:flex items-center gap-1.5 px-1">
                <button
                  type="button"
                  onClick={toggleMute}
                  aria-label={isMuted ? 'Unmute' : 'Mute'}
                  className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-400 hover:text-white"
                >
                  {isMuted || volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={isMuted ? 0 : volume}
                  onChange={(e) => setVolume(Number(e.target.value))}
                  aria-label="Volume"
                  className="w-20 h-1 accent-[#4F6BFF] bg-white/15 rounded-full cursor-pointer"
                />
              </div>

              <button
                type="button"
                onClick={() => setIsExpanded(true)}
                aria-label="Expand full screen player"
                title="Expand player"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
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
