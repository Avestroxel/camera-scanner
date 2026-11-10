import React, { useState } from 'react';
import { Download, Share2, Copy, Check, X, Camera, Sparkles } from 'lucide-react';
import { SnapshotData } from '../types';
import { Translation } from '../translations';

interface Props {
  snapshot: SnapshotData;
  t: Translation;
  isRtl: boolean;
  onClose: () => void;
}

export const SnapshotModal: React.FC<Props> = ({ snapshot, t, isRtl, onClose }) => {
  const [copied, setCopied] = useState(false);

  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = snapshot.imageUrl;
    a.download = `ocr-scan-${snapshot.searchQuery || 'highlight'}-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        // Try sharing as File first
        const res = await fetch(snapshot.imageUrl);
        const blob = await res.blob();
        const file = new File([blob], `scan-${snapshot.searchQuery}.png`, { type: 'image/png' });

        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            title: t.snapshotTitle,
            text: `${t.searchingFor}: "${snapshot.searchQuery}" - Found ${snapshot.matchesCount} ${t.matchesCount}`,
            files: [file],
          });
          return;
        }

        await navigator.share({
          title: t.snapshotTitle,
          text: `${t.searchingFor}: "${snapshot.searchQuery}"\nMatches: ${snapshot.matchedWords.join(', ')}\n${snapshot.fullOcrText}`,
        });
      } catch (err) {
        // User cancelled share or unsupported
      }
    } else {
      // Fallback: download
      handleDownload();
    }
  };

  const handleCopyText = async () => {
    const textToCopy = snapshot.fullOcrText || snapshot.matchedWords.join('\n');
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard error
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/85 backdrop-blur-md animate-fade-in overflow-y-auto">
      <div
        className="w-full max-w-lg rounded-3xl bg-slate-900 border border-emerald-500/30 p-4 sm:p-6 shadow-2xl space-y-4 my-auto max-h-[92vh] flex flex-col"
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <Camera className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                {t.snapshotTitle}
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-normal border border-emerald-500/30">
                  {snapshot.matchesCount} {t.matchesCount}
                </span>
              </h3>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Snapshot Image Preview */}
        <div className="relative rounded-2xl overflow-hidden bg-black border border-slate-800 shadow-inner max-h-[46vh] flex items-center justify-center">
          <img
            src={snapshot.imageUrl}
            alt="Captured OCR Scan"
            className="max-h-[46vh] w-auto max-w-full object-contain rounded-xl"
          />
          {snapshot.matchesCount > 0 && (
            <div className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-slate-900/80 backdrop-blur-md border border-emerald-500/40 text-emerald-400 text-xs font-semibold flex items-center gap-1.5 shadow-lg">
              <Sparkles className="w-3.5 h-3.5 animate-pulse" />
              <span>
                "{snapshot.searchQuery}" ({snapshot.matchesCount})
              </span>
            </div>
          )}
        </div>

        {/* Extracted text snippet */}
        {snapshot.matchedWords.length > 0 && (
          <div className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60 text-xs text-slate-300 max-h-24 overflow-y-auto">
            <div className="font-semibold text-emerald-400 mb-1 flex items-center justify-between">
              <span>{t.matchFound}</span>
              <button
                onClick={handleCopyText}
                className="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                {copied ? t.copied : t.copyText}
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {snapshot.matchedWords.map((word, i) => (
                <span
                  key={i}
                  className="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 font-mono text-xs border border-emerald-500/30"
                >
                  {word}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-2.5 pt-1 shrink-0">
          <button
            onClick={handleDownload}
            className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-bold text-sm shadow-lg shadow-emerald-950/30 active:scale-95 transition-all"
          >
            <Download className="w-4 h-4 stroke-[2.5]" />
            <span>{t.downloadImage}</span>
          </button>

          <button
            onClick={handleShare}
            className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-medium text-sm border border-slate-700 active:scale-95 transition-all"
          >
            <Share2 className="w-4 h-4 text-cyan-400" />
            <span>{t.shareImage}</span>
          </button>
        </div>

        <button
          onClick={onClose}
          className="w-full py-2.5 rounded-xl text-slate-400 hover:text-white text-xs font-medium hover:bg-slate-800/40 transition shrink-0"
        >
          {t.continueScanning}
        </button>
      </div>
    </div>
  );
};
