import React from 'react';
import { CheckCircle2, Download, Loader2, X } from 'lucide-react';
import { useOfflineMusic } from '../context/OfflineMusicContext';
import { formatBytes } from '../utils/offlineMusicDb';

export function DownloadProgressTray() {
  const { activeDownloads, batchDownloadState, cancelBatchDownload } = useOfflineMusic();

  if (activeDownloads.length === 0 && !batchDownloadState) return null;

  const batchProcessed = batchDownloadState
    ? batchDownloadState.completed + batchDownloadState.skipped + batchDownloadState.failed
    : 0;
  const batchPercent =
    batchDownloadState && batchDownloadState.total > 0
      ? Math.round((batchProcessed / batchDownloadState.total) * 100)
      : 0;

  return (
    <aside
      aria-label="Active song downloads"
      className="fixed right-3 sm:right-5 bottom-[136px] md:bottom-24 z-40 w-[calc(100vw-1.5rem)] max-w-sm rounded-2xl bg-[#11141F]/95 border border-emerald-500/35 p-3.5 shadow-2xl backdrop-blur-xl space-y-2.5"
    >
      {batchDownloadState && (
        <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/25 p-2.5 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-emerald-200 truncate">
                Batch: {batchDownloadState.label}
              </p>
              <p className="font-mono-tabular text-[11px] text-slate-300 truncate">
                {batchProcessed} / {batchDownloadState.total} processed · {batchDownloadState.completed} saved
                {batchDownloadState.skipped > 0 ? ` · ${batchDownloadState.skipped} skipped` : ''}
              </p>
            </div>
            <button
              type="button"
              onClick={cancelBatchDownload}
              aria-label="Cancel batch download"
              title="Cancel batch download"
              className="min-h-[32px] px-2 rounded-lg bg-white/10 hover:bg-rose-500/25 text-xs font-medium text-slate-200 hover:text-white inline-flex items-center gap-1 shrink-0 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              <span>Stop</span>
            </button>
          </div>
          <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full rounded-full bg-emerald-400 transition-all duration-200"
              style={{ width: `${Math.max(4, Math.min(100, batchPercent))}%` }}
            />
          </div>
        </div>
      )}

      {activeDownloads.length > 0 && (
        <>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Download className="w-4 h-4 text-emerald-400 shrink-0" />
              <span className="text-xs font-semibold text-white truncate">
                Downloading ({activeDownloads.length})
              </span>
            </div>
            <span className="text-[11px] font-medium text-emerald-300 whitespace-nowrap">
              {batchDownloadState ? 'My Music' : 'Device + My Music'}
            </span>
          </div>

          <div className="space-y-2.5 max-h-56 overflow-y-auto pr-0.5">
            {activeDownloads.map((item) => {
              const isDone = item.phase === 'done';
              const statusLine =
                item.phase === 'resolving'
                  ? 'Finding best audio stream...'
                  : item.phase === 'saving'
                    ? 'Saving audio offline...'
                    : item.phase === 'done'
                      ? 'Saved offline'
                      : item.totalBytes > 0
                        ? `${formatBytes(item.loadedBytes)} / ${formatBytes(item.totalBytes)} · ${formatBytes(item.remainingBytes)} left`
                        : `${formatBytes(item.loadedBytes)} downloaded`;

              return (
                <div
                  key={item.trackId}
                  className="rounded-xl bg-[#090A0F]/85 border border-white/[0.07] p-2.5 space-y-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-white truncate">{item.title}</p>
                      <p className="text-[11px] text-slate-400 truncate">{item.artist}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {isDone ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Loader2 className="w-3.5 h-3.5 text-emerald-400 animate-spin" />
                      )}
                      <span className="font-mono-tabular text-xs font-bold text-emerald-300">
                        {item.percent}%
                      </span>
                    </div>
                  </div>

                  <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-[#4F6BFF] to-[#8B5CF6] transition-all duration-150"
                      style={{ width: `${Math.max(4, Math.min(100, item.percent))}%` }}
                    />
                  </div>

                  <p className="font-mono-tabular text-[11px] text-slate-300 truncate">{statusLine}</p>
                </div>
              );
            })}
          </div>
        </>
      )}
    </aside>
  );
}
