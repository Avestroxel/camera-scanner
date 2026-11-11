import React, { useState, useEffect } from 'react';
import { OcrLanguage, MatchMode, UILanguage, ChecklistItem } from './types';
import { translations } from './translations';
import { HomeScreen } from './components/HomeScreen';
import { CameraView } from './components/CameraView';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { WifiOff } from 'lucide-react';

const STORAGE_KEY = 'ocr_multi_checklist_v2';
const THEME_STORAGE_KEY = 'ocr_theme_mode';

const DEFAULT_ITEMS: ChecklistItem[] = [
  { id: 'item-1', text: 'after', createdAt: Date.now(), isCompleted: false },
  { id: 'item-2', text: 'Anas', createdAt: Date.now() + 1, isCompleted: true },
];

export default function App() {
  const [currentView, setCurrentView] = useState<'home' | 'scanner'>('home');
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
      if (savedTheme === 'light' || savedTheme === 'dark') {
        return savedTheme;
      }
    } catch {
      // ignore
    }
    return 'dark';
  });

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

  const [initialTotalCount, setInitialTotalCount] = useState<number>(() => checklist.length);
  const [ocrLanguage, setOcrLanguage] = useState<OcrLanguage>('eng');
  const [matchMode] = useState<MatchMode>('contains');
  const [uiLang, setUiLang] = useState<UILanguage>('en');

  const isOnline = useOnlineStatus();
  const t = translations[uiLang] || translations.en;
  const isRtl = uiLang === 'ku' || uiLang === 'ar';

  // Synchronize theme with document.documentElement and localStorage
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // ignore
    }
  }, [theme]);

  // Synchronize checklist with localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(checklist));
    } catch {
      // ignore
    }
  }, [checklist]);

  // Synchronize document direction with active UI language
  useEffect(() => {
    document.documentElement.dir = isRtl ? 'rtl' : 'ltr';
    document.documentElement.lang = uiLang;
  }, [isRtl, uiLang]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  // Queue manipulation functions
  const handleAddItem = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const newItem: ChecklistItem = {
      id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      text: trimmed,
      createdAt: Date.now(),
      isCompleted: false,
    };
    setChecklist((prev) => [...prev, newItem]);
  };

  const handleAddMultipleItems = (texts: string[]) => {
    const newItems: ChecklistItem[] = texts
      .map((itemText) => itemText.trim())
      .filter((itemText) => itemText.length > 0)
      .map((itemText, idx) => ({
        id: `item-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`,
        text: itemText,
        createdAt: Date.now() + idx,
        isCompleted: false,
      }));

    if (newItems.length > 0) {
      setChecklist((prev) => [...prev, ...newItems]);
    }
  };

  const handleRemoveItem = (id: string) => {
    setChecklist((prev) => prev.filter((i) => i.id !== id));
  };

  const handleToggleItemCompleted = (id: string) => {
    setChecklist((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              isCompleted: !item.isCompleted,
              completedAt: !item.isCompleted ? Date.now() : undefined,
            }
          : item
      )
    );
  };

  const handleClearAll = () => {
    setChecklist([]);
  };

  const handleStartScanning = () => {
    // If all items are currently marked completed, reset them to active so the user can scan them again
    const hasUncompleted = checklist.some((item) => !item.isCompleted);
    if (!hasUncompleted && checklist.length > 0) {
      setChecklist((prev) =>
        prev.map((item) => ({ ...item, isCompleted: false, completedAt: undefined }))
      );
    }
    setInitialTotalCount(checklist.length);
    setCurrentView('scanner');
  };

  const handleCompleteItem = (item: ChecklistItem) => {
    setChecklist((prev) =>
      prev.map((i) =>
        i.id === item.id ? { ...i, isCompleted: true, completedAt: Date.now() } : i
      )
    );
  };

  const handleRestartBatch = () => {
    setChecklist((prev) =>
      prev.map((item) => ({ ...item, isCompleted: false, completedAt: undefined }))
    );
    setCurrentView('home');
  };

  const activeItemsForScanner = checklist.filter((item) => !item.isCompleted);
  const completedItemsForScanner = checklist.filter((item) => Boolean(item.isCompleted));

  return (
    <main className="w-full h-[100dvh] max-h-[100dvh] relative overflow-hidden bg-[#f8fafc] dark:bg-[#0a0a0a] text-[#0f172a] dark:text-white font-sans antialiased transition-colors duration-200">
      {/* Offline Status Toast */}
      {!isOnline && (
        <div className="fixed top-2 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1.5 px-3 py-1 bg-amber-500 text-slate-950 font-bold text-[11px] border border-black/20">
          <WifiOff className="w-3 h-3" />
          <span>{t.offlineBanner}</span>
        </div>
      )}

      {currentView === 'home' ? (
        <HomeScreen
          checklist={checklist}
          onAddItem={handleAddItem}
          onAddMultipleItems={handleAddMultipleItems}
          onRemoveItem={handleRemoveItem}
          onToggleItemCompleted={handleToggleItemCompleted}
          onClearAll={handleClearAll}
          ocrLanguage={ocrLanguage}
          setOcrLanguage={setOcrLanguage}
          uiLang={uiLang}
          setUiLang={setUiLang}
          theme={theme}
          onToggleTheme={toggleTheme}
          t={t}
          isRtl={isRtl}
          onStartScanning={handleStartScanning}
        />
      ) : (
        <CameraView
          checklist={activeItemsForScanner}
          completedItems={completedItemsForScanner}
          initialTotalCount={initialTotalCount}
          ocrLanguage={ocrLanguage}
          matchMode={matchMode}
          t={t}
          isRtl={isRtl}
          onBack={() => setCurrentView('home')}
          onCompleteItem={handleCompleteItem}
          onRestartBatch={handleRestartBatch}
        />
      )}
    </main>
  );
}
