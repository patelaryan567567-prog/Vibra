import React, { useState } from 'react';
import { Check, FolderHeart, Plus, X } from 'lucide-react';
import { useOfflineMusic } from '../context/OfflineMusicContext';
import type { OfflineTrack } from '../types/music';

interface OfflinePlaylistModalProps {
  track: OfflineTrack | null;
  onClose: () => void;
}

export function OfflinePlaylistModal({ track, onClose }: OfflinePlaylistModalProps) {
  const {
    offlinePlaylists,
    createOfflinePlaylist,
    addTrackToOfflinePlaylist,
    removeTrackFromOfflinePlaylist,
  } = useOfflineMusic();
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

  if (!track) return null;

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    createOfflinePlaylist(newName, [track.id], newDesc);
    setNewName('');
    setNewDesc('');
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm p-0 sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Add downloaded song to offline playlist"
    >
      <div
        className="w-full sm:max-w-md bg-[#11131A] border border-white/10 rounded-t-3xl sm:rounded-2xl overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.07]">
          <div className="min-w-0 pr-3">
            <h3 className="text-base font-semibold text-white truncate">Save to Offline Playlist</h3>
            <p className="text-xs text-slate-400 truncate mt-0.5">{track.title}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto">
          {offlinePlaylists.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-400">Your offline playlists</p>
              <div className="space-y-1.5">
                {offlinePlaylists.map((pl) => {
                  const hasTrack = pl.trackIds.includes(track.id);
                  return (
                    <button
                      key={pl.id}
                      type="button"
                      onClick={() =>
                        hasTrack
                          ? removeTrackFromOfflinePlaylist(pl.id, track.id)
                          : addTrackToOfflinePlaylist(pl.id, track.id)
                      }
                      className="w-full min-h-[48px] px-3.5 py-2.5 flex items-center justify-between rounded-xl bg-[#181B26] hover:bg-[#1E2230] border border-white/[0.06] transition-colors text-left"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-lg bg-emerald-500/15 text-emerald-400 flex items-center justify-center shrink-0">
                          <FolderHeart className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-white truncate">{pl.name}</p>
                          <p className="text-xs text-slate-400 font-mono-tabular">
                            {pl.trackIds.length} {pl.trackIds.length === 1 ? 'song' : 'songs'}
                          </p>
                        </div>
                      </div>
                      <span
                        className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 transition-colors ${
                          hasTrack
                            ? 'bg-emerald-500 text-white'
                            : 'border border-white/15 text-transparent'
                        }`}
                      >
                        <Check className="w-3.5 h-3.5" />
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <form onSubmit={handleCreate} className="space-y-3 pt-2 border-t border-white/[0.07]">
            <p className="text-xs font-medium text-slate-400">Create new offline playlist</p>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Playlist name (e.g. Offline Gym Mix)"
              className="w-full h-11 px-3.5 rounded-xl bg-[#090A0F] border border-white/10 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
            />
            <input
              type="text"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Optional description"
              className="w-full h-11 px-3.5 rounded-xl bg-[#090A0F] border border-white/10 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500"
            />
            <button
              type="submit"
              disabled={!newName.trim()}
              className="w-full h-11 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:pointer-events-none text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Create &amp; Add Song</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
