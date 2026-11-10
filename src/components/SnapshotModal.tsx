import React, { useState } from 'react';
import { Download, Share2, Copy, Check, X, Camera } from 'lucide-react';
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
    a.download = `ocr-scan-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        const res = await fetch(snapshot.imageUrl);
        const blob = await res.blob();
        const file = new File([blob], `scan-${Date.now()}.png`, { type: 'image/png' });

        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({
            title: t.snapshotTitle,
            text: `Matches: ${snapshot.matchedWords.join(', ')}`,
            files: [file],
          });
          return;
        }

        await navigator.share({
          title: t.snapshotTitle,
          text: `Matches: ${snapshot.matchedWords.join(', ')}\n${snapshot.fullOcrText}`,
        });
      } catch {
        // user cancel
      }
    } else {
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
      // ignore
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/85 backdrop-blur-md animate-fade-in overflow-hidden">
      <div
        className="w-full max-w-sm rounded-2xl ios-glass-card p-4 shadow-2xl space-y-3 flex flex-col max-h-[90vh]"
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 pb-2 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <Camera className="w-3.5 h-3.5" />
            </div>
            <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
              <span>{t.snapshotTitle}</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-400 font-mono">
                {snapshot.matchesCount}
              </span>
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-full text-slate-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Snapshot Image Preview */}
        <div className="relative rounded-xl overflow-hidden bg-black border border-white/5 flex items-center justify-center max-h-[44vh]">
          <img
            src={snapshot.imageUrl}
            alt="OCR Snapshot"
            className="max-h-[44vh] w-auto max-w-full object-contain rounded-lg"
          />
        </div>

        {/* Extracted text snippet */}
        {snapshot.matchedWords.length > 0 && (
          <div className="p-2 rounded-xl bg-black/40 border border-white/5 text-[11px] text-slate-300 max-h-20 overflow-y-auto shrink-0">
            <div className="font-semibold text-emerald-400 mb-1 flex items-center justify-between">
              <span>{t.matchFound}</span>
              <button
                onClick={handleCopyText}
                className="text-[10px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                {copied ? t.copied : t.copyText}
              </button>
            </div>
            <div className="flex flex-wrap gap-1">
              {snapshot.matchedWords.map((word, i) => (
                <span
                  key={i}
                  className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 font-mono text-[10px]"
                >
                  {word}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-2 shrink-0">
          <button
            onClick={handleDownload}
            className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 text-slate-950 font-bold text-xs shadow-md active:scale-95 transition"
          >
            <Download className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>{t.downloadImage}</span>
          </button>

          <button
            onClick={handleShare}
            className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-medium text-xs border border-white/10 active:scale-95 transition"
          >
            <Share2 className="w-3.5 h-3.5 text-cyan-400" />
            <span>{t.shareImage}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
