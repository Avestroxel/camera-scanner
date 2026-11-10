import { useEffect, useRef, useState, useCallback } from 'react';
import { createWorker, Worker } from 'tesseract.js';
import { OcrLanguage, MatchMode, MatchedWord, ScanResult } from '../types';
import { checkMatch } from '../utils/textMatcher';
import { triggerHaptic, playMatchChime } from '../utils/audioAlert';

export function useOCRScanner(selectedLang: OcrLanguage) {
  const [isInitializing, setIsInitializing] = useState(true);
  const [initProgress, setInitProgress] = useState(0);
  const [initStatusText, setInitStatusText] = useState('Initializing OCR Engine...');
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastScanResult, setLastScanResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeLangRef = useRef<OcrLanguage>(selectedLang);
  const isBusyRef = useRef(false);
  const hadMatchesRef = useRef(false);

  // Initialize or reinitialize worker when language changes
  useEffect(() => {
    let isCancelled = false;
    activeLangRef.current = selectedLang;

    async function setupWorker() {
      setIsInitializing(true);
      setInitProgress(10);
      setInitStatusText(`Loading ${selectedLang} models...`);

      if (workerRef.current) {
        try {
          await workerRef.current.terminate();
        } catch {
          // Ignore termination errors
        }
        workerRef.current = null;
      }

      try {
        const worker = await createWorker(selectedLang, 1, {
          logger: (m) => {
            if (!isCancelled && m.status) {
              if (m.status === 'loading tesseract core') {
                setInitProgress(25);
                setInitStatusText('Loading OCR Core...');
              } else if (m.status === 'initializing tesseract') {
                setInitProgress(50);
                setInitStatusText('Initializing Tesseract...');
              } else if (m.status.includes('loading') || m.status.includes('traineddata')) {
                const p = Math.round((m.progress || 0) * 40) + 50;
                setInitProgress(Math.min(95, p));
                setInitStatusText(`Downloading ${selectedLang} data (${Math.round((m.progress || 0) * 100)}%)...`);
              }
            }
          },
        });

        if (isCancelled) {
          await worker.terminate();
          return;
        }

        workerRef.current = worker;
        setIsInitializing(false);
        setInitProgress(100);
        setInitStatusText('OCR Ready');
        setError(null);
      } catch (err) {
        if (!isCancelled) {
          console.error('OCR initialization failed:', err);
          setError('Failed to load OCR language models. Check your internet connection.');
          setIsInitializing(false);
        }
      }
    }

    setupWorker();

    return () => {
      isCancelled = true;
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, [selectedLang]);

  // Main scan function
  const scanSource = useCallback(
    async (
      source: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement,
      searchQuery: string,
      mode: MatchMode,
      enableHaptics = true,
      enableSound = true
    ): Promise<ScanResult | null> => {
      if (!workerRef.current || isBusyRef.current || isInitializing) {
        return null;
      }

      isBusyRef.current = true;
      setIsProcessing(true);
      const startTime = performance.now();

      try {
        // Determine source intrinsic dimensions
        let srcW = 0;
        let srcH = 0;
        if (source instanceof HTMLVideoElement) {
          srcW = source.videoWidth;
          srcH = source.videoHeight;
        } else if (source instanceof HTMLCanvasElement) {
          srcW = source.width;
          srcH = source.height;
        } else if (source instanceof HTMLImageElement) {
          srcW = source.naturalWidth || source.width;
          srcH = source.naturalHeight || source.height;
        }

        if (srcW === 0 || srcH === 0) {
          isBusyRef.current = false;
          setIsProcessing(false);
          return null;
        }

        // Downscale offscreen frame for responsive 60fps OCR
        // Scale to ~800px max width/height to drastically reduce latency while maintaining high text fidelity
        const targetW = Math.min(840, srcW);
        const scaleFactor = targetW / srcW;
        const targetH = Math.round(srcH * scaleFactor);

        if (!offscreenCanvasRef.current) {
          offscreenCanvasRef.current = document.createElement('canvas');
        }
        const canvas = offscreenCanvasRef.current;
        canvas.width = targetW;
        canvas.height = targetH;

        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          isBusyRef.current = false;
          setIsProcessing(false);
          return null;
        }

        // Draw downscaled frame
        ctx.drawImage(source, 0, 0, targetW, targetH);

        // Perform recognition on offscreen canvas
        const ret = await workerRef.current.recognize(canvas);

        // Collect all detected words across blocks -> paragraphs -> lines
        const wordsData: Array<{ text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }> = [];
        if (ret.data.blocks) {
          for (const block of ret.data.blocks) {
            if (block.paragraphs) {
              for (const para of block.paragraphs) {
                if (para.lines) {
                  for (const line of para.lines) {
                    if (line.words) {
                      for (const w of line.words) {
                        wordsData.push(w);
                      }
                    }
                  }
                }
              }
            }
          }
        }

        // Fallback if words array exists directly
        const rawAnyData = ret.data as unknown as { words?: typeof wordsData };
        if (wordsData.length === 0 && Array.isArray(rawAnyData.words)) {
          wordsData.push(...rawAnyData.words);
        }

        const allWords: MatchedWord[] = [];
        const matchedWords: MatchedWord[] = [];

        for (let i = 0; i < wordsData.length; i++) {
          const w = wordsData[i];
          const rawText = w.text ? w.text.trim() : '';
          if (!rawText || rawText.length < 1) continue;

          // Map bounding box from offscreen downscaled coords back to intrinsic source coords
          const invScale = 1 / scaleFactor;
          const bbox = {
            x0: Math.round(w.bbox.x0 * invScale),
            y0: Math.round(w.bbox.y0 * invScale),
            x1: Math.round(w.bbox.x1 * invScale),
            y1: Math.round(w.bbox.y1 * invScale),
          };

          const { isMatch, score } = searchQuery.trim()
            ? checkMatch(rawText, searchQuery, mode)
            : { isMatch: false, score: 0 };

          const item: MatchedWord = {
            id: `w-${i}-${Date.now()}`,
            text: rawText,
            normalizedText: rawText,
            confidence: Math.round(w.confidence || 0),
            bbox,
            isMatch,
            score,
          };

          allWords.push(item);
          if (isMatch) {
            matchedWords.push(item);
          }
        }

        const endTime = performance.now();
        const result: ScanResult = {
          allWords,
          matchedWords,
          fullText: ret.data.text || '',
          processingTimeMs: Math.round(endTime - startTime),
          frameWidth: srcW,
          frameHeight: srcH,
        };

        setLastScanResult(result);

        // Trigger haptics and audio chime on fresh match
        if (matchedWords.length > 0) {
          if (!hadMatchesRef.current) {
            if (enableHaptics) triggerHaptic(60);
            if (enableSound) playMatchChime();
          }
          hadMatchesRef.current = true;
        } else {
          hadMatchesRef.current = false;
        }

        return result;
      } catch (err) {
        console.warn('OCR scan error:', err);
        return null;
      } finally {
        isBusyRef.current = false;
        setIsProcessing(false);
      }
    },
    [isInitializing]
  );

  return {
    isInitializing,
    initProgress,
    initStatusText,
    isProcessing,
    lastScanResult,
    error,
    scanSource,
  };
}
