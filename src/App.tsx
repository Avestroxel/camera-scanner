import React, { useState, useEffect } from 'react';
import { OcrLanguage, MatchMode, UILanguage } from './types';
import { translations } from './translations';
import { HomeScreen } from './components/HomeScreen';
import { CameraView } from './components/CameraView';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { WifiOff } from 'lucide-react';

export default function App() {
  const [currentView, setCurrentView] = useState<'home' | 'scanner'>('home');
  const [searchQuery, setSearchQuery] = useState('Total');
  const [ocrLanguage, setOcrLanguage] = useState<OcrLanguage>('eng+ara');
  const [matchMode, setMatchMode] = useState<MatchMode>('contains');
  const [uiLang, setUiLang] = useState<UILanguage>('en');
  const [initialImage, setInitialImage] = useState<string | null>(null);

  const isOnline = useOnlineStatus();
  const t = translations[uiLang] || translations.en;
  const isRtl = uiLang === 'ku' || uiLang === 'ar';

  // Synchronize document direction with active UI language
  useEffect(() => {
    document.documentElement.dir = isRtl ? 'rtl' : 'ltr';
    document.documentElement.lang = uiLang;
  }, [isRtl, uiLang]);

  return (
    <main className="w-full h-full min-h-[100dvh] relative overflow-hidden bg-[#090d16] font-sans antialiased">
      {/* Offline Status Toast */}
      {!isOnline && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/90 text-slate-950 font-bold text-xs shadow-lg backdrop-blur-md animate-bounce">
          <WifiOff className="w-3.5 h-3.5" />
          <span>{t.offlineBanner}</span>
        </div>
      )}

      {currentView === 'home' ? (
        <HomeScreen
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          ocrLanguage={ocrLanguage}
          setOcrLanguage={setOcrLanguage}
          matchMode={matchMode}
          setMatchMode={setMatchMode}
          uiLang={uiLang}
          setUiLang={setUiLang}
          t={t}
          isRtl={isRtl}
          onStartScanning={() => {
            setInitialImage(null);
            setCurrentView('scanner');
          }}
          onSelectSampleImage={(dataUrl) => {
            setInitialImage(dataUrl);
            setCurrentView('scanner');
          }}
        />
      ) : (
        <CameraView
          searchQuery={searchQuery}
          ocrLanguage={ocrLanguage}
          matchMode={matchMode}
          t={t}
          isRtl={isRtl}
          initialImageSrc={initialImage}
          onBack={() => {
            setInitialImage(null);
            setCurrentView('home');
          }}
          onUpdateQuery={(newQ) => setSearchQuery(newQ)}
        />
      )}
    </main>
  );
}
