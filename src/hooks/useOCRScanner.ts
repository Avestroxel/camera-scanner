import { useEffect, useRef, useState, useCallback } from 'react';
import { createWorker, createScheduler, Scheduler, Worker, PSM } from 'tesseract.js';
import { OcrLanguage, MatchMode, MatchedWord, ScanResult, ChecklistItem, DetectedMatchGroup } from '../types';
import {
  cleanNormalized,
  normalizeSerialLookalikes,
  prepareTargets,
  sliceSubTokenBbox,
} from '../utils/textMatcher';
import { triggerHaptic, playMatchChime } from '../utils/audioAlert';

interface RawWordItem {
  text: string;
  cleanText: string;
  serialLookalikeText: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

interface RawLineItem {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  words: RawWordItem[];
}

export interface SnapshotScanOutput {
  result: ScanResult;
  snapshotCanvas: HTMLCanvasElement;
}

const FAST_LANG_CDN = 'https://tessdata.projectnaptha.com/4.0.0_fast';
export const MAX_SNAPSHOT_LONG_EDGE = 1800;
const PARALLEL_WORKERS = 2;

/**
 * Precomputed 256-entry Contrast Stretch Lookup Table (LUT) for faint thermal receipt ink.
 * Pulls gray ink (< 142) sharply toward pure black (0) and paper background (> 180) to pure white (255)
 * while preserving smooth anti-aliased character edges so small serial numbers read cleanly.
 */
const THERMAL_CONTRAST_LUT = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  if (i <= 92) {
    THERMAL_CONTRAST_LUT[i] = 0;
  } else if (i >= 188) {
    THERMAL_CONTRAST_LUT[i] = 255;
  } else {
    const normalized = (i - 92) / (188 - 92);
    const sCurve =
      normalized < 0.5
        ? 2 * normalized * normalized
        : 1 - Math.pow(-2 * normalized + 2, 2) / 2;
    THERMAL_CONTRAST_LUT[i] = Math.min(255, Math.max(0, Math.round(sCurve * 255)));
  }
}

/**
 * Ultra-fast Uint32Array grayscale + thermal contrast stretch on the OCR copy canvas
 */
function applyThermalReceiptContrastLUT(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number
): void {
  try {
    const imgData = ctx.getImageData(0, 0, w, h);
    const data8 = imgData.data;
    const buf32 = new Uint32Array(data8.buffer);
    const len = buf32.length;

    for (let i = 0; i < len; i++) {
      const px = buf32[i];
      const r = px & 0xff;
      const g = (px >> 8) & 0xff;
      const b = (px >> 16) & 0xff;
      const luma = (r * 77 + g * 150 + b * 29) >> 8;
      const c = THERMAL_CONTRAST_LUT[luma];
      buf32[i] = (255 << 24) | (c << 16) | (c << 8) | c;
    }

    ctx.putImageData(imgData, 0, 0);
  } catch {
    // Fallback to raw frame if canvas security blocks getImageData
  }
}

// Module-level singleton 2-worker scheduler cache so opening the camera has 0ms startup delay
let singletonScheduler: Scheduler | null = null;
let singletonWorkers: Worker[] = [];
let singletonLang: OcrLanguage | null = null;
let singletonInitPromise: Promise<Scheduler> | null = null;

async function getOrCreateSingletonScheduler(lang: OcrLanguage): Promise<Scheduler> {
  if (singletonScheduler && singletonLang === lang) {
    return singletonScheduler;
  }

  if (singletonInitPromise && singletonLang === lang) {
    return singletonInitPromise;
  }

  if (singletonScheduler && singletonLang !== lang) {
    const oldScheduler = singletonScheduler;
    singletonScheduler = null;
    singletonWorkers = [];
    singletonLang = null;
    singletonInitPromise = null;
    try {
      await oldScheduler.terminate();
    } catch {
      // ignore
    }
  }

  singletonLang = lang;
  singletonInitPromise = (async () => {
    const scheduler = createScheduler();

    const createFastMatrixWorker = async (): Promise<Worker> => {
      let worker: Worker;
      try {
        worker = await createWorker(lang, 1, {
          langPath: FAST_LANG_CDN,
        });
      } catch {
        worker = await createWorker(lang, 1);
      }

      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK, // '6' - Full-screen spatial matrix block
        user_defined_dpi: '300',
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

    const workers = await Promise.all(
      Array.from({ length: PARALLEL_WORKERS }, () => createFastMatrixWorker())
    );

    for (const w of workers) {
      scheduler.addWorker(w);
    }

    singletonScheduler = scheduler;
    singletonWorkers = workers;
    return scheduler;
  })();

  try {
    return await singletonInitPromise;
  } catch (err) {
    singletonScheduler = null;
    singletonWorkers = [];
    singletonLang = null;
    singletonInitPromise = null;
    throw err;
  }
}

/**
 * Pre-warms the persistent 2-worker 4.0.0_fast scheduler on App startup
 */
export function prewarmOCRWorker(lang: OcrLanguage): void {
  void getOrCreateSingletonScheduler(lang).catch(() => {
    // handled when scanner mounts
  });
}

export function useOCRScanner(selectedLang: OcrLanguage, liveChecklist: ChecklistItem[] = []) {
  const alreadyReady =
    singletonScheduler !== null &&
    singletonWorkers.length === PARALLEL_WORKERS &&
    singletonLang === selectedLang;

  const [isInitializing, setIsInitializing] = useState(!alreadyReady);
  const [isScanningSnapshot, setIsScanningSnapshot] = useState(false);
  const [lastScanResult, setLastScanResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const schedulerRef = useRef<Scheduler | null>(alreadyReady ? singletonScheduler : null);
  const ocrCanvasPoolRef = useRef<[HTMLCanvasElement | null, HTMLCanvasElement | null]>([
    null,
    null,
  ]);
  const displayCanvasPoolRef = useRef<[HTMLCanvasElement | null, HTMLCanvasElement | null]>([
    null,
    null,
  ]);
  const poolIdxRef = useRef<number>(0);
  const activeJobsRef = useRef<number>(0);

  // Live checklist ref & completed tombstone set
  const activeItemsRef = useRef<ChecklistItem[]>(liveChecklist);
  activeItemsRef.current = liveChecklist;
  const completedTombstonesRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const currentActiveIds = new Set(liveChecklist.map((i) => i.id));
    for (const id of Array.from(completedTombstonesRef.current)) {
      if (currentActiveIds.has(id)) {
        completedTombstonesRef.current.delete(id);
      }
    }

    setLastScanResult((prev) => {
      if (!prev) return null;
      const filteredWords = prev.matchedWords.filter(
        (w) => w.matchedItemId && currentActiveIds.has(w.matchedItemId)
      );
      const filteredGroups = prev.detectedGroups.filter((g) =>
        currentActiveIds.has(g.item.id)
      );
      if (
        filteredWords.length === prev.matchedWords.length &&
        filteredGroups.length === prev.detectedGroups.length
      ) {
        return prev;
      }
      return {
        ...prev,
        allWords: filteredWords,
        matchedWords: filteredWords,
        detectedGroups: filteredGroups,
      };
    });
  }, [liveChecklist]);

  // Immediately purge a single completed item from OCR state
  const purgeItem = useCallback((itemId: string) => {
    completedTombstonesRef.current.add(itemId);
    setLastScanResult((prev) => {
      if (!prev) return null;
      const filteredWords = prev.matchedWords.filter((w) => w.matchedItemId !== itemId);
      const filteredGroups = prev.detectedGroups.filter((g) => g.item.id !== itemId);
      return {
        ...prev,
        allWords: filteredWords,
        matchedWords: filteredWords,
        detectedGroups: filteredGroups,
      };
    });
  }, []);

  // Immediately purge multiple completed items ("Mark All Found")
  const purgeMultipleItems = useCallback((itemIds: string[]) => {
    const idSet = new Set(itemIds);
    for (const id of idSet) {
      completedTombstonesRef.current.add(id);
    }
    setLastScanResult((prev) => {
      if (!prev) return null;
      const filteredWords = prev.matchedWords.filter(
        (w) => !w.matchedItemId || !idSet.has(w.matchedItemId)
      );
      const filteredGroups = prev.detectedGroups.filter((g) => !idSet.has(g.item.id));
      return {
        ...prev,
        allWords: filteredWords,
        matchedWords: filteredWords,
        detectedGroups: filteredGroups,
      };
    });
  }, []);

  // Attach to or initialize the singleton 2-worker scheduler
  useEffect(() => {
    let isCancelled = false;

    async function attachScheduler() {
      if (singletonScheduler && singletonLang === selectedLang) {
        schedulerRef.current = singletonScheduler;
        setIsInitializing(false);
        setError(null);
        return;
      }

      setIsInitializing(true);
      try {
        const sched = await getOrCreateSingletonScheduler(selectedLang);
        if (!isCancelled) {
          schedulerRef.current = sched;
          setIsInitializing(false);
          setError(null);
        }
      } catch (err) {
        if (!isCancelled) {
          console.error('OCR scheduler init error:', err);
          const errorMsg = err instanceof Error ? err.message : String(err);
          setError(`Worker Error: ${errorMsg}`);
          setIsInitializing(false);
        }
      }
    }

    attachScheduler();

    return () => {
      isCancelled = true;
    };
  }, [selectedLang]);

  /**
   * High-Resolution Snapshot Capture & Simultaneous Multi-Target OCR:
   * 1. Captures the full camera frame at native high resolution (up to 1800px on the long edge)
   *    into `displayCanvas` (clean color bitmap for FROZEN_LOCK display) and `ocrCanvas` (contrast-boosted for OCR).
   * 2. Because `displayCanvas` and `ocrCanvas` share the EXACT same width & height (`snapW x snapH`) with zero cropping offset,
   *    every matched bounding box `(x0, y0, x1, y1)` is 100% pixel-locked to `displayCanvas` with 0.00px drift!
   */
  const scanSnapshot = useCallback(
    async (
      source: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement,
      _mode: MatchMode,
      options?: {
        forceCaptureCanvas?: HTMLCanvasElement;
        enableHaptics?: boolean;
        enableSound?: boolean;
      }
    ): Promise<SnapshotScanOutput | null> => {
      const scheduler = schedulerRef.current;
      if (
        !scheduler ||
        activeJobsRef.current >= PARALLEL_WORKERS ||
        isInitializing ||
        activeItemsRef.current.length === 0
      ) {
        return null;
      }

      if (source instanceof HTMLVideoElement) {
        if (source.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || source.videoWidth === 0) {
          return null;
        }
      }

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
        return null;
      }

      activeJobsRef.current += 1;
      setIsScanningSnapshot(true);
      const startTime = performance.now();

      try {
        // Full high-resolution capture (up to 1800px on the long edge — never downscaled to blurry sizes)
        const longEdge = Math.max(srcW, srcH);
        const scale = longEdge > MAX_SNAPSHOT_LONG_EDGE ? MAX_SNAPSHOT_LONG_EDGE / longEdge : 1;
        const snapW = Math.max(1, Math.round(srcW * scale));
        const snapH = Math.max(1, Math.round(srcH * scale));

        const slot = poolIdxRef.current % PARALLEL_WORKERS;
        poolIdxRef.current = (poolIdxRef.current + 1) % PARALLEL_WORKERS;

        // 1. Clean high-res color snapshot canvas (rendered directly on screen in FROZEN_LOCK mode)
        const displayCanvas =
          options?.forceCaptureCanvas ||
          displayCanvasPoolRef.current[slot] ||
          (displayCanvasPoolRef.current[slot] = document.createElement('canvas'));

        if (displayCanvas.width !== snapW || displayCanvas.height !== snapH) {
          displayCanvas.width = snapW;
          displayCanvas.height = snapH;
        }
        const displayCtx = displayCanvas.getContext('2d', { alpha: false });
        if (!displayCtx) return null;
        displayCtx.imageSmoothingEnabled = true;
        displayCtx.imageSmoothingQuality = 'high';
        displayCtx.drawImage(source, 0, 0, snapW, snapH);

        // 2. Identically sized OCR canvas (with fast thermal receipt contrast stretch)
        if (!ocrCanvasPoolRef.current[slot]) {
          ocrCanvasPoolRef.current[slot] = document.createElement('canvas');
        }
        const ocrCanvas = ocrCanvasPoolRef.current[slot]!;
        if (ocrCanvas.width !== snapW || ocrCanvas.height !== snapH) {
          ocrCanvas.width = snapW;
          ocrCanvas.height = snapH;
        }
        const ocrCtx = ocrCanvas.getContext('2d', { alpha: false, willReadFrequently: true });
        if (!ocrCtx) return null;
        ocrCtx.drawImage(displayCanvas, 0, 0, snapW, snapH);
        applyThermalReceiptContrastLUT(ocrCtx, snapW, snapH);

        // Run Tesseract on the high-contrast OCR canvas
        const ret = await scheduler.addJob('recognize', ocrCanvas);
        const data = ret.data;
        const rawFullText = (data.text || '').trim();

        const freshTargets = activeItemsRef.current.filter(
          (item) => !item.isCompleted && !completedTombstonesRef.current.has(item.id)
        );

        if (freshTargets.length === 0) {
          const emptyResult: ScanResult = {
            allWords: [],
            matchedWords: [],
            detectedGroups: [],
            fullText: rawFullText,
            processingTimeMs: Math.round(performance.now() - startTime),
            frameWidth: snapW,
            frameHeight: snapH,
          };
          setLastScanResult(emptyResult);
          return { result: emptyResult, snapshotCanvas: displayCanvas };
        }

        const preparedTargets = prepareTargets(freshTargets);

        const wordsList: RawWordItem[] = [];
        const linesList: RawLineItem[] = [];

        if (data.lines && Array.isArray(data.lines)) {
          for (let l = 0; l < data.lines.length; l++) {
            const line = data.lines[l];
            const lineWords: RawWordItem[] = [];
            if (line.words && Array.isArray(line.words)) {
              for (let wIdx = 0; wIdx < line.words.length; wIdx++) {
                const w = line.words[wIdx];
                if (w.text && w.text.trim() && w.bbox) {
                  const trimmed = w.text.trim();
                  const cleanText = cleanNormalized(trimmed);
                  if (cleanText) {
                    const rw: RawWordItem = {
                      text: trimmed,
                      cleanText,
                      serialLookalikeText: normalizeSerialLookalikes(cleanText),
                      confidence: Math.round(w.confidence || 85),
                      bbox: w.bbox,
                    };
                    lineWords.push(rw);
                    wordsList.push(rw);
                  }
                }
              }
            }
            if (lineWords.length > 0 && line.bbox) {
              linesList.push({
                text: (line.text || '').trim(),
                confidence: Math.round(line.confidence || 85),
                bbox: line.bbox,
                words: lineWords,
              });
            }
          }
        }

        if (wordsList.length === 0) {
          const rawTopWords = (
            data as unknown as {
              words?: Array<{
                text: string;
                confidence: number;
                bbox: { x0: number; y0: number; x1: number; y1: number };
              }>;
            }
          ).words;
          if (rawTopWords && Array.isArray(rawTopWords)) {
            for (let i = 0; i < rawTopWords.length; i++) {
              const w = rawTopWords[i];
              if (w.text && w.text.trim() && w.bbox) {
                const trimmed = w.text.trim();
                const cleanText = cleanNormalized(trimmed);
                if (cleanText) {
                  wordsList.push({
                    text: trimmed,
                    cleanText,
                    serialLookalikeText: normalizeSerialLookalikes(cleanText),
                    confidence: Math.round(w.confidence || 85),
                    bbox: w.bbox,
                  });
                }
              }
            }
          }
        }

        if (wordsList.length === 0 && data.blocks) {
          for (const b of data.blocks) {
            if (!b.paragraphs) continue;
            for (const p of b.paragraphs) {
              if (!p.lines) continue;
              for (const l of p.lines) {
                const lineWords: RawWordItem[] = [];
                if (l.words) {
                  for (const w of l.words) {
                    if (w.text && w.text.trim() && w.bbox) {
                      const trimmed = w.text.trim();
                      const cleanText = cleanNormalized(trimmed);
                      if (cleanText) {
                        const rw: RawWordItem = {
                          text: trimmed,
                          cleanText,
                          serialLookalikeText: normalizeSerialLookalikes(cleanText),
                          confidence: Math.round(w.confidence || 85),
                          bbox: w.bbox,
                        };
                        lineWords.push(rw);
                        wordsList.push(rw);
                      }
                    }
                  }
                }
                if (lineWords.length > 0 && l.bbox) {
                  linesList.push({
                    text: (l.text || '').trim(),
                    confidence: Math.round(l.confidence || 85),
                    bbox: l.bbox,
                    words: lineWords,
                  });
                }
              }
            }
          }
        }

        // Strict character-accurate substring matching (with 0<->O and 1<->I equivalence only)
        const matchedWords: MatchedWord[] = [];
        const matchesByItem = new Map<string, MatchedWord[]>();

        for (let wIdx = 0; wIdx < wordsList.length; wIdx++) {
          const w = wordsList[wIdx];
          const cleanWord = w.cleanText;
          const serialWord = w.serialLookalikeText;

          for (let tIdx = 0; tIdx < preparedTargets.length; tIdx++) {
            const pt = preparedTargets[tIdx];
            if (completedTombstonesRef.current.has(pt.item.id)) continue;

            const isDirectHit = cleanWord.includes(pt.cleanTarget);
            const isSerialLookalikeHit =
              !isDirectHit &&
              pt.cleanTarget.length >= 3 &&
              serialWord.includes(pt.serialLookalikeTarget);

            if (isDirectHit || isSerialLookalikeHit) {
              const slicedBbox = sliceSubTokenBbox(
                w.bbox,
                w.text,
                pt.rawTrimmed,
                cleanWord,
                pt.cleanTarget
              );

              const listForTarget = matchesByItem.get(pt.item.id) || [];
              const isDuplicateRowHit = listForTarget.some(
                (ex) =>
                  Math.abs(ex.bbox.y0 - slicedBbox.y0) < 14 &&
                  Math.abs(ex.bbox.x0 - slicedBbox.x0) < 36
              );

              if (!isDuplicateRowHit) {
                const matchObj: MatchedWord = {
                  id: `m-${pt.item.id}-${wIdx}-${tIdx}`,
                  text: w.text,
                  normalizedText: cleanWord,
                  confidence: w.confidence,
                  bbox: slicedBbox,
                  isMatch: true,
                  score: isDirectHit ? 1.0 : 0.96,
                  matchedItemId: pt.item.id,
                  matchedItemText: pt.item.text,
                };
                matchedWords.push(matchObj);
                listForTarget.push(matchObj);
                matchesByItem.set(pt.item.id, listForTarget);
              }
            }
          }
        }

        // Sliding window across adjacent words on the same line for multi-word targets
        for (let lIdx = 0; lIdx < linesList.length; lIdx++) {
          const line = linesList[lIdx];
          const lWords = line.words;
          if (lWords.length < 2) continue;

          for (let tIdx = 0; tIdx < preparedTargets.length; tIdx++) {
            const pt = preparedTargets[tIdx];
            if (completedTombstonesRef.current.has(pt.item.id)) continue;

            const listForTarget = matchesByItem.get(pt.item.id) || [];
            const windowLen = Math.max(2, pt.parts.length);
            const maxWin = Math.min(lWords.length, windowLen + 1);

            for (let winSize = 2; winSize <= maxWin; winSize++) {
              for (let start = 0; start <= lWords.length - winSize; start++) {
                const slice = lWords.slice(start, start + winSize);
                const combinedClean = slice.map((sw) => sw.cleanText).join('');
                const combinedSerial = slice.map((sw) => sw.serialLookalikeText).join('');

                const isHit =
                  combinedClean === pt.cleanTarget ||
                  (pt.isMultiWord && combinedClean.includes(pt.cleanTarget)) ||
                  (pt.cleanTarget.length >= 4 && combinedSerial === pt.serialLookalikeTarget);

                if (!isHit) continue;

                const unionBbox = {
                  x0: Math.min(...slice.map((sw) => sw.bbox.x0)),
                  y0: Math.min(...slice.map((sw) => sw.bbox.y0)),
                  x1: Math.max(...slice.map((sw) => sw.bbox.x1)),
                  y1: Math.max(...slice.map((sw) => sw.bbox.y1)),
                };

                const isDuplicateRowHit = listForTarget.some(
                  (ex) =>
                    Math.abs(ex.bbox.y0 - unionBbox.y0) < 14 &&
                    Math.abs(ex.bbox.x0 - unionBbox.x0) < 36
                );

                if (!isDuplicateRowHit) {
                  const matchObj: MatchedWord = {
                    id: `mw-${pt.item.id}-${lIdx}-${start}`,
                    text: slice.map((sw) => sw.text).join(' '),
                    normalizedText: combinedClean,
                    confidence: line.confidence,
                    bbox: unionBbox,
                    isMatch: true,
                    score: 0.95,
                    matchedItemId: pt.item.id,
                    matchedItemText: pt.item.text,
                  };
                  matchedWords.push(matchObj);
                  listForTarget.push(matchObj);
                  matchesByItem.set(pt.item.id, listForTarget);
                }
              }
            }
          }
        }

        const detectedGroups: DetectedMatchGroup[] = [];
        for (const target of freshTargets) {
          if (completedTombstonesRef.current.has(target.id)) continue;
          const words = matchesByItem.get(target.id);
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
          frameWidth: snapW,
          frameHeight: snapH,
        };

        setLastScanResult(result);

        if (detectedGroups.length > 0) {
          if (options?.enableHaptics !== false) triggerHaptic(70);
          if (options?.enableSound !== false) playMatchChime();
        }

        return {
          result,
          snapshotCanvas: displayCanvas,
        };
      } catch (err) {
        console.warn('Snapshot OCR scan error:', err);
        return null;
      } finally {
        activeJobsRef.current = Math.max(0, activeJobsRef.current - 1);
        if (activeJobsRef.current === 0) {
          setIsScanningSnapshot(false);
        }
      }
    },
    [isInitializing]
  );

  return {
    isInitializing,
    isScanningSnapshot,
    lastScanResult,
    error,
    scanSnapshot,
    purgeItem,
    purgeMultipleItems,
  };
}
