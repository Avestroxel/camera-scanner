import { useEffect, useRef, useState, useCallback } from 'react';
import { createWorker, Worker } from 'tesseract.js';
import { OcrLanguage, MatchMode, MatchedWord, ScanResult, ChecklistItem, DetectedMatchGroup } from '../types';
import { checkMatch, normalizeText } from '../utils/textMatcher';
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
  const previousMatchedItemIdsRef = useRef<Set<string>>(new Set());

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

  // Main scan function comparing against all active checklist items
  const scanSource = useCallback(
    async (
      source: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement,
      targetItems: ChecklistItem[],
      mode: MatchMode,
      enableHaptics = true,
      enableSound = true
    ): Promise<ScanResult | null> => {
      if (!workerRef.current || isBusyRef.current || isInitializing || targetItems.length === 0) {
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

        // Collect both individual words and full lines
        interface RawToken {
          text: string;
          confidence: number;
          bbox: { x0: number; y0: number; x1: number; y1: number };
          isLine?: boolean;
        }
        const rawTokens: RawToken[] = [];

        if (ret.data.blocks) {
          for (const block of ret.data.blocks) {
            if (block.paragraphs) {
              for (const para of block.paragraphs) {
                if (para.lines) {
                  for (const line of para.lines) {
                    // Add the line token for multi-word phrase matching
                    if (line.text && line.text.trim().length > 1) {
                      rawTokens.push({
                        text: line.text.trim(),
                        confidence: Math.round(line.confidence || 0),
                        bbox: line.bbox,
                        isLine: true,
                      });
                    }
                    if (line.words) {
                      for (const w of line.words) {
                        if (w.text && w.text.trim().length > 0) {
                          rawTokens.push({
                            text: w.text.trim(),
                            confidence: Math.round(w.confidence || 0),
                            bbox: w.bbox,
                            isLine: false,
                          });
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }

        const invScale = 1 / scaleFactor;
        const allWords: MatchedWord[] = [];
        const matchedWords: MatchedWord[] = [];
        const itemToMatchesMap = new Map<string, MatchedWord[]>();

        // Pre-normalize target items for ultra-fast comparison
        const normalizedTargets = targetItems.map((item) => ({
          item,
          normText: normalizeText(item.text),
          isMultiWord: item.text.trim().includes(' '),
        }));

        for (let i = 0; i < rawTokens.length; i++) {
          const t = rawTokens[i];
          const rawText = t.text;
          const bbox = {
            x0: Math.round(t.bbox.x0 * invScale),
            y0: Math.round(t.bbox.y0 * invScale),
            x1: Math.round(t.bbox.x1 * invScale),
            y1: Math.round(t.bbox.y1 * invScale),
          };

          let matchedItem: ChecklistItem | null = null;
          let highestScore = 0;

          // Check token against all active checklist items
          for (const target of normalizedTargets) {
            // For multi-word items, prefer line tokens; for single words, prefer word tokens
            if (target.isMultiWord && !t.isLine) {
              continue;
            }
            if (!target.isMultiWord && t.isLine) {
              continue;
            }

            const { isMatch, score } = checkMatch(rawText, target.item.text, mode);
            if (isMatch && score > highestScore) {
              highestScore = score;
              matchedItem = target.item;
            }
          }

          const isMatch = Boolean(matchedItem);
          const item: MatchedWord = {
            id: `tok-${i}-${Date.now()}`,
            text: rawText,
            normalizedText: rawText,
            confidence: t.confidence,
            bbox,
            isMatch,
            score: highestScore,
            matchedItemId: matchedItem?.id,
            matchedItemText: matchedItem?.text,
          };

          allWords.push(item);

          if (isMatch && matchedItem) {
            matchedWords.push(item);
            if (!itemToMatchesMap.has(matchedItem.id)) {
              itemToMatchesMap.set(matchedItem.id, []);
            }
            itemToMatchesMap.get(matchedItem.id)!.push(item);
          }
        }

        // Build DetectedMatchGroup per detected checklist item
        const detectedGroups: DetectedMatchGroup[] = [];
        for (const target of normalizedTargets) {
          const words = itemToMatchesMap.get(target.item.id);
          if (words && words.length > 0) {
            // Find highest confidence or first word as primary
            const primaryWord = words.reduce((prev, curr) =>
              (curr.confidence > prev.confidence ? curr : prev), words[0]);
            detectedGroups.push({
              item: target.item,
              words,
              primaryWord,
            });
          }
        }

        const endTime = performance.now();
        const result: ScanResult = {
          allWords,
          matchedWords,
          detectedGroups,
          fullText: ret.data.text || '',
          processingTimeMs: Math.round(endTime - startTime),
          frameWidth: srcW,
          frameHeight: srcH,
        };

        setLastScanResult(result);

        // Trigger haptics and audio chime if any NEW item was locked onto
        const currentMatchedIds = new Set(detectedGroups.map((g) => g.item.id));
        let hasNewMatch = false;
        for (const id of currentMatchedIds) {
          if (!previousMatchedItemIdsRef.current.has(id)) {
            hasNewMatch = true;
            break;
          }
        }

        if (hasNewMatch) {
          if (enableHaptics) triggerHaptic(60);
          if (enableSound) playMatchChime();
        }
        previousMatchedItemIdsRef.current = currentMatchedIds;

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
