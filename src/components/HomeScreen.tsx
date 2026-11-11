import React, { useState } from 'react';
import {
  X,
  Check,
  Search,
  Moon,
  Sun,
  Globe,
} from 'lucide-react';
import { OcrLanguage, UILanguage, ChecklistItem } from '../types';
import { Translation } from '../translations';

interface Props {
  checklist: ChecklistItem[];
  onAddItem: (text: string) => void;
  onAddMultipleItems: (texts: string[]) => void;
  onRemoveItem: (id: string) => void;
  onToggleItemCompleted: (id: string) => void;
  onClearAll: () => void;
  ocrLanguage: OcrLanguage;
  setOcrLanguage: (val: OcrLanguage) => void;
  uiLang: UILanguage;
  setUiLang: (val: UILanguage) => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  t: Translation;
  isRtl: boolean;
  onStartScanning: () => void;
}

export const HomeScreen: React.FC<Props> = ({
  checklist,
  onAddItem,
  onAddMultipleItems,
  onRemoveItem,
  onToggleItemCompleted,
  ocrLanguage,
  setOcrLanguage,
  uiLang,
  setUiLang,
  theme,
  onToggleTheme,
  isRtl,
  onStartScanning,
}) => {
  const [inputText, setInputText] = useState('');

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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddSubmit();
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

  const handleCycleUiLanguage = () => {
    setUiLang(uiLang === 'en' ? 'ku' : 'en');
  };

  return (
    <div
      className="w-full h-[100dvh] max-h-[100dvh] overflow-hidden bg-[#f8fafc] dark:bg-[#0a0a0a] text-[#0f172a] dark:text-white flex flex-col justify-between px-6 pt-20 pb-7 max-w-md mx-auto select-none transition-colors duration-200"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      {/* Top & Middle Content Area */}
      <div className="flex-1 min-h-0 flex flex-col">
        {/* 1. Header: Square Box + Bold Title */}
        <header className="shrink-0 flex items-center gap-4 mb-9" dir="ltr">
          <div className="w-12 h-12 bg-[#d9d9d9] dark:bg-[#d9d9d9] shrink-0" />
          <h1 className="text-2xl font-extrabold tracking-tight text-[#0f172a] dark:text-white leading-none">
            {uiLang === 'ku' ? 'گەڕانی دەقی ڕاستەوخۆ' : 'Live Text Finder'}
          </h1>
        </header>

        {/* 2. Target Input Section */}
        <section className="shrink-0 mb-8">
          <label
            htmlFor="target-input"
            className="block text-sm font-bold mb-2 text-[#0f172a] dark:text-white"
          >
            {uiLang === 'ku' ? 'ئامانج بنووسە' : 'Type target'}
          </label>
          <form onSubmit={handleAddSubmit}>
            <input
              id="target-input"
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onBlur={() => {
                if (inputText.trim()) {
                  handleAddSubmit();
                }
              }}
              placeholder={uiLang === 'ku' ? 'وشە، کۆد........' : 'word, finder........'}
              enterKeyHint="done"
              className="w-full h-13 px-4 bg-white dark:bg-[#0f0f0f] border border-[#cbd5e1] dark:border-white/70 rounded-none text-sm font-bold text-[#0f172a] dark:text-white placeholder-[#94a3b8] dark:placeholder-[#3f3f46] outline-none focus:border-[#248a3d] dark:focus:border-white transition-colors"
            />
          </form>
        </section>

        {/* 3. Search List Section */}
        <section className="flex-1 min-h-0 flex flex-col">
          <h2 className="shrink-0 text-sm font-bold mb-2.5 text-[#0f172a] dark:text-white">
            {uiLang === 'ku' ? 'لیستی گەڕان' : 'Search list'}
          </h2>

          <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-0.5">
            {checklist.length > 0 ? (
              checklist.map((item, idx) => {
                const isDone = Boolean(item.isCompleted);
                return (
                  <div
                    key={item.id}
                    className="w-full h-13 px-4 bg-white dark:bg-[#0f0f0f] border border-[#cbd5e1] dark:border-white/70 rounded-none flex items-center justify-between gap-3 transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() => onToggleItemCompleted(item.id)}
                      className="flex-1 min-w-0 text-left flex items-center gap-1.5 py-2 text-sm font-bold text-[#0f172a] dark:text-white tabular-nums truncate"
                      dir="ltr"
                    >
                      <span>{idx + 1}.</span>
                      <span className="truncate">{item.text}</span>
                    </button>

                    {isDone ? (
                      <button
                        type="button"
                        onClick={() => onToggleItemCompleted(item.id)}
                        aria-label="Completed item"
                        title="Tap to mark active again"
                        className="min-w-[40px] min-h-[40px] -mr-2 flex items-center justify-center text-[#22c55e] hover:opacity-80 active:scale-90 transition"
                      >
                        <Check className="w-6 h-6 stroke-[2.75]" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onRemoveItem(item.id)}
                        aria-label="Remove item"
                        title="Remove item"
                        className="min-w-[40px] min-h-[40px] -mr-2 flex items-center justify-center text-[#dc2626] hover:opacity-80 active:scale-90 transition"
                      >
                        <X className="w-6 h-6 stroke-[2.75]" />
                      </button>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="w-full h-13 px-4 bg-white/50 dark:bg-[#0f0f0f]/50 border border-dashed border-[#cbd5e1] dark:border-white/30 flex items-center justify-center text-xs font-semibold text-[#94a3b8] dark:text-[#52525b]">
                {uiLang === 'ku'
                  ? 'هیچ دانەیەک زیاد نەکراوە — لە سەرەوە وشەیەک بنووسە'
                  : 'No items in search list — type a target above'}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* 4. Bottom Controls: Language Selector Box + Bottom Action Bar */}
      <footer className="shrink-0 pt-4 space-y-6 pb-safe" dir="ltr">
        {/* Rectangular Segmented Language Selector */}
        <div className="w-full h-12 bg-white dark:bg-[#0a0a0a] border border-[#cbd5e1] dark:border-white/70 p-1 flex items-center">
          <button
            type="button"
            onClick={() => setOcrLanguage('eng+ara')}
            className={`flex-1 h-full flex items-center justify-center text-xs sm:text-sm font-bold transition ${
              ocrLanguage === 'eng+ara'
                ? 'bg-slate-200 dark:bg-[#1a1a1a] text-[#0f172a] dark:text-white rounded-[2px]'
                : 'text-slate-600 dark:text-white hover:opacity-80'
            }`}
          >
            English + کوردی
          </button>

          {/* Center Vertical Divider */}
          <div className="w-[1px] h-5 bg-[#cbd5e1] dark:bg-white/70 shrink-0 mx-1" />

          <button
            type="button"
            onClick={() => setOcrLanguage('eng')}
            className={`flex-1 h-full flex items-center justify-center text-xs sm:text-sm font-bold transition ${
              ocrLanguage === 'eng'
                ? 'bg-slate-200 dark:bg-[#1a1a1a] text-[#0f172a] dark:text-white rounded-[2px]'
                : 'text-slate-600 dark:text-white hover:opacity-80'
            }`}
          >
            English (Faster)
          </button>
        </div>

        {/* Bottom Row: Moon/Sun Icon (Left) | Green Search Squircle (Center) | Globe Icon (Right) */}
        <div className="flex items-center justify-between px-1">
          {/* Theme Toggle (Moon / Sun) */}
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label="Toggle Dark/Light Mode"
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-[#0f172a] dark:text-white hover:opacity-75 active:scale-90 transition"
          >
            {theme === 'dark' ? (
              <Moon className="w-7 h-7 fill-current stroke-[1.5] -rotate-12" />
            ) : (
              <Sun className="w-7 h-7 stroke-[2.2]" />
            )}
          </button>

          {/* Primary Green Squircle Search Button */}
          <button
            type="button"
            onClick={onStartScanning}
            disabled={checklist.length === 0}
            aria-label="Start Camera Search"
            className="w-[88px] h-[76px] rounded-[26px] bg-[#248a3d] hover:bg-[#2aa147] disabled:opacity-35 disabled:pointer-events-none active:scale-95 transition-all flex items-center justify-center shadow-lg"
          >
            <Search className="w-10 h-10 text-white stroke-[3.5]" />
          </button>

          {/* UI Language Toggle (Globe) */}
          <button
            type="button"
            onClick={handleCycleUiLanguage}
            aria-label="Switch Interface Language"
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-[#0f172a] dark:text-white hover:opacity-75 active:scale-90 transition relative"
          >
            <Globe className="w-7 h-7 stroke-[1.8]" />
          </button>
        </div>
      </footer>
    </div>
  );
};
