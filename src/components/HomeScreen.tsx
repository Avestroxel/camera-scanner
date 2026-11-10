import React, { useState } from 'react';
import {
  Plus,
  Trash2,
  Camera,
  X,
  Download,
  Share2,
  PlusSquare,
  Sparkles,
} from 'lucide-react';
import { OcrLanguage, UILanguage, ChecklistItem } from '../types';
import { Translation } from '../translations';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface Props {
  checklist: ChecklistItem[];
  onAddItem: (text: string) => void;
  onAddMultipleItems: (texts: string[]) => void;
  onRemoveItem: (id: string) => void;
  onClearAll: () => void;
  ocrLanguage: OcrLanguage;
  setOcrLanguage: (val: OcrLanguage) => void;
  uiLang: UILanguage;
  setUiLang: (val: UILanguage) => void;
  t: Translation;
  isRtl: boolean;
  onStartScanning: () => void;
}

export const HomeScreen: React.FC<Props> = ({
  checklist,
  onAddItem,
  onAddMultipleItems,
  onRemoveItem,
  onClearAll,
  ocrLanguage,
  setOcrLanguage,
  uiLang,
  setUiLang,
  t,
  isRtl,
  onStartScanning,
}) => {
  const [inputText, setInputText] = useState('');
  const [showIOSModal, setShowIOSModal] = useState(false);
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();

  const handleAddSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = inputText.trim();
    if (!trimmed) return;

    if (trimmed.includes('\n')) {
      const lines = trimmed
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      if (lines.length > 0) {
        onAddMultipleItems(lines);
        setInputText('');
      }
    } else {
      onAddItem(trimmed);
      setInputText('');
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text');
    if (pasted && pasted.includes('\n')) {
      e.preventDefault();
      const lines = pasted
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      if (lines.length > 0) {
        onAddMultipleItems(lines);
        setInputText('');
      }
    }
  };

  const handleInstallClick = () => {
    if (isInstallable) {
      install();
    } else if (isIOS) {
      setShowIOSModal(true);
    }
  };

  return (
    <div
      className="w-full h-[100dvh] max-h-[100dvh] overflow-hidden bg-[#07090e] text-slate-100 flex flex-col justify-between p-3 sm:p-4 select-none"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      {/* 1. Compact Header */}
      <header className="shrink-0 flex items-center justify-between gap-2 pt-1 pb-2">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-cyan-500 to-emerald-400 flex items-center justify-center shadow-sm">
            <Camera className="w-4 h-4 text-slate-950 stroke-[2.5]" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white tracking-tight leading-none">
              {t.appName}
            </h1>
            <p className="text-[10px] text-slate-400 leading-tight mt-0.5">
              Live OCR Scanner
            </p>
          </div>
        </div>

        {/* Header Right Actions: Install icon + Language Pill */}
        <div className="flex items-center gap-1.5">
          {/* Subtle Install App Icon */}
          {!isInstalled && (isInstallable || isIOS) && (
            <button
              onClick={handleInstallClick}
              title="Add to Home Screen"
              className="p-1.5 rounded-full ios-glass text-cyan-400 hover:text-white transition active:scale-95"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Minimal Language Switcher Pill */}
          <div className="flex items-center rounded-full ios-glass p-0.5 text-[11px] font-medium">
            <button
              onClick={() => setUiLang('ku')}
              className={`px-2 py-0.5 rounded-full transition ${
                uiLang === 'ku'
                  ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              کوردی
            </button>
            <button
              onClick={() => setUiLang('en')}
              className={`px-2 py-0.5 rounded-full transition ${
                uiLang === 'en'
                  ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              EN
            </button>
          </div>
        </div>
      </header>

      {/* 2. Main Body: Input Bar + Active Checklist Area */}
      <main className="flex-1 min-h-0 flex flex-col gap-2.5 my-1">
        {/* Sleek Dark-Glass Input Bar */}
        <form onSubmit={handleAddSubmit} className="shrink-0">
          <div className="relative flex items-center rounded-xl ios-glass-card p-1 border border-white/10 shadow-sm focus-within:border-cyan-500/50 transition">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onPaste={handlePaste}
              placeholder={t.addPlaceholder}
              className="flex-1 bg-transparent px-3 py-2 text-xs sm:text-sm text-white placeholder-slate-500 outline-none font-medium"
            />
            <button
              type="submit"
              disabled={!inputText.trim()}
              className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-teal-400 disabled:opacity-30 disabled:pointer-events-none text-slate-950 font-bold text-xs flex items-center gap-1 active:scale-95 transition"
            >
              <Plus className="w-3.5 h-3.5 stroke-[3]" />
              <span className="hidden xs:inline">{t.addItem}</span>
            </button>
          </div>
        </form>

        {/* Active Checklist Container (Scrollable) */}
        <div className="flex-1 min-h-0 flex flex-col rounded-2xl ios-glass-card p-2.5 sm:p-3 border border-white/10 overflow-hidden shadow-inner">
          {/* List Header */}
          <div className="shrink-0 flex items-center justify-between pb-2 border-b border-white/5 text-[11px]">
            <div className="flex items-center gap-1.5 text-slate-300 font-medium">
              <span className="text-cyan-400 font-semibold">{t.activeChecklist}</span>
              <span className="px-1.5 py-0.2 rounded-full bg-cyan-500/15 text-cyan-400 font-mono text-[10px]">
                {checklist.length}
              </span>
            </div>
            {checklist.length > 0 && (
              <button
                onClick={onClearAll}
                className="text-slate-400 hover:text-rose-400 flex items-center gap-1 text-[10px] transition"
              >
                <Trash2 className="w-3 h-3" />
                <span>{t.clearAll}</span>
              </button>
            )}
          </div>

          {/* List Items */}
          <div className="flex-1 min-h-0 overflow-y-auto pt-2 space-y-1.5 pr-1">
            {checklist.length > 0 ? (
              checklist.map((item, idx) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-slate-900/60 border border-white/5 hover:border-cyan-500/30 text-xs transition animate-fade-in"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-4 h-4 rounded-md bg-slate-800 text-slate-400 font-mono text-[10px] flex items-center justify-center shrink-0">
                      {idx + 1}
                    </span>
                    <span className="font-semibold text-slate-200 truncate">
                      {item.text}
                    </span>
                  </div>
                  <button
                    onClick={() => onRemoveItem(item.id)}
                    className="p-1 rounded-md text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition"
                    aria-label="Remove"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center p-4 text-slate-500 space-y-1">
                <Sparkles className="w-5 h-5 text-slate-600 mb-1" />
                <p className="text-xs font-medium text-slate-400">
                  {t.emptyQueueWarning}
                </p>
                <p className="text-[10px] text-slate-600">
                  {t.bulkPasteHint}
                </p>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* 3. Bottom Area: Segmented Language Control + Primary Action Button */}
      <footer className="shrink-0 space-y-2 pt-1 pb-safe">
        {/* Compact Segmented Control for OCR Model */}
        <div className="grid grid-cols-2 p-0.5 rounded-xl ios-glass text-[11px] font-medium text-center">
          <button
            onClick={() => setOcrLanguage('eng+ara')}
            className={`py-1.5 rounded-lg transition ${
              ocrLanguage === 'eng+ara'
                ? 'bg-slate-800 text-cyan-300 font-bold shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            English + کوردی
          </button>
          <button
            onClick={() => setOcrLanguage('eng')}
            className={`py-1.5 rounded-lg transition ${
              ocrLanguage === 'eng'
                ? 'bg-slate-800 text-cyan-300 font-bold shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            English Fast
          </button>
        </div>

        {/* Primary Start Scanning Button */}
        <button
          onClick={onStartScanning}
          disabled={checklist.length === 0}
          className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-cyan-500 via-teal-400 to-emerald-400 disabled:opacity-35 disabled:pointer-events-none text-slate-950 font-extrabold text-sm sm:text-base shadow-lg shadow-cyan-500/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
        >
          <Camera className="w-5 h-5 stroke-[2.3]" />
          <span>
            {t.startScanning}
            {checklist.length > 0 ? ` (${checklist.length})` : ''}
          </span>
        </button>
      </footer>

      {/* iOS Safari PWA Install Modal */}
      {showIOSModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 bg-black/80 backdrop-blur-md animate-fade-in">
          <div
            className="w-full max-w-sm rounded-2xl bg-slate-900 border border-white/10 p-5 shadow-2xl text-white space-y-4"
            dir={isRtl ? 'rtl' : 'ltr'}
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
              <h3 className="text-sm font-bold text-white">{t.iosInstallTitle}</h3>
              <button
                onClick={() => setShowIOSModal(false)}
                className="p-1 rounded-full text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-300">
              <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-slate-800/60 border border-white/5">
                <span className="w-5 h-5 rounded-md bg-blue-500/20 text-blue-400 flex items-center justify-center shrink-0 font-bold text-[10px]">
                  1
                </span>
                <div className="flex items-center gap-1.5">
                  <span>{t.iosStep1}</span>
                  <Share2 className="w-3.5 h-3.5 text-blue-400 shrink-0 inline" />
                </div>
              </div>

              <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-slate-800/60 border border-white/5">
                <span className="w-5 h-5 rounded-md bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 font-bold text-[10px]">
                  2
                </span>
                <div className="flex items-center gap-1.5">
                  <span>{t.iosStep2}</span>
                  <PlusSquare className="w-3.5 h-3.5 text-emerald-400 shrink-0 inline" />
                </div>
              </div>
            </div>

            <button
              onClick={() => setShowIOSModal(false)}
              className="w-full py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-medium text-xs transition"
            >
              {t.close}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
