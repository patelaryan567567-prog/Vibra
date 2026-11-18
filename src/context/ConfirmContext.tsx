import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  tone?: 'danger' | 'warning';
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn>(async () => true);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = useState<ConfirmOptions | null>(null);
  const resolverRef = useRef<((accepted: boolean) => void) | null>(null);
  const cancelBtnRef = useRef<HTMLButtonElement | null>(null);

  const settle = useCallback((accepted: boolean) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setRequest(null);
    if (resolve) resolve(accepted);
  }, []);

  const confirm = useCallback<ConfirmFn>((options) => {
    // If another confirm is open, cancel it cleanly before opening the new one
    if (resolverRef.current) {
      resolverRef.current(false);
      resolverRef.current = null;
    }
    setRequest(options);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  useEffect(() => {
    if (!request) return;
    cancelBtnRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        settle(false);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [request, settle]);

  const isDanger = (request?.tone ?? 'danger') === 'danger';

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}

      {request && (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center bg-black/75 backdrop-blur-xs p-4"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="vibra-confirm-title"
          aria-describedby="vibra-confirm-desc"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) settle(false);
          }}
        >
          <div className="w-full max-w-md rounded-2xl bg-[#131620] border border-white/15 shadow-[0_24px_60px_rgba(0,0,0,0.8)] overflow-hidden">
            <div className="flex items-start gap-3.5 px-5 pt-5 pb-4">
              <div
                className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                  isDanger
                    ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                    : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                }`}
              >
                {isDanger ? (
                  <Trash2 className="w-5 h-5" />
                ) : (
                  <AlertTriangle className="w-5 h-5" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <h3 id="vibra-confirm-title" className="text-base font-bold text-white leading-snug">
                  {request.title}
                </h3>
                <p
                  id="vibra-confirm-desc"
                  className="text-xs sm:text-[13px] text-slate-300 mt-1.5 leading-relaxed break-words"
                >
                  {request.message}
                </p>
              </div>

              <button
                type="button"
                onClick={() => settle(false)}
                aria-label="Close warning dialog"
                className="min-h-[36px] min-w-[36px] -mr-1 -mt-1 flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-white/5 shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-5 py-3.5 bg-[#0D0F16] border-t border-white/[0.07] flex items-center justify-end gap-2.5">
              <button
                ref={cancelBtnRef}
                type="button"
                onClick={() => settle(false)}
                className="min-h-[42px] px-4 rounded-xl bg-white/[0.07] hover:bg-white/[0.12] border border-white/10 text-xs font-semibold text-slate-200 hover:text-white transition-colors"
              >
                {request.cancelText || 'Cancel'}
              </button>
              <button
                type="button"
                onClick={() => settle(true)}
                className={`min-h-[42px] px-4 rounded-xl text-xs font-semibold text-white transition-colors ${
                  isDanger
                    ? 'bg-rose-600 hover:bg-rose-500'
                    : 'bg-amber-600 hover:bg-amber-500'
                }`}
              >
                {request.confirmText || 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext);
}
