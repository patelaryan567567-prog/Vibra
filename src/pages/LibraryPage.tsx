import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  BarChart3,
  Check,
  Clock,
  Disc3,
  Download,
  Edit3,
  FolderHeart,
  FolderOpen,
  Globe,
  HardDrive,
  Link2,
  ListMusic,
  ListPlus,
  Loader2,
  Music2,
  Pause,
  Play,
  Plus,
  PlusSquare,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Shuffle,
  Trash2,
  Upload,
  User,
  WifiOff,
} from 'lucide-react';
import { BackupRestoreModal } from '../components/BackupRestoreModal';
import { TrackRow } from '../components/TrackCard';
import { useArtistNavigation } from '../context/ArtistNavigationContext';
import { useConfirm } from '../context/ConfirmContext';
import { useLibrary } from '../context/LibraryContext';
import { useOfflineMusic } from '../context/OfflineMusicContext';
import { useOfflinePlayer } from '../context/OfflinePlayerContext';
import { usePlayer } from '../context/PlayerContext';
import type {
  AudioSourceProvider,
  MultiSourceTrack,
  NavTab,
  OfflinePlaylist,
  OfflineTrack,
  Playlist,
  Track,
} from '../types/music';
import { formatRelativeTime, formatSeconds } from '../utils/format';
import { formatBytes } from '../utils/offlineMusicDb';

export type LibrarySectionTab = 'mymusic' | 'playlists' | 'recent' | 'stats' | 'history';

interface LibraryPageProps {
  onAddToPlaylist: (track: Track) => void;
  onAddToOfflinePlaylist: (track: OfflineTrack) => void;
  onRunSearchQuery: (query: string) => void;
  onNavigate: (tab: NavTab) => void;
  requestedSection?: LibrarySectionTab | null;
  onConsumeRequestedSection?: () => void;
}

function formatTotalListeningTime(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export function LibraryPage({
  onAddToPlaylist,
  onAddToOfflinePlaylist,
  onRunSearchQuery,
  onNavigate,
  requestedSection,
  onConsumeRequestedSection,
}: LibraryPageProps) {
  const confirm = useConfirm();
  const {
    playlists,
    recentlyPlayed,
    searchHistory,
    listeningStats,
    trackPositions,
    createPlaylist,
    renamePlaylist,
    deletePlaylist,
    removeTrackFromPlaylist,
    clearRecentlyPlayed,
    clearListeningStats,
    removeSearchQuery,
    clearSearchHistory,
  } = useLibrary();
  const { playTrack } = usePlayer();
  const { openArtistPage } = useArtistNavigation();
  const {
    offlineTracks,
    offlinePlaylists,
    isScanning,
    scanStatusText,
    storageGranted,
    grantedFolderName,
    canRescanFolder,
    isOnline,
    downloadingIds,
    downloadProgressMap,
    activeDownloads,
    grantPermissionAndScanDirectory,
    rescanSavedFolder,
    importAudioFiles,
    saveOnlineTrack,
    downloadFromDirectUrl,
    exportTrackToDevice,
    searchOtherSources,
    isTrackSavedOffline,
    deleteOfflineTrack,
    clearAllOfflineTracks,
    createOfflinePlaylist,
    renameOfflinePlaylist,
    deleteOfflinePlaylist,
    removeTrackFromOfflinePlaylist,
    batchDownloadState,
    isBatchDownloading,
    batchDownloadTracks,
  } = useOfflineMusic();
  const {
    currentTrack: activeOfflineTrack,
    isPlaying: isOfflinePlaying,
    playOfflineTrack,
    togglePlay: toggleOfflinePlay,
    addToOfflineQueue,
    playNextInOfflineQueue,
  } = useOfflinePlayer();

  const [sectionTab, setSectionTab] = useState<LibrarySectionTab>('mymusic');
  const [myMusicView, setMyMusicView] = useState<'songs' | 'playlists' | 'sources'>('songs');
  const [offlineQuery, setOfflineQuery] = useState('');
  const [sourceQuery, setSourceQuery] = useState('');
  const [sourceProvider, setSourceProvider] = useState<'all' | AudioSourceProvider>('all');
  const [sourceResults, setSourceResults] = useState<MultiSourceTrack[]>([]);
  const [isSearchingSources, setIsSearchingSources] = useState(false);
  const [sourceSearchError, setSourceSearchError] = useState<string | null>(null);
  const [hasSearchedSources, setHasSearchedSources] = useState(false);
  const [directUrl, setDirectUrl] = useState('');
  const [directTitle, setDirectTitle] = useState('');
  const [directAlsoDevice, setDirectAlsoDevice] = useState(true);
  const [showOfflinePlaylistBuilder, setShowOfflinePlaylistBuilder] = useState(false);
  const [newOfflinePlName, setNewOfflinePlName] = useState('');
  const [newOfflinePlDesc, setNewOfflinePlDesc] = useState('');
  const [selectedBuilderTrackIds, setSelectedBuilderTrackIds] = useState<string[]>([]);
  const [selectedOfflinePlaylistId, setSelectedOfflinePlaylistId] = useState<string | null>(null);
  const [editingOfflinePlId, setEditingOfflinePlId] = useState<string | null>(null);
  const [editOfflinePlName, setEditOfflinePlName] = useState('');
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [newPlaylistDesc, setNewPlaylistDesc] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);

  const [editingPlaylistId, setEditingPlaylistId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);

  useEffect(() => {
    if (requestedSection) {
      setSectionTab(requestedSection);
      onConsumeRequestedSection?.();
    }
  }, [requestedSection, onConsumeRequestedSection]);

  const selectedPlaylist: Playlist | undefined = playlists.find((p) => p.id === selectedPlaylistId);
  const selectedOfflinePlaylist: OfflinePlaylist | undefined =
    offlinePlaylists.find((p) => p.id === selectedOfflinePlaylistId) ?? offlinePlaylists[0];

  const offlineTrackMap = useMemo(() => {
    const map = new Map<string, OfflineTrack>();
    for (const t of offlineTracks) map.set(t.id, t);
    return map;
  }, [offlineTracks]);

  const filteredOfflineTracks = useMemo(() => {
    const q = offlineQuery.trim().toLowerCase();
    if (!q) return offlineTracks;
    return offlineTracks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q) ||
        t.fileName.toLowerCase().includes(q) ||
        (t.album && t.album.toLowerCase().includes(q))
    );
  }, [offlineTracks, offlineQuery]);

  const totalOfflineBytes = useMemo(
    () => offlineTracks.reduce((acc, t) => acc + (t.sizeBytes || 0), 0),
    [offlineTracks]
  );

  const topTracks = useMemo(
    () =>
      Object.values(listeningStats.trackStats)
        .sort((a, b) => b.playCount - a.playCount || b.lastPlayedAt - a.lastPlayedAt)
        .slice(0, 15),
    [listeningStats.trackStats]
  );

  const topArtists = useMemo(
    () =>
      Object.values(listeningStats.artistStats)
        .sort((a, b) => b.playCount - a.playCount || b.lastPlayedAt - a.lastPlayedAt)
        .slice(0, 8),
    [listeningStats.artistStats]
  );

  const handleCreatePlaylist = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPlaylistName.trim()) return;
    const pl = createPlaylist(newPlaylistName, newPlaylistDesc);
    setNewPlaylistName('');
    setNewPlaylistDesc('');
    setShowCreateForm(false);
    setSelectedPlaylistId(pl.id);
  };

  const handleShufflePlay = (tracks: Track[]) => {
    if (tracks.length === 0) return;
    const shuffled = [...tracks].sort(() => Math.random() - 0.5);
    playTrack(shuffled[0], shuffled);
  };

  const handleAllowStorageAndScan = async () => {
    const result = await grantPermissionAndScanDirectory();
    if (result === 'fallback-needed') {
      fileInputRef.current?.click();
    }
  };

  const handleToggleBuilderTrack = (trackId: string) => {
    setSelectedBuilderTrackIds((prev) =>
      prev.includes(trackId) ? prev.filter((id) => id !== trackId) : [...prev, trackId]
    );
  };

  const handleCreateOfflinePlaylist = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOfflinePlName.trim()) return;
    const created = createOfflinePlaylist(
      newOfflinePlName,
      selectedBuilderTrackIds,
      newOfflinePlDesc
    );
    setNewOfflinePlName('');
    setNewOfflinePlDesc('');
    setSelectedBuilderTrackIds([]);
    setShowOfflinePlaylistBuilder(false);
    setMyMusicView('playlists');
    setSelectedOfflinePlaylistId(created.id);
  };

  const handleShuffleOfflinePlay = (tracks: OfflineTrack[]) => {
    if (tracks.length === 0) return;
    const shuffled = [...tracks].sort(() => Math.random() - 0.5);
    playOfflineTrack(shuffled[0], shuffled);
  };

  const multiSourceToTrack = (item: MultiSourceTrack): Track => ({
    id: item.id,
    title: item.title,
    artist: item.artist,
    channelTitle: item.sourceLabel,
    thumbnail: item.thumbnail,
    thumbnailHigh: item.thumbnailHigh || item.thumbnail,
    duration: item.duration,
    durationSeconds: item.durationSeconds,
  });

  const runSourceSearch = async (queryText: string, provider: 'all' | AudioSourceProvider) => {
    const q = queryText.trim();
    if (!q) return;
    setIsSearchingSources(true);
    setSourceSearchError(null);
    setHasSearchedSources(true);
    try {
      const results = await searchOtherSources(q, provider);
      setSourceResults(results);
    } catch (err) {
      setSourceSearchError(err instanceof Error ? err.message : 'Unable to search sources right now.');
      setSourceResults([]);
    } finally {
      setIsSearchingSources(false);
    }
  };

  const handleSourceSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void runSourceSearch(sourceQuery, sourceProvider);
  };

  const handleDirectUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!directUrl.trim()) return;
    const saved = await downloadFromDirectUrl(directUrl, {
      title: directTitle.trim() || undefined,
      alsoDownloadToDevice: directAlsoDevice,
    });
    if (saved) {
      setDirectUrl('');
      setDirectTitle('');
    }
  };

  const activeUrlDownloads = activeDownloads.filter((d) => d.trackId.startsWith('url_'));

  return (
    <div className="space-y-8 pb-8">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">Your Library</h1>
          <p className="text-sm text-slate-400 mt-1">
            Downloaded offline music, custom playlists, listening stats, and saved searches on this device.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          {sectionTab === 'mymusic' ? (
            <>
              <button
                type="button"
                onClick={() => void handleAllowStorageAndScan()}
                disabled={isScanning}
                className="h-10 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap transition-colors"
              >
                {isScanning ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <FolderOpen className="w-4 h-4" />
                )}
                <span>{storageGranted ? 'Add More Music' : 'Allow Storage & Scan'}</span>
              </button>
              {offlineTracks.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setMyMusicView('playlists');
                    setShowOfflinePlaylistBuilder((v) => !v);
                  }}
                  className="h-10 px-4 rounded-xl bg-[#4F6BFF] hover:bg-[#415CE6] text-white text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  <span>Offline Playlist</span>
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              onClick={() => {
                setSectionTab('playlists');
                setShowCreateForm((v) => !v);
              }}
              className="h-10 px-4 rounded-xl bg-[#4F6BFF] hover:bg-[#415CE6] text-white text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>New Playlist</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsBackupModalOpen(true)}
            className="h-10 px-3.5 rounded-xl bg-[#11131A] hover:bg-[#181B26] border border-white/10 text-slate-200 hover:text-white text-xs font-medium inline-flex items-center gap-2 whitespace-nowrap transition-colors"
          >
            <Archive className="w-4 h-4 text-[#7A90FF]" />
            <span>Backup / Restore</span>
          </button>
        </div>
      </div>

      {/* Hidden File & Folder Inputs for universal Android / iOS / Tablet / Desktop storage access */}
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg,.opus,.flac,.webm"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            void importAudioFiles(e.target.files, 'device-file');
            e.target.value = '';
          }
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg,.opus,.flac,.webm"
        multiple
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            void importAudioFiles(e.target.files, 'device-folder');
            e.target.value = '';
          }
        }}
      />

      {/* Section Tabs (mobile-safe horizontal scroll) */}
      <div className="flex items-center gap-1 p-1 rounded-xl bg-[#11131A] border border-white/[0.07] w-fit max-w-full overflow-x-auto no-scrollbar">
        <button
          type="button"
          onClick={() => setSectionTab('mymusic')}
          className={`px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 transition-colors ${
            sectionTab === 'mymusic'
              ? 'bg-emerald-600 text-white'
              : 'text-slate-300 hover:text-white'
          }`}
        >
          <HardDrive className="w-3.5 h-3.5" />
          <span>My Music ({offlineTracks.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setSectionTab('playlists')}
          className={`px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
            sectionTab === 'playlists' ? 'bg-[#4F6BFF] text-white' : 'text-slate-400 hover:text-white'
          }`}
        >
          Playlists ({playlists.length})
        </button>
        <button
          type="button"
          onClick={() => setSectionTab('recent')}
          className={`px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
            sectionTab === 'recent' ? 'bg-[#4F6BFF] text-white' : 'text-slate-400 hover:text-white'
          }`}
        >
          Recently Played ({recentlyPlayed.length})
        </button>
        <button
          type="button"
          onClick={() => setSectionTab('stats')}
          className={`px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
            sectionTab === 'stats' ? 'bg-[#4F6BFF] text-white' : 'text-slate-400 hover:text-white'
          }`}
        >
          Listening Stats
        </button>
        <button
          type="button"
          onClick={() => setSectionTab('history')}
          className={`px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
            sectionTab === 'history' ? 'bg-[#4F6BFF] text-white' : 'text-slate-400 hover:text-white'
          }`}
        >
          Searches ({searchHistory.length})
        </button>
      </div>

      {/* MY MUSIC SECTION (Offline Storage + Downloaded Songs + Offline Playlists) */}
      {sectionTab === 'mymusic' && (
        <div className="space-y-6">
          {/* Storage Permission & Scanner Banner */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDraggingFiles(true);
            }}
            onDragLeave={() => setIsDraggingFiles(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDraggingFiles(false);
              if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                void importAudioFiles(e.dataTransfer.files, 'device-file');
              }
            }}
            className={`rounded-2xl border p-5 sm:p-6 transition-colors ${
              isDraggingFiles
                ? 'bg-emerald-500/15 border-emerald-400'
                : 'bg-gradient-to-br from-[#111921] via-[#11131A] to-[#131522] border-white/[0.09]'
            }`}
          >
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="space-y-1.5 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-300">
                    <ShieldCheck className="w-4 h-4 shrink-0" />
                    <span>
                      {storageGranted || offlineTracks.length > 0
                        ? grantedFolderName
                          ? `Folder linked: ${grantedFolderName}`
                          : 'Offline Storage Ready'
                        : 'Allow Storage Access'}
                    </span>
                  </span>
                  {!isOnline && (
                    <>
                      <span aria-hidden="true" className="text-slate-500">·</span>
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-300">
                        <WifiOff className="w-3.5 h-3.5" />
                        <span>Offline Mode</span>
                      </span>
                    </>
                  )}
                  {offlineTracks.length > 0 && (
                    <>
                      <span aria-hidden="true" className="text-slate-500">·</span>
                      <span className="font-mono-tabular text-xs text-slate-300">
                        {offlineTracks.length} {offlineTracks.length === 1 ? 'song' : 'songs'} · {formatBytes(totalOfflineBytes)}
                      </span>
                    </>
                  )}
                </div>

                <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight">
                  {offlineTracks.length === 0
                    ? 'Import Your Downloaded Songs for Offline Playback'
                    : 'My Music — Downloaded Songs & Offline Player'}
                </h2>
                <p className="text-xs sm:text-sm text-slate-300 max-w-2xl leading-relaxed">
                  Grant access to your device Downloads or Music folder, or pick MP3/M4A/WAV/FLAC files. Everything is stored locally on this device so you can play songs and offline playlists anytime without internet.
                </p>

                {isScanning && scanStatusText && (
                  <div className="pt-1 flex items-center gap-2 text-xs font-medium text-emerald-300">
                    <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                    <span className="truncate">{scanStatusText}</span>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => void handleAllowStorageAndScan()}
                  disabled={isScanning}
                  className="h-10 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap transition-colors"
                >
                  <FolderOpen className="w-4 h-4" />
                  <span>Scan Music Folder</span>
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isScanning}
                  className="h-10 px-4 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] border border-white/10 text-white text-xs font-semibold inline-flex items-center gap-2 whitespace-nowrap transition-colors"
                >
                  <Upload className="w-4 h-4 text-emerald-400" />
                  <span>Pick Song Files</span>
                </button>
                <button
                  type="button"
                  onClick={() => folderInputRef.current?.click()}
                  disabled={isScanning}
                  className="hidden sm:inline-flex h-10 px-3.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-slate-200 text-xs font-medium items-center gap-1.5 whitespace-nowrap transition-colors"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  <span>Browse Folder</span>
                </button>
                {canRescanFolder && (
                  <button
                    type="button"
                    onClick={() => void rescanSavedFolder()}
                    disabled={isScanning}
                    className="h-10 px-3.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-slate-200 text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
                    <span>Rescan</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* My Music Sub-Tabs (Downloaded Songs | Offline Playlists | Download Sources) */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-1 p-1 rounded-xl bg-[#11131A] border border-white/[0.07] w-fit max-w-full overflow-x-auto no-scrollbar">
              <button
                type="button"
                onClick={() => setMyMusicView('songs')}
                className={`px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                  myMusicView === 'songs' ? 'bg-[#181B26] text-white shadow-sm' : 'text-slate-400 hover:text-white'
                }`}
              >
                Downloaded Songs ({offlineTracks.length})
              </button>
              <button
                type="button"
                onClick={() => setMyMusicView('playlists')}
                className={`px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                  myMusicView === 'playlists' ? 'bg-[#181B26] text-white shadow-sm' : 'text-slate-400 hover:text-white'
                }`}
              >
                Offline Playlists ({offlinePlaylists.length})
              </button>
              <button
                type="button"
                onClick={() => setMyMusicView('sources')}
                className={`px-3.5 py-2 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 transition-colors ${
                  myMusicView === 'sources'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-emerald-300 hover:text-white'
                }`}
              >
                <Globe className="w-3.5 h-3.5" />
                <span>Download Sources</span>
              </button>
            </div>

            {myMusicView === 'songs' && offlineTracks.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    playOfflineTrack(
                      filteredOfflineTracks[0] ?? offlineTracks[0],
                      filteredOfflineTracks.length > 0 ? filteredOfflineTracks : offlineTracks
                    )
                  }
                  className="h-9 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Play All</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleShuffleOfflinePlay(
                      filteredOfflineTracks.length > 0 ? filteredOfflineTracks : offlineTracks
                    )
                  }
                  className="h-9 px-3.5 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] text-white text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Shuffle className="w-3.5 h-3.5" />
                  <span>Shuffle</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMyMusicView('playlists');
                    setShowOfflinePlaylistBuilder(true);
                  }}
                  className="h-9 px-3.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] text-emerald-300 text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Make Playlist</span>
                </button>
              </div>
            ) : myMusicView === 'playlists' && offlineTracks.length > 0 ? (
              <button
                type="button"
                onClick={() => setShowOfflinePlaylistBuilder((v) => !v)}
                className="h-9 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 self-start sm:self-auto whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{showOfflinePlaylistBuilder ? 'Close Builder' : 'Create Offline Playlist'}</span>
              </button>
            ) : null}
          </div>

          {/* All-Rounder Multi-Source Search & Direct Audio URL Downloader */}
          {myMusicView === 'sources' && (
            <div className="space-y-6">
              {/* 1. Multi-Source Audio Search */}
              <div className="rounded-2xl bg-[#11131A] border border-white/[0.08] p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h3 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                      <Globe className="w-4 h-4 text-emerald-400" />
                      <span>Multi-Source Music Downloader</span>
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Search across JioSaavn HD, Audius, SoundCloud, and Internet Archive. One click saves to both Device Downloads & My Music.
                    </p>
                  </div>
                </div>

                <form onSubmit={handleSourceSearchSubmit} className="flex flex-col sm:flex-row gap-2.5">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={sourceQuery}
                      onChange={(e) => setSourceQuery(e.target.value)}
                      placeholder="Search any song, artist, remix, or audiobook across 4 sources..."
                      className="w-full h-11 pl-10 pr-4 rounded-xl bg-[#090A0F] border border-white/10 text-xs sm:text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isSearchingSources || !sourceQuery.trim()}
                    className="h-11 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs font-semibold text-white inline-flex items-center justify-center gap-2 shrink-0 whitespace-nowrap transition-colors"
                  >
                    {isSearchingSources ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Search className="w-4 h-4" />
                    )}
                    <span>Search Sources</span>
                  </button>
                </form>

                {/* Provider Filter Switcher */}
                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
                  {(
                    [
                      { id: 'all', label: 'All Sources' },
                      { id: 'jiosaavn', label: 'JioSaavn' },
                      { id: 'audius', label: 'Audius' },
                      { id: 'soundcloud', label: 'SoundCloud' },
                      { id: 'archive', label: 'Internet Archive' },
                    ] as const
                  ).map((prov) => {
                    const active = sourceProvider === prov.id;
                    return (
                      <button
                        key={prov.id}
                        type="button"
                        onClick={() => {
                          setSourceProvider(prov.id);
                          if (sourceQuery.trim()) {
                            void runSourceSearch(sourceQuery, prov.id);
                          }
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors border ${
                          active
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                            : 'bg-[#090A0F] text-slate-400 hover:text-white border-white/[0.07]'
                        }`}
                      >
                        {prov.label}
                      </button>
                    );
                  })}
                </div>

                {sourceSearchError && (
                  <p className="text-xs text-rose-400">{sourceSearchError}</p>
                )}

                {isSearchingSources ? (
                  <div className="space-y-2 pt-1">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="h-14 rounded-xl bg-white/[0.04] animate-pulse" />
                    ))}
                  </div>
                ) : sourceResults.length > 0 ? (
                  <div className="space-y-2 pt-1">
                    {sourceResults.map((item) => {
                      const asTrack = multiSourceToTrack(item);
                      const isDl = Boolean(downloadingIds[item.id]);
                      const dlProg = downloadProgressMap[item.id];
                      const alreadySaved = isTrackSavedOffline(item.id);

                      return (
                        <div
                          key={item.id}
                          className="flex items-center gap-3 p-2.5 sm:p-3 rounded-xl bg-[#0D0F16] border border-white/[0.06] hover:border-white/[0.14] transition-colors"
                        >
                          <button
                            type="button"
                            onClick={() =>
                              playTrack(asTrack, sourceResults.map(multiSourceToTrack))
                            }
                            aria-label={`Play ${item.title}`}
                            className="relative w-12 h-12 rounded-lg overflow-hidden bg-[#181B26] shrink-0 flex items-center justify-center group"
                          >
                            {item.thumbnail ? (
                              <img
                                src={item.thumbnail}
                                alt={item.title}
                                referrerPolicy="no-referrer"
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <Music2 className="w-5 h-5 text-slate-400" />
                            )}
                            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                              <Play className="w-4 h-4 text-white fill-current ml-0.5" />
                            </div>
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              playTrack(asTrack, sourceResults.map(multiSourceToTrack))
                            }
                            className="min-w-0 flex-1 text-left"
                          >
                            <p className="text-xs sm:text-sm font-semibold text-white line-clamp-1 break-words">
                              {item.title}
                            </p>
                            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] sm:text-xs text-slate-300 mt-0.5">
                              <span className="truncate max-w-[160px] sm:max-w-none">{item.artist}</span>
                              <span aria-hidden="true" className="text-slate-500">·</span>
                              <span className="text-emerald-300 font-medium whitespace-nowrap">
                                {item.sourceLabel}
                              </span>
                              {item.duration && item.duration !== '--:--' && (
                                <>
                                  <span aria-hidden="true" className="text-slate-500">·</span>
                                  <span className="font-mono-tabular text-slate-400 whitespace-nowrap">
                                    {item.duration}
                                  </span>
                                </>
                              )}
                            </div>
                            {dlProg && (
                              <div className="mt-1.5 space-y-1 max-w-xs">
                                <div className="w-full h-1 rounded-full bg-white/10 overflow-hidden">
                                  <div
                                    className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-[#4F6BFF] transition-all"
                                    style={{ width: `${Math.max(5, dlProg.percent)}%` }}
                                  />
                                </div>
                                <p className="font-mono-tabular text-[10px] text-emerald-300">
                                  {dlProg.percent}%
                                  {dlProg.totalBytes > 0
                                    ? ` · ${formatBytes(dlProg.loadedBytes)} / ${formatBytes(dlProg.totalBytes)} (${formatBytes(dlProg.remainingBytes)} left)`
                                    : dlProg.loadedBytes > 0
                                      ? ` · ${formatBytes(dlProg.loadedBytes)}`
                                      : ''}
                                </p>
                              </div>
                            )}
                          </button>

                          <button
                            type="button"
                            disabled={isDl}
                            onClick={() => void saveOnlineTrack(asTrack, true)}
                            className={`h-9 sm:h-10 px-3 sm:px-3.5 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 shrink-0 whitespace-nowrap transition-colors ${
                              isDl
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                : alreadySaved
                                  ? 'bg-white/[0.08] hover:bg-white/[0.14] text-emerald-300 border border-emerald-500/30'
                                  : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                            }`}
                          >
                            {isDl ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                <span className="font-mono-tabular">{dlProg?.percent ?? 0}%</span>
                              </>
                            ) : alreadySaved ? (
                              <>
                                <Check className="w-3.5 h-3.5" />
                                <span className="hidden sm:inline">Device File</span>
                              </>
                            ) : (
                              <>
                                <Download className="w-3.5 h-3.5" />
                                <span>Download</span>
                              </>
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : hasSearchedSources ? (
                  <p className="text-xs text-slate-400 py-4 text-center">
                    No matching tracks found across selected sources. Try another song title or artist name.
                  </p>
                ) : null}
              </div>

              {/* 2. Direct Audio URL Downloader */}
              <form
                onSubmit={handleDirectUrlSubmit}
                className="rounded-2xl bg-[#11131A] border border-white/[0.08] p-5 space-y-4"
              >
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Link2 className="w-4 h-4 text-[#7A90FF]" />
                    <span>Download from Direct Audio Link</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Paste any direct MP3, M4A, WAV, OGG, or FLAC audio URL to save it to My Music and your Device Downloads with live progress.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <input
                    type="url"
                    required
                    value={directUrl}
                    onChange={(e) => setDirectUrl(e.target.value)}
                    placeholder="https://example.com/song.mp3"
                    className="sm:col-span-2 h-11 px-3.5 rounded-xl bg-[#090A0F] border border-white/10 text-xs sm:text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#4F6BFF]"
                  />
                  <input
                    type="text"
                    value={directTitle}
                    onChange={(e) => setDirectTitle(e.target.value)}
                    placeholder="Song title (optional)"
                    className="h-11 px-3.5 rounded-xl bg-[#090A0F] border border-white/10 text-xs sm:text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#4F6BFF]"
                  />
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={directAlsoDevice}
                      onChange={(e) => setDirectAlsoDevice(e.target.checked)}
                      className="rounded border-white/20 bg-[#090A0F] text-emerald-500 focus:ring-emerald-500"
                    />
                    <span>Save to both Device Downloads & My Music</span>
                  </label>

                  <button
                    type="submit"
                    disabled={!directUrl.trim() || activeUrlDownloads.length > 0}
                    className="h-10 px-4 rounded-xl bg-[#4F6BFF] hover:bg-[#415CE6] disabled:opacity-50 text-xs font-semibold text-white inline-flex items-center justify-center gap-2 self-start sm:self-auto whitespace-nowrap transition-colors"
                  >
                    {activeUrlDownloads.length > 0 ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="font-mono-tabular">
                          Downloading {activeUrlDownloads[0].percent}%
                        </span>
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4" />
                        <span>Download Audio Link</span>
                      </>
                    )}
                  </button>
                </div>

                {activeUrlDownloads.map((item) => (
                  <div
                    key={item.trackId}
                    className="rounded-xl bg-[#090A0F] border border-white/[0.08] p-3 space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-white truncate">{item.title}</span>
                      <span className="font-mono-tabular font-bold text-emerald-300 shrink-0">
                        {item.percent}%
                      </span>
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-[#4F6BFF] transition-all"
                        style={{ width: `${Math.max(5, item.percent)}%` }}
                      />
                    </div>
                    <p className="font-mono-tabular text-[11px] text-slate-400">
                      {item.totalBytes > 0
                        ? `${formatBytes(item.loadedBytes)} / ${formatBytes(item.totalBytes)} · ${formatBytes(item.remainingBytes)} remaining`
                        : `${formatBytes(item.loadedBytes)} downloaded`}
                    </p>
                  </div>
                ))}
              </form>
            </div>
          )}

          {/* Downloaded Songs List View */}
          {myMusicView === 'songs' && offlineTracks.length === 0 && (
            <div className="rounded-2xl bg-[#11131A] border border-white/[0.07] p-8 sm:p-10 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center mx-auto">
                <HardDrive className="w-6 h-6" />
              </div>
              <h3 className="text-base font-semibold text-white">No downloaded songs in My Music yet</h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                Click the Download button on any song across VIBRA, search JioSaavn / Audius / SoundCloud / Internet Archive, or import files from your device storage.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setMyMusicView('sources')}
                  className="h-10 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white inline-flex items-center gap-2"
                >
                  <Globe className="w-4 h-4" />
                  <span>Open Download Sources</span>
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="h-10 px-4 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] text-xs font-semibold text-white inline-flex items-center gap-2"
                >
                  <Upload className="w-4 h-4 text-emerald-400" />
                  <span>Pick Device Songs</span>
                </button>
              </div>
            </div>
          )}

          {/* Offline Playlists Empty State when 0 songs */}
          {myMusicView === 'playlists' && offlineTracks.length === 0 && (
            <div className="rounded-2xl bg-[#11131A] border border-white/[0.07] p-8 sm:p-10 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center mx-auto">
                <FolderHeart className="w-6 h-6" />
              </div>
              <h3 className="text-base font-semibold text-white">Download songs first for Offline Playlists</h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                Download songs from VIBRA, use Download Sources, or import files from your device to group them into offline playlists.
              </p>
              <button
                type="button"
                onClick={() => setMyMusicView('sources')}
                className="h-10 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white inline-flex items-center gap-2"
              >
                <Globe className="w-4 h-4" />
                <span>Find & Download Songs</span>
              </button>
            </div>
          )}

          {offlineTracks.length > 0 && (
            <>
              {/* Downloaded Songs List View */}
              {myMusicView === 'songs' && (
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="relative flex-1 max-w-md">
                      <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        value={offlineQuery}
                        onChange={(e) => setOfflineQuery(e.target.value)}
                        placeholder="Filter downloaded songs by name, artist, or album..."
                        className="w-full h-10 pl-10 pr-4 rounded-xl bg-[#11131A] border border-white/[0.08] text-xs sm:text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        if (
                          await confirm({
                            title: 'Delete All Offline Songs?',
                            message: `This will permanently delete all ${offlineTracks.length} downloaded/imported songs from My Music on this device. This action cannot be undone.`,
                            confirmText: 'Delete All',
                          })
                        ) {
                          await clearAllOfflineTracks();
                        }
                      }}
                      className="text-xs text-slate-400 hover:text-rose-400 self-start sm:self-auto"
                    >
                      Clear all downloaded songs
                    </button>
                  </div>

                  {filteredOfflineTracks.length === 0 ? (
                    <div className="rounded-2xl bg-[#11131A] border border-white/[0.07] p-8 text-center text-sm text-slate-400">
                      No downloaded songs match "{offlineQuery}".
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {filteredOfflineTracks.map((track, idx) => {
                        const isActive = activeOfflineTrack?.id === track.id;
                        const isActivePlaying = isActive && isOfflinePlaying;
                        const savedResume =
                          trackPositions[track.id] ||
                          (track.sourceVideoId ? trackPositions[track.sourceVideoId] : undefined);
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
                        return (
                          <div
                            key={track.id}
                            className={`group flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors ${
                              isActive
                                ? 'bg-emerald-500/10 border-emerald-500/35'
                                : 'bg-[#11131A]/80 border-white/[0.06] hover:bg-[#181B26] hover:border-white/[0.12]'
                            }`}
                          >
                            <span className="hidden sm:inline-block w-6 text-center font-mono-tabular text-xs text-slate-500 shrink-0">
                              {idx + 1}
                            </span>

                            <button
                              type="button"
                              onClick={() =>
                                isActive
                                  ? toggleOfflinePlay()
                                  : playOfflineTrack(track, filteredOfflineTracks)
                              }
                              aria-label={isActivePlaying ? `Pause ${track.title}` : `Play ${track.title}`}
                              className="relative w-11 h-11 rounded-lg overflow-hidden bg-[#181B26] border border-white/[0.08] shrink-0 flex items-center justify-center text-emerald-400"
                            >
                              {track.artworkDataUrl ? (
                                <img
                                  src={track.artworkDataUrl}
                                  alt={track.title}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <Disc3 className={`w-5 h-5 ${isActivePlaying ? 'animate-[spin_8s_linear_infinite]' : ''}`} />
                              )}
                              <div
                                className={`absolute inset-0 bg-black/55 flex items-center justify-center transition-opacity ${
                                  isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                                }`}
                              >
                                {isActivePlaying ? (
                                  <Pause className="w-4 h-4 text-white fill-current" />
                                ) : (
                                  <Play className="w-4 h-4 text-white fill-current ml-0.5" />
                                )}
                              </div>
                              {hasResume && (
                                <div className="absolute inset-x-0 bottom-0 h-1 bg-black/65">
                                  <div
                                    className="h-full bg-emerald-400"
                                    style={{ width: `${resumePercent}%` }}
                                  />
                                </div>
                              )}
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                isActive
                                  ? toggleOfflinePlay()
                                  : playOfflineTrack(track, filteredOfflineTracks)
                              }
                              className="min-w-0 flex-1 text-left"
                            >
                              <p
                                className={`text-[13px] sm:text-[15px] font-semibold line-clamp-2 break-words leading-snug ${
                                  isActive ? 'text-emerald-300' : 'text-white'
                                }`}
                              >
                                {track.title}
                              </p>
                              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-300 mt-0.5">
                                <span className="line-clamp-1 break-words">{track.artist}</span>
                                <span aria-hidden="true" className="text-slate-500">·</span>
                                <span className="font-mono-tabular text-slate-400 whitespace-nowrap">
                                  {formatBytes(track.sizeBytes)}
                                </span>
                                {track.duration && track.duration !== '--:--' && (
                                  <>
                                    <span aria-hidden="true" className="text-slate-500">·</span>
                                    <span className="font-mono-tabular text-slate-400 whitespace-nowrap">
                                      {track.duration}
                                    </span>
                                  </>
                                )}
                                {hasResume && savedResume && (
                                  <>
                                    <span aria-hidden="true" className="text-slate-500">·</span>
                                    <span className="font-mono-tabular font-semibold text-emerald-300 whitespace-nowrap">
                                      Resume {formatSeconds(savedResume.positionSeconds)}
                                    </span>
                                  </>
                                )}
                              </div>
                            </button>

                            <div className="flex items-center gap-0.5 shrink-0">
                              {hasResume && (
                                <button
                                  type="button"
                                  onClick={() => playOfflineTrack(track, filteredOfflineTracks, 0)}
                                  aria-label={`Restart ${track.title} from 0:00`}
                                  title="Start Over (0:00)"
                                  className="min-h-[40px] min-w-[38px] flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
                                >
                                  <RotateCcw className="w-3.5 h-3.5" />
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => playNextInOfflineQueue(track)}
                                aria-label={`Play ${track.title} next`}
                                title="Play Next"
                                className="hidden md:flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
                              >
                                <Play className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => addToOfflineQueue(track)}
                                aria-label={`Add ${track.title} to offline queue`}
                                title="Add to Offline Queue"
                                className="hidden sm:flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
                              >
                                <ListPlus className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => void exportTrackToDevice(track)}
                                aria-label={`Save ${track.title} file to device Downloads`}
                                title="Save audio file to Device Downloads"
                                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-300 hover:text-emerald-300 hover:bg-white/5 transition-colors"
                              >
                                <Download className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => onAddToOfflinePlaylist(track)}
                                aria-label={`Add ${track.title} to offline playlist`}
                                title="Add to Offline Playlist"
                                className="min-h-[40px] min-w-[40px] px-2.5 flex items-center justify-center gap-1.5 rounded-lg bg-white/[0.05] hover:bg-emerald-500/20 border border-white/[0.08] hover:border-emerald-500/40 text-xs font-medium text-slate-200 hover:text-white transition-colors"
                              >
                                <PlusSquare className="w-3.5 h-3.5 text-emerald-400" />
                                <span className="hidden md:inline">Playlist</span>
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  if (
                                    await confirm({
                                      title: 'Delete Offline Song?',
                                      message: `Remove "${track.title}" from My Music on this device?`,
                                      confirmText: 'Delete',
                                    })
                                  ) {
                                    await deleteOfflineTrack(track.id);
                                  }
                                }}
                                aria-label={`Delete ${track.title} from My Music`}
                                title="Remove from My Music"
                                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-400 hover:bg-white/5 transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Offline Playlists View */}
              {myMusicView === 'playlists' && (
                <div className="space-y-6">
                  {showOfflinePlaylistBuilder && (
                    <form
                      onSubmit={handleCreateOfflinePlaylist}
                      className="rounded-2xl bg-[#11131A] border border-emerald-500/30 p-5 space-y-4"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="text-sm sm:text-base font-bold text-white">
                          Create Playlist from Downloaded Songs
                        </h3>
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedBuilderTrackIds((prev) =>
                              prev.length === offlineTracks.length ? [] : offlineTracks.map((t) => t.id)
                            )
                          }
                          className="text-xs font-semibold text-emerald-400 hover:text-emerald-300"
                        >
                          {selectedBuilderTrackIds.length === offlineTracks.length
                            ? 'Clear Selection'
                            : 'Select All Songs'}
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <input
                          type="text"
                          value={newOfflinePlName}
                          onChange={(e) => setNewOfflinePlName(e.target.value)}
                          placeholder="Offline playlist name (e.g. Road Trip Offline)"
                          className="h-11 px-3.5 rounded-xl bg-[#090A0F] border border-white/10 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
                        />
                        <input
                          type="text"
                          value={newOfflinePlDesc}
                          onChange={(e) => setNewOfflinePlDesc(e.target.value)}
                          placeholder="Description (optional)"
                          className="h-11 px-3.5 rounded-xl bg-[#090A0F] border border-white/10 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-slate-400">
                          Pick downloaded songs ({selectedBuilderTrackIds.length} selected)
                        </p>
                        <div className="max-h-60 overflow-y-auto rounded-xl border border-white/[0.07] bg-[#090A0F] p-2 space-y-1">
                          {offlineTracks.map((t) => {
                            const checked = selectedBuilderTrackIds.includes(t.id);
                            return (
                              <button
                                key={t.id}
                                type="button"
                                onClick={() => handleToggleBuilderTrack(t.id)}
                                className={`w-full px-3 py-2 rounded-lg flex items-center justify-between gap-3 text-left transition-colors ${
                                  checked ? 'bg-emerald-500/15' : 'hover:bg-white/[0.04]'
                                }`}
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="text-xs sm:text-sm font-medium text-white truncate">
                                    {t.title}
                                  </p>
                                  <p className="text-[11px] text-slate-400 truncate">
                                    {t.artist} · {t.duration}
                                  </p>
                                </div>
                                <span
                                  className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 ${
                                    checked
                                      ? 'bg-emerald-500 text-white'
                                      : 'border border-white/20 text-transparent'
                                  }`}
                                >
                                  <Check className="w-3.5 h-3.5" />
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="submit"
                          disabled={!newOfflinePlName.trim()}
                          className="h-10 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-45 text-xs font-semibold text-white"
                        >
                          Save Offline Playlist ({selectedBuilderTrackIds.length})
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowOfflinePlaylistBuilder(false)}
                          className="h-10 px-4 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-xs font-medium text-slate-300"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  )}

                  {offlinePlaylists.length === 0 ? (
                    <div className="rounded-2xl bg-[#11131A] border border-white/[0.07] p-10 text-center space-y-3">
                      <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center mx-auto">
                        <FolderHeart className="w-6 h-6" />
                      </div>
                      <h3 className="text-base font-semibold text-white">No offline playlists yet</h3>
                      <p className="text-xs text-slate-400 max-w-md mx-auto">
                        Group your downloaded songs into custom offline playlists and play them continuously with screen off or without internet.
                      </p>
                      <button
                        type="button"
                        onClick={() => setShowOfflinePlaylistBuilder(true)}
                        className="h-10 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white inline-flex items-center gap-2"
                      >
                        <Plus className="w-4 h-4" />
                        <span>Create Offline Playlist</span>
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-5 lg:gap-6">
                      {/* Offline Playlist List */}
                      <div className="md:col-span-5 lg:col-span-4 space-y-2.5">
                        {offlinePlaylists.map((pl) => {
                          const active = selectedOfflinePlaylist?.id === pl.id;
                          const resolvedCount = pl.trackIds.filter((id) => offlineTrackMap.has(id)).length;
                          return (
                            <div
                              key={pl.id}
                              className={`rounded-xl border p-3.5 transition-colors ${
                                active
                                  ? 'bg-emerald-500/10 border-emerald-500/40'
                                  : 'bg-[#11131A] border-white/[0.07] hover:border-white/15'
                              }`}
                            >
                              {editingOfflinePlId === pl.id ? (
                                <form
                                  onSubmit={(e) => {
                                    e.preventDefault();
                                    renameOfflinePlaylist(pl.id, editOfflinePlName);
                                    setEditingOfflinePlId(null);
                                  }}
                                  className="flex items-center gap-2"
                                >
                                  <input
                                    type="text"
                                    value={editOfflinePlName}
                                    onChange={(e) => setEditOfflinePlName(e.target.value)}
                                    autoFocus
                                    className="flex-1 h-9 px-2.5 rounded-lg bg-[#090A0F] border border-white/15 text-xs text-white"
                                  />
                                  <button
                                    type="submit"
                                    className="h-9 px-3 rounded-lg bg-emerald-600 text-xs font-medium text-white"
                                  >
                                    Save
                                  </button>
                                </form>
                              ) : (
                                <div className="flex items-center justify-between gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setSelectedOfflinePlaylistId(pl.id)}
                                    className="flex items-center gap-3 min-w-0 flex-1 text-left"
                                  >
                                    <div className="w-11 h-11 rounded-lg bg-[#181B26] overflow-hidden shrink-0 flex items-center justify-center text-emerald-400">
                                      <FolderHeart className="w-5 h-5" />
                                    </div>
                                    <div className="min-w-0">
                                      <p className="text-sm font-semibold text-white truncate">{pl.name}</p>
                                      <p className="text-xs text-slate-400 font-mono-tabular">
                                        {resolvedCount} {resolvedCount === 1 ? 'song' : 'songs'}
                                      </p>
                                    </div>
                                  </button>

                                  <div className="flex items-center shrink-0">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingOfflinePlId(pl.id);
                                        setEditOfflinePlName(pl.name);
                                      }}
                                      aria-label={`Rename ${pl.name}`}
                                      className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/5"
                                    >
                                      <Edit3 className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        if (
                                          await confirm({
                                            title: 'Delete Offline Playlist?',
                                            message: `Delete "${pl.name}"? Your downloaded songs will stay in My Music.`,
                                            confirmText: 'Delete Playlist',
                                          })
                                        ) {
                                          deleteOfflinePlaylist(pl.id);
                                          if (selectedOfflinePlaylistId === pl.id) {
                                            setSelectedOfflinePlaylistId(null);
                                          }
                                        }
                                      }}
                                      aria-label={`Delete ${pl.name}`}
                                      className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-400 hover:bg-white/5"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* Selected Offline Playlist Detail */}
                      <div className="md:col-span-7 lg:col-span-8">
                        {selectedOfflinePlaylist ? (
                          (() => {
                            const plTracks = selectedOfflinePlaylist.trackIds
                              .map((id) => offlineTrackMap.get(id))
                              .filter((t): t is OfflineTrack => Boolean(t));
                            return (
                              <div className="rounded-2xl bg-[#11131A] border border-white/[0.08] p-5 space-y-5">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-white/[0.07]">
                                  <div>
                                    <h3 className="text-xl font-bold text-white">
                                      {selectedOfflinePlaylist.name}
                                    </h3>
                                    {selectedOfflinePlaylist.description && (
                                      <p className="text-xs text-slate-400 mt-1">
                                        {selectedOfflinePlaylist.description}
                                      </p>
                                    )}
                                  </div>
                                  {plTracks.length > 0 && (
                                    <div className="flex items-center gap-2 shrink-0">
                                      <button
                                        type="button"
                                        onClick={() => playOfflineTrack(plTracks[0], plTracks)}
                                        className="h-9 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white inline-flex items-center gap-1.5"
                                      >
                                        <Play className="w-3.5 h-3.5 fill-current" />
                                        <span>Play All</span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleShuffleOfflinePlay(plTracks)}
                                        className="h-9 px-3.5 rounded-xl bg-white/[0.07] hover:bg-white/[0.12] text-xs font-medium text-white inline-flex items-center gap-1.5"
                                      >
                                        <Shuffle className="w-3.5 h-3.5" />
                                        <span>Shuffle</span>
                                      </button>
                                    </div>
                                  )}
                                </div>

                                {plTracks.length === 0 ? (
                                  <div className="py-10 text-center space-y-3">
                                    <p className="text-sm text-slate-400">
                                      No downloaded songs in this offline playlist yet.
                                    </p>
                                    <button
                                      type="button"
                                      onClick={() => setMyMusicView('songs')}
                                      className="h-9 px-4 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] text-xs font-medium text-white inline-flex items-center gap-1.5"
                                    >
                                      <PlusSquare className="w-3.5 h-3.5 text-emerald-400" />
                                      <span>Add from Downloaded Songs</span>
                                    </button>
                                  </div>
                                ) : (
                                  <div className="space-y-2">
                                    {plTracks.map((t, idx) => {
                                      const active = activeOfflineTrack?.id === t.id;
                                      const activePlaying = active && isOfflinePlaying;
                                      const savedResume =
                                        trackPositions[t.id] ||
                                        (t.sourceVideoId ? trackPositions[t.sourceVideoId] : undefined);
                                      const hasResume = Boolean(savedResume && savedResume.positionSeconds >= 3);
                                      return (
                                        <div
                                          key={t.id}
                                          className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors ${
                                            active
                                              ? 'bg-emerald-500/10 border-emerald-500/35'
                                              : 'bg-[#0D0F16] border-white/[0.05] hover:bg-[#181B26]'
                                          }`}
                                        >
                                          <span className="w-5 text-center font-mono-tabular text-xs text-slate-500 shrink-0">
                                            {idx + 1}
                                          </span>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              active ? toggleOfflinePlay() : playOfflineTrack(t, plTracks)
                                            }
                                            className="w-9 h-9 rounded-lg bg-[#181B26] flex items-center justify-center text-emerald-400 shrink-0"
                                            aria-label={activePlaying ? `Pause ${t.title}` : `Play ${t.title}`}
                                          >
                                            {activePlaying ? (
                                              <Pause className="w-4 h-4 fill-current" />
                                            ) : (
                                              <Play className="w-4 h-4 fill-current ml-0.5" />
                                            )}
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() =>
                                              active ? toggleOfflinePlay() : playOfflineTrack(t, plTracks)
                                            }
                                            className="min-w-0 flex-1 text-left"
                                          >
                                            <p
                                              className={`text-sm font-semibold truncate ${
                                                active ? 'text-emerald-300' : 'text-white'
                                              }`}
                                            >
                                              {t.title}
                                            </p>
                                            <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-slate-400">
                                              <span className="truncate">{t.artist} · {t.duration}</span>
                                              {hasResume && savedResume && (
                                                <>
                                                  <span aria-hidden="true" className="text-slate-500">·</span>
                                                  <span className="font-mono-tabular font-semibold text-emerald-300 whitespace-nowrap">
                                                    Resume {formatSeconds(savedResume.positionSeconds)}
                                                  </span>
                                                </>
                                              )}
                                            </div>
                                          </button>
                                          {hasResume && (
                                            <button
                                              type="button"
                                              onClick={() => playOfflineTrack(t, plTracks, 0)}
                                              aria-label={`Restart ${t.title} from 0:00`}
                                              title="Start Over (0:00)"
                                              className="min-h-[40px] min-w-[38px] flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/5"
                                            >
                                              <RotateCcw className="w-3.5 h-3.5" />
                                            </button>
                                          )}
                                          <button
                                            type="button"
                                            onClick={async () => {
                                              if (
                                                await confirm({
                                                  title: 'Remove Song from Playlist?',
                                                  message: `Remove "${t.title}" from "${selectedOfflinePlaylist.name}"?`,
                                                  confirmText: 'Remove',
                                                })
                                              ) {
                                                removeTrackFromOfflinePlaylist(
                                                  selectedOfflinePlaylist.id,
                                                  t.id
                                                );
                                              }
                                            }}
                                            aria-label={`Remove ${t.title} from offline playlist`}
                                            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-400 hover:bg-white/5"
                                          >
                                            <Trash2 className="w-4 h-4" />
                                          </button>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })()
                        ) : null}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Create Playlist Form */}
      {showCreateForm && sectionTab === 'playlists' && (
        <form
          onSubmit={handleCreatePlaylist}
          className="rounded-2xl bg-[#11131A] border border-white/10 p-5 space-y-3 max-w-lg"
        >
          <h3 className="text-sm font-semibold text-white">Create a Custom Playlist</h3>
          <input
            type="text"
            value={newPlaylistName}
            onChange={(e) => setNewPlaylistName(e.target.value)}
            placeholder="Playlist name"
            className="w-full h-11 px-3.5 rounded-xl bg-[#090A0F] border border-white/10 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#4F6BFF]"
          />
          <input
            type="text"
            value={newPlaylistDesc}
            onChange={(e) => setNewPlaylistDesc(e.target.value)}
            placeholder="Description (optional)"
            className="w-full h-11 px-3.5 rounded-xl bg-[#090A0F] border border-white/10 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-[#4F6BFF]"
          />
          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={!newPlaylistName.trim()}
              className="h-10 px-4 rounded-xl bg-[#4F6BFF] hover:bg-[#415CE6] disabled:opacity-45 text-xs font-semibold text-white"
            >
              Create Playlist
            </button>
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="h-10 px-4 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-xs font-medium text-slate-300"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Playlists Tab */}
      {sectionTab === 'playlists' && (
        <div className="space-y-6">
          {playlists.length === 0 ? (
            <div className="rounded-2xl bg-[#11131A] border border-white/[0.07] p-10 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-[#4F6BFF]/15 text-[#7A90FF] flex items-center justify-center mx-auto">
                <ListMusic className="w-6 h-6" />
              </div>
              <h3 className="text-base font-semibold text-white">No custom playlists yet</h3>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                Create a playlist above or click the add-to-playlist icon on any song card.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-12 gap-5 lg:gap-6">
              {/* Playlist List */}
              <div className="md:col-span-5 lg:col-span-4 space-y-2.5">
                {playlists.map((pl) => {
                  const active = selectedPlaylist?.id === pl.id;
                  return (
                    <div
                      key={pl.id}
                      className={`rounded-xl border p-3.5 transition-colors ${
                        active
                          ? 'bg-[#4F6BFF]/10 border-[#4F6BFF]/40'
                          : 'bg-[#11131A] border-white/[0.07] hover:border-white/15'
                      }`}
                    >
                      {editingPlaylistId === pl.id ? (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            renamePlaylist(pl.id, editName);
                            setEditingPlaylistId(null);
                          }}
                          className="flex items-center gap-2"
                        >
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            autoFocus
                            className="flex-1 h-9 px-2.5 rounded-lg bg-[#090A0F] border border-white/15 text-xs text-white"
                          />
                          <button
                            type="submit"
                            className="h-9 px-3 rounded-lg bg-[#4F6BFF] text-xs font-medium text-white"
                          >
                            Save
                          </button>
                        </form>
                      ) : (
                        <div className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedPlaylistId(pl.id)}
                            className="flex items-center gap-3 min-w-0 flex-1 text-left"
                          >
                            <div className="w-11 h-11 rounded-lg bg-[#181B26] overflow-hidden shrink-0 flex items-center justify-center text-[#7A90FF]">
                              {pl.tracks[0]?.thumbnail ? (
                                <img
                                  src={pl.tracks[0].thumbnail}
                                  alt={pl.name}
                                  referrerPolicy="no-referrer"
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <ListMusic className="w-5 h-5" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-white truncate">{pl.name}</p>
                              <p className="text-xs text-slate-400 font-mono-tabular">
                                {pl.tracks.length} {pl.tracks.length === 1 ? 'track' : 'tracks'}
                              </p>
                            </div>
                          </button>

                          <div className="flex items-center shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingPlaylistId(pl.id);
                                setEditName(pl.name);
                              }}
                              aria-label={`Rename ${pl.name}`}
                              className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/5"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                if (
                                  await confirm({
                                    title: 'Delete Playlist?',
                                    message: `Permanently delete "${pl.name}" (${pl.tracks.length} ${pl.tracks.length === 1 ? 'track' : 'tracks'})?`,
                                    confirmText: 'Delete Playlist',
                                  })
                                ) {
                                  deletePlaylist(pl.id);
                                  if (selectedPlaylistId === pl.id) setSelectedPlaylistId(null);
                                }
                              }}
                              aria-label={`Delete ${pl.name}`}
                              className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-400 hover:bg-white/5"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Selected Playlist Detail */}
              <div className="md:col-span-7 lg:col-span-8">
                {selectedPlaylist ? (
                  <div className="rounded-2xl bg-[#11131A] border border-white/[0.08] p-5 space-y-5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-white/[0.07]">
                      <div>
                        <h3 className="text-xl font-bold text-white">{selectedPlaylist.name}</h3>
                        {selectedPlaylist.description && (
                          <p className="text-xs text-slate-400 mt-1">{selectedPlaylist.description}</p>
                        )}
                      </div>
                      {selectedPlaylist.tracks.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => playTrack(selectedPlaylist.tracks[0], selectedPlaylist.tracks)}
                            className="h-9 px-3.5 rounded-xl bg-[#4F6BFF] hover:bg-[#415CE6] text-xs font-semibold text-white inline-flex items-center gap-1.5"
                          >
                            <Play className="w-3.5 h-3.5 fill-current" />
                            <span>Play All</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleShufflePlay(selectedPlaylist.tracks)}
                            className="h-9 px-3.5 rounded-xl bg-white/[0.07] hover:bg-white/[0.12] text-xs font-medium text-white inline-flex items-center gap-1.5"
                          >
                            <Shuffle className="w-3.5 h-3.5" />
                            <span>Shuffle</span>
                          </button>
                          {selectedPlaylist.tracks.some((t) => !t.isOffline) && (
                            <button
                              type="button"
                              disabled={isBatchDownloading}
                              onClick={() =>
                                void batchDownloadTracks(
                                  selectedPlaylist.tracks.filter((t) => !t.isOffline),
                                  selectedPlaylist.name,
                                  false
                                )
                              }
                              className="h-9 px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-xs font-semibold text-white inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
                            >
                              {isBatchDownloading &&
                              batchDownloadState?.label === selectedPlaylist.name ? (
                                <>
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                  <span className="font-mono-tabular">
                                    {batchDownloadState.completed}/{batchDownloadState.total}
                                  </span>
                                </>
                              ) : (
                                <>
                                  <Download className="w-3.5 h-3.5" />
                                  <span>Download Playlist</span>
                                </>
                              )}
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {selectedPlaylist.tracks.length === 0 ? (
                      <div className="py-10 text-center space-y-3">
                        <p className="text-sm text-slate-400">This playlist has no tracks yet.</p>
                        <button
                          type="button"
                          onClick={() => onNavigate('search')}
                          className="h-9 px-4 rounded-xl bg-white/[0.08] hover:bg-white/[0.14] text-xs font-medium text-white inline-flex items-center gap-1.5"
                        >
                          <Search className="w-3.5 h-3.5" />
                          <span>Find Songs to Add</span>
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {selectedPlaylist.tracks.map((track, idx) => (
                          <TrackRow
                            key={track.id}
                            track={track}
                            index={idx}
                            queueContext={selectedPlaylist.tracks}
                            onAddToPlaylist={onAddToPlaylist}
                            rightAction={
                              <button
                                type="button"
                                onClick={async () => {
                                  if (
                                    await confirm({
                                      title: 'Remove Track?',
                                      message: `Remove "${track.title}" from "${selectedPlaylist.name}"?`,
                                      confirmText: 'Remove',
                                    })
                                  ) {
                                    removeTrackFromPlaylist(selectedPlaylist.id, track.id);
                                  }
                                }}
                                aria-label={`Remove ${track.title} from playlist`}
                                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-400 hover:bg-white/5"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            }
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded-2xl bg-[#11131A] border border-white/[0.06] p-10 text-center text-sm text-slate-400">
                    Select a playlist on the left to inspect or play its tracks.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Recently Played Tab */}
      {sectionTab === 'recent' && (
        <div className="space-y-4">
          {recentlyPlayed.length > 0 && (
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-400">Tracks played on this device with timestamps</p>
              <button
                type="button"
                onClick={async () => {
                  if (
                    await confirm({
                      title: 'Clear Recently Played?',
                      message: `Remove all ${recentlyPlayed.length} recently played entries from this device?`,
                      confirmText: 'Clear History',
                    })
                  ) {
                    clearRecentlyPlayed();
                  }
                }}
                className="text-xs text-slate-400 hover:text-rose-400"
              >
                Clear history
              </button>
            </div>
          )}

          {recentlyPlayed.length === 0 ? (
            <div className="rounded-2xl bg-[#11131A] border border-white/[0.07] p-10 text-center space-y-2">
              <Clock className="w-8 h-8 text-slate-500 mx-auto" />
              <p className="text-sm font-medium text-white">No listening history yet</p>
              <p className="text-xs text-slate-400">Play any song or music video to track it here.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {recentlyPlayed.map((item, idx) => (
                <TrackRow
                  key={`${item.track.id}_${item.playedAt}`}
                  track={item.track}
                  index={idx}
                  queueContext={recentlyPlayed.map((r) => r.track)}
                  onAddToPlaylist={onAddToPlaylist}
                  timestampLabel={formatRelativeTime(item.playedAt)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Listening Statistics Tab */}
      {sectionTab === 'stats' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs text-slate-400">
              Real playback metrics recorded from your listening sessions on this browser
            </p>
            {listeningStats.totalPlays > 0 && (
              <button
                type="button"
                onClick={async () => {
                  if (
                    await confirm({
                      title: 'Reset Listening Stats?',
                      message:
                        'Reset all play counts, top artists, and total listening time back to zero? This cannot be undone.',
                      confirmText: 'Reset Stats',
                    })
                  ) {
                    clearListeningStats();
                  }
                }}
                className="text-xs text-slate-400 hover:text-rose-400 whitespace-nowrap"
              >
                Reset stats
              </button>
            )}
          </div>

          {/* Summary KPI Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <div className="rounded-xl bg-[#11131A] border border-white/[0.07] p-4 space-y-1">
              <p className="text-xs text-slate-400">Total Plays</p>
              <p className="text-2xl font-bold text-white font-mono-tabular">
                {listeningStats.totalPlays}
              </p>
            </div>
            <div className="rounded-xl bg-[#11131A] border border-white/[0.07] p-4 space-y-1">
              <p className="text-xs text-slate-400">Listening Time</p>
              <p className="text-2xl font-bold text-white font-mono-tabular">
                {formatTotalListeningTime(listeningStats.totalSecondsListened)}
              </p>
            </div>
            <div className="rounded-xl bg-[#11131A] border border-white/[0.07] p-4 space-y-1">
              <p className="text-xs text-slate-400">Unique Tracks</p>
              <p className="text-2xl font-bold text-white font-mono-tabular">
                {Object.keys(listeningStats.trackStats).length}
              </p>
            </div>
            <div className="rounded-xl bg-[#11131A] border border-white/[0.07] p-4 space-y-1">
              <p className="text-xs text-slate-400">Unique Artists</p>
              <p className="text-2xl font-bold text-white font-mono-tabular">
                {Object.keys(listeningStats.artistStats).length}
              </p>
            </div>
          </div>

          {listeningStats.totalPlays === 0 ? (
            <div className="rounded-2xl bg-[#11131A] border border-white/[0.07] p-10 text-center space-y-2">
              <BarChart3 className="w-8 h-8 text-slate-500 mx-auto" />
              <p className="text-sm font-medium text-white">No playback statistics yet</p>
              <p className="text-xs text-slate-400">
                Play songs across Home, Search, or AI Discovery to build your top artists and tracks.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Top Artists */}
              <div className="lg:col-span-5 rounded-2xl bg-[#11131A] border border-white/[0.07] p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-[#7A90FF]" />
                  <h3 className="text-base font-bold text-white">Top Artists</h3>
                </div>
                <div className="space-y-2">
                  {topArtists.map((artistStat, idx) => (
                    <button
                      key={artistStat.artist}
                      type="button"
                      onClick={() => openArtistPage(artistStat.artist)}
                      className="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl bg-[#0D0F16] hover:bg-[#181B26] border border-white/[0.05] text-left transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="font-mono-tabular text-xs text-slate-500 w-5 shrink-0">
                          {idx + 1}
                        </span>
                        <span className="text-sm font-medium text-white truncate">
                          {artistStat.artist}
                        </span>
                      </div>
                      <span className="font-mono-tabular text-xs text-[#7A90FF] shrink-0">
                        {artistStat.playCount} {artistStat.playCount === 1 ? 'play' : 'plays'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Most Played Tracks */}
              <div className="lg:col-span-7 rounded-2xl bg-[#11131A] border border-white/[0.07] p-5 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Disc3 className="w-4 h-4 text-[#7A90FF]" />
                    <h3 className="text-base font-bold text-white">Most Played Tracks</h3>
                  </div>
                  {topTracks.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        const first = topTracks[0].track;
                        const matchedOffline = offlineTrackMap.get(first.id);
                        if (first.isOffline && matchedOffline) {
                          const offlineQueue = topTracks
                            .map((t) => offlineTrackMap.get(t.track.id))
                            .filter((t): t is OfflineTrack => Boolean(t));
                          playOfflineTrack(matchedOffline, offlineQueue.length > 0 ? offlineQueue : [matchedOffline]);
                        } else {
                          playTrack(
                            first,
                            topTracks.map((t) => t.track)
                          );
                        }
                      }}
                      className="h-8 px-3 rounded-lg bg-white/[0.07] hover:bg-white/[0.12] text-xs font-medium text-white inline-flex items-center gap-1.5"
                    >
                      <Play className="w-3 h-3 fill-current" />
                      <span>Play Top</span>
                    </button>
                  )}
                </div>

                <div className="space-y-2">
                  {topTracks.map((item, idx) => (
                    <TrackRow
                      key={item.track.id}
                      track={item.track}
                      index={idx}
                      queueContext={topTracks.map((t) => t.track)}
                      onAddToPlaylist={onAddToPlaylist}
                      timestampLabel={`${item.playCount} ${item.playCount === 1 ? 'play' : 'plays'}`}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Search History Tab */}
      {sectionTab === 'history' && (
        <div className="space-y-4">
          {searchHistory.length > 0 && (
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-400">Click any past search to run it again</p>
              <button
                type="button"
                onClick={async () => {
                  if (
                    await confirm({
                      title: 'Clear Search History?',
                      message: `Delete all ${searchHistory.length} saved search queries?`,
                      confirmText: 'Clear All',
                    })
                  ) {
                    clearSearchHistory();
                  }
                }}
                className="text-xs text-slate-400 hover:text-rose-400"
              >
                Clear search history
              </button>
            </div>
          )}

          {searchHistory.length === 0 ? (
            <div className="rounded-2xl bg-[#11131A] border border-white/[0.07] p-10 text-center space-y-2">
              <Search className="w-8 h-8 text-slate-500 mx-auto" />
              <p className="text-sm font-medium text-white">Search history is empty</p>
              <p className="text-xs text-slate-400">Your searches from the Search page appear here.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {searchHistory.map((item) => (
                <div
                  key={item.query}
                  className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-[#11131A] border border-white/[0.06]"
                >
                  <button
                    type="button"
                    onClick={() => onRunSearchQuery(item.query)}
                    className="flex items-center gap-3 min-w-0 flex-1 text-left"
                  >
                    <Search className="w-4 h-4 text-[#7A90FF] shrink-0" />
                    <span className="text-sm font-medium text-white truncate">{item.query}</span>
                    <span className="text-xs text-slate-500 shrink-0">
                      {formatRelativeTime(item.timestamp)}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (
                        await confirm({
                          title: 'Delete Search Entry?',
                          message: `Remove "${item.query}" from search history?`,
                          confirmText: 'Delete',
                        })
                      ) {
                        removeSearchQuery(item.query);
                      }
                    }}
                    aria-label={`Delete ${item.query}`}
                    className="p-2 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-white/5"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {/* Backup & Restore Library Modal */}
      <BackupRestoreModal
        isOpen={isBackupModalOpen}
        onClose={() => setIsBackupModalOpen(false)}
      />
    </div>
  );
}
