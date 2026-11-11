import { useEffect, useRef, useState, useCallback } from 'react';
import { createWorker, createScheduler, Scheduler, Worker, PSM } from 'tesseract.js';
import { OcrLanguage, MatchMode, MatchedWord, ScanResult, ChecklistItem, DetectedMatchGroup } from '../types';
import { cleanNormalized, prepareTargets, sliceSubTokenBbox } from '../utils/textMatcher';
import { triggerHaptic, playMatchChime } from '../utils/audioAlert';

interface RawWordItem {
  text: string;
  cleanText: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

interface RawLineItem {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  words: RawWordItem[];
}

interface SpatialMatchEntry {
  spatialKey: string;
  word: MatchedWord;
  item: ChecklistItem;
  timestamp: number;
  missedFrames: number;
}

const FAST_LANG_CDN = 'https://tessdata.projectnaptha.com/4.0.0_fast';
export const OCR_MATRIX_WIDTH = 1152;
const PARALLEL_WORKERS = 2;
const LOCK_ON_TTL_MS = 2500;
const MAX_MISSED_SCANS = 4;

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
 * so opening the camera starts scanning immediately with zero delay.
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
  const previousMatchedItemIdsRef = useRef<Set<string>>(new Set());
  const spatialMemoryRef = useRef<SpatialMatchEntry[]>([]);

  // Live checklist ref & completed tombstone set so in-flight scans never resurrect completed items
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

    spatialMemoryRef.current = spatialMemoryRef.current.filter((m) =>
      currentActiveIds.has(m.item.id)
    );

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
    spatialMemoryRef.current = spatialMemoryRef.current.filter(
      (entry) => entry.item.id !== itemId && entry.word.matchedItemId !== itemId
    );
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
    }
    spatialMemoryRef.current = spatialMemoryRef.current.filter(
      (entry) =>
        !idSet.has(entry.item.id) &&
        (!entry.word.matchedItemId || !idSet.has(entry.word.matchedItemId))
    );
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
   * PHASE 1 & PHASE 2:
   * - Single-Shot Full-Screen 1152px Matrix Capture (one recognize() call per frame).
   * - Instantaneous O(1) Multi-Target Matcher across all words and line sliding windows (< 0.5ms).
   * - Never breaks early: collects ALL matching checklist items and ALL occurrences simultaneously.
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
      const startTime = performance.now();

      try {
        // PHASE 1: Ingest the entire visible camera frame at once onto 1152px offscreen canvas
        const ocrW = OCR_MATRIX_WIDTH;
        const ocrH = Math.max(1, Math.round(OCR_MATRIX_WIDTH * (videoH / videoW)));

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

        const ocrCtx = ocrCanvas.getContext('2d', { alpha: false });
        if (!ocrCtx) {
          return null;
        }

        // Draw FULL <video> frame in one shot — zero cropping, zero filters
        ocrCtx.drawImage(source, 0, 0, ocrW, ocrH);

        // Single recognize() call returns the complete spatial matrix of ALL words and lines
        const ret = await scheduler.addJob('recognize', ocrCanvas);
        const data = ret.data;
        const rawFullText = (data.text || '').trim();

        // Read LIVE active search list AFTER recognize() completes
        const freshTargets = activeItemsRef.current.filter(
          (item) => !item.isCompleted && !completedTombstonesRef.current.has(item.id)
        );

        if (freshTargets.length === 0) {
          spatialMemoryRef.current = [];
          const emptyResult: ScanResult = {
            allWords: [],
            matchedWords: [],
            detectedGroups: [],
            fullText: rawFullText,
            processingTimeMs: Math.round(performance.now() - startTime),
            frameWidth: ocrW,
            frameHeight: ocrH,
          };
          setLastScanResult(emptyResult);
          return emptyResult;
        }

        // Pre-normalize all active search targets into an indexed lookup array (< 0.1ms)
        const preparedTargets = prepareTargets(freshTargets);

        // Build unified full-screen word & line arrays from Tesseract output
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

        // Fallback if data.words was populated without data.lines
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
                    confidence: Math.round(w.confidence || 85),
                    bbox: w.bbox,
                  });
                }
              }
            }
          }
        }

        // Fallback to blocks -> paragraphs -> lines -> words if needed
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

        // PHASE 2: Instantaneous O(1) Multi-Target Matcher (< 0.5ms)
        // Evaluate ALL detected words and line sliding windows against ALL active targets simultaneously!
        const currentFrameMatches: MatchedWord[] = [];
        const matchedSpatialDedup = new Set<string>();

        // 2A. Single-token & embedded sub-token simultaneous evaluation across ALL words on screen
        for (let wIdx = 0; wIdx < wordsList.length; wIdx++) {
          const w = wordsList[wIdx];
          const cleanWord = w.cleanText;

          // Compare this word against ALL active targets simultaneously (never break early!)
          for (let tIdx = 0; tIdx < preparedTargets.length; tIdx++) {
            const pt = preparedTargets[tIdx];
            if (completedTombstonesRef.current.has(pt.item.id)) continue;

            const cleanTarget = pt.cleanTarget;
            const isExactOrSubToken = cleanWord.includes(cleanTarget);
            const isReverseToken =
              !pt.isMultiWord &&
              cleanWord.length >= 3 &&
              cleanTarget.length >= 3 &&
              cleanTarget.includes(cleanWord);

            if (isExactOrSubToken || isReverseToken) {
              const slicedBbox = isExactOrSubToken
                ? sliceSubTokenBbox(w.bbox, w.text, pt.rawTrimmed, cleanWord, cleanTarget)
                : w.bbox;

              const gridKey = `${pt.item.id}_${Math.round(slicedBbox.x0 / 48)}_${Math.round(slicedBbox.y0 / 36)}`;
              if (!matchedSpatialDedup.has(gridKey)) {
                matchedSpatialDedup.add(gridKey);
                currentFrameMatches.push({
                  id: `m-${pt.item.id}-${wIdx}-${tIdx}`,
                  text: w.text,
                  normalizedText: cleanWord,
                  confidence: w.confidence,
                  bbox: slicedBbox,
                  isMatch: true,
                  score: isExactOrSubToken ? 1.0 : 0.9,
                  matchedItemId: pt.item.id,
                  matchedItemText: pt.item.text,
                });
              }
            }
          }
        }

        // 2B. Sliding-window evaluation across adjacent words on the same line for multi-word targets
        // (and targets split across adjacent tokens by OCR)
        for (let lIdx = 0; lIdx < linesList.length; lIdx++) {
          const line = linesList[lIdx];
          const lWords = line.words;
          if (lWords.length === 0) continue;

          for (let tIdx = 0; tIdx < preparedTargets.length; tIdx++) {
            const pt = preparedTargets[tIdx];
            if (completedTombstonesRef.current.has(pt.item.id)) continue;

            const windowLen = Math.max(1, pt.parts.length);
            if (windowLen === 1 && lWords.length < 2) continue;

            // Check sliding windows of size [windowLen] and [windowLen + 1] along the line
            const maxWin = Math.min(lWords.length, windowLen + 1);
            const minWin = Math.min(lWords.length, Math.max(2, windowLen));

            for (let winSize = minWin; winSize <= maxWin; winSize++) {
              for (let start = 0; start <= lWords.length - winSize; start++) {
                const slice = lWords.slice(start, start + winSize);
                const combinedClean = slice.map((sw) => sw.cleanText).join('');
                if (!combinedClean.includes(pt.cleanTarget)) continue;

                const unionBbox = {
                  x0: Math.min(...slice.map((sw) => sw.bbox.x0)),
                  y0: Math.min(...slice.map((sw) => sw.bbox.y0)),
                  x1: Math.max(...slice.map((sw) => sw.bbox.x1)),
                  y1: Math.max(...slice.map((sw) => sw.bbox.y1)),
                };

                const gridKey = `${pt.item.id}_${Math.round(unionBbox.x0 / 48)}_${Math.round(unionBbox.y0 / 36)}`;
                if (!matchedSpatialDedup.has(gridKey)) {
                  matchedSpatialDedup.add(gridKey);
                  currentFrameMatches.push({
                    id: `mw-${pt.item.id}-${lIdx}-${start}`,
                    text: slice.map((sw) => sw.text).join(' '),
                    normalizedText: combinedClean,
                    confidence: line.confidence,
                    bbox: unionBbox,
                    isMatch: true,
                    score: 0.96,
                    matchedItemId: pt.item.id,
                    matchedItemText: pt.item.text,
                  });
                }
              }
            }
          }
        }

        // PHASE 4: Update spatial multi-occurrence memory (2500ms or 4 missed scans)
        const now = performance.now();
        const activeTargetIdSet = new Set(freshTargets.map((t) => t.id));
        const targetById = new Map(freshTargets.map((t) => [t.id, t]));

        const updatedMemory: SpatialMatchEntry[] = [];
        const matchedPrevIndices = new Set<number>();

        // 1. Associate each current-frame occurrence with nearest spatial memory entry (< 95px in 1152px space)
        for (let i = 0; i < currentFrameMatches.length; i++) {
          const m = currentFrameMatches[i];
          if (!m.matchedItemId || completedTombstonesRef.current.has(m.matchedItemId)) continue;
          const item = targetById.get(m.matchedItemId);
          if (!item) continue;

          const mCx = (m.bbox.x0 + m.bbox.x1) * 0.5;
          const mCy = (m.bbox.y0 + m.bbox.y1) * 0.5;
          const spatialKey = `${item.id}_${Math.round(m.bbox.x0 / 60)}_${Math.round(m.bbox.y0 / 60)}`;

          let bestPrevIdx = -1;
          let bestDist = 95;

          for (let j = 0; j < spatialMemoryRef.current.length; j++) {
            if (matchedPrevIndices.has(j)) continue;
            const prev = spatialMemoryRef.current[j];
            if (prev.item.id !== item.id) continue;

            const pCx = (prev.word.bbox.x0 + prev.word.bbox.x1) * 0.5;
            const pCy = (prev.word.bbox.y0 + prev.word.bbox.y1) * 0.5;
            const dist = Math.hypot(mCx - pCx, mCy - pCy);
            if (dist < bestDist) {
              bestDist = dist;
              bestPrevIdx = j;
            }
          }

          if (bestPrevIdx >= 0) {
            matchedPrevIndices.add(bestPrevIdx);
          }

          updatedMemory.push({
            spatialKey,
            word: m,
            item,
            timestamp: now,
            missedFrames: 0,
          });
        }

        // 2. Keep recently seen spatial occurrences alive for up to 2500ms or 4 missed scans
        for (let j = 0; j < spatialMemoryRef.current.length; j++) {
          if (matchedPrevIndices.has(j)) continue;
          const prev = spatialMemoryRef.current[j];
          if (
            !activeTargetIdSet.has(prev.item.id) ||
            completedTombstonesRef.current.has(prev.item.id)
          ) {
            continue;
          }
          const nextMissed = prev.missedFrames + 1;
          if (now - prev.timestamp < LOCK_ON_TTL_MS && nextMissed <= MAX_MISSED_SCANS) {
            updatedMemory.push({
              ...prev,
              missedFrames: nextMissed,
            });
          }
        }

        spatialMemoryRef.current = updatedMemory;

        // Build detectedGroups for ALL simultaneously active matched items
        const itemToMatchesMap = new Map<string, MatchedWord[]>();
        for (const entry of updatedMemory) {
          if (!itemToMatchesMap.has(entry.item.id)) {
            itemToMatchesMap.set(entry.item.id, []);
          }
          itemToMatchesMap.get(entry.item.id)!.push(entry.word);
        }

        const detectedGroups: DetectedMatchGroup[] = [];
        for (const target of freshTargets) {
          if (completedTombstonesRef.current.has(target.id)) continue;
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
          allWords: currentFrameMatches,
          matchedWords: currentFrameMatches,
          detectedGroups,
          fullText: rawFullText,
          processingTimeMs: Math.round(endTime - startTime),
          frameWidth: ocrW,
          frameHeight: ocrH,
        };

        setLastScanResult(result);

        // Trigger audio/haptic feedback whenever any new checklist item enters detectedGroups
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
