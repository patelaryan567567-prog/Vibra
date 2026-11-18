import React, { useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileJson,
  Upload,
  X,
} from 'lucide-react';
import { useConfirm } from '../context/ConfirmContext';
import { useLibrary } from '../context/LibraryContext';
import { useOfflineMusic } from '../context/OfflineMusicContext';
import type { LibraryBackupPayload } from '../types/music';

interface BackupRestoreModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function BackupRestoreModal({ isOpen, onClose }: BackupRestoreModalProps) {
  const confirm = useConfirm();
  const {
    favourites,
    playlists,
    recentlyPlayed,
    searchHistory,
    exportLibraryBackup,
    importLibraryBackup,
    showToast,
  } = useLibrary();
  const { offlinePlaylists, importOfflinePlaylistsBackup } = useOfflineMusic();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [parsedBackup, setParsedBackup] = useState<LibraryBackupPayload | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [restoreMode, setRestoreMode] = useState<'merge' | 'replace'>('merge');

  if (!isOpen) return null;

  const handleExport = () => {
    const payload = exportLibraryBackup(offlinePlaylists);
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const today = new Date().toISOString().slice(0, 10);

    const a = document.createElement('a');
    a.href = url;
    a.download = `vibra-library-backup-${today}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    showToast('Library backup exported as JSON.');
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setParseError(null);
    setParsedBackup(null);
    setFileName(file.name);

    try {
      const text = await file.text();
      const raw = JSON.parse(text) as Partial<LibraryBackupPayload> | null;
      if (
        !raw ||
        typeof raw !== 'object' ||
        raw.app !== 'VIBRA' ||
        raw.version !== 1
      ) {
        setParseError(
          'Invalid backup file. Please select a valid VIBRA Library backup (.json) file.'
        );
        return;
      }

      setParsedBackup({
        version: 1,
        app: 'VIBRA',
        exportedAt: typeof raw.exportedAt === 'number' ? raw.exportedAt : Date.now(),
        favourites: Array.isArray(raw.favourites) ? raw.favourites : [],
        playlists: Array.isArray(raw.playlists) ? raw.playlists : [],
        recentlyPlayed: Array.isArray(raw.recentlyPlayed) ? raw.recentlyPlayed : [],
        searchHistory: Array.isArray(raw.searchHistory) ? raw.searchHistory : [],
        listeningStats: raw.listeningStats || {
          totalPlays: 0,
          totalSecondsListened: 0,
          trackStats: {},
          artistStats: {},
          dailyPlays: {},
        },
        trackPositions: raw.trackPositions || {},
        offlinePlaylists: Array.isArray(raw.offlinePlaylists) ? raw.offlinePlaylists : [],
      });
    } catch {
      setParseError('Could not parse JSON file. Make sure the file is not corrupted.');
    }
  };

  const handleApplyRestore = async () => {
    if (!parsedBackup) return;
    if (restoreMode === 'replace') {
      const ok = await confirm({
        title: 'Replace Current Library?',
        message:
          'This will overwrite your existing playlists, favourites, listening stats, and history with the selected backup file.',
        confirmText: 'Replace Library',
        tone: 'warning',
      });
      if (!ok) return;
    }
    try {
      const result = importLibraryBackup(parsedBackup, restoreMode);
      if (result.offlinePlaylists && result.offlinePlaylists.length > 0) {
        importOfflinePlaylistsBackup(result.offlinePlaylists, restoreMode);
      } else if (restoreMode === 'replace' && Array.isArray(parsedBackup.offlinePlaylists)) {
        importOfflinePlaylistsBackup(parsedBackup.offlinePlaylists, 'replace');
      }
      setParsedBackup(null);
      setFileName('');
      onClose();
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Failed to apply backup.');
    }
  };

  const resetAndClose = () => {
    setParsedBackup(null);
    setParseError(null);
    setFileName('');
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Backup and restore library"
    >
      <div className="w-full max-w-lg rounded-2xl bg-[#11131A] border border-white/12 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08] shrink-0">
          <div className="flex items-center gap-2.5">
            <FileJson className="w-5 h-5 text-[#7A90FF]" />
            <div>
              <h3 className="text-base font-bold text-white">Backup &amp; Restore Library</h3>
              <p className="text-xs text-slate-400">
                Export or restore your playlists, favourites, stats, and playback progress
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={resetAndClose}
            aria-label="Close modal"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-white hover:bg-white/5"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5 overflow-y-auto">
          {/* Export Section */}
          <div className="rounded-xl bg-[#0D0F16] border border-white/[0.07] p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold text-white">Export Library Backup</h4>
                <p className="text-xs text-slate-400 mt-0.5">
                  Downloads a portable .json file with your entire library metadata. Audio MP3 blobs stored locally are not included.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] px-2.5 py-2">
                <p className="text-slate-400 text-[11px]">Playlists</p>
                <p className="font-mono-tabular font-bold text-white mt-0.5">{playlists.length}</p>
              </div>
              <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] px-2.5 py-2">
                <p className="text-slate-400 text-[11px]">Favourites</p>
                <p className="font-mono-tabular font-bold text-white mt-0.5">{favourites.length}</p>
              </div>
              <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] px-2.5 py-2">
                <p className="text-slate-400 text-[11px]">History</p>
                <p className="font-mono-tabular font-bold text-white mt-0.5">{recentlyPlayed.length}</p>
              </div>
              <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] px-2.5 py-2">
                <p className="text-slate-400 text-[11px]">Searches</p>
                <p className="font-mono-tabular font-bold text-white mt-0.5">{searchHistory.length}</p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleExport}
              className="w-full min-h-[42px] px-4 rounded-xl bg-[#4F6BFF] hover:bg-[#415CE6] text-xs font-semibold text-white inline-flex items-center justify-center gap-2 transition-colors"
            >
              <Download className="w-4 h-4" />
              <span>Export Library (.json)</span>
            </button>
          </div>

          {/* Restore Section */}
          <div className="rounded-xl bg-[#0D0F16] border border-white/[0.07] p-4 space-y-3">
            <div>
              <h4 className="text-sm font-semibold text-white">Restore from Backup</h4>
              <p className="text-xs text-slate-400 mt-0.5">
                Choose a previously exported VIBRA backup file to merge into or replace your current library.
              </p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => void handleFileChange(e)}
            />

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full min-h-[42px] px-4 rounded-xl bg-white/[0.07] hover:bg-white/[0.12] border border-white/10 text-xs font-semibold text-white inline-flex items-center justify-center gap-2 transition-colors"
            >
              <Upload className="w-4 h-4 text-emerald-400" />
              <span>{fileName ? `Selected: ${fileName}` : 'Choose Backup .json File'}</span>
            </button>

            {parseError && (
              <div className="rounded-lg bg-rose-500/10 border border-rose-500/30 px-3 py-2.5 flex items-start gap-2 text-xs text-rose-300">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{parseError}</span>
              </div>
            )}

            {parsedBackup && (
              <div className="space-y-3 pt-1">
                <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-3 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-emerald-300">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>
                      Valid backup from {new Date(parsedBackup.exportedAt).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-[11px] text-slate-300 font-mono-tabular">
                    <span>Playlists: {parsedBackup.playlists.length}</span>
                    <span>Favourites: {parsedBackup.favourites.length}</span>
                    <span>Recent: {parsedBackup.recentlyPlayed.length}</span>
                    <span>Searches: {parsedBackup.searchHistory.length}</span>
                    <span>Offline Pl: {parsedBackup.offlinePlaylists?.length ?? 0}</span>
                  </div>
                </div>

                {/* Merge vs Replace Mode */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setRestoreMode('merge')}
                    className={`min-h-[42px] px-3 py-2 rounded-xl border text-left transition-colors ${
                      restoreMode === 'merge'
                        ? 'bg-[#4F6BFF]/15 border-[#4F6BFF]/50 text-white'
                        : 'bg-white/[0.03] border-white/[0.08] text-slate-400 hover:text-white'
                    }`}
                  >
                    <p className="text-xs font-semibold">Merge (Recommended)</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">Keeps existing &amp; adds missing</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRestoreMode('replace')}
                    className={`min-h-[42px] px-3 py-2 rounded-xl border text-left transition-colors ${
                      restoreMode === 'replace'
                        ? 'bg-amber-500/15 border-amber-500/50 text-white'
                        : 'bg-white/[0.03] border-white/[0.08] text-slate-400 hover:text-white'
                    }`}
                  >
                    <p className="text-xs font-semibold">Replace Library</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">Overwrites current lists</p>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleApplyRestore}
                  className="w-full min-h-[42px] px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white inline-flex items-center justify-center gap-2 transition-colors"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>
                    {restoreMode === 'merge' ? 'Merge Into Library' : 'Replace Current Library'}
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
