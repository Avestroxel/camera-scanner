import React, { useRef } from 'react';
import {
  Scan,
  Search,
  Sparkles,
  Languages,
  Zap,
  Globe,
  Camera,
  Upload,
  FileText,
  X,
  Sliders,
  Check,
} from 'lucide-react';
import { OcrLanguage, MatchMode, UILanguage } from '../types';
import { Translation, PRESETS_BY_LANG } from '../translations';
import { PWAInstallBanner } from './PWAInstallBanner';

interface Props {
  searchQuery: string;
  setSearchQuery: (val: string) => void;
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
  searchQuery,
  setSearchQuery,
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const presets = PRESETS_BY_LANG[uiLang] || PRESETS_BY_LANG.en;

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

  // Generate an instant rich sample receipt canvas image for 1-tap testing
  const createSampleInvoice = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 1000;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clean paper texture background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 800, 1000);

    // Subtle receipt header
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 36px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('STARLIGHT STORE', 400, 80);

    ctx.font = '18px monospace';
    ctx.fillStyle = '#64748b';
    ctx.fillText('Tax Invoice #INV-92841', 400, 120);
    ctx.fillText('Date: 2026-11-10  Time: 14:30', 400, 150);

    // Dotted divider line
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.beginPath();
    ctx.moveTo(80, 180);
    ctx.lineTo(720, 180);
    ctx.stroke();
    ctx.setLineDash([]);

    // Items table
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

    // Subtotal and Total
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

    // Kurdish and Arabic sample line
    y += 70;
    ctx.font = 'bold 24px sans-serif';
    ctx.fillStyle = '#1e293b';
    ctx.textAlign = 'center';
    ctx.fillText('کۆی گشتی: $52.71 (Total)', 400, y);

    y += 40;
    ctx.font = '20px sans-serif';
    ctx.fillStyle = '#475569';
    ctx.fillText('المجموع الكلي: $52.71', 400, y);

    // Barcode mock at bottom
    y += 80;
    ctx.fillStyle = '#0f172a';
    for (let x = 180; x < 620; x += 8) {
      const barW = (x % 3 === 0) ? 5 : 2;
      ctx.fillRect(x, y, barW, 60);
    }
    ctx.font = '16px monospace';
    ctx.fillText('*SERIAL-8942-X7*', 400, y + 85);

    const dataUrl = canvas.toDataURL('image/png');
    onSelectSampleImage(dataUrl);
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

      {/* Main Content Area */}
      <div className="w-full max-w-lg mx-auto space-y-6 pt-2">
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
                  v2.0
                </span>
              </h1>
              <p className="text-xs text-slate-400">{t.appTagline}</p>
            </div>
          </div>

          {/* Language Switcher (EN / کوردی / عربي) */}
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

        {/* In-App PWA Install Banner */}
        <PWAInstallBanner t={t} isRtl={isRtl} />

        {/* SEARCH TARGET INPUT CARD (Glassmorphic Hero Card) */}
        <div className="relative rounded-3xl glass-panel p-5 sm:p-6 border border-white/10 shadow-2xl space-y-4">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-cyan-400 flex items-center gap-1.5 uppercase tracking-wider">
              <Search className="w-3.5 h-3.5" />
              <span>{t.searchingFor}</span>
            </label>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="text-[11px] text-slate-400 hover:text-rose-400 flex items-center gap-1 transition"
              >
                <X className="w-3 h-3" />
                <span>{t.clear}</span>
              </button>
            )}
          </div>

          {/* Prominent Search Input Field */}
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t.searchPlaceholder}
              autoFocus
              className="w-full py-4 px-4 pr-11 rounded-2xl bg-slate-900/90 text-white placeholder-slate-500 text-base sm:text-lg font-medium border border-cyan-500/30 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/20 outline-none shadow-inner transition"
            />
            <div className="absolute inset-y-0 right-3.5 flex items-center pointer-events-none text-cyan-400">
              <Sparkles className="w-5 h-5 animate-pulse" />
            </div>
          </div>

          {/* Quick Presets / Tags */}
          <div className="space-y-2 pt-1">
            <span className="text-[11px] text-slate-400 font-medium">
              {t.quickPresets}:
            </span>
            <div className="flex flex-wrap gap-1.5">
              {presets.map((preset) => (
                <button
                  key={preset}
                  onClick={() => setSearchQuery(preset)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium transition active:scale-95 ${
                    searchQuery.toLowerCase() === preset.toLowerCase()
                      ? 'bg-cyan-500 text-slate-950 font-bold shadow-md shadow-cyan-500/30'
                      : 'bg-slate-800/80 hover:bg-slate-800 text-slate-300 border border-slate-700/60'
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>

          {/* Settings Grid: OCR Language & Match Precision */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-800/80">
            {/* OCR Language Selector */}
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

            {/* Match Precision Selector */}
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
              onClick={onStartScanning}
              className="w-full group py-4 px-6 rounded-2xl bg-gradient-to-r from-cyan-500 via-teal-400 to-emerald-400 hover:from-cyan-400 hover:to-emerald-300 text-slate-950 font-extrabold text-base sm:text-lg shadow-xl shadow-cyan-500/25 active:scale-[0.98] transition-all flex items-center justify-center gap-3"
            >
              <Camera className="w-6 h-6 stroke-[2.3] group-hover:scale-110 transition-transform" />
              <span>{t.startScanning}</span>
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

      {/* Footer Branding */}
      <div className="w-full text-center text-[11px] text-slate-600 py-4 shrink-0">
        PWA Mobile OCR • Offline Ready • Real-Time Text Highlighter
      </div>
    </div>
  );
};
