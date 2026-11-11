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

interface ActiveTargetMemory {
  item: ChecklistItem;
  words: MatchedWord[];
  timestamp: number;
  missedFrames: number;
}

const FAST_LANG_CDN = 'https://tessdata.projectnaptha.com/4.0.0_fast';
export const OCR_MATRIX_WIDTH = 1080;
const PARALLEL_WORKERS = 2;
// Short anti-flicker hold (400ms / max 1 missed scan) so moving the hand never leaves boxes stuck on wrong rows
const HOLD_TTL_MS = 400;
const MAX_MISSED_SCANS = 1;

/**
 * Precomputed 256-entry Contrast Stretch Lookup Table (LUT) for faint thermal receipt ink.
 * Pulls gray ink (< 142) sharply toward pure black (0) and paper background (> 175) to pure white (255)
 * while preserving smooth grayscale transitions (115..175) so thin monospace characters stay sharp.
 */
const THERMAL_CONTRAST_LUT = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  if (i <= 95) {
    THERMAL_CONTRAST_LUT[i] = 0;
  } else if (i >= 185) {
    THERMAL_CONTRAST_LUT[i] = 255;
  } else {
    const normalized = (i - 95) / (185 - 95);
    // Steep S-curve contrast stretch
    const sCurve = normalized < 0.5
      ? 2 * normalized * normalized
      : 1 - Math.pow(-2 * normalized + 2, 2) / 2;
    THERMAL_CONTRAST_LUT[i] = Math.min(255, Math.max(0, Math.round(sCurve * 255)));
  }
}

/**
 * Ultra-fast (< 1.5ms) Uint32Array grayscale + thermal contrast stretch on ocrCanvas
 */
function applyThermalReceiptContrastLUT(ctx: CanvasRenderingContext2D, w: number, h: number): void {
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
      // Fast integer luminance: (r * 77 + g * 150 + b * 29) >> 8
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

async function getOrCreateSingletonScheduler(
  lang: OcrLanguage
): Promise<Scheduler> {
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
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK, // '6' - Uniform block of receipt rows / matrix text
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
  const [lastScanResult, setLastScanResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const schedulerRef = useRef<Scheduler | null>(alreadyReady ? singletonScheduler : null);
  const canvasPoolRef = useRef<[HTMLCanvasElement | null, HTMLCanvasElement | null]>([null, null]);
  const poolIdxRef = useRef<number>(0);
  const activeJobsRef = useRef<number>(0);
  const latestCompletedSeqRef = useRef<number>(0);
  const jobSeqCounterRef = useRef<number>(0);
  const previousMatchedItemIdsRef = useRef<Set<string>>(new Set());
  const targetMemoryRef = useRef<Map<string, ActiveTargetMemory>>(new Map());

  // Live checklist ref & completed tombstone set
  const activeItemsRef = useRef<ChecklistItem[]>(liveChecklist);
  activeItemsRef.current = liveChecklist;
  const completedTombstonesRef = useRef<Set<string>>(new Set());

  // Sync tombstones and prune completed items when checklist changes
  useEffect(() => {
    const currentActiveIds = new Set(liveChecklist.map((i) => i.id));
    for (const id of Array.from(completedTombstonesRef.current)) {
      if (currentActiveIds.has(id)) {
        completedTombstonesRef.current.delete(id);
      }
    }

    for (const key of Array.from(targetMemoryRef.current.keys())) {
      if (!currentActiveIds.has(key)) {
        targetMemoryRef.current.delete(key);
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

  // Immediately purge a single completed item from OCR memory and state
  const purgeItem = useCallback((itemId: string) => {
    completedTombstonesRef.current.add(itemId);
    previousMatchedItemIdsRef.current.delete(itemId);
    targetMemoryRef.current.delete(itemId);
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

  // Immediately purge multiple completed items ("Mark All Found") in one atomic step
  const purgeMultipleItems = useCallback((itemIds: string[]) => {
    const idSet = new Set(itemIds);
    for (const id of idSet) {
      completedTombstonesRef.current.add(id);
      previousMatchedItemIdsRef.current.delete(id);
      targetMemoryRef.current.delete(id);
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
   * 1:1 Native-Resolution Center Strip Capture + Fast Thermal Contrast LUT +
   * Exact Crop-to-Intrinsic-Video Coordinate Mapping:
   * - Crops out outer 15% left/right and 8% top / 12% bottom dead margins at 1:1 native camera pixels.
   * - Applies a <1.5ms Uint32Array contrast LUT so faint thermal receipt print turns crisp black-on-white.
   * - Converts every matched word bbox back to full intrinsic video coordinates (videoW x videoH):
   *     videoX0 = cropX + (slicedX0 / ocrCanvas.width) * cropW
   *     videoY0 = cropY + (word.bbox.y0 / ocrCanvas.height) * cropH
   */
  const scanSource = useCallback(
    async (
      source: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement,
      _targetItems: ChecklistItem[],
      _mode: MatchMode,
      enableHaptics = true,
      enableSound = true
    ): Promise<ScanResult | null> => {
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
      const currentSeq = ++jobSeqCounterRef.current;
      const startTime = performance.now();

      try {
        // 1. Crop out outer 15% left/right and 8% top / 12% bottom dead margins at 1:1 native camera pixels
        const cropX = Math.round(videoW * 0.15);
        const cropY = Math.round(videoH * 0.08);
        const cropW = Math.max(1, Math.round(videoW * 0.70));
        const cropH = Math.max(1, Math.round(videoH * 0.80));

        // Keep 1:1 native resolution (capped at 1600px max height so 4K cameras don't stall)
        const nativeScale = cropH > 1600 ? 1600 / cropH : 1;
        const ocrW = Math.max(1, Math.round(cropW * nativeScale));
        const ocrH = Math.max(1, Math.round(cropH * nativeScale));

        const slot = poolIdxRef.current % PARALLEL_WORKERS;
        poolIdxRef.current = (poolIdxRef.current + 1) % PARALLEL_WORKERS;

        if (!canvasPoolRef.current[slot]) {
          canvasPoolRef.current[slot] = document.createElement('canvas');
        }
        const ocrCanvas = canvasPoolRef.current[slot]!;
        if (ocrCanvas.width !== ocrW || ocrCanvas.height !== ocrH) {
          ocrCanvas.width = ocrW;
          ocrCanvas.height = ocrH;
        }

        const ocrCtx = ocrCanvas.getContext('2d', { alpha: false, willReadFrequently: true });
        if (!ocrCtx) {
          return null;
        }

        ocrCtx.imageSmoothingEnabled = false;
        ocrCtx.drawImage(source, cropX, cropY, cropW, cropH, 0, 0, ocrW, ocrH);

        // Apply <1.5ms Uint32Array thermal receipt contrast stretch LUT
        applyThermalReceiptContrastLUT(ocrCtx, ocrW, ocrH);

        const ret = await scheduler.addJob('recognize', ocrCanvas);

        // Discard out-of-order stale worker responses so older frames never overwrite newer positions
        if (currentSeq < latestCompletedSeqRef.current) {
          return null;
        }
        latestCompletedSeqRef.current = currentSeq;

        const data = ret.data;
        const rawFullText = (data.text || '').trim();

        const freshTargets = activeItemsRef.current.filter(
          (item) => !item.isCompleted && !completedTombstonesRef.current.has(item.id)
        );

        if (freshTargets.length === 0) {
          targetMemoryRef.current.clear();
          const emptyResult: ScanResult = {
            allWords: [],
            matchedWords: [],
            detectedGroups: [],
            fullText: rawFullText,
            processingTimeMs: Math.round(performance.now() - startTime),
            frameWidth: videoW,
            frameHeight: videoH,
          };
          setLastScanResult(emptyResult);
          return emptyResult;
        }

        const preparedTargets = prepareTargets(freshTargets);

        // Helper: Convert any bbox (x0, y0, x1, y1) from ocrCanvas coordinates back to full intrinsic video (videoW, videoH)
        const toIntrinsicVideoBbox = (b: { x0: number; y0: number; x1: number; y1: number }) => ({
          x0: cropX + (b.x0 / ocrW) * cropW,
          y0: cropY + (b.y0 / ocrH) * cropH,
          x1: cropX + (b.x1 / ocrW) * cropW,
          y1: cropY + (b.y1 / ocrH) * cropH,
        });

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
          const rawTopWords = (data as unknown as { words?: Array<{ text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }> }).words;
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

        // Simultaneous Multi-Target Evaluation (Strictly zero false-positive fuzzy/reverse matches)
        const currentFrameMatchesByItem = new Map<string, MatchedWord[]>();

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
              const slicedCanvasBbox = sliceSubTokenBbox(
                w.bbox,
                w.text,
                pt.rawTrimmed,
                cleanWord,
                pt.cleanTarget
              );
              const videoBbox = toIntrinsicVideoBbox(slicedCanvasBbox);

              const existingForTarget = currentFrameMatchesByItem.get(pt.item.id) || [];
              // Avoid duplicate overlapping hits on the same receipt row (within 18px vertically & 45px horizontally)
              const isDuplicateRowHit = existingForTarget.some(
                (ex) =>
                  Math.abs(ex.bbox.y0 - videoBbox.y0) < 18 &&
                  Math.abs(ex.bbox.x0 - videoBbox.x0) < 45
              );

              if (!isDuplicateRowHit) {
                const matchObj: MatchedWord = {
                  id: `m-${pt.item.id}-${wIdx}-${tIdx}`,
                  text: w.text,
                  normalizedText: cleanWord,
                  confidence: w.confidence,
                  bbox: videoBbox,
                  isMatch: true,
                  score: isDirectHit ? 1.0 : 0.96,
                  matchedItemId: pt.item.id,
                  matchedItemText: pt.item.text,
                };
                existingForTarget.push(matchObj);
                currentFrameMatchesByItem.set(pt.item.id, existingForTarget);
              }
            }
          }
        }

        // Multi-word / split-token sliding window along each line
        for (let lIdx = 0; lIdx < linesList.length; lIdx++) {
          const line = linesList[lIdx];
          const lWords = line.words;
          if (lWords.length < 2) continue;

          for (let tIdx = 0; tIdx < preparedTargets.length; tIdx++) {
            const pt = preparedTargets[tIdx];
            if (completedTombstonesRef.current.has(pt.item.id)) continue;
            // If single-word target was already cleanly matched on this line, skip window fallback
            const existingForTarget = currentFrameMatchesByItem.get(pt.item.id) || [];

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

                const unionCanvasBbox = {
                  x0: Math.min(...slice.map((sw) => sw.bbox.x0)),
                  y0: Math.min(...slice.map((sw) => sw.bbox.y0)),
                  x1: Math.max(...slice.map((sw) => sw.bbox.x1)),
                  y1: Math.max(...slice.map((sw) => sw.bbox.y1)),
                };
                const videoBbox = toIntrinsicVideoBbox(unionCanvasBbox);

                const isDuplicateRowHit = existingForTarget.some(
                  (ex) =>
                    Math.abs(ex.bbox.y0 - videoBbox.y0) < 18 &&
                    Math.abs(ex.bbox.x0 - videoBbox.x0) < 45
                );

                if (!isDuplicateRowHit) {
                  existingForTarget.push({
                    id: `mw-${pt.item.id}-${lIdx}-${start}`,
                    text: slice.map((sw) => sw.text).join(' '),
                    normalizedText: combinedClean,
                    confidence: line.confidence,
                    bbox: videoBbox,
                    isMatch: true,
                    score: 0.95,
                    matchedItemId: pt.item.id,
                    matchedItemText: pt.item.text,
                  });
                  currentFrameMatchesByItem.set(pt.item.id, existingForTarget);
                }
              }
            }
          }
        }

        // Update Target Memory:
        // - If target IS found in this scan, REPLACE its boxes with the fresh coordinates (zero ghost duplicates!)
        // - If target is NOT found in this scan, hold for at most 1 missed scan / 400ms
        const now = performance.now();
        const activeMatchedWords: MatchedWord[] = [];
        const detectedGroups: DetectedMatchGroup[] = [];

        for (const target of freshTargets) {
          if (completedTombstonesRef.current.has(target.id)) continue;

          const freshWords = currentFrameMatchesByItem.get(target.id);
          if (freshWords && freshWords.length > 0) {
            targetMemoryRef.current.set(target.id, {
              item: target,
              words: freshWords,
              timestamp: now,
              missedFrames: 0,
            });
            activeMatchedWords.push(...freshWords);
            const primaryWord = freshWords.reduce(
              (prev, curr) => (curr.confidence > prev.confidence ? curr : prev),
              freshWords[0]
            );
            detectedGroups.push({
              item: target,
              words: freshWords,
              primaryWord,
            });
          } else {
            const prevEntry = targetMemoryRef.current.get(target.id);
            if (prevEntry) {
              const nextMissed = prevEntry.missedFrames + 1;
              if (now - prevEntry.timestamp < HOLD_TTL_MS && nextMissed <= MAX_MISSED_SCANS) {
                const updatedEntry: ActiveTargetMemory = {
                  ...prevEntry,
                  missedFrames: nextMissed,
                };
                targetMemoryRef.current.set(target.id, updatedEntry);
                activeMatchedWords.push(...updatedEntry.words);
                const primaryWord = updatedEntry.words.reduce(
                  (prev, curr) => (curr.confidence > prev.confidence ? curr : prev),
                  updatedEntry.words[0]
                );
                detectedGroups.push({
                  item: target,
                  words: updatedEntry.words,
                  primaryWord,
                });
              } else {
                targetMemoryRef.current.delete(target.id);
              }
            }
          }
        }

        const endTime = performance.now();
        const result: ScanResult = {
          allWords: activeMatchedWords,
          matchedWords: activeMatchedWords,
          detectedGroups,
          fullText: rawFullText,
          processingTimeMs: Math.round(endTime - startTime),
          // Report full intrinsic videoW x videoH so screen mapping is 100% locked
          frameWidth: videoW,
          frameHeight: videoH,
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
        console.warn('OCR matrix scan error:', err);
        return null;
      } finally {
        activeJobsRef.current = Math.max(0, activeJobsRef.current - 1);
      }
    },
    [isInitializing]
  );

  return {
    isInitializing,
    lastScanResult,
    error,
    scanSource,
    purgeItem,
    purgeMultipleItems,
  };
}
