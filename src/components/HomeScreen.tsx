import React, { useState, useRef } from 'react';
import {
  Scan,
  Plus,
  Trash2,
  Sparkles,
  Languages,
  Zap,
  Camera,
  Upload,
  FileText,
  Sliders,
  CheckCircle2,
  ListOrdered,
  ClipboardPaste,
  AlertCircle,
  X,
} from 'lucide-react';
import { OcrLanguage, MatchMode, UILanguage, ChecklistItem } from '../types';
import { Translation, PRESETS_BY_LANG } from '../translations';
import { PWAInstallBanner } from './PWAInstallBanner';

interface Props {
  checklist: ChecklistItem[];
  onAddItem: (text: string) => void;
  onAddMultipleItems: (texts: string[]) => void;
  onRemoveItem: (id: string) => void;
  onClearAll: () => void;
  ocrLanguage: OcrLanguage;
  setOcrLanguage: (val: OcrLanguage) => void;
  matchMode: MatchMode;
  setMatchMode: (val: MatchMode) => void;
  uiLang: UILanguage;
  setUiLang: (val: UILanguage) => void;
  t: Translation;
  isRtl: boolean;
  onStartScanning: () => void;
  onSelectSampleImage: (dataUrl: string) => void;
}

export const HomeScreen: React.FC<Props> = ({
  checklist,
  onAddItem,
  onAddMultipleItems,
  onRemoveItem,
  onClearAll,
  ocrLanguage,
  setOcrLanguage,
  matchMode,
  setMatchMode,
  uiLang,
  setUiLang,
  t,
  isRtl,
  onStartScanning,
  onSelectSampleImage,
}) => {
  const [inputText, setInputText] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const presets = PRESETS_BY_LANG[uiLang] || PRESETS_BY_LANG.en;

  // Handle Add Item or Bulk Add
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
        setInputError(null);
      }
    } else {
      onAddItem(trimmed);
      setInputText('');
      setInputError(null);
    }
  };

  // Handle Paste Event to automatically detect multi-line text
  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
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
        setInputError(null);
      }
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          onSelectSampleImage(event.target.result as string);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  // Generate sample invoice containing multiple items
  const createSampleInvoice = () => {
    // If checklist is empty, pre-populate with sample receipt items
    if (checklist.length === 0) {
      onAddMultipleItems(['Espresso', 'TOTAL DUE', '$52.71', 'کۆی گشتی']);
    }

    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 1000;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 800, 1000);

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 36px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('STARLIGHT STORE', 400, 80);

    ctx.font = '18px monospace';
    ctx.fillStyle = '#64748b';
    ctx.fillText('Tax Invoice #INV-92841', 400, 120);
    ctx.fillText('Date: 2026-11-10  Time: 14:30', 400, 150);

    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(80, 180);
    ctx.lineTo(720, 180);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 22px monospace';
    ctx.fillText('DESCRIPTION', 80, 230);
    ctx.textAlign = 'right';
    ctx.fillText('PRICE', 720, 230);

    const items = [
      { name: 'Espresso Roast (500g)', price: '$18.50' },
      { name: 'Organic Almond Milk', price: '$4.20' },
      { name: 'Caramel Glazed Donut', price: '$3.50' },
      { name: 'Ceramic Travel Mug', price: '$24.00' },
    ];

    let y = 280;
    ctx.font = '20px monospace';
    ctx.fillStyle = '#334155';
    items.forEach((item) => {
      ctx.textAlign = 'left';
      ctx.fillText(item.name, 80, y);
      ctx.textAlign = 'right';
      ctx.fillText(item.price, 720, y);
      y += 50;
    });

    y += 30;
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(80, y);
    ctx.lineTo(720, y);
    ctx.stroke();

    y += 50;
    ctx.textAlign = 'left';
    ctx.font = '22px monospace';
    ctx.fillText('Subtotal:', 400, y);
    ctx.textAlign = 'right';
    ctx.fillText('$50.20', 720, y);

    y += 40;
    ctx.textAlign = 'left';
    ctx.fillText('VAT / Tax (5%):', 400, y);
    ctx.textAlign = 'right';
    ctx.fillText('$2.51', 720, y);

    y += 55;
    ctx.textAlign = 'left';
    ctx.font = 'bold 32px monospace';
    ctx.fillStyle = '#0f172a';
    ctx.fillText('TOTAL DUE:', 360, y);
    ctx.textAlign = 'right';
    ctx.fillText('$52.71', 720, y);

    y += 70;
    ctx.font = 'bold 24px sans-serif';
    ctx.fillStyle = '#1e293b';
    ctx.textAlign = 'center';
    ctx.fillText('کۆی گشتی: $52.71 (Total)', 400, y);

    y += 40;
    ctx.font = '20px sans-serif';
    ctx.fillStyle = '#475569';
    ctx.fillText('المجموع الكلي: $52.71', 400, y);

    y += 80;
    ctx.fillStyle = '#0f172a';
    for (let x = 180; x < 620; x += 8) {
      const barW = x % 3 === 0 ? 5 : 2;
      ctx.fillRect(x, y, barW, 60);
    }
    ctx.font = '16px monospace';
    ctx.fillText('*SERIAL-8942-X7*', 400, y + 85);

    const dataUrl = canvas.toDataURL('image/png');
    onSelectSampleImage(dataUrl);
  };

  const handleStart = () => {
    if (checklist.length === 0) {
      setInputError(t.emptyQueueWarning);
      return;
    }
    onStartScanning();
  };

  return (
    <div
      className="min-h-[100dvh] w-full overflow-y-auto bg-gradient-to-b from-slate-950 via-[#0a0f1d] to-[#060a14] text-slate-100 flex flex-col justify-between p-4 sm:p-6"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <input
        type="file"
        ref={fileInputRef}
        accept="image/*"
        className="hidden"
        onChange={handleFileUpload}
      />

      <div className="w-full max-w-lg mx-auto space-y-5 pt-2">
        {/* Top Header Bar */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-cyan-500 to-emerald-400 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <Scan className="w-5 h-5 text-slate-950 stroke-[2.5]" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white tracking-tight flex items-center gap-1.5">
                <span>{t.appName}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-400 font-mono border border-cyan-500/30">
                  Multi-Target
                </span>
              </h1>
              <p className="text-xs text-slate-400">{t.appTagline}</p>
            </div>
          </div>

          {/* Language Switcher */}
          <div className="flex items-center rounded-xl bg-slate-900 border border-slate-800 p-0.5 text-xs font-medium">
            <button
              onClick={() => setUiLang('en')}
              className={`px-2 py-1 rounded-lg transition ${
                uiLang === 'en'
                  ? 'bg-cyan-500 text-slate-950 font-bold shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              EN
            </button>
            <button
              onClick={() => setUiLang('ku')}
              className={`px-2 py-1 rounded-lg transition ${
                uiLang === 'ku'
                  ? 'bg-cyan-500 text-slate-950 font-bold shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              کوردی
            </button>
            <button
              onClick={() => setUiLang('ar')}
              className={`px-2 py-1 rounded-lg transition ${
                uiLang === 'ar'
                  ? 'bg-cyan-500 text-slate-950 font-bold shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              عربي
            </button>
          </div>
        </div>

        {/* PWA Install Banner */}
        <PWAInstallBanner t={t} isRtl={isRtl} />

        {/* MULTI-ITEM INPUT & QUEUE MANAGEMENT CARD */}
        <div className="relative rounded-3xl glass-panel p-5 sm:p-6 border border-white/10 shadow-2xl space-y-4">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-cyan-400 flex items-center gap-1.5 uppercase tracking-wider">
              <ListOrdered className="w-4 h-4" />
              <span>{t.activeChecklist}</span>
            </label>

            <div className="flex items-center gap-2">
              <span className="text-xs font-mono px-2.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/30">
                {t.remainingItems}: {checklist.length}
              </span>
              {checklist.length > 0 && (
                <button
                  onClick={onClearAll}
                  className="text-[11px] text-slate-400 hover:text-rose-400 flex items-center gap-1 transition"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>{t.clearAll}</span>
                </button>
              )}
            </div>
          </div>

          {/* Add Item Input Bar with Button & Paste detection */}
          <form onSubmit={handleAddSubmit} className="space-y-1.5">
            <div className="relative flex items-center">
              <input
                type="text"
                value={inputText}
                onChange={(e) => {
                  setInputText(e.target.value);
                  if (inputError) setInputError(null);
                }}
                onPaste={handlePaste}
                placeholder={t.addPlaceholder}
                className="w-full py-3.5 px-4 pr-14 rounded-2xl bg-slate-900/90 text-white placeholder-slate-500 text-sm sm:text-base font-medium border border-cyan-500/30 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/20 outline-none shadow-inner transition"
              />
              <button
                type="submit"
                className="absolute right-2 px-3.5 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-teal-400 text-slate-950 font-bold text-xs shadow active:scale-95 transition hover:brightness-110 flex items-center gap-1"
              >
                <Plus className="w-4 h-4 stroke-[3]" />
                <span className="hidden xs:inline">{t.addItem}</span>
              </button>
            </div>
            <div className="flex items-center justify-between px-1 text-[11px] text-slate-400">
              <span className="flex items-center gap-1">
                <ClipboardPaste className="w-3 h-3 text-cyan-400 shrink-0" />
                <span>{t.bulkPasteHint}</span>
              </span>
            </div>
          </form>

          {/* Error Message if empty queue attempted */}
          {inputError && (
            <div className="p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2 animate-shake">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{inputError}</span>
            </div>
          )}

          {/* Active Checklist Items Queue Chips */}
          <div className="space-y-2 pt-1">
            {checklist.length > 0 ? (
              <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto p-1 pr-2">
                {checklist.map((item, idx) => (
                  <div
                    key={item.id}
                    className="group flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-800/90 hover:bg-slate-800 text-white border border-slate-700/80 shadow-sm transition-all animate-fade-in"
                  >
                    <span className="w-4 h-4 rounded-full bg-cyan-500/20 text-cyan-400 font-mono text-[10px] flex items-center justify-center shrink-0">
                      {idx + 1}
                    </span>
                    <span className="text-xs font-semibold max-w-[160px] sm:max-w-[200px] truncate">
                      {item.text}
                    </span>
                    <button
                      onClick={() => onRemoveItem(item.id)}
                      className="p-0.5 rounded-md text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition"
                      aria-label="Remove item"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-4 rounded-2xl bg-slate-900/60 border border-dashed border-slate-800 text-center space-y-1">
                <p className="text-xs text-slate-400 font-medium">
                  {t.emptyQueueWarning}
                </p>
                <p className="text-[11px] text-slate-500">
                  {t.emptyQueueTip}
                </p>
              </div>
            )}
          </div>

          {/* Quick Presets / Tags (Add to Queue on click) */}
          <div className="space-y-2 pt-2 border-t border-slate-800/80">
            <span className="text-[11px] text-slate-400 font-medium flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-cyan-400" />
              <span>{t.quickPresets} (+):</span>
            </span>
            <div className="flex flex-wrap gap-1.5">
              {presets.map((preset) => {
                const isAlreadyIn = checklist.some((c) => c.text.toLowerCase() === preset.toLowerCase());
                return (
                  <button
                    key={preset}
                    onClick={() => {
                      if (!isAlreadyIn) {
                        onAddItem(preset);
                      }
                    }}
                    disabled={isAlreadyIn}
                    className={`px-3 py-1.5 rounded-xl text-xs font-medium transition active:scale-95 flex items-center gap-1 ${
                      isAlreadyIn
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 opacity-70 cursor-default'
                        : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700/60 hover:text-white'
                    }`}
                  >
                    <span>{preset}</span>
                    {isAlreadyIn ? (
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Plus className="w-3 h-3 text-cyan-400" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Settings Grid: OCR Language & Match Precision */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-800/80">
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-slate-400 flex items-center gap-1">
                <Languages className="w-3 h-3 text-cyan-400" />
                <span>{t.ocrLanguage}</span>
              </label>
              <select
                value={ocrLanguage}
                onChange={(e) => setOcrLanguage(e.target.value as OcrLanguage)}
                className="w-full py-2.5 px-3 rounded-xl bg-slate-800/90 border border-slate-700/80 text-xs text-white font-medium outline-none focus:border-cyan-400"
              >
                <option value="eng+ara">{t.ocrLangEngAra}</option>
                <option value="eng">{t.ocrLangEng}</option>
                <option value="ara">{t.ocrLangAra}</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-slate-400 flex items-center gap-1">
                <Sliders className="w-3 h-3 text-cyan-400" />
                <span>{t.matchMode}</span>
              </label>
              <select
                value={matchMode}
                onChange={(e) => setMatchMode(e.target.value as MatchMode)}
                className="w-full py-2.5 px-3 rounded-xl bg-slate-800/90 border border-slate-700/80 text-xs text-white font-medium outline-none focus:border-cyan-400"
              >
                <option value="contains">{t.matchContains}</option>
                <option value="exact">{t.matchExact}</option>
                <option value="fuzzy">{t.matchFuzzy}</option>
              </select>
            </div>
          </div>

          {/* Primary "Start Scanning" Button */}
          <div className="pt-2">
            <button
              onClick={handleStart}
              className="w-full group py-4 px-6 rounded-2xl bg-gradient-to-r from-cyan-500 via-teal-400 to-emerald-400 hover:from-cyan-400 hover:to-emerald-300 text-slate-950 font-extrabold text-base sm:text-lg shadow-xl shadow-cyan-500/25 active:scale-[0.98] transition-all flex items-center justify-center gap-3"
            >
              <Camera className="w-6 h-6 stroke-[2.3] group-hover:scale-110 transition-transform" />
              <span>
                {t.startScanning}
                {checklist.length > 0 ? ` (${checklist.length})` : ''}
              </span>
            </button>
          </div>
        </div>

        {/* Secondary Options: Demo / Upload Image */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={createSampleInvoice}
            className="flex items-center justify-center gap-2 p-3.5 rounded-2xl glass-panel-subtle hover:bg-slate-800/60 border border-slate-800 text-xs text-slate-300 font-medium active:scale-95 transition"
          >
            <FileText className="w-4 h-4 text-emerald-400" />
            <span>{t.sampleImageDemo}</span>
          </button>

          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center justify-center gap-2 p-3.5 rounded-2xl glass-panel-subtle hover:bg-slate-800/60 border border-slate-800 text-xs text-slate-300 font-medium active:scale-95 transition"
          >
            <Upload className="w-4 h-4 text-cyan-400" />
            <span>{t.uploadTestImage}</span>
          </button>
        </div>

        {/* Pro Tips Section */}
        <div className="rounded-2xl bg-slate-900/60 border border-slate-800/60 p-4 space-y-2 text-xs text-slate-400">
          <h4 className="font-semibold text-slate-300 flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            <span>{t.tipTitle}</span>
          </h4>
          <ul className="space-y-1.5 list-disc list-inside text-slate-400">
            <li>{t.tip1}</li>
            <li>{t.tip2}</li>
            <li>{t.tip3}</li>
          </ul>
        </div>
      </div>

      <div className="w-full text-center text-[11px] text-slate-600 py-4 shrink-0">
        PWA Mobile OCR • Multi-Target Queue • Interactive Check-Off Workflow
      </div>
    </div>
  );
};
