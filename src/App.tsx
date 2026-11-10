import React, { useState, useEffect } from 'react';
import { OcrLanguage, MatchMode, UILanguage, ChecklistItem } from './types';
import { translations } from './translations';
import { HomeScreen } from './components/HomeScreen';
import { CameraView } from './components/CameraView';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { WifiOff } from 'lucide-react';

const STORAGE_KEY = 'ocr_multi_checklist';

const DEFAULT_ITEMS: ChecklistItem[] = [
  { id: 'item-1', text: 'Total', createdAt: Date.now() },
  { id: 'item-2', text: 'Invoice', createdAt: Date.now() + 1 },
  { id: 'item-3', text: '$52.71', createdAt: Date.now() + 2 },
];

export default function App() {
  const [currentView, setCurrentView] = useState<'home' | 'scanner'>('home');
  const [checklist, setChecklist] = useState<ChecklistItem[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch {
      // fallback
    }
    return DEFAULT_ITEMS;
  });

  const [completedItems, setCompletedItems] = useState<ChecklistItem[]>([]);
  const [initialTotalCount, setInitialTotalCount] = useState<number>(() => checklist.length);
  const [ocrLanguage, setOcrLanguage] = useState<OcrLanguage>('eng+ara');
  const [matchMode, setMatchMode] = useState<MatchMode>('contains');
  const [uiLang, setUiLang] = useState<UILanguage>('en');
  const [initialImage, setInitialImage] = useState<string | null>(null);

  const isOnline = useOnlineStatus();
  const t = translations[uiLang] || translations.en;
  const isRtl = uiLang === 'ku' || uiLang === 'ar';

  // Synchronize checklist with localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(checklist));
    } catch {
      // ignore storage quota errors
    }
  }, [checklist]);

  // Synchronize document direction with active UI language
  useEffect(() => {
    document.documentElement.dir = isRtl ? 'rtl' : 'ltr';
    document.documentElement.lang = uiLang;
  }, [isRtl, uiLang]);

  // Queue manipulation functions
  const handleAddItem = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const newItem: ChecklistItem = {
      id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      text: trimmed,
      createdAt: Date.now(),
    };
    setChecklist((prev) => [...prev, newItem]);
  };

  const handleAddMultipleItems = (texts: string[]) => {
    const newItems: ChecklistItem[] = texts
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
      .map((t, idx) => ({
        id: `item-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`,
        text: t,
        createdAt: Date.now() + idx,
      }));

    if (newItems.length > 0) {
      setChecklist((prev) => [...prev, ...newItems]);
    }
  };

  const handleRemoveItem = (id: string) => {
    setChecklist((prev) => prev.filter((i) => i.id !== id));
  };

  const handleClearAll = () => {
    setChecklist([]);
  };

  const handleStartScanning = () => {
    setCompletedItems([]);
    setInitialTotalCount(checklist.length);
    setInitialImage(null);
    setCurrentView('scanner');
  };

  // Called when user taps "تەواو" (Done) on an item from the camera screen
  const handleCompleteItem = (item: ChecklistItem) => {
    setChecklist((prev) => prev.filter((i) => i.id !== item.id));
    setCompletedItems((prev) => [
      ...prev,
      { ...item, isCompleted: true, completedAt: Date.now() },
    ]);
  };

  // Restart batch after all items are completed
  const handleRestartBatch = () => {
    setChecklist(DEFAULT_ITEMS);
    setCompletedItems([]);
    setInitialImage(null);
    setCurrentView('home');
  };

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
          checklist={checklist}
          onAddItem={handleAddItem}
          onAddMultipleItems={handleAddMultipleItems}
          onRemoveItem={handleRemoveItem}
          onClearAll={handleClearAll}
          ocrLanguage={ocrLanguage}
          setOcrLanguage={setOcrLanguage}
          matchMode={matchMode}
          setMatchMode={setMatchMode}
          uiLang={uiLang}
          setUiLang={setUiLang}
          t={t}
          isRtl={isRtl}
          onStartScanning={handleStartScanning}
          onSelectSampleImage={(dataUrl) => {
            setCompletedItems([]);
            setInitialTotalCount(checklist.length);
            setInitialImage(dataUrl);
            setCurrentView('scanner');
          }}
        />
      ) : (
        <CameraView
          checklist={checklist}
          completedItems={completedItems}
          initialTotalCount={initialTotalCount}
          ocrLanguage={ocrLanguage}
          matchMode={matchMode}
          t={t}
          isRtl={isRtl}
          initialImageSrc={initialImage}
          onBack={() => {
            setInitialImage(null);
            setCurrentView('home');
          }}
          onCompleteItem={handleCompleteItem}
          onRestartBatch={handleRestartBatch}
        />
      )}
    </main>
  );
}
