import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Download,
  Heart,
  ListPlus,
  Loader2,
  MoreHorizontal,
  Music2,
  Pause,
  Play,
  PlusSquare,
  Radio,
  Tv,
} from 'lucide-react';
import { useLibrary } from '../context/LibraryContext';
import { useOfflineMusic } from '../context/OfflineMusicContext';
import { usePlayer } from '../context/PlayerContext';
import type { Track } from '../types/music';

interface TrackCardProps {
  track: Track;
  queueContext?: Track[];
  onAddToPlaylist: (track: Track) => void;
  timestampLabel?: string;
}

export function TrackCard({ track, queueContext, onAddToPlaylist, timestampLabel }: TrackCardProps) {
  const {
    currentTrack,
    isPlaying,
    playTrack,
    startTrackRadio,
    togglePlay,
    addToQueue,
    playNextInQueue,
  } = usePlayer();
  const { isFavourite, toggleFavourite } = useLibrary();
  const { saveOnlineTrack, isTrackSavedOffline, downloadingIds, downloadProgressMap } = useOfflineMusic();
  const [menuOpen, setMenuOpen] = useState(false);
  const [imgError, setImgError] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const isCurrent = currentTrack?.id === track.id;
  const isCurrentPlaying = isCurrent && isPlaying;
  const fav = isFavourite(track.id);
  const savedOffline = isTrackSavedOffline(track.id);
  const isDownloading = Boolean(downloadingIds[track.id]);
  const dlProgress = downloadProgressMap[track.id];

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const handlePrimaryPlay = () => {
    if (isCurrent) {
      togglePlay();
    } else {
      playTrack(track, queueContext, Boolean(track.isVideo));
    }
  };

  return (
    <article className="group relative flex flex-col rounded-xl bg-[#11131A] border border-white/[0.07] hover:border-white/[0.15] hover:bg-[#161923] transition-colors p-3">
      {/* Artwork / Thumbnail */}
      <div className="relative aspect-video w-full rounded-lg overflow-hidden bg-[#181B26] mb-3">
        {!imgError ? (
          <img
            src={track.thumbnail}
            alt={track.title}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-[#1B1F2E] to-[#11131A] text-slate-500 p-4">
            <Music2 className="w-7 h-7 mb-1" />
            <span className="text-[11px] text-center line-clamp-1">{track.artist}</span>
          </div>
        )}

        {/* Scrim & Play button */}
        <button
          type="button"
          onClick={handlePrimaryPlay}
          aria-label={isCurrentPlaying ? `Pause ${track.title}` : `Play ${track.title}`}
          className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-transparent flex items-end justify-between p-2.5 opacity-95 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
        >
          <span className="font-mono-tabular text-[11px] font-medium text-white/90 bg-black/65 px-2 py-0.5 rounded-md backdrop-blur-xs">
            {track.duration}
          </span>
          <span
            className={`w-10 h-10 rounded-full flex items-center justify-center shadow-lg transition-transform active:scale-95 ${
              isCurrentPlaying
                ? 'bg-white text-[#090A0F]'
                : 'bg-[#4F6BFF] text-white hover:bg-[#5E78FF]'
            }`}
          >
            {isCurrentPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
          </span>
        </button>

        {/* Active track indicator bar */}
        {isCurrent && (
          <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-[#4F6BFF] text-[11px] font-medium text-white shadow">
            {isCurrentPlaying ? 'Playing' : 'Paused'}
          </div>
        )}

        {/* Live Download Percentage Badge */}
        {dlProgress && (
          <div className="absolute top-2 right-2 px-2 py-0.5 rounded-md bg-emerald-600/95 text-[11px] font-mono-tabular font-bold text-white shadow flex items-center gap-1">
            {dlProgress.phase !== 'done' && <Loader2 className="w-3 h-3 animate-spin" />}
            <span>{dlProgress.percent}%</span>
          </div>
        )}
      </div>

      {/* Title & Clean Unboxed Metadata */}
      <div className="flex items-start justify-between gap-2 min-w-0">
        <button
          type="button"
          onClick={handlePrimaryPlay}
          className="text-left min-w-0 flex-1 focus:outline-none"
        >
          <h3
            className={`text-sm sm:text-[15px] font-semibold leading-snug line-clamp-2 break-words ${
              isCurrent ? 'text-[#8CA2FF]' : 'text-white group-hover:text-white'
            }`}
          >
            {track.title}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs sm:text-[13px] font-medium text-slate-300">
            <span className="line-clamp-1 break-words">{track.artist}</span>
            {track.viewCount && (
              <>
                <span aria-hidden="true" className="text-slate-500">·</span>
                <span className="font-mono-tabular whitespace-nowrap text-slate-300">{track.viewCount}</span>
              </>
            )}
            {timestampLabel && (
              <>
                <span aria-hidden="true" className="text-slate-500">·</span>
                <span className="whitespace-nowrap text-slate-400">{timestampLabel}</span>
              </>
            )}
          </div>
        </button>

        {/* Quick actions */}
        <div className="flex items-center shrink-0 -mr-1.5" ref={menuRef}>
          <button
            type="button"
            onClick={() => toggleFavourite(track)}
            aria-label={fav ? `Remove ${track.title} from favourites` : `Add ${track.title} to favourites`}
            title={fav ? 'Remove from favourites' : 'Save to favourites'}
            className={`min-h-[40px] min-w-[38px] sm:min-w-[40px] flex items-center justify-center rounded-lg transition-colors ${
              fav ? 'text-rose-400 hover:bg-rose-500/10' : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Heart className={`w-4 h-4 ${fav ? 'fill-current' : ''}`} />
          </button>

          <button
            type="button"
            onClick={() => onAddToPlaylist(track)}
            aria-label={`Add ${track.title} to playlist`}
            title="Add to playlist"
            className="min-h-[40px] min-w-[38px] sm:min-w-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:text-[#7A90FF] hover:bg-white/5 transition-colors"
          >
            <PlusSquare className="w-4 h-4" />
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label={`More actions for ${track.title}`}
              className="min-h-[40px] min-w-[38px] sm:min-w-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>

            {menuOpen && (
              <div className="absolute right-0 bottom-10 z-30 w-48 rounded-xl bg-[#181B26] border border-white/10 shadow-2xl py-1.5 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    startTrackRadio(track);
                    setMenuOpen(false);
                  }}
                  className="w-full px-3.5 py-2.5 flex items-center gap-2.5 text-slate-200 hover:bg-white/5 text-left"
                >
                  <Radio className="w-3.5 h-3.5 text-[#7A90FF]" />
                  <span>Start Song Radio</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    playTrack(track, queueContext, true);
                    setMenuOpen(false);
                  }}
                  className="w-full px-3.5 py-2.5 flex items-center gap-2.5 text-slate-200 hover:bg-white/5 text-left"
                >
                  <Tv className="w-3.5 h-3.5 text-[#7A90FF]" />
                  <span>Watch Music Video</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    playNextInQueue(track);
                    setMenuOpen(false);
                  }}
                  className="w-full px-3.5 py-2.5 flex items-center gap-2.5 text-slate-200 hover:bg-white/5 text-left"
                >
                  <Play className="w-3.5 h-3.5 text-slate-400" />
                  <span>Play Next</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    addToQueue(track);
                    setMenuOpen(false);
                  }}
                  className="w-full px-3.5 py-2.5 flex items-center gap-2.5 text-slate-200 hover:bg-white/5 text-left"
                >
                  <ListPlus className="w-3.5 h-3.5 text-slate-400" />
                  <span>Add to Queue</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onAddToPlaylist(track);
                    setMenuOpen(false);
                  }}
                  className="w-full px-3.5 py-2.5 flex items-center gap-2.5 text-slate-200 hover:bg-white/5 text-left"
                >
                  <PlusSquare className="w-3.5 h-3.5 text-slate-400" />
                  <span>Add to Playlist</span>
                </button>
                <button
                  type="button"
                  disabled={isDownloading}
                  onClick={() => {
                    void saveOnlineTrack(track, true);
                    setMenuOpen(false);
                  }}
                  className="w-full px-3.5 py-2.5 flex items-center gap-2.5 text-slate-200 hover:bg-white/5 disabled:opacity-65 text-left"
                >
                  {isDownloading ? (
                    <Loader2 className="w-3.5 h-3.5 text-emerald-400 animate-spin shrink-0" />
                  ) : savedOffline ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  ) : (
                    <Download className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  )}
                  <span className="truncate">
                    {isDownloading
                      ? `Downloading ${dlProgress?.percent ?? 0}%`
                      : savedOffline
                        ? 'Download File to Device'
                        : 'Download (Device + My Music)'}
                  </span>
                </button>
                {!savedOffline && (
                  <button
                    type="button"
                    disabled={isDownloading}
                    onClick={() => {
                      void saveOnlineTrack(track, false);
                      setMenuOpen(false);
                    }}
                    className="w-full px-3.5 py-2.5 flex items-center gap-2.5 text-slate-300 hover:bg-white/5 disabled:opacity-65 text-left"
                  >
                    <Download className="w-3.5 h-3.5 text-[#7A90FF] shrink-0" />
                    <span>Save Only to My Music</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

interface TrackRowProps {
  track: Track;
  index?: number;
  queueContext?: Track[];
  onAddToPlaylist: (track: Track) => void;
  rightAction?: React.ReactNode;
  timestampLabel?: string;
}

export function TrackRow({
  track,
  index,
  queueContext,
  onAddToPlaylist,
  rightAction,
  timestampLabel,
}: TrackRowProps) {
  const { currentTrack, isPlaying, playTrack, togglePlay, addToQueue } = usePlayer();
  const { isFavourite, toggleFavourite } = useLibrary();
  const { saveOnlineTrack, isTrackSavedOffline, downloadingIds, downloadProgressMap } = useOfflineMusic();
  const [imgError, setImgError] = useState(false);

  const isCurrent = currentTrack?.id === track.id;
  const isCurrentPlaying = isCurrent && isPlaying;
  const fav = isFavourite(track.id);
  const savedOffline = isTrackSavedOffline(track.id);
  const isDownloading = Boolean(downloadingIds[track.id]);
  const dlProgress = downloadProgressMap[track.id];

  const handlePlay = () => {
    if (isCurrent) togglePlay();
    else playTrack(track, queueContext, Boolean(track.isVideo));
  };

  return (
    <div
      className={`group flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors ${
        isCurrent
          ? 'bg-[#4F6BFF]/10 border-[#4F6BFF]/30'
          : 'bg-[#11131A]/70 border-white/[0.05] hover:bg-[#181B26] hover:border-white/[0.12]'
      }`}
    >
      {typeof index === 'number' && (
        <span className="w-6 text-center font-mono-tabular text-xs text-slate-500 shrink-0">
          {index + 1}
        </span>
      )}

      <button
        type="button"
        onClick={handlePlay}
        className="relative w-14 h-10 sm:w-16 sm:h-11 rounded-lg overflow-hidden bg-[#181B26] shrink-0"
        aria-label={isCurrentPlaying ? `Pause ${track.title}` : `Play ${track.title}`}
      >
        {!imgError ? (
          <img
            src={track.thumbnail}
            alt={track.title}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-500">
            <Music2 className="w-4 h-4" />
          </div>
        )}
        <div
          className={`absolute inset-0 bg-black/50 flex items-center justify-center transition-opacity ${
            isCurrent ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
        >
          {isCurrentPlaying ? (
            <Pause className="w-4 h-4 text-white fill-current" />
          ) : (
            <Play className="w-4 h-4 text-white fill-current ml-0.5" />
          )}
        </div>
      </button>

      <button type="button" onClick={handlePlay} className="min-w-0 flex-1 text-left">
        <p className={`text-[13px] sm:text-[15px] font-semibold line-clamp-2 break-words leading-snug ${isCurrent ? 'text-[#8CA2FF]' : 'text-white'}`}>
          {track.title}
        </p>
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs sm:text-[13px] font-medium text-slate-300 mt-0.5">
          <span className="line-clamp-1 break-words">{track.artist}</span>
          {track.viewCount && (
            <>
              <span aria-hidden="true" className="text-slate-500">·</span>
              <span className="font-mono-tabular shrink-0 text-slate-300">{track.viewCount}</span>
            </>
          )}
          {timestampLabel && (
            <>
              <span aria-hidden="true" className="text-slate-500">·</span>
              <span className="shrink-0 text-slate-400">{timestampLabel}</span>
            </>
          )}
        </div>
      </button>

      <span className="hidden sm:inline-block font-mono-tabular text-xs text-slate-400 px-2 shrink-0">
        {track.duration}
      </span>

      <div className="flex items-center gap-0.5 shrink-0">
        <button
          type="button"
          onClick={() => toggleFavourite(track)}
          className={`min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg transition-colors ${
            fav ? 'text-rose-400 hover:bg-rose-500/10' : 'text-slate-400 hover:text-white hover:bg-white/5'
          }`}
          aria-label={fav ? 'Remove from favourites' : 'Save to favourites'}
        >
          <Heart className={`w-4 h-4 ${fav ? 'fill-current' : ''}`} />
        </button>
        <button
          type="button"
          onClick={() => addToQueue(track)}
          className="min-h-[40px] min-w-[40px] hidden sm:flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
          aria-label="Add to queue"
          title="Add to queue"
        >
          <ListPlus className="w-4 h-4" />
        </button>
        <button
          type="button"
          disabled={isDownloading}
          onClick={() => void saveOnlineTrack(track, true)}
          className={`min-h-[40px] min-w-[40px] px-1.5 flex items-center justify-center gap-1 rounded-lg transition-colors ${
            isDownloading
              ? 'bg-emerald-500/15 text-emerald-300'
              : savedOffline
                ? 'text-emerald-400 hover:bg-emerald-500/10'
                : 'text-slate-400 hover:text-emerald-300 hover:bg-white/5'
          }`}
          aria-label={
            isDownloading
              ? `Downloading ${track.title} ${dlProgress?.percent ?? 0}%`
              : savedOffline
                ? `Saved in My Music — Download ${track.title} to Device`
                : `Download ${track.title} to Device and My Music`
          }
          title={
            isDownloading
              ? `Downloading ${dlProgress?.percent ?? 0}%`
              : savedOffline
                ? 'Saved in My Music — Click to Download File to Device'
                : 'Download to Device & My Music'
          }
        >
          {isDownloading ? (
            <>
              <Loader2 className="w-3.5 h-3.5 text-emerald-400 animate-spin shrink-0" />
              <span className="font-mono-tabular text-[11px] font-bold">
                {dlProgress?.percent ?? 0}%
              </span>
            </>
          ) : savedOffline ? (
            <Check className="w-4 h-4" />
          ) : (
            <Download className="w-4 h-4" />
          )}
        </button>
        <button
          type="button"
          onClick={() => onAddToPlaylist(track)}
          className="min-h-[40px] min-w-[40px] px-2.5 flex items-center justify-center gap-1.5 rounded-lg bg-white/[0.05] hover:bg-[#4F6BFF]/20 border border-white/[0.08] hover:border-[#4F6BFF]/40 text-xs font-medium text-slate-200 hover:text-white transition-colors"
          aria-label={`Add ${track.title} to playlist`}
          title="Add to playlist"
        >
          <PlusSquare className="w-3.5 h-3.5 text-[#7A90FF]" />
          <span className="hidden md:inline">Playlist</span>
        </button>
        {rightAction}
      </div>
    </div>
  );
}

export function TrackCardSkeleton() {
  return (
    <div className="rounded-xl bg-[#11131A] border border-white/[0.06] p-3 animate-pulse">
      <div className="aspect-video w-full rounded-lg bg-white/[0.06] mb-3" />
      <div className="h-4 bg-white/[0.07] rounded w-4/5 mb-2" />
      <div className="h-3 bg-white/[0.05] rounded w-1/2" />
    </div>
  );
}
