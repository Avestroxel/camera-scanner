import React, { useState } from 'react';
import { Download, Share2, PlusSquare, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { Translation } from '../translations';

interface Props {
  t: Translation;
  isRtl: boolean;
}

export const PWAInstallBanner: React.FC<Props> = ({ t, isRtl }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSModal, setShowIOSModal] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // If already running standalone or user dismissed this session
  if (isInstalled || dismissed) {
    return null;
  }

  // Only show if installable on Chromium/Android or if on iOS Safari
  if (!isInstallable && !isIOS) {
    return null;
  }

  return (
    <>
      <div className="relative overflow-hidden rounded-2xl glass-panel p-4 border border-cyan-500/20 shadow-lg shadow-cyan-950/20">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-cyan-500 to-emerald-500 flex items-center justify-center shrink-0 shadow-md shadow-cyan-500/20">
              <Download className="w-5 h-5 text-slate-950 stroke-[2.5]" />
            </div>
            <div className="min-w-0 text-left" dir={isRtl ? 'rtl' : 'ltr'}>
              <h4 className="text-sm font-semibold text-white truncate">
                {t.installAppBannerTitle}
              </h4>
              <p className="text-xs text-slate-300 line-clamp-1">
                {t.installAppBannerDesc}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {isInstallable && (
              <button
                onClick={install}
                className="px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-teal-400 text-slate-950 font-bold text-xs shadow hover:brightness-110 active:scale-95 transition-all"
              >
                {t.installApp}
              </button>
            )}

            {isIOS && (
              <button
                onClick={() => setShowIOSModal(true)}
                className="px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-teal-400 text-slate-950 font-bold text-xs shadow hover:brightness-110 active:scale-95 transition-all"
              >
                {t.installApp}
              </button>
            )}

            <button
              onClick={() => setDismissed(true)}
              className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/60 transition"
              aria-label="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* iOS Safari Home Screen Guide Modal */}
      {showIOSModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-fade-in">
          <div
            className="w-full max-w-sm rounded-3xl bg-slate-900 border border-cyan-500/30 p-6 shadow-2xl text-white space-y-5"
            dir={isRtl ? 'rtl' : 'ltr'}
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-cyan-500/20 text-cyan-400 flex items-center justify-center">
                  <Download className="w-4 h-4" />
                </div>
                <h3 className="text-base font-bold text-white">{t.iosInstallTitle}</h3>
              </div>
              <button
                onClick={() => setShowIOSModal(false)}
                className="p-1 rounded-full text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4 text-sm text-slate-300">
              <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-800/70 border border-slate-700/50">
                <div className="w-7 h-7 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center shrink-0 mt-0.5 font-bold text-xs">
                  1
                </div>
                <div>
                  <div className="flex items-center gap-1.5 font-medium text-white mb-1">
                    <span>{t.iosStep1}</span>
                    <Share2 className="w-4 h-4 text-blue-400 shrink-0 inline" />
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-xl bg-slate-800/70 border border-slate-700/50">
                <div className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5 font-bold text-xs">
                  2
                </div>
                <div>
                  <div className="flex items-center gap-1.5 font-medium text-white mb-1">
                    <span>{t.iosStep2}</span>
                    <PlusSquare className="w-4 h-4 text-emerald-400 shrink-0 inline" />
                  </div>
                </div>
              </div>
            </div>

            <button
              onClick={() => setShowIOSModal(false)}
              className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-medium text-sm transition"
            >
              {t.close}
            </button>
          </div>
        </div>
      )}
    </>
  );
};
