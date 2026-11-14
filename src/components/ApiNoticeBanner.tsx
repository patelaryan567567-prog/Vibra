import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ApiNoticeBannerProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

export function ApiNoticeBanner({
  title = 'YouTube Data API v3 Configuration Required',
  message,
  onRetry,
}: ApiNoticeBannerProps) {
  return (
    <div className="rounded-xl bg-[#11131A] border border-amber-500/30 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div className="flex items-start gap-3.5">
        <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
          <AlertTriangle className="w-5 h-5" />
        </div>
        <div className="space-y-1">
          <h4 className="text-sm font-semibold text-white">{title}</h4>
          <p className="text-xs sm:text-sm text-slate-300 leading-relaxed max-w-2xl">{message}</p>
        </div>
      </div>

      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="h-10 px-4 rounded-xl bg-white/[0.07] hover:bg-white/[0.12] border border-white/10 text-xs font-medium text-white inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Retry Connection</span>
        </button>
      )}
    </div>
  );
}
