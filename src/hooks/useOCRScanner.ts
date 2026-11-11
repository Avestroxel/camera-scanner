import { useEffect, useRef, useState, useCallback } from 'react';
import { createWorker, createScheduler, Scheduler, Worker, PSM } from 'tesseract.js';
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

const FAST_LANG_CDN = 'https://tessdata.projectnaptha.com/4.0.0_fast';
const PARALLEL_WORKERS = 2;
const OCR_TARGET_WIDTH = 580;

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

/**
 * Tightens a word's horizontal bounding box when the OCR token contains extra characters
 * around the target query (e.g. "Price:50" or "after," when searching "50" or "after").
 */
function tightenWordBbox(
  bbox: { x0: number; y0: number; x1: number; y1: number },
  rawWordText: string,
  targetText: string
): { x0: number; y0: number; x1: number; y1: number } {
  const cWord = clean(rawWordText);
  const cTarget = clean(targetText);
  if (
    cWord.length > cTarget.length + 1 &&
    cTarget.length >= 2 &&
    cWord.includes(cTarget)
  ) {
    const idx = cWord.indexOf(cTarget);
    if (idx >= 0) {
      const w = bbox.x1 - bbox.x0;
      const startRatio = idx / cWord.length;
      const endRatio = (idx + cTarget.length) / cWord.length;
      return {
        x0: bbox.x0 + w * startRatio,
        y0: bbox.y0,
        x1: bbox.x0 + w * endRatio,
        y1: bbox.y1,
      };
    }
  }
  return bbox;
}

export function useOCRScanner(selectedLang: OcrLanguage) {
  const [isInitializing, setIsInitializing] = useState(true);
  const [initProgress, setInitProgress] = useState(0);
  const [initStatusText, setInitStatusText] = useState('Loading Fast OCR Engine...');
  const [workerStatus, setWorkerStatus] = useState<'initializing' | 'ready' | 'error'>('initializing');
  const [rawTextPreview, setRawTextPreview] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastScanResult, setLastScanResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const schedulerRef = useRef<Scheduler | null>(null);
  const workersRef = useRef<Worker[]>([]);
  // Dual 580px offscreen canvas pool so 2 parallel workers never overwrite each other's frame
  const canvasPoolRef = useRef<[HTMLCanvasElement | null, HTMLCanvasElement | null]>([null, null]);
  const poolIndexRef = useRef<number>(0);
  const activeJobsRef = useRef<number>(0);
  const latestCompletedSeqRef = useRef<number>(0);
  const jobSeqCounterRef = useRef<number>(0);
  const previousMatchedItemIdsRef = useRef<Set<string>>(new Set());

  // Initialize Dual-Worker Tesseract v5 Scheduler with 4.0.0_fast + PSM 11 + DAWG disabled
  useEffect(() => {
    let isCancelled = false;

    async function setupFastScheduler() {
      setIsInitializing(true);
      setWorkerStatus('initializing');
      setInitProgress(15);
      setInitStatusText(`Loading Fast ${selectedLang}...`);

      if (schedulerRef.current) {
        try {
          await schedulerRef.current.terminate();
        } catch {
          // ignore
        }
        schedulerRef.current = null;
        workersRef.current = [];
      }

      try {
        const scheduler = createScheduler();

        const createFastWorker = async (workerIdx: number): Promise<Worker> => {
          let worker: Worker;
          try {
            worker = await createWorker(selectedLang, 1, {
              langPath: FAST_LANG_CDN,
              logger:
                workerIdx === 0
                  ? (m) => {
                      if (!isCancelled && m.status) {
                        if (m.status === 'loading tesseract core') {
                          setInitProgress(30);
                          setInitStatusText('Loading Fast Core...');
                        } else if (m.status === 'initializing tesseract') {
                          setInitProgress(60);
                          setInitStatusText('Initializing Dual Workers...');
                        } else if (m.status.includes('loading') || m.status.includes('traineddata')) {
                          const p = Math.round((m.progress || 0) * 35) + 60;
                          setInitProgress(Math.min(98, p));
                          setInitStatusText(
                            `Fast Model ${selectedLang} (${Math.round((m.progress || 0) * 100)}%)...`
                          );
                        }
                      }
                    }
                  : undefined,
            });
          } catch {
            worker = await createWorker(selectedLang, 1);
          }

          // PSM 11 (Sparse text - ultra fast) + disable dictionary DAWGs & unused serialization
          await worker.setParameters({
            tessedit_pageseg_mode: PSM.SPARSE_TEXT,
            load_system_dawg: '0',
            load_freq_dawg: '0',
            tessjs_create_hocr: '0',
            tessjs_create_tsv: '0',
            tessjs_create_box: '0',
            tessjs_create_unlv: '0',
            tessjs_create_osd: '0',
          });

          return worker;
        };

        const createdWorkers = await Promise.all(
          Array.from({ length: PARALLEL_WORKERS }, (_, idx) => createFastWorker(idx))
        );

        if (isCancelled) {
          await Promise.all(createdWorkers.map((w) => w.terminate()));
          return;
        }

        for (const w of createdWorkers) {
          scheduler.addWorker(w);
        }

        schedulerRef.current = scheduler;
        workersRef.current = createdWorkers;
        activeJobsRef.current = 0;
        setIsInitializing(false);
        setWorkerStatus('ready');
        setInitProgress(100);
        setInitStatusText('Ready / Scanning...');
        setError(null);
      } catch (err) {
        if (!isCancelled) {
          console.error('OCR scheduler init error:', err);
          const errorMsg = err instanceof Error ? err.message : String(err);
          setError(`Worker Error: ${errorMsg}`);
          setWorkerStatus('error');
          setInitStatusText(`Error: ${errorMsg}`);
          setIsInitializing(false);
        }
      }
    }

    setupFastScheduler();

    return () => {
      isCancelled = true;
      if (schedulerRef.current) {
        schedulerRef.current.terminate();
        schedulerRef.current = null;
        workersRef.current = [];
      }
    };
  }, [selectedLang]);

  // Ultra-fast raw 580px frame OCR scan (~100ms cycle)
  const scanSource = useCallback(
    async (
      source: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement,
      targetItems: ChecklistItem[],
      _mode: MatchMode,
      enableHaptics = true,
      enableSound = true
    ): Promise<ScanResult | null> => {
      if (
        !schedulerRef.current ||
        activeJobsRef.current >= PARALLEL_WORKERS ||
        isInitializing ||
        targetItems.length === 0
      ) {
        return null;
      }

      if (source instanceof HTMLVideoElement) {
        if (source.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || source.videoWidth === 0) {
          return null;
        }
      }

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

      activeJobsRef.current += 1;
      setIsProcessing(true);
      const currentSeq = ++jobSeqCounterRef.current;
      const startTime = performance.now();

      try {
        // Fixed compact width of 580px (height scaled proportionally to videoHeight / videoWidth)
        const ocrW = OCR_TARGET_WIDTH;
        const ocrH = Math.max(1, Math.round((videoH / videoW) * ocrW));

        const slot = poolIndexRef.current % 2;
        poolIndexRef.current = (poolIndexRef.current + 1) % 2;

        if (!canvasPoolRef.current[slot]) {
          canvasPoolRef.current[slot] = document.createElement('canvas');
        }
        const ocrCanvas = canvasPoolRef.current[slot]!;
        if (ocrCanvas.width !== ocrW || ocrCanvas.height !== ocrH) {
          ocrCanvas.width = ocrW;
          ocrCanvas.height = ocrH;
        }

        const ocrCtx = ocrCanvas.getContext('2d', { alpha: false });
        if (!ocrCtx) {
          return null;
        }

        // Draw raw <video> frame directly — ZERO CSS/SVG/pixel filters
        ocrCtx.drawImage(source, 0, 0, ocrW, ocrH);

        const ret = await schedulerRef.current.addJob('recognize', ocrCanvas);

        if (currentSeq < latestCompletedSeqRef.current) {
          return null;
        }
        latestCompletedSeqRef.current = currentSeq;

        const data = ret.data;
        const rawFullText = (data.text || '').trim();

        const sanitizedPreview = rawFullText.replace(/\s+/g, ' ').slice(0, 60);
        setRawTextPreview(sanitizedPreview);

        // Extract words and lines
        const wordsList: RawWordItem[] = [];
        const linesList: RawLineItem[] = [];

        const rawTopWords = (data as unknown as { words?: RawWordItem[] }).words;
        if (rawTopWords && Array.isArray(rawTopWords) && rawTopWords.length > 0) {
          for (const w of rawTopWords) {
            if (w.text && w.text.trim() && w.bbox) {
              wordsList.push({
                text: w.text.trim(),
                confidence: Math.round(w.confidence || 85),
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
                    confidence: Math.round(w.confidence || 85),
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
                confidence: Math.round(line.confidence || 85),
                bbox: line.bbox,
                words: lineWords,
              });
            }
          }
        }

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
                            confidence: Math.round(w.confidence || 85),
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
                        confidence: Math.round(l.confidence || 85),
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

        for (const targetItem of targetItems) {
          const cleanTarget = clean(targetItem.text);
          if (!cleanTarget) continue;

          let matchedInWords = false;

          // 1. Word-level match with tight sub-word proportional bbox slicing
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
              const tightBbox = tightenWordBbox(w.bbox, w.text, targetItem.text);
              const matchObj: MatchedWord = {
                id: `w-${targetItem.id}-${i}`,
                text: w.text,
                normalizedText: cleanWord,
                confidence: w.confidence,
                bbox: tightBbox,
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

          // 2. Multi-word line fallback (uses tight union of matching words inside the line)
          if (!matchedInWords) {
            for (let lIdx = 0; lIdx < linesList.length; lIdx++) {
              const line = linesList[lIdx];
              const cleanLine = clean(line.text);
              if (!cleanLine || !cleanLine.includes(cleanTarget)) continue;

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
                id: `l-${targetItem.id}-${lIdx}`,
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
        activeJobsRef.current = Math.max(0, activeJobsRef.current - 1);
        if (activeJobsRef.current === 0) {
          setIsProcessing(false);
        }
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
