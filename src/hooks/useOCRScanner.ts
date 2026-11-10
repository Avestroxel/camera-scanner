import { useEffect, useRef, useState, useCallback } from 'react';
import { createWorker, Worker } from 'tesseract.js';
import { OcrLanguage, MatchMode, MatchedWord, ScanResult, ChecklistItem, DetectedMatchGroup } from '../types';
import { checkMatch } from '../utils/textMatcher';
import { triggerHaptic, playMatchChime } from '../utils/audioAlert';

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
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeLangRef = useRef<OcrLanguage>(selectedLang);
  const isBusyRef = useRef(false);
  const previousMatchedItemIdsRef = useRef<Set<string>>(new Set());

  // Initialize or reinitialize Tesseract v5 worker when language changes
  useEffect(() => {
    let isCancelled = false;
    activeLangRef.current = selectedLang;

    async function setupWorker() {
      setIsInitializing(true);
      setWorkerStatus('initializing');
      setInitProgress(15);
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
        // Tesseract v5 compliant createWorker call
        const worker = await createWorker(selectedLang, 1, {
          logger: (m) => {
            if (!isCancelled && m.status) {
              if (m.status === 'loading tesseract core') {
                setInitProgress(25);
                setInitStatusText('Loading Tesseract Core...');
              } else if (m.status === 'initializing tesseract') {
                setInitProgress(50);
                setInitStatusText('Initializing OCR...');
              } else if (m.status.includes('loading') || m.status.includes('traineddata')) {
                const p = Math.round((m.progress || 0) * 40) + 50;
                setInitProgress(Math.min(95, p));
                setInitStatusText(`Downloading ${selectedLang} (${Math.round((m.progress || 0) * 100)}%)...`);
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
        setWorkerStatus('ready');
        setInitProgress(100);
        setInitStatusText('OCR Ready');
        setError(null);
      } catch (err) {
        if (!isCancelled) {
          console.error('OCR initialization failed:', err);
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

  // Main scan function with grayscale + contrast pre-processing
  const scanSource = useCallback(
    async (
      source: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement,
      targetItems: ChecklistItem[],
      mode: MatchMode,
      enableHaptics = true,
      enableSound = true
    ): Promise<ScanResult | null> => {
      // Prevent overlapping calls or scanning when worker isn't ready
      if (!workerRef.current || isBusyRef.current || isInitializing || targetItems.length === 0) {
        return null;
      }

      // Check readyState for HTMLVideoElement to ensure valid camera frame
      if (source instanceof HTMLVideoElement) {
        if (source.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
          return null;
        }
      }

      isBusyRef.current = true;
      setIsProcessing(true);
      const startTime = performance.now();

      try {
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

        // Downscale offscreen frame to ~800px width for fast mobile OCR
        const targetW = Math.min(800, srcW);
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

        // Apply Grayscale and Contrast Enhancement for mobile camera accuracy
        try {
          const imgData = ctx.getImageData(0, 0, targetW, targetH);
          const data = imgData.data;
          // Contrast factor enhancement (+45)
          const contrast = 45;
          const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));

          for (let i = 0; i < data.length; i += 4) {
            // Standard Luminance conversion
            const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            const enhanced = Math.min(255, Math.max(0, factor * (gray - 128) + 128));
            data[i] = enhanced;
            data[i + 1] = enhanced;
            data[i + 2] = enhanced;
          }
          ctx.putImageData(imgData, 0, 0);
        } catch (filterErr) {
          // If security or canvas read fails, proceed with raw frame
          console.warn('Canvas filter error:', filterErr);
        }

        // Perform recognition on the enhanced offscreen canvas
        const ret = await workerRef.current.recognize(canvas);
        const rawFullText = (ret.data.text || '').trim();

        // Update raw text preview for live debug pill (first 60 characters)
        const sanitizedPreview = rawFullText.replace(/\s+/g, ' ').slice(0, 60);
        setRawTextPreview(sanitizedPreview);

        // Collect both full lines AND individual words
        interface ExtractedToken {
          text: string;
          confidence: number;
          bbox: { x0: number; y0: number; x1: number; y1: number };
          isLine: boolean;
        }
        const extractedTokens: ExtractedToken[] = [];

        // 1. Process Lines
        if (ret.data.lines && ret.data.lines.length > 0) {
          for (const line of ret.data.lines) {
            if (line.text && line.text.trim().length > 0) {
              extractedTokens.push({
                text: line.text.trim(),
                confidence: Math.round(line.confidence || 0),
                bbox: line.bbox,
                isLine: true,
              });

              // Also collect words inside line
              if (line.words) {
                for (const w of line.words) {
                  if (w.text && w.text.trim().length > 0) {
                    extractedTokens.push({
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

        // 2. Process Blocks as fallback if lines weren't populated
        if (extractedTokens.length === 0 && ret.data.blocks) {
          for (const block of ret.data.blocks) {
            if (block.paragraphs) {
              for (const p of block.paragraphs) {
                if (p.lines) {
                  for (const l of p.lines) {
                    if (l.text && l.text.trim().length > 0) {
                      extractedTokens.push({
                        text: l.text.trim(),
                        confidence: Math.round(l.confidence || 0),
                        bbox: l.bbox,
                        isLine: true,
                      });
                      if (l.words) {
                        for (const w of l.words) {
                          if (w.text && w.text.trim().length > 0) {
                            extractedTokens.push({
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
        }

        // Fallback: check raw full text directly against targets
        // If whole text contains a target, synthesize a fallback token
        for (const target of targetItems) {
          const { isMatch, score } = checkMatch(rawFullText, target.text, mode);
          if (isMatch && !extractedTokens.some((t) => checkMatch(t.text, target.text, mode).isMatch)) {
            // Add a synthetic center token so the Done card pops up
            extractedTokens.push({
              text: rawFullText.slice(0, 30),
              confidence: 85,
              bbox: {
                x0: Math.round(targetW * 0.2),
                y0: Math.round(targetH * 0.4),
                x1: Math.round(targetW * 0.8),
                y1: Math.round(targetH * 0.6),
              },
              isLine: true,
            });
          }
        }

        const invScale = 1 / scaleFactor;
        const allWords: MatchedWord[] = [];
        const matchedWords: MatchedWord[] = [];
        const itemToMatchesMap = new Map<string, MatchedWord[]>();

        for (let i = 0; i < extractedTokens.length; i++) {
          const t = extractedTokens[i];
          const rawText = t.text;
          const bbox = {
            x0: Math.round(t.bbox.x0 * invScale),
            y0: Math.round(t.bbox.y0 * invScale),
            x1: Math.round(t.bbox.x1 * invScale),
            y1: Math.round(t.bbox.y1 * invScale),
          };

          let matchedItem: ChecklistItem | null = null;
          let highestScore = 0;

          // Check token against every active checklist item
          for (const item of targetItems) {
            const { isMatch, score } = checkMatch(rawText, item.text, mode);
            if (isMatch && score > highestScore) {
              highestScore = score;
              matchedItem = item;
            }
          }

          const isMatch = Boolean(matchedItem);
          const wordItem: MatchedWord = {
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

          allWords.push(wordItem);

          if (isMatch && matchedItem) {
            matchedWords.push(wordItem);
            if (!itemToMatchesMap.has(matchedItem.id)) {
              itemToMatchesMap.set(matchedItem.id, []);
            }
            itemToMatchesMap.get(matchedItem.id)!.push(wordItem);
          }
        }

        // Build DetectedMatchGroup per detected checklist item
        const detectedGroups: DetectedMatchGroup[] = [];
        for (const target of targetItems) {
          const words = itemToMatchesMap.get(target.id);
          if (words && words.length > 0) {
            // Find highest confidence word/line as primary
            const primaryWord = words.reduce((prev, curr) =>
              (curr.confidence > prev.confidence ? curr : prev), words[0]);
            detectedGroups.push({
              item: target,
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
          fullText: rawFullText,
          processingTimeMs: Math.round(endTime - startTime),
          frameWidth: srcW,
          frameHeight: srcH,
        };

        setLastScanResult(result);

        // Haptic feedback & audio chime when a new match is detected
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
    workerStatus,
    rawTextPreview,
    isProcessing,
    lastScanResult,
    error,
    scanSource,
  };
}
