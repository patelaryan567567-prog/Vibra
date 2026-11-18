import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  Download,
  HardDrive,
  Heart,
  ListPlus,
  Loader2,
  MoreHorizontal,
  Music2,
  Pause,
  Play,
  PlusSquare,
  Radio,
  RotateCcw,
  Tv,
  User,
} from 'lucide-react';
import { useArtistNavigation } from '../context/ArtistNavigationContext';
import { useLibrary } from '../context/LibraryContext';
import { useOfflineMusic } from '../context/OfflineMusicContext';
import { useOfflinePlayer } from '../context/OfflinePlayerContext';
import { usePlayer } from '../context/PlayerContext';
import { prewarmTrackAudio } from '../services/api';
import type { OfflineTrack, Track, TrackResumeInfo } from '../types/music';
import { formatSeconds } from '../utils/format';

interface TrackActionMenuProps {
  track: Track;
  queueContext?: Track[];
  matchedOffline?: OfflineTrack;
  savedResume?: TrackResumeInfo | null;
  onAddToPlaylist: (track: Track) => void;
  anchorEl: HTMLButtonElement | null;
  isOpen: boolean;
  onClose: () => void;
}

function TrackActionMenu({
  track,
  queueContext,
  matchedOffline,
  savedResume,
  onAddToPlaylist,
  anchorEl,
  isOpen,
  onClose,
}: TrackActionMenuProps) {
  const { playTrack, startTrackRadio, addToQueue, playNextInQueue } = usePlayer();
  const { playOfflineTrack, addToOfflineQueue, playNextInOfflineQueue } = useOfflinePlayer();
  const { openArtistPage } = useArtistNavigation();
  const {
    saveOnlineTrack,
    exportTrackToDevice,
    isTrackSavedOffline,
    downloadingIds,
    downloadProgressMap,
  } = useOfflineMusic();

  const menuPanelRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number; maxHeight: number }>({
    top: -9999,
    left: -9999,
    maxHeight: 360,
  });

  const isOfflineEntry = Boolean(track.isOffline || track.offlineTrackId);
  const savedOffline = isTrackSavedOffline(track.id) || Boolean(matchedOffline);
  const isDownloading = Boolean(downloadingIds[track.id]);
  const dlProgress = downloadProgressMap[track.id];
  const hasResume = Boolean(savedResume && savedResume.positionSeconds >= 3);

  const updatePosition = useCallback(() => {
    if (!anchorEl) return;
    const rect = anchorEl.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 10;
    const gap = 6;
    const menuWidth = Math.min(248, vw - margin * 2);
    const measuredHeight = menuPanelRef.current?.offsetHeight || 296;

    const left = Math.max(margin, Math.min(vw - menuWidth - margin, rect.right - menuWidth));
    const spaceBelow = vh - rect.bottom - margin - gap;
    const spaceAbove = rect.top - margin - gap;

    let top: number;
    let maxHeight: number;

    if (spaceBelow >= measuredHeight || spaceBelow >= spaceAbove) {
      maxHeight = Math.max(160, spaceBelow);
      const effectiveHeight = Math.min(measuredHeight, maxHeight);
      top = Math.min(vh - margin - effectiveHeight, rect.bottom + gap);
    } else {
      maxHeight = Math.max(160, spaceAbove);
      const effectiveHeight = Math.min(measuredHeight, maxHeight);
      top = Math.max(margin, rect.top - gap - effectiveHeight);
    }

    setCoords({ top, left, maxHeight });
  }, [anchorEl]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    updatePosition();
  }, [isOpen, updatePosition, savedOffline, isDownloading, hasResume]);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (anchorEl && anchorEl.contains(target)) return;
      if (menuPanelRef.current && menuPanelRef.current.contains(target)) return;
      onClose();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    const handleScrollOrResize = (e: Event) => {
      if (menuPanelRef.current && e.target instanceof Node && menuPanelRef.current.contains(e.target)) {
        return;
      }
      if (!anchorEl) {
        onClose();
        return;
      }
      const rect = anchorEl.getBoundingClientRect();
      if (
        rect.bottom < 0 ||
        rect.top > window.innerHeight ||
        rect.right < 0 ||
        rect.left > window.innerWidth
      ) {
        onClose();
        return;
      }
      updatePosition();
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown, { passive: true });
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleScrollOrResize);
    window.addEventListener('scroll', handleScrollOrResize, true);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('scroll', handleScrollOrResize, true);
    };
  }, [isOpen, anchorEl, onClose, updatePosition]);

  if (!isOpen || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={menuPanelRef}
      role="menu"
      aria-label={`Actions for ${track.title}`}
      style={{
        position: 'fixed',
        top: `${coords.top}px`,
        left: `${coords.left}px`,
        maxHeight: `${coords.maxHeight}px`,
      }}
      className="z-[80] w-[248px] max-w-[calc(100vw-20px)] overflow-y-auto rounded-xl bg-[#181B26]/98 backdrop-blur-xl border border-white/15 shadow-[0_18px_45px_rgba(0,0,0,0.75)] py-1.5 text-xs"
    >
      {hasResume && savedResume && (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              if ((isOfflineEntry || !navigator.onLine) && matchedOffline) {
                playOfflineTrack(matchedOffline, undefined, savedResume.positionSeconds);
              } else {
                playTrack(track, queueContext, Boolean(track.isVideo), savedResume.positionSeconds);
              }
              onClose();
            }}
            className="w-full min-h-[40px] px-3.5 py-2 flex items-center gap-2.5 text-emerald-300 hover:bg-white/[0.07] text-left transition-colors font-medium"
          >
            <Play className="w-4 h-4 fill-current shrink-0" />
            <span>Resume from {formatSeconds(savedResume.positionSeconds)}</span>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              if ((isOfflineEntry || !navigator.onLine) && matchedOffline) {
                playOfflineTrack(matchedOffline, undefined, 0);
              } else {
                playTrack(track, queueContext, Boolean(track.isVideo), 0);
              }
              onClose();
            }}
            className="w-full min-h-[40px] px-3.5 py-2 flex items-center gap-2.5 text-slate-200 hover:bg-white/[0.07] text-left transition-colors"
          >
            <RotateCcw className="w-4 h-4 text-slate-300 shrink-0" />
            <span>Start Over (0:00)</span>
          </button>

          <div className="my-1 border-t border-white/[0.07]" />
        </>
      )}

      {!isOfflineEntry && (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              startTrackRadio(track);
              onClose();
            }}
            className="w-full min-h-[40px] px-3.5 py-2 flex items-center gap-2.5 text-slate-100 hover:bg-white/[0.07] text-left transition-colors"
          >
            <Radio className="w-4 h-4 text-[#7A90FF] shrink-0" />
            <span>Start Song Radio</span>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              playTrack(track, queueContext, true);
              onClose();
            }}
            className="w-full min-h-[40px] px-3.5 py-2 flex items-center gap-2.5 text-slate-100 hover:bg-white/[0.07] text-left transition-colors"
          >
            <Tv className="w-4 h-4 text-[#7A90FF] shrink-0" />
            <span>Watch Music Video</span>
          </button>
        </>
      )}

      <button
        type="button"
        role="menuitem"
        onClick={() => {
          if (isOfflineEntry && matchedOffline) {
            playNextInOfflineQueue(matchedOffline);
          } else {
            playNextInQueue(track);
          }
          onClose();
        }}
        className="w-full min-h-[40px] px-3.5 py-2 flex items-center gap-2.5 text-slate-100 hover:bg-white/[0.07] text-left transition-colors"
      >
        <Play className="w-4 h-4 text-slate-300 shrink-0" />
        <span>Play Next</span>
      </button>

      <button
        type="button"
        role="menuitem"
        onClick={() => {
          if (isOfflineEntry && matchedOffline) {
            addToOfflineQueue(matchedOffline);
          } else {
            addToQueue(track);
          }
          onClose();
        }}
        className="w-full min-h-[40px] px-3.5 py-2 flex items-center gap-2.5 text-slate-100 hover:bg-white/[0.07] text-left transition-colors"
      >
        <ListPlus className="w-4 h-4 text-slate-300 shrink-0" />
        <span>{isOfflineEntry ? 'Add to Offline Queue' : 'Add to Queue'}</span>
      </button>

      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onAddToPlaylist(track);
          onClose();
        }}
        className="w-full min-h-[40px] px-3.5 py-2 flex items-center gap-2.5 text-slate-100 hover:bg-white/[0.07] text-left transition-colors"
      >
        <PlusSquare className="w-4 h-4 text-slate-300 shrink-0" />
        <span>Add to Playlist</span>
      </button>

      {track.artist && (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            openArtistPage(track.artist, isOfflineEntry ? undefined : track);
            onClose();
          }}
          className="w-full min-h-[40px] px-3.5 py-2 flex items-center gap-2.5 text-slate-100 hover:bg-white/[0.07] text-left transition-colors"
        >
          <User className="w-4 h-4 text-[#7A90FF] shrink-0" />
          <span>View Artist</span>
        </button>
      )}

      <div className="my-1 border-t border-white/[0.07]" />

      {isOfflineEntry && matchedOffline ? (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            void exportTrackToDevice(matchedOffline);
            onClose();
          }}
          className="w-full min-h-[40px] px-3.5 py-2 flex items-center gap-2.5 text-slate-100 hover:bg-white/[0.07] text-left transition-colors"
        >
          <Download className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>Save File to Device Downloads</span>
        </button>
      ) : (
        <>
          <button
            type="button"
            role="menuitem"
            disabled={isDownloading}
            onClick={() => {
              void saveOnlineTrack(track, true);
              onClose();
            }}
            className="w-full min-h-[40px] px-3.5 py-2 flex items-center gap-2.5 text-slate-100 hover:bg-white/[0.07] disabled:opacity-65 text-left transition-colors"
          >
            {isDownloading ? (
              <Loader2 className="w-4 h-4 text-emerald-400 animate-spin shrink-0" />
            ) : savedOffline ? (
              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <Download className="w-4 h-4 text-emerald-400 shrink-0" />
            )}
            <span>
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
              role="menuitem"
              disabled={isDownloading}
              onClick={() => {
                void saveOnlineTrack(track, false);
                onClose();
              }}
              className="w-full min-h-[40px] px-3.5 py-2 flex items-center gap-2.5 text-slate-300 hover:bg-white/[0.07] disabled:opacity-65 text-left transition-colors"
            >
              <Download className="w-4 h-4 text-[#7A90FF] shrink-0" />
              <span>Save Only to My Music</span>
            </button>
          )}
        </>
      )}
    </div>,
    document.body
  );
}

interface TrackCardProps {
  track: Track;
  queueContext?: Track[];
  onAddToPlaylist: (track: Track) => void;
  timestampLabel?: string;
}

export const TrackCard = React.memo(function TrackCard({ track, queueContext, onAddToPlaylist, timestampLabel }: TrackCardProps) {
  const { currentTrack, isPlaying, playTrack, togglePlay } = usePlayer();
  const {
    currentTrack: currentOfflineTrack,
    isPlaying: isOfflinePlaying,
    playOfflineTrack,
    togglePlay: toggleOfflinePlay,
  } = useOfflinePlayer();
  const { isFavourite, toggleFavourite, trackPositions, showToast } = useLibrary();
  const { offlineTracks, downloadProgressMap } = useOfflineMusic();
  const { openArtistPage } = useArtistNavigation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [imgError, setImgError] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);

  const matchedOffline = offlineTracks.find(
    (o) =>
      o.id === track.id ||
      o.id === track.offlineTrackId ||
      (o.sourceVideoId && o.sourceVideoId === track.id)
  );
  const isOfflineEntry = Boolean(track.isOffline || track.offlineTrackId);

  const isActiveOffline = Boolean(matchedOffline && currentOfflineTrack?.id === matchedOffline.id);
  const isActiveOnline = !isOfflineEntry && currentTrack?.id === track.id;
  const isCurrent = isActiveOffline || isActiveOnline;
  const isCurrentPlaying = isActiveOffline ? isOfflinePlaying : isActiveOnline ? isPlaying : false;

  const fav = isFavourite(track.id);
  const dlProgress = downloadProgressMap[track.id];

  const savedResume =
    trackPositions[track.id] ||
    (matchedOffline ? trackPositions[matchedOffline.id] : undefined) ||
    (track.offlineTrackId ? trackPositions[track.offlineTrackId] : undefined);
  const hasResume = Boolean(savedResume && savedResume.positionSeconds >= 3);
  const resumePercent =
    hasResume && savedResume
      ? Math.min(
          100,
          Math.max(
            4,
            (savedResume.positionSeconds /
              (savedResume.durationSeconds || track.durationSeconds || 180)) *
              100
          )
        )
      : 0;

  const handlePrimaryPlay = () => {
    if (isOfflineEntry) {
      if (!matchedOffline) {
        showToast('Offline audio file is no longer in My Music.');
        return;
      }
      if (isActiveOffline) toggleOfflinePlay();
      else playOfflineTrack(matchedOffline);
      return;
    }
    if (!navigator.onLine && matchedOffline) {
      if (isActiveOffline) toggleOfflinePlay();
      else playOfflineTrack(matchedOffline);
      return;
    }
    if (isActiveOnline) {
      togglePlay();
    } else {
      playTrack(track, queueContext, Boolean(track.isVideo));
    }
  };

  const handleStartOver = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isOfflineEntry) {
      if (!matchedOffline) {
        showToast('Offline audio file is no longer in My Music.');
        return;
      }
      playOfflineTrack(matchedOffline, undefined, 0);
      return;
    }
    if (!navigator.onLine && matchedOffline) {
      playOfflineTrack(matchedOffline, undefined, 0);
    } else {
      playTrack(track, queueContext, Boolean(track.isVideo), 0);
    }
  };

  return (
    <article
      onMouseEnter={() => {
        if (!isOfflineEntry) prewarmTrackAudio(track);
      }}
      onTouchStart={() => {
        if (!isOfflineEntry) prewarmTrackAudio(track);
      }}
      className="group relative flex flex-col rounded-xl bg-[#11131A] border border-white/[0.07] hover:border-white/[0.15] hover:bg-[#161923] transition-colors p-3"
    >
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
                : isOfflineEntry
                  ? 'bg-emerald-500 text-white hover:bg-emerald-400'
                  : 'bg-[#4F6BFF] text-white hover:bg-[#5E78FF]'
            }`}
          >
            {isCurrentPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
          </span>
        </button>

        {/* Active track indicator bar */}
        {isCurrent && (
          <div
            className={`absolute top-2 left-2 px-2 py-0.5 rounded-md text-[11px] font-medium text-white shadow ${
              isActiveOffline ? 'bg-emerald-600' : 'bg-[#4F6BFF]'
            }`}
          >
            {isCurrentPlaying ? 'Playing' : 'Paused'}
          </div>
        )}

        {/* Offline / Download Indicator */}
        {dlProgress ? (
          <div className="absolute top-2 right-2 px-2 py-0.5 rounded-md bg-emerald-600/95 text-[11px] font-mono-tabular font-bold text-white shadow flex items-center gap-1">
            {dlProgress.phase !== 'done' && <Loader2 className="w-3 h-3 animate-spin" />}
            <span>{dlProgress.percent}%</span>
          </div>
        ) : isOfflineEntry ? (
          <div className="absolute top-2 right-2 px-2 py-0.5 rounded-md bg-black/75 border border-emerald-500/40 text-[10px] font-semibold text-emerald-300 shadow flex items-center gap-1">
            <HardDrive className="w-3 h-3" />
            <span>Offline</span>
          </div>
        ) : null}

        {/* Saved Resume Progress Bar at Bottom of Artwork */}
        {hasResume && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/60 pointer-events-none">
            <div
              className={`h-full transition-all ${
                isOfflineEntry ? 'bg-emerald-400' : 'bg-[#4F6BFF]'
              }`}
              style={{ width: `${resumePercent}%` }}
            />
          </div>
        )}
      </div>

      {/* Title & Clean Unboxed Metadata */}
      <div className="flex items-start justify-between gap-2 min-w-0">
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={handlePrimaryPlay}
            className="w-full text-left focus:outline-none"
          >
            <h3
              className={`text-sm sm:text-[15px] font-semibold leading-snug line-clamp-2 break-words ${
                isCurrent
                  ? isActiveOffline
                    ? 'text-emerald-300'
                    : 'text-[#8CA2FF]'
                  : 'text-white group-hover:text-white'
              }`}
            >
              {track.title}
            </h3>
          </button>
          <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs sm:text-[13px] font-medium text-slate-300">
            <button
              type="button"
              onClick={() => openArtistPage(track.artist, isOfflineEntry ? undefined : track)}
              className="text-left hover:text-white hover:underline line-clamp-1 break-words transition-colors"
            >
              {track.artist}
            </button>
            {track.viewCount && (
              <>
                <span aria-hidden="true" className="text-slate-500">·</span>
                <span
                  className={`font-mono-tabular whitespace-nowrap ${
                    isOfflineEntry ? 'text-emerald-400' : 'text-slate-300'
                  }`}
                >
                  {track.viewCount}
                </span>
              </>
            )}
            {timestampLabel && (
              <>
                <span aria-hidden="true" className="text-slate-500">·</span>
                <span className="whitespace-nowrap text-slate-400">{timestampLabel}</span>
              </>
            )}
          </div>
        </div>

        {/* Quick actions */}
        <div className="flex items-center shrink-0 -mr-1.5">
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

          <button
            ref={menuTriggerRef}
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={`More actions for ${track.title}`}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            className={`min-h-[40px] min-w-[38px] sm:min-w-[40px] flex items-center justify-center rounded-lg transition-colors ${
              menuOpen ? 'text-white bg-white/10' : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>

          <TrackActionMenu
            track={track}
            queueContext={queueContext}
            matchedOffline={matchedOffline}
            savedResume={savedResume}
            onAddToPlaylist={onAddToPlaylist}
            anchorEl={menuTriggerRef.current}
            isOpen={menuOpen}
            onClose={() => setMenuOpen(false)}
          />
        </div>
      </div>

      {/* Resume Badge + Start Over Control */}
      {hasResume && savedResume && (
        <div className="mt-2 pt-2 border-t border-white/[0.06] flex items-center justify-between gap-2 text-[11px]">
          <button
            type="button"
            onClick={handlePrimaryPlay}
            className="inline-flex items-center gap-1.5 font-mono-tabular font-semibold text-emerald-300 hover:text-emerald-200 transition-colors"
          >
            <Play className="w-3 h-3 fill-current" />
            <span>Resume {formatSeconds(savedResume.positionSeconds)}</span>
          </button>
          <button
            type="button"
            onClick={handleStartOver}
            title="Start over from 0:00"
            className="inline-flex items-center gap-1 text-slate-400 hover:text-white transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            <span>0:00</span>
          </button>
        </div>
      )}
    </article>
  );
});

interface TrackRowProps {
  track: Track;
  index?: number;
  queueContext?: Track[];
  onAddToPlaylist: (track: Track) => void;
  rightAction?: React.ReactNode;
  timestampLabel?: string;
}

export const TrackRow = React.memo(function TrackRow({
  track,
  index,
  queueContext,
  onAddToPlaylist,
  rightAction,
  timestampLabel,
}: TrackRowProps) {
  const { currentTrack, isPlaying, playTrack, togglePlay, addToQueue } = usePlayer();
  const {
    currentTrack: currentOfflineTrack,
    isPlaying: isOfflinePlaying,
    playOfflineTrack,
    togglePlay: toggleOfflinePlay,
    addToOfflineQueue,
  } = useOfflinePlayer();
  const { isFavourite, toggleFavourite, trackPositions, showToast } = useLibrary();
  const { openArtistPage } = useArtistNavigation();
  const {
    offlineTracks,
    saveOnlineTrack,
    exportTrackToDevice,
    isTrackSavedOffline,
    downloadingIds,
    downloadProgressMap,
  } = useOfflineMusic();
  const [imgError, setImgError] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);

  const matchedOffline = offlineTracks.find(
    (o) =>
      o.id === track.id ||
      o.id === track.offlineTrackId ||
      (o.sourceVideoId && o.sourceVideoId === track.id)
  );
  const isOfflineEntry = Boolean(track.isOffline || track.offlineTrackId);

  const isActiveOffline = Boolean(matchedOffline && currentOfflineTrack?.id === matchedOffline.id);
  const isActiveOnline = !isOfflineEntry && currentTrack?.id === track.id;
  const isCurrent = isActiveOffline || isActiveOnline;
  const isCurrentPlaying = isActiveOffline ? isOfflinePlaying : isActiveOnline ? isPlaying : false;

  const fav = isFavourite(track.id);
  const savedOffline = isTrackSavedOffline(track.id) || Boolean(matchedOffline);
  const isDownloading = Boolean(downloadingIds[track.id]);
  const dlProgress = downloadProgressMap[track.id];

  const savedResume =
    trackPositions[track.id] ||
    (matchedOffline ? trackPositions[matchedOffline.id] : undefined) ||
    (track.offlineTrackId ? trackPositions[track.offlineTrackId] : undefined);
  const hasResume = Boolean(savedResume && savedResume.positionSeconds >= 3);
  const resumePercent =
    hasResume && savedResume
      ? Math.min(
          100,
          Math.max(
            4,
            (savedResume.positionSeconds /
              (savedResume.durationSeconds || track.durationSeconds || 180)) *
              100
          )
        )
      : 0;

  const handlePlay = () => {
    if (isOfflineEntry) {
      if (!matchedOffline) {
        showToast('Offline audio file is no longer in My Music.');
        return;
      }
      if (isActiveOffline) toggleOfflinePlay();
      else playOfflineTrack(matchedOffline);
      return;
    }
    if (!navigator.onLine && matchedOffline) {
      if (isActiveOffline) toggleOfflinePlay();
      else playOfflineTrack(matchedOffline);
      return;
    }
    if (isActiveOnline) togglePlay();
    else playTrack(track, queueContext, Boolean(track.isVideo));
  };

  const handleStartOver = () => {
    if (isOfflineEntry) {
      if (!matchedOffline) {
        showToast('Offline audio file is no longer in My Music.');
        return;
      }
      playOfflineTrack(matchedOffline, undefined, 0);
      return;
    }
    if (!navigator.onLine && matchedOffline) {
      playOfflineTrack(matchedOffline, undefined, 0);
    } else {
      playTrack(track, queueContext, Boolean(track.isVideo), 0);
    }
  };

  return (
    <div
      onMouseEnter={() => {
        if (!isOfflineEntry) prewarmTrackAudio(track);
      }}
      onTouchStart={() => {
        if (!isOfflineEntry) prewarmTrackAudio(track);
      }}
      className={`group flex items-center gap-2.5 sm:gap-3 px-3 py-2.5 rounded-xl border transition-colors ${
        isCurrent
          ? isActiveOffline
            ? 'bg-emerald-500/10 border-emerald-500/35'
            : 'bg-[#4F6BFF]/10 border-[#4F6BFF]/30'
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
        className="relative w-12 h-10 sm:w-16 sm:h-11 rounded-lg overflow-hidden bg-[#181B26] shrink-0"
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
        {hasResume && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/60">
            <div
              className={`h-full ${isOfflineEntry ? 'bg-emerald-400' : 'bg-[#4F6BFF]'}`}
              style={{ width: `${resumePercent}%` }}
            />
          </div>
        )}
      </button>

      <div className="min-w-0 flex-1">
        <button type="button" onClick={handlePlay} className="w-full text-left focus:outline-none">
          <p
            className={`text-[13px] sm:text-[15px] font-semibold line-clamp-2 break-words leading-snug ${
              isCurrent
                ? isActiveOffline
                  ? 'text-emerald-300'
                  : 'text-[#8CA2FF]'
                : 'text-white'
            }`}
          >
            {track.title}
          </p>
        </button>
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs sm:text-[13px] font-medium text-slate-300 mt-0.5">
          <button
            type="button"
            onClick={() => openArtistPage(track.artist, isOfflineEntry ? undefined : track)}
            className="text-left hover:text-white hover:underline line-clamp-1 break-words transition-colors"
          >
            {track.artist}
          </button>
          {isOfflineEntry && (
            <>
              <span aria-hidden="true" className="text-slate-500">·</span>
              <span className="inline-flex items-center gap-1 text-emerald-400 font-semibold shrink-0">
                <HardDrive className="w-3 h-3" />
                <span>Offline</span>
              </span>
            </>
          )}
          {!isOfflineEntry && track.viewCount && (
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
          {hasResume && savedResume && (
            <>
              <span aria-hidden="true" className="text-slate-500">·</span>
              <span className="font-mono-tabular font-semibold text-emerald-300 shrink-0">
                Resume {formatSeconds(savedResume.positionSeconds)}
              </span>
            </>
          )}
        </div>
      </div>

      <span className="hidden sm:inline-block font-mono-tabular text-xs text-slate-400 px-2 shrink-0">
        {track.duration}
      </span>

      <div className="flex items-center gap-0.5 shrink-0">
        {hasResume && (
          <button
            type="button"
            onClick={handleStartOver}
            className="hidden sm:flex min-h-[40px] min-w-[38px] items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
            aria-label={`Restart ${track.title} from 0:00`}
            title="Start Over (0:00)"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={() => toggleFavourite(track)}
          className={`min-h-[40px] min-w-[38px] sm:min-w-[40px] flex items-center justify-center rounded-lg transition-colors ${
            fav ? 'text-rose-400 hover:bg-rose-500/10' : 'text-slate-400 hover:text-white hover:bg-white/5'
          }`}
          aria-label={fav ? 'Remove from favourites' : 'Save to favourites'}
        >
          <Heart className={`w-4 h-4 ${fav ? 'fill-current' : ''}`} />
        </button>
        <button
          type="button"
          onClick={() => {
            if (isOfflineEntry && matchedOffline) {
              addToOfflineQueue(matchedOffline);
            } else {
              addToQueue(track);
            }
          }}
          className="min-h-[40px] min-w-[40px] hidden sm:flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
          aria-label={isOfflineEntry ? 'Add to offline queue' : 'Add to queue'}
          title={isOfflineEntry ? 'Add to Offline Queue' : 'Add to queue'}
        >
          <ListPlus className="w-4 h-4" />
        </button>
        {isOfflineEntry && matchedOffline ? (
          <button
            type="button"
            onClick={() => void exportTrackToDevice(matchedOffline)}
            className="min-h-[40px] min-w-[38px] sm:min-w-[40px] px-1.5 flex items-center justify-center rounded-lg text-emerald-400 hover:bg-emerald-500/10 transition-colors"
            aria-label={`Save ${track.title} file to device Downloads`}
            title="Save file to Device Downloads"
          >
            <Download className="w-4 h-4" />
          </button>
        ) : (
          <button
            type="button"
            disabled={isDownloading}
            onClick={() => void saveOnlineTrack(track, true)}
            className={`min-h-[40px] min-w-[38px] sm:min-w-[40px] px-1.5 flex items-center justify-center gap-1 rounded-lg transition-colors ${
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
        )}
        <button
          type="button"
          onClick={() => onAddToPlaylist(track)}
          className="hidden sm:flex min-h-[40px] min-w-[40px] px-2.5 items-center justify-center gap-1.5 rounded-lg bg-white/[0.05] hover:bg-[#4F6BFF]/20 border border-white/[0.08] hover:border-[#4F6BFF]/40 text-xs font-medium text-slate-200 hover:text-white transition-colors"
          aria-label={`Add ${track.title} to playlist`}
          title="Add to playlist"
        >
          <PlusSquare className="w-3.5 h-3.5 text-[#7A90FF]" />
          <span className="hidden md:inline">Playlist</span>
        </button>
        <button
          ref={menuTriggerRef}
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label={`More actions for ${track.title}`}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          className={`min-h-[40px] min-w-[38px] sm:min-w-[40px] flex items-center justify-center rounded-lg transition-colors ${
            menuOpen ? 'text-white bg-white/10' : 'text-slate-400 hover:text-white hover:bg-white/5'
          }`}
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
        <TrackActionMenu
          track={track}
          queueContext={queueContext}
          matchedOffline={matchedOffline}
          savedResume={savedResume}
          onAddToPlaylist={onAddToPlaylist}
          anchorEl={menuTriggerRef.current}
          isOpen={menuOpen}
          onClose={() => setMenuOpen(false)}
        />
        {rightAction}
      </div>
    </div>
  );
});

export function TrackCardSkeleton() {
  return (
    <div className="rounded-xl bg-[#11131A] border border-white/[0.06] p-3 animate-pulse">
      <div className="aspect-video w-full rounded-lg bg-white/[0.06] mb-3" />
      <div className="h-4 bg-white/[0.07] rounded w-4/5 mb-2" />
      <div className="h-3 bg-white/[0.05] rounded w-1/2" />
    </div>
  );
}
