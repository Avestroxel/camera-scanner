import { useEffect, useRef, useState, useCallback } from 'react';
import { createWorker, Worker, PSM } from 'tesseract.js';
import { OcrLanguage, MatchMode, MatchedWord, ScanResult, ChecklistItem, DetectedMatchGroup } from '../types';
import { normalizeText } from '../utils/textMatcher';
import { triggerHaptic, playMatchChime } from '../utils/audioAlert';

interface RawWordItem {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

interface RawLineItem {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  words: RawWordItem[];
}

/**
 * Foolproof cleaner for English, Kurdish, and Arabic text/numbers
 */
function clean(str: string): string {
  if (!str) return '';
  return normalizeText(str)
    .toLowerCase()
    .trim()
    .replace(/[^\w\u0600-\u06FF]/g, '');
}

export function useOCRScanner(selectedLang: OcrLanguage) {
  const [isInitializing, setIsInitializing] = useState(true);
  const [initProgress, setInitProgress] = useState(0);
  const [initStatusText, setInitStatusText] = useState('Loading OCR Engine...');
  const [workerStatus, setWorkerStatus] = useState<'initializing' | 'ready' | 'error'>('initializing');
  const [rawTextPreview, setRawTextPreview] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastScanResult, setLastScanResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const ocrCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isScanningRef = useRef(false);
  const previousMatchedItemIdsRef = useRef<Set<string>>(new Set());

  // Initialize persistent Tesseract v5 worker once per selected language
  useEffect(() => {
    let isCancelled = false;

    async function setupWorker() {
      setIsInitializing(true);
      setWorkerStatus('initializing');
      setInitProgress(15);
      setInitStatusText(`Loading ${selectedLang}...`);

      if (workerRef.current) {
        try {
          await workerRef.current.terminate();
        } catch {
          // ignore
        }
        workerRef.current = null;
      }

      try {
        const worker = await createWorker(selectedLang, 1, {
          logger: (m) => {
            if (!isCancelled && m.status) {
              if (m.status === 'loading tesseract core') {
                setInitProgress(25);
                setInitStatusText('Loading Engine...');
              } else if (m.status === 'initializing tesseract') {
                setInitProgress(50);
                setInitStatusText('Initializing OCR...');
              } else if (m.status.includes('loading') || m.status.includes('traineddata')) {
                const p = Math.round((m.progress || 0) * 40) + 50;
                setInitProgress(Math.min(95, p));
                setInitStatusText(`Loading ${selectedLang} (${Math.round((m.progress || 0) * 100)}%)...`);
              }
            }
          },
        });

        if (isCancelled) {
          await worker.terminate();
          return;
        }

        // PSM 6 = Assume a single uniform block of text (most reliable mode for screens, papers, and labels)
        await worker.setParameters({
          tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
        });

        workerRef.current = worker;
        setIsInitializing(false);
        setWorkerStatus('ready');
        setInitProgress(100);
        setInitStatusText('Ready / Scanning...');
        setError(null);
      } catch (err) {
        if (!isCancelled) {
          console.error('OCR init error:', err);
          const errorMsg = err instanceof Error ? err.message : String(err);
          setError(`Worker Error: ${errorMsg}`);
          setWorkerStatus('error');
          setInitStatusText(`Error: ${errorMsg}`);
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

  // Clean, fast scan function: 1024px raw drawImage (ZERO ctx.filter / SVG filters)
  const scanSource = useCallback(
    async (
      source: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement,
      targetItems: ChecklistItem[],
      _mode: MatchMode,
      enableHaptics = true,
      enableSound = true
    ): Promise<ScanResult | null> => {
      if (!workerRef.current || isScanningRef.current || isInitializing || targetItems.length === 0) {
        return null;
      }

      if (source instanceof HTMLVideoElement) {
        if (source.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || source.videoWidth === 0) {
          return null;
        }
      }

      isScanningRef.current = true;
      setIsProcessing(true);
      const startTime = performance.now();

      try {
        let videoW = 0;
        let videoH = 0;
        if (source instanceof HTMLVideoElement) {
          videoW = source.videoWidth;
          videoH = source.videoHeight;
        } else if (source instanceof HTMLCanvasElement) {
          videoW = source.width;
          videoH = source.height;
        } else if (source instanceof HTMLImageElement) {
          videoW = source.naturalWidth || source.width;
          videoH = source.naturalHeight || source.height;
        }

        if (videoW === 0 || videoH === 0) {
          return null;
        }

        // Offscreen canvas width fixed at 1024px (proportional height)
        const ocrW = 1024;
        const ocrH = Math.max(1, Math.round((videoH / videoW) * ocrW));

        if (!ocrCanvasRef.current) {
          ocrCanvasRef.current = document.createElement('canvas');
        }
        const ocrCanvas = ocrCanvasRef.current;
        if (ocrCanvas.width !== ocrW || ocrCanvas.height !== ocrH) {
          ocrCanvas.width = ocrW;
          ocrCanvas.height = ocrH;
        }

        const ocrCtx = ocrCanvas.getContext('2d');
        if (!ocrCtx) {
          return null;
        }

        // Direct, raw drawImage — NO ctx.filter or SVG filters (100% iOS Safari compatible)
        ocrCtx.drawImage(source, 0, 0, ocrW, ocrH);

        const ret = await workerRef.current.recognize(ocrCanvas);
        const data = ret.data;
        const rawFullText = (data.text || '').trim();

        // Update top debug bar with raw detected text preview
        const sanitizedPreview = rawFullText.replace(/\s+/g, ' ').slice(0, 60);
        setRawTextPreview(sanitizedPreview);

        // Collect all words and lines from Tesseract output
        const wordsList: RawWordItem[] = [];
        const linesList: RawLineItem[] = [];

        const rawTopWords = (data as unknown as { words?: RawWordItem[] }).words;
        if (rawTopWords && Array.isArray(rawTopWords) && rawTopWords.length > 0) {
          for (const w of rawTopWords) {
            if (w.text && w.text.trim() && w.bbox) {
              wordsList.push({
                text: w.text.trim(),
                confidence: Math.round(w.confidence || 80),
                bbox: w.bbox,
              });
            }
          }
        }

        if (data.lines && Array.isArray(data.lines)) {
          for (const line of data.lines) {
            const lineWords: RawWordItem[] = [];
            if (line.words && Array.isArray(line.words)) {
              for (const w of line.words) {
                if (w.text && w.text.trim() && w.bbox) {
                  const item: RawWordItem = {
                    text: w.text.trim(),
                    confidence: Math.round(w.confidence || 80),
                    bbox: w.bbox,
                  };
                  lineWords.push(item);
                  if (wordsList.length === 0) {
                    wordsList.push(item);
                  }
                }
              }
            }
            if (line.text && line.text.trim() && line.bbox) {
              linesList.push({
                text: line.text.trim(),
                confidence: Math.round(line.confidence || 80),
                bbox: line.bbox,
                words: lineWords,
              });
            }
          }
        }

        // Also check blocks -> paragraphs -> lines if both wordsList and linesList were empty
        if (wordsList.length === 0 && linesList.length === 0 && data.blocks) {
          for (const b of data.blocks) {
            if (b.paragraphs) {
              for (const p of b.paragraphs) {
                if (p.lines) {
                  for (const l of p.lines) {
                    const lineWords: RawWordItem[] = [];
                    if (l.words) {
                      for (const w of l.words) {
                        if (w.text && w.text.trim() && w.bbox) {
                          const item: RawWordItem = {
                            text: w.text.trim(),
                            confidence: Math.round(w.confidence || 80),
                            bbox: w.bbox,
                          };
                          lineWords.push(item);
                          wordsList.push(item);
                        }
                      }
                    }
                    if (l.text && l.text.trim() && l.bbox) {
                      linesList.push({
                        text: l.text.trim(),
                        confidence: Math.round(l.confidence || 80),
                        bbox: l.bbox,
                        words: lineWords,
                      });
                    }
                  }
                }
              }
            }
          }
        }

        const matchedWords: MatchedWord[] = [];
        const itemToMatchesMap = new Map<string, MatchedWord[]>();

        // Loop through user's active checklist items
        for (const targetItem of targetItems) {
          const cleanTarget = clean(targetItem.text);
          if (!cleanTarget) continue;

          let matchedInWords = false;

          // 1. Check every word in data.words first
          for (let i = 0; i < wordsList.length; i++) {
            const w = wordsList[i];
            const cleanWord = clean(w.text);
            if (!cleanWord) continue;

            const isDirectMatch = cleanWord.includes(cleanTarget);
            const isReverseMatch =
              cleanWord.length >= 3 &&
              cleanTarget.length >= 3 &&
              cleanTarget.includes(cleanWord);

            if (isDirectMatch || isReverseMatch) {
              matchedInWords = true;
              const matchObj: MatchedWord = {
                id: `w-${targetItem.id}-${i}-${Date.now()}`,
                text: w.text,
                normalizedText: cleanWord,
                confidence: w.confidence,
                bbox: w.bbox,
                isMatch: true,
                score: isDirectMatch ? 1.0 : 0.9,
                matchedItemId: targetItem.id,
                matchedItemText: targetItem.text,
              };

              matchedWords.push(matchObj);
              if (!itemToMatchesMap.has(targetItem.id)) {
                itemToMatchesMap.set(targetItem.id, []);
              }
              itemToMatchesMap.get(targetItem.id)!.push(matchObj);
            }
          }

          // 2. Fallback: check data.lines if not matched by individual word (e.g. multi-word target)
          if (!matchedInWords) {
            for (let lIdx = 0; lIdx < linesList.length; lIdx++) {
              const line = linesList[lIdx];
              const cleanLine = clean(line.text);
              if (!cleanLine || !cleanLine.includes(cleanTarget)) continue;

              // Find the subset of words inside this line that belong to the target phrase
              const targetParts = targetItem.text
                .trim()
                .split(/\s+/)
                .map((p) => clean(p))
                .filter(Boolean);

              const matchingLineWords = line.words.filter((lw) => {
                const cw = clean(lw.text);
                return (
                  cw.length > 0 &&
                  (cleanTarget.includes(cw) ||
                    cw.includes(cleanTarget) ||
                    targetParts.some((tp) => cw.includes(tp) || tp.includes(cw)))
                );
              });

              const bboxToUse =
                matchingLineWords.length > 0
                  ? {
                      x0: Math.min(...matchingLineWords.map((lw) => lw.bbox.x0)),
                      y0: Math.min(...matchingLineWords.map((lw) => lw.bbox.y0)),
                      x1: Math.max(...matchingLineWords.map((lw) => lw.bbox.x1)),
                      y1: Math.max(...matchingLineWords.map((lw) => lw.bbox.y1)),
                    }
                  : line.bbox;

              const matchObj: MatchedWord = {
                id: `l-${targetItem.id}-${lIdx}-${Date.now()}`,
                text: line.text,
                normalizedText: cleanLine,
                confidence: line.confidence,
                bbox: bboxToUse,
                isMatch: true,
                score: 0.95,
                matchedItemId: targetItem.id,
                matchedItemText: targetItem.text,
              };

              matchedWords.push(matchObj);
              if (!itemToMatchesMap.has(targetItem.id)) {
                itemToMatchesMap.set(targetItem.id, []);
              }
              itemToMatchesMap.get(targetItem.id)!.push(matchObj);
            }
          }
        }

        const detectedGroups: DetectedMatchGroup[] = [];
        for (const target of targetItems) {
          const words = itemToMatchesMap.get(target.id);
          if (words && words.length > 0) {
            const primaryWord = words.reduce(
              (prev, curr) => (curr.confidence > prev.confidence ? curr : prev),
              words[0]
            );
            detectedGroups.push({
              item: target,
              words,
              primaryWord,
            });
          }
        }

        const endTime = performance.now();
        // Store ocrW & ocrH as frameWidth & frameHeight so bbox coordinates map directly from ocrCanvas space
        const result: ScanResult = {
          allWords: matchedWords,
          matchedWords,
          detectedGroups,
          fullText: rawFullText,
          processingTimeMs: Math.round(endTime - startTime),
          frameWidth: ocrW,
          frameHeight: ocrH,
        };

        setLastScanResult(result);

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
        isScanningRef.current = false;
        setIsProcessing(false);
      }
    },
    [isInitializing]
  );

  return {
    isInitializing,
    initProgress,
    initStatusText,
    workerStatus,
    rawTextPreview,
    isProcessing,
    lastScanResult,
    error,
    scanSource,
  };
}
