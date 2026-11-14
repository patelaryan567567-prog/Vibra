import React, { useEffect } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Disc3,
  HardDrive,
  Headphones,
  ListMusic,
  Maximize2,
  Pause,
  Play,
  PlusSquare,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useOfflinePlayer } from '../context/OfflinePlayerContext';
import type { OfflineTrack } from '../types/music';
import { formatSeconds } from '../utils/format';
import { formatBytes } from '../utils/offlineMusicDb';

interface OfflinePersistentPlayerProps {
  onAddToOfflinePlaylist: (track: OfflineTrack) => void;
}

function getFormatExtLabel(track: OfflineTrack): string {
  const m = track.fileName.match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toUpperCase() : 'AUDIO';
}

export function OfflinePersistentPlayer({ onAddToOfflinePlaylist }: OfflinePersistentPlayerProps) {
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
    isExpanded,
    mobilePlayerView,
    isQueueOpen,
    isBackgroundPlay,
    playerError,
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
  } = useOfflinePlayer();

  useEffect(() => {
    if (!isExpanded) {
      setMobilePlayerView('player');
    }
  }, [isExpanded, setMobilePlayerView]);

  if (!currentTrack) return null;

  const effectiveDuration = duration > 0 ? duration : currentTrack.durationSeconds || 0;
  const progressPct =
    effectiveDuration > 0 ? Math.min(100, Math.max(0, (currentTime / effectiveDuration) * 100)) : 0;
  const effectiveVolumePct = isMuted ? 0 : Math.min(100, Math.max(0, volume));
  const RepeatIcon = repeatMode === 'one' ? Repeat1 : Repeat;
  const formatExt = getFormatExtLabel(currentTrack);

  return (
    <>
      {/* Full-Screen Expanded Offline Player */}
      {isExpanded && (
        <div
          className="fixed inset-0 z-50 w-full max-w-full overflow-hidden bg-[#090A0F]/98 backdrop-blur-2xl"
          role="dialog"
          aria-modal="true"
          aria-label="Offline downloaded music player"
        >
          <div className="w-full max-w-7xl mx-auto h-[100dvh] px-3 sm:px-5 lg:px-8 py-2 sm:py-3 lg:py-4 flex flex-col overflow-hidden">
            {/* ZONE 1: Header Bar */}
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-white/[0.08] shrink-0 min-w-0">
              <button
                type="button"
                onClick={() => setIsExpanded(false)}
                aria-label="Minimize offline player"
                className="min-h-[40px] min-w-[40px] px-2 sm:px-3 -ml-1 rounded-xl flex items-center justify-center sm:justify-start gap-1.5 text-slate-200 hover:text-white hover:bg-white/5 transition-colors shrink-0"
              >
                <ChevronDown className="w-5 h-5" />
                <span className="hidden sm:inline text-xs sm:text-sm font-medium whitespace-nowrap">
                  Minimize
                </span>
              </button>

              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-semibold whitespace-nowrap">
                <HardDrive className="w-3.5 h-3.5 shrink-0" />
                <span>My Music · Offline Player</span>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={toggleBackgroundPlay}
                  aria-label={isBackgroundPlay ? 'Turn off background playback' : 'Turn on background playback'}
                  className={`hidden md:flex min-h-[38px] px-2.5 rounded-xl items-center gap-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                    isBackgroundPlay
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      : 'text-slate-300 hover:text-white hover:bg-white/5 border border-transparent'
                  }`}
                >
                  <Headphones className="w-4 h-4" />
                  <span>Bg Play</span>
                </button>

                <button
                  type="button"
                  onClick={() => onAddToOfflinePlaylist(currentTrack)}
                  className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-200 hover:text-emerald-300 hover:bg-white/5 transition-colors"
                  aria-label="Add to offline playlist"
                  title="Add to offline playlist"
                >
                  <PlusSquare className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Mobile Sub-View Switcher (< 768px) */}
            <div className="md:hidden grid grid-cols-2 gap-1 p-1 mt-1.5 rounded-xl bg-[#11131A] border border-white/[0.08] shrink-0">
              <button
                type="button"
                onClick={() => setMobilePlayerView('player')}
                className={`py-1.5 px-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                  mobilePlayerView === 'player' ? 'bg-[#181B26] text-white shadow-sm' : 'text-slate-400 hover:text-white'
                }`}
              >
                Now Playing
              </button>
              <button
                type="button"
                onClick={() => setMobilePlayerView('queue')}
                className={`py-1.5 px-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                  mobilePlayerView === 'queue' ? 'bg-[#181B26] text-white shadow-sm' : 'text-slate-400 hover:text-white'
                }`}
              >
                Up Next ({queue.length})
              </button>
            </div>

            {/* ZONE 2: Middle Content Area */}
            <div className="flex-1 min-h-0 overflow-hidden flex flex-col md:grid md:grid-cols-12 md:grid-rows-[minmax(0,1fr)] py-2 md:py-3 md:gap-4 lg:gap-6">
              {/* Left Artwork / Vinyl Stage + Caption Card */}
              <div
                className={`${
                  mobilePlayerView !== 'player' ? 'hidden md:flex' : 'flex flex-1 min-h-0'
                } md:h-full md:col-span-7 flex-col justify-between gap-2 sm:gap-2.5 min-w-0 overflow-hidden`}
              >
                <div className="relative flex-1 min-h-[120px] w-full rounded-2xl overflow-hidden bg-gradient-to-br from-[#0F1722] via-[#11131A] to-[#0B0D14] border border-white/[0.08] shadow-2xl flex items-center justify-center p-4">
                  {currentTrack.artworkDataUrl ? (
                    <>
                      <img
                        src={currentTrack.artworkDataUrl}
                        alt=""
                        aria-hidden="true"
                        className="absolute inset-0 w-full h-full object-cover blur-2xl opacity-35 scale-110"
                      />
                      <img
                        src={currentTrack.artworkDataUrl}
                        alt={currentTrack.title}
                        className="relative z-10 max-h-full max-w-full rounded-xl object-contain shadow-2xl"
                      />
                    </>
                  ) : (
                    <div className="relative flex flex-col items-center justify-center text-center gap-3">
                      <div
                        className={`w-32 h-32 sm:w-44 sm:h-44 rounded-full bg-gradient-to-br from-emerald-500/25 via-[#4F6BFF]/25 to-[#8B5CF6]/20 border border-emerald-400/30 flex items-center justify-center shadow-[0_0_50px_rgba(16,185,129,0.2)] ${
                          isPlaying ? 'animate-[spin_14s_linear_infinite]' : ''
                        }`}
                      >
                        <div className="w-20 h-20 sm:w-28 sm:h-28 rounded-full bg-[#0D1017] border border-white/15 flex items-center justify-center">
                          <Disc3 className="w-10 h-10 sm:w-12 sm:h-12 text-emerald-400" />
                        </div>
                      </div>
                      <span className="font-mono-tabular text-[11px] font-semibold tracking-wider uppercase text-emerald-300/90">
                        {formatExt} · {formatBytes(currentTrack.sizeBytes)}
                      </span>
                    </div>
                  )}

                  {playerError && (
                    <div className="absolute inset-x-3 bottom-3 z-20 rounded-xl bg-rose-950/90 border border-rose-500/40 px-3 py-2 text-xs text-rose-100">
                      {playerError}
                    </div>
                  )}
                </div>

                {/* High-Contrast Caption Card */}
                <div className="min-w-0 shrink-0 rounded-2xl bg-[#11141F]/95 border border-white/[0.08] px-3.5 py-2.5 sm:px-4 sm:py-3 shadow-md">
                  <h2 className="text-[15px] sm:text-lg md:text-xl font-bold text-white leading-snug line-clamp-2 break-words tracking-tight">
                    {currentTrack.title}
                  </h2>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs sm:text-[13px] md:text-sm font-medium text-slate-200 leading-snug">
                    <span className="text-white/95 font-semibold break-words">{currentTrack.artist}</span>
                    {currentTrack.album && (
                      <>
                        <span aria-hidden="true" className="text-slate-500">·</span>
                        <span className="text-slate-300 break-words">{currentTrack.album}</span>
                      </>
                    )}
                    <span aria-hidden="true" className="text-slate-500">·</span>
                    <span className="font-mono-tabular text-slate-300 whitespace-nowrap">
                      {formatBytes(currentTrack.sizeBytes)}
                    </span>
                    <span aria-hidden="true" className="text-slate-500">·</span>
                    <span className="text-emerald-400 font-semibold whitespace-nowrap">Offline Storage</span>
                  </div>
                </div>
              </div>

              {/* Right Column: Offline Queue */}
              <div
                className={`${
                  mobilePlayerView === 'player' ? 'hidden md:flex' : 'flex flex-1 min-h-0'
                } md:col-span-5 md:h-full flex-col rounded-2xl bg-[#11131A] border border-white/[0.08] overflow-hidden min-h-0`}
              >
                <div className="flex items-center justify-between gap-2 px-3 sm:px-4 py-2.5 border-b border-white/[0.07] shrink-0">
                  <span className="text-xs font-semibold text-white">Up Next ({queue.length})</span>
                  {queue.length > 0 && (
                    <div className="flex items-center gap-1">
                      {queue.length - (currentIndex + 1) >= 2 && (
                        <button
                          type="button"
                          onClick={shuffleUpcomingOfflineQueue}
                          title="Shuffle upcoming songs"
                          aria-label="Shuffle upcoming songs"
                          className="p-2 rounded-lg text-slate-300 hover:text-white hover:bg-white/5 transition-colors"
                        >
                          <Shuffle className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {queue.length > 1 && (
                        <button
                          type="button"
                          onClick={clearOfflineQueue}
                          className="text-xs text-slate-300 hover:text-white px-2.5 py-1.5 rounded-lg hover:bg-white/5 transition-colors"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto p-2.5 sm:p-3 space-y-1.5">
                  {queue.map((item, idx) => {
                    const active = idx === currentIndex;
                    return (
                      <div
                        key={`${item.id}_${idx}`}
                        className={`flex items-center gap-2 p-2 rounded-xl transition-colors ${
                          active
                            ? 'bg-emerald-500/15 border border-emerald-500/35'
                            : 'hover:bg-white/[0.04] border border-transparent'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => jumpToOfflineQueueIndex(idx)}
                          className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
                        >
                          <div className="w-10 h-10 rounded-lg overflow-hidden bg-[#181B26] shrink-0 flex items-center justify-center text-emerald-400">
                            {item.artworkDataUrl ? (
                              <img
                                src={item.artworkDataUrl}
                                alt={item.title}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <Disc3 className="w-4 h-4" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p
                              className={`text-xs sm:text-[13px] font-semibold leading-snug line-clamp-2 break-words ${
                                active ? 'text-emerald-300' : 'text-white'
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
                                onClick={() => moveOfflineQueueItem(idx, idx - 1)}
                                aria-label={`Move ${item.title} up`}
                                className="min-h-[32px] min-w-[28px] flex items-center justify-center rounded-lg text-slate-400 hover:text-white disabled:opacity-25 hover:bg-white/5"
                              >
                                <ArrowUp className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                disabled={idx === queue.length - 1}
                                onClick={() => moveOfflineQueueItem(idx, idx + 1)}
                                aria-label={`Move ${item.title} down`}
                                className="min-h-[32px] min-w-[28px] flex items-center justify-center rounded-lg text-slate-400 hover:text-white disabled:opacity-25 hover:bg-white/5"
                              >
                                <ArrowDown className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            onClick={() => onAddToOfflinePlaylist(item)}
                            aria-label={`Add ${item.title} to offline playlist`}
                            title="Add to offline playlist"
                            className="min-h-[32px] min-w-[30px] flex items-center justify-center rounded-lg text-slate-300 hover:text-emerald-300 hover:bg-white/5"
                          >
                            <PlusSquare className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeFromOfflineQueue(idx)}
                            aria-label={`Remove ${item.title} from offline queue`}
                            className="min-h-[32px] min-w-[30px] flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-400 hover:bg-white/5"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* ZONE 3: Pinned Bottom Transport & Sound Control Deck */}
            <div className="shrink-0 rounded-2xl bg-[#11141F]/95 border border-white/[0.09] px-3.5 py-2.5 sm:px-5 sm:py-3 space-y-2 shadow-2xl">
              {/* Seek Progress Bar */}
              <div className="flex items-center gap-2.5 sm:gap-3">
                <span className="font-mono-tabular text-xs font-semibold text-emerald-300 w-10 text-right shrink-0">
                  {formatSeconds(currentTime)}
                </span>
                <div className="relative flex-1 h-5 flex items-center group px-1">
                  <div className="w-full h-2 rounded-full bg-white/15 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-[#4F6BFF] to-[#8B5CF6]"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                  <div
                    className="pointer-events-none absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-white shadow-[0_0_10px_rgba(16,185,129,0.9)] ring-2 ring-emerald-400 transition-transform group-hover:scale-110 group-active:scale-125"
                    style={{ left: `calc(4px + (100% - 8px) * ${progressPct / 100})` }}
                  />
                  <input
                    type="range"
                    min={0}
                    max={Math.max(1, effectiveDuration)}
                    step="any"
                    value={Math.min(currentTime, Math.max(1, effectiveDuration))}
                    onChange={(e) => seekTo(Number(e.target.value))}
                    aria-label="Seek offline song position"
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  />
                </div>
                <span className="font-mono-tabular text-xs font-medium text-slate-300 w-10 shrink-0">
                  {formatSeconds(effectiveDuration)}
                </span>
              </div>

              {/* Transport Controls + Volume */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-4">
                <div className="flex items-center justify-between sm:justify-start gap-2 sm:gap-3">
                  <button
                    type="button"
                    onClick={toggleShuffle}
                    aria-label="Toggle shuffle"
                    className={`min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl transition-colors ${
                      isShuffle ? 'text-emerald-300 bg-emerald-500/20' : 'text-slate-300 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <Shuffle className="w-4 h-4 sm:w-5 sm:h-5" />
                  </button>

                  <div className="flex items-center gap-3 sm:gap-4">
                    <button
                      type="button"
                      onClick={prevTrack}
                      aria-label="Previous song"
                      className="min-h-[40px] min-w-[40px] sm:min-h-[42px] sm:min-w-[42px] flex items-center justify-center rounded-full text-white hover:bg-white/10 transition-colors"
                    >
                      <SkipBack className="w-5 h-5 sm:w-6 sm:h-6 fill-current" />
                    </button>

                    <button
                      type="button"
                      onClick={togglePlay}
                      aria-label={isPlaying ? 'Pause' : 'Play'}
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
                      aria-label="Next song"
                      className="min-h-[40px] min-w-[40px] sm:min-h-[42px] sm:min-w-[42px] flex items-center justify-center rounded-full text-white hover:bg-white/10 transition-colors"
                    >
                      <SkipForward className="w-5 h-5 sm:w-6 sm:h-6 fill-current" />
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={cycleRepeat}
                    aria-label={`Repeat mode: ${repeatMode}`}
                    className={`min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl transition-colors ${
                      repeatMode !== 'off'
                        ? 'text-emerald-300 bg-emerald-500/20'
                        : 'text-slate-300 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <RepeatIcon className="w-4 h-4 sm:w-5 sm:h-5" />
                  </button>
                </div>

                {/* Volume Slider */}
                <div className="flex items-center justify-between sm:justify-end gap-2.5 sm:gap-3 flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-1 sm:max-w-[260px] min-w-0">
                    <button
                      type="button"
                      onClick={toggleMute}
                      aria-label={isMuted ? 'Unmute' : 'Mute'}
                      className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg text-slate-200 hover:text-white shrink-0"
                    >
                      {isMuted || volume === 0 ? (
                        <VolumeX className="w-4 h-4 text-rose-400" />
                      ) : (
                        <Volume2 className="w-4 h-4 text-emerald-400" />
                      )}
                    </button>
                    <div className="relative flex-1 min-w-[80px] h-5 flex items-center group px-1">
                      <div className="w-full h-2 rounded-full bg-white/15 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-[#38BDF8]"
                          style={{ width: `${effectiveVolumePct}%` }}
                        />
                      </div>
                      <div
                        className="pointer-events-none absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-white shadow ring-2 ring-emerald-400 transition-transform group-hover:scale-110"
                        style={{ left: `calc(4px + (100% - 8px) * ${effectiveVolumePct / 100})` }}
                      />
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={effectiveVolumePct}
                        onChange={(e) => setVolume(Number(e.target.value))}
                        aria-label="Offline player volume"
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                      />
                    </div>
                    <span className="font-mono-tabular text-xs font-semibold text-emerald-300 w-9 text-right shrink-0">
                      {effectiveVolumePct}%
                    </span>
                  </div>
                </div>

                {/* Mobile Quick Utility Row (< 640px) */}
                <div className="sm:hidden grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={toggleBackgroundPlay}
                    className={`min-h-[38px] px-2 py-1 rounded-xl flex items-center justify-center gap-1.5 text-[11px] font-semibold whitespace-nowrap transition-colors border ${
                      isBackgroundPlay
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                        : 'bg-[#090A0F] text-slate-300 border-white/[0.08] hover:text-white'
                    }`}
                  >
                    <Headphones className="w-3.5 h-3.5" />
                    <span>Bg Play</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onAddToOfflinePlaylist(currentTrack)}
                    className="min-h-[38px] px-2 py-1 rounded-xl flex items-center justify-center gap-1.5 text-[11px] font-semibold whitespace-nowrap bg-[#090A0F] text-slate-300 border border-white/[0.08] hover:text-white transition-colors"
                  >
                    <PlusSquare className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Add Playlist</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Side Offline Queue Drawer (when minimized) */}
      {isQueueOpen && !isExpanded && (
        <div className="fixed right-3 sm:right-4 bottom-[136px] md:bottom-24 z-40 w-[calc(100vw-1.5rem)] max-w-sm rounded-2xl bg-[#11131A]/95 backdrop-blur-xl border border-white/10 shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.07]">
            <div className="flex items-center gap-2">
              <ListMusic className="w-4 h-4 text-emerald-400" />
              <h4 className="text-sm font-semibold text-white">Offline Queue ({queue.length})</h4>
            </div>
            <div className="flex items-center gap-1">
              {queue.length - (currentIndex + 1) >= 2 && (
                <button
                  type="button"
                  onClick={shuffleUpcomingOfflineQueue}
                  title="Shuffle upcoming"
                  aria-label="Shuffle upcoming"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/5"
                >
                  <Shuffle className="w-3.5 h-3.5" />
                </button>
              )}
              {queue.length > 1 && (
                <button
                  type="button"
                  onClick={clearOfflineQueue}
                  className="text-xs text-slate-400 hover:text-white px-2 py-1 rounded-md hover:bg-white/5"
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsQueueOpen(false)}
                className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/5"
                aria-label="Close offline queue"
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
                    active ? 'bg-emerald-500/15' : 'hover:bg-white/5'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => jumpToOfflineQueueIndex(idx)}
                    className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
                  >
                    <div className="w-9 h-9 rounded bg-[#181B26] overflow-hidden flex items-center justify-center text-emerald-400 shrink-0">
                      {item.artworkDataUrl ? (
                        <img
                          src={item.artworkDataUrl}
                          alt={item.title}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <Disc3 className="w-4 h-4" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p
                        className={`text-[13px] font-semibold leading-snug line-clamp-1 ${
                          active ? 'text-emerald-300' : 'text-white'
                        }`}
                      >
                        {item.title}
                      </p>
                      <p className="text-xs text-slate-300 truncate">{item.artist}</p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => removeFromOfflineQueue(idx)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400"
                    aria-label="Remove from offline queue"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Persistent 2-Row Bottom Docked Offline Mini-Player Bar */}
      {!isExpanded && (
        <div className="fixed bottom-[56px] md:bottom-0 left-0 md:left-[76px] lg:left-56 xl:left-64 right-0 z-40 bg-[#0D1117]/98 backdrop-blur-xl border-t border-emerald-500/25 shadow-[0_-8px_30px_rgba(0,0,0,0.7)]">
          {/* Row 1: Colored Seek Bar with Timestamps */}
          <div className="px-3 sm:px-4 lg:px-6 pt-1.5 pb-0.5 flex items-center gap-2">
            <span className="font-mono-tabular text-[11px] font-semibold text-emerald-300 w-8 sm:w-9 text-right shrink-0">
              {formatSeconds(currentTime)}
            </span>
            <div className="relative flex-1 h-4 flex items-center group px-1">
              <div className="w-full h-1.5 bg-white/15 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-emerald-400 via-[#4F6BFF] to-[#8B5CF6] rounded-full"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <div
                className="pointer-events-none absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-white shadow ring-2 ring-emerald-400 transition-transform group-hover:scale-110"
                style={{ left: `calc(4px + (100% - 8px) * ${progressPct / 100})` }}
              />
              <input
                type="range"
                min={0}
                max={Math.max(1, effectiveDuration)}
                step="any"
                value={Math.min(currentTime, Math.max(1, effectiveDuration))}
                onChange={(e) => seekTo(Number(e.target.value))}
                aria-label="Offline track progress"
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
            </div>
            <span className="font-mono-tabular text-[11px] font-medium text-slate-300 w-8 sm:w-9 shrink-0">
              {formatSeconds(effectiveDuration)}
            </span>
          </div>

          {/* Row 2: Info + Controls + Sound Slider + Actions */}
          <div className="h-[54px] sm:h-[58px] px-3 sm:px-4 lg:px-6 pb-1 flex items-center justify-between gap-2 sm:gap-3 lg:gap-4">
            <div className="flex items-center gap-2 sm:gap-2.5 min-w-0 flex-1 overflow-hidden pr-1">
              <button
                type="button"
                onClick={() => setIsExpanded(true)}
                className="relative w-10 h-10 lg:w-11 lg:h-11 rounded-lg overflow-hidden bg-[#181B26] border border-emerald-500/25 shrink-0 flex items-center justify-center text-emerald-400"
                aria-label="Expand offline player"
              >
                {currentTrack.artworkDataUrl ? (
                  <img
                    src={currentTrack.artworkDataUrl}
                    alt={currentTrack.title}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Disc3 className={`w-5 h-5 ${isPlaying ? 'animate-[spin_8s_linear_infinite]' : ''}`} />
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
                <p className="text-[11px] sm:text-xs text-slate-300 truncate flex items-center gap-1.5">
                  <span className="text-emerald-400 font-semibold shrink-0">Offline</span>
                  <span aria-hidden="true" className="text-slate-500">·</span>
                  <span className="truncate">{currentTrack.artist}</span>
                </p>
              </button>

              <button
                type="button"
                onClick={() => onAddToOfflinePlaylist(currentTrack)}
                aria-label="Add playing downloaded song to offline playlist"
                title="Add to offline playlist"
                className="hidden md:flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 hover:text-emerald-300 hover:bg-white/5 transition-colors shrink-0"
              >
                <PlusSquare className="w-4 h-4" />
              </button>
            </div>

            {/* Center Transport */}
            <div className="flex items-center gap-0.5 sm:gap-1 lg:gap-1.5 shrink-0">
              <button
                type="button"
                onClick={toggleShuffle}
                aria-label="Shuffle"
                className={`hidden md:flex h-8 w-8 lg:h-9 lg:w-9 items-center justify-center rounded-lg transition-colors shrink-0 ${
                  isShuffle ? 'text-emerald-300 bg-emerald-500/15' : 'text-slate-300 hover:text-white hover:bg-white/5'
                }`}
              >
                <Shuffle className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={prevTrack}
                aria-label="Previous"
                className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg text-slate-200 hover:text-white hover:bg-white/5 shrink-0"
              >
                <SkipBack className="w-4 h-4 sm:w-[18px] sm:h-[18px] fill-current" />
              </button>

              <button
                type="button"
                onClick={togglePlay}
                aria-label={isPlaying ? 'Pause' : 'Play'}
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
                className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg text-slate-200 hover:text-white hover:bg-white/5 shrink-0"
              >
                <SkipForward className="w-4 h-4 sm:w-[18px] sm:h-[18px] fill-current" />
              </button>

              <button
                type="button"
                onClick={cycleRepeat}
                aria-label={`Repeat: ${repeatMode}`}
                className={`hidden md:flex h-8 w-8 lg:h-9 lg:w-9 items-center justify-center rounded-lg transition-colors shrink-0 ${
                  repeatMode !== 'off'
                    ? 'text-emerald-300 bg-emerald-500/15'
                    : 'text-slate-300 hover:text-white hover:bg-white/5'
                }`}
              >
                <RepeatIcon className="w-4 h-4" />
              </button>
            </div>

            {/* Right Sound Slider + Queue + Expand */}
            <div className="flex items-center justify-end gap-0.5 sm:gap-1 shrink-0">
              <div className="flex items-center gap-1 sm:px-0.5">
                <button
                  type="button"
                  onClick={toggleMute}
                  aria-label={isMuted ? 'Unmute' : 'Mute'}
                  className="h-8 w-8 flex items-center justify-center rounded-lg text-slate-200 hover:text-white shrink-0"
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX className="w-4 h-4 text-rose-400" />
                  ) : (
                    <Volume2 className="w-4 h-4 text-emerald-400" />
                  )}
                </button>
                <div className="hidden sm:flex relative w-14 md:w-20 lg:w-24 xl:w-28 h-5 items-center group px-1">
                  <div className="w-full h-1.5 rounded-full bg-white/15 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-[#38BDF8]"
                      style={{ width: `${effectiveVolumePct}%` }}
                    />
                  </div>
                  <div
                    className="pointer-events-none absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-white shadow ring-2 ring-emerald-400"
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
                <span className="hidden xl:inline font-mono-tabular text-[11px] font-semibold text-emerald-300 w-8 text-right shrink-0">
                  {effectiveVolumePct}%
                </span>
              </div>

              <button
                type="button"
                onClick={() => onAddToOfflinePlaylist(currentTrack)}
                aria-label="Add playing downloaded song to offline playlist"
                className="hidden sm:flex md:hidden h-8 w-8 items-center justify-center rounded-lg text-slate-300 hover:text-emerald-300 hover:bg-white/5 transition-colors shrink-0"
              >
                <PlusSquare className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => setIsQueueOpen(!isQueueOpen)}
                aria-label="Toggle offline queue"
                title="Offline Queue"
                className={`h-8 w-8 flex items-center justify-center rounded-lg transition-colors shrink-0 ${
                  isQueueOpen ? 'text-emerald-300 bg-emerald-500/15' : 'text-slate-300 hover:text-white hover:bg-white/5'
                }`}
              >
                <ListMusic className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => setIsExpanded(true)}
                aria-label="Expand full screen offline player"
                title="Expand offline player"
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
