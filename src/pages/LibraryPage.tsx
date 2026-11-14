import React, { useMemo, useState } from 'react';
import {
  BarChart3,
  Clock,
  Disc3,
  Edit3,
  ListMusic,
  Play,
  Plus,
  Search,
  Shuffle,
  Trash2,
  User,
} from 'lucide-react';
import { TrackRow } from '../components/TrackCard';
import { useLibrary } from '../context/LibraryContext';
import { usePlayer } from '../context/PlayerContext';
import type { NavTab, Playlist, Track } from '../types/music';
import { formatRelativeTime } from '../utils/format';

interface LibraryPageProps {
  onAddToPlaylist: (track: Track) => void;
  onRunSearchQuery: (query: string) => void;
  onNavigate: (tab: NavTab) => void;
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
  onRunSearchQuery,
  onNavigate,
}: LibraryPageProps) {
  const {
    playlists,
    recentlyPlayed,
    searchHistory,
    listeningStats,
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

  const [sectionTab, setSectionTab] = useState<'playlists' | 'recent' | 'stats' | 'history'>('playlists');
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [newPlaylistDesc, setNewPlaylistDesc] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);

  const [editingPlaylistId, setEditingPlaylistId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const selectedPlaylist: Playlist | undefined = playlists.find((p) => p.id === selectedPlaylistId);

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

  return (
    <div className="space-y-8 pb-8">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">Your Library</h1>
          <p className="text-sm text-slate-400 mt-1">
            Custom playlists, listening statistics, history, and saved searches on this device.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setSectionTab('playlists');
            setShowCreateForm((v) => !v);
          }}
          className="h-10 px-4 rounded-xl bg-[#4F6BFF] hover:bg-[#415CE6] text-white text-xs font-semibold inline-flex items-center gap-2 self-start sm:self-auto whitespace-nowrap transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>New Playlist</span>
        </button>
      </div>

      {/* Section Tabs (mobile-safe horizontal scroll) */}
      <div className="flex items-center gap-1 p-1 rounded-xl bg-[#11131A] border border-white/[0.07] w-fit max-w-full overflow-x-auto no-scrollbar">
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
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Playlist List */}
              <div className="lg:col-span-4 space-y-2.5">
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
                              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                deletePlaylist(pl.id);
                                if (selectedPlaylistId === pl.id) setSelectedPlaylistId(null);
                              }}
                              aria-label={`Delete ${pl.name}`}
                              className="p-2 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-white/5"
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
              <div className="lg:col-span-8">
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
                        <div className="flex items-center gap-2 shrink-0">
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
                                onClick={() => removeTrackFromPlaylist(selectedPlaylist.id, track.id)}
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
                onClick={clearRecentlyPlayed}
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
                onClick={clearListeningStats}
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
                      onClick={() => onRunSearchQuery(artistStat.artist)}
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
                      onClick={() =>
                        playTrack(
                          topTracks[0].track,
                          topTracks.map((t) => t.track)
                        )
                      }
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
                onClick={clearSearchHistory}
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
                    onClick={() => removeSearchQuery(item.query)}
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
    </div>
  );
}
