import { useEffect, useRef, useState, useCallback } from 'react';
import { createWorker, Worker, PSM } from 'tesseract.js';
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

interface BandScanSnapshot {
  matches: MatchedWord[];
  timestamp: number;
}

const FAST_LANG_CDN = 'https://tessdata.projectnaptha.com/4.0.0_fast';
export const STRIP_W = 960;
export const STRIP_H = 320;
const NUM_STRIPS = 3;
const BOX_TTL_MS = 400;

/**
 * 3 Overlapping Horizontal Strips covering 10% to 90% of video height:
 * - Band 0 (Top Zone):    10% -> 42%
 * - Band 1 (Center Zone): 34% -> 66%
 * - Band 2 (Bottom Zone): 58% -> 90%
 */
const HORIZONTAL_BANDS: ReadonlyArray<{ startRatio: number; endRatio: number }> = [
  { startRatio: 0.10, endRatio: 0.42 },
  { startRatio: 0.34, endRatio: 0.66 },
  { startRatio: 0.58, endRatio: 0.90 },
];

// Module-level singleton 3-worker pool so opening the camera has 0ms startup delay
let singletonWorkers: Worker[] = [];
let singletonLang: OcrLanguage | null = null;
let singletonInitPromise: Promise<Worker[]> | null = null;

async function getOrCreateThreeWorkers(lang: OcrLanguage): Promise<Worker[]> {
  if (singletonWorkers.length === NUM_STRIPS && singletonLang === lang) {
    return singletonWorkers;
  }

  if (singletonInitPromise && singletonLang === lang) {
    return singletonInitPromise;
  }

  if (singletonWorkers.length > 0 && singletonLang !== lang) {
    const oldWorkers = singletonWorkers;
    singletonWorkers = [];
    singletonLang = null;
    singletonInitPromise = null;
    await Promise.all(
      oldWorkers.map(async (w) => {
        try {
          await w.terminate();
        } catch {
          // ignore
        }
      })
    );
  }

  singletonLang = lang;
  singletonInitPromise = (async () => {
    const createStripWorker = async (): Promise<Worker> => {
      let worker: Worker;
      try {
        worker = await createWorker(lang, 1, {
          langPath: FAST_LANG_CDN,
        });
      } catch {
        worker = await createWorker(lang, 1);
      }

      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK, // '6'
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
      Array.from({ length: NUM_STRIPS }, () => createStripWorker())
    );

    singletonWorkers = workers;
    return workers;
  })();

  try {
    return await singletonInitPromise;
  } catch (err) {
    singletonWorkers = [];
    singletonLang = null;
    singletonInitPromise = null;
    throw err;
  }
}

/**
 * Pre-warms the 3 parallel 4.0.0_fast workers on App load
 */
export function prewarmOCRWorker(lang: OcrLanguage): void {
  void getOrCreateThreeWorkers(lang).catch(() => {
    // handled when scanner mounts
  });
}

export function useOCRScanner(selectedLang: OcrLanguage, liveChecklist: ChecklistItem[] = []) {
  const alreadyReady =
    singletonWorkers.length === NUM_STRIPS && singletonLang === selectedLang;

  const [isInitializing, setIsInitializing] = useState(!alreadyReady);
  const [lastScanResult, setLastScanResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const workersRef = useRef<Worker[]>(alreadyReady ? singletonWorkers : []);
  // 3 dedicated 960x320 offscreen canvases (one per horizontal strip)
  const stripCanvasesRef = useRef<[HTMLCanvasElement | null, HTMLCanvasElement | null, HTMLCanvasElement | null]>([
    null,
    null,
    null,
  ]);
  const bandBusyRef = useRef<[boolean, boolean, boolean]>([false, false, false]);
  const bandResultsRef = useRef<[BandScanSnapshot, BandScanSnapshot, BandScanSnapshot]>([
    { matches: [], timestamp: 0 },
    { matches: [], timestamp: 0 },
    { matches: [], timestamp: 0 },
  ]);
  const previousMatchedItemIdsRef = useRef<Set<string>>(new Set());

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

    for (let b = 0; b < NUM_STRIPS; b++) {
      bandResultsRef.current[b].matches = bandResultsRef.current[b].matches.filter(
        (w) => w.matchedItemId && currentActiveIds.has(w.matchedItemId)
      );
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

  // Immediately purge a single completed item from all 3 strips & state
  const purgeItem = useCallback((itemId: string) => {
    completedTombstonesRef.current.add(itemId);
    previousMatchedItemIdsRef.current.delete(itemId);
    for (let b = 0; b < NUM_STRIPS; b++) {
      bandResultsRef.current[b].matches = bandResultsRef.current[b].matches.filter(
        (w) => w.matchedItemId !== itemId
      );
    }
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
      previousMatchedItemIdsRef.current.delete(id);
    }
    for (let b = 0; b < NUM_STRIPS; b++) {
      bandResultsRef.current[b].matches = bandResultsRef.current[b].matches.filter(
        (w) => !w.matchedItemId || !idSet.has(w.matchedItemId)
      );
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

  // Attach to or initialize the 3 parallel workers
  useEffect(() => {
    let isCancelled = false;

    async function attachWorkers() {
      if (singletonWorkers.length === NUM_STRIPS && singletonLang === selectedLang) {
        workersRef.current = singletonWorkers;
        setIsInitializing(false);
        setError(null);
        return;
      }

      setIsInitializing(true);
      try {
        const workers = await getOrCreateThreeWorkers(selectedLang);
        if (!isCancelled) {
          workersRef.current = workers;
          setIsInitializing(false);
          setError(null);
        }
      } catch (err) {
        if (!isCancelled) {
          console.error('OCR 3-worker init error:', err);
          const errorMsg = err instanceof Error ? err.message : String(err);
          setError(`Worker Error: ${errorMsg}`);
          setIsInitializing(false);
        }
      }
    }

    attachWorkers();

    return () => {
      isCancelled = true;
    };
  }, [selectedLang]);

  /**
   * Merges the latest fresh (< 400ms) matches across all 3 horizontal strips,
   * deduplicating overlapping hits in the 8% overlap zones between adjacent bands,
   * and immediately emits the unified ScanResult in full video coordinates (videoW x videoH).
   */
  const emitMergedStripResults = useCallback(
    (
      videoW: number,
      videoH: number,
      processingTimeMs: number,
      enableHaptics: boolean,
      enableSound: boolean
    ): ScanResult => {
      const now = performance.now();
      const freshTargets = activeItemsRef.current.filter(
        (item) => !item.isCompleted && !completedTombstonesRef.current.has(item.id)
      );
      const activeIdSet = new Set(freshTargets.map((t) => t.id));

      const mergedWords: MatchedWord[] = [];
      const matchesByItem = new Map<string, MatchedWord[]>();

      for (let b = 0; b < NUM_STRIPS; b++) {
        const snapshot = bandResultsRef.current[b];
        if (now - snapshot.timestamp > BOX_TTL_MS) {
          snapshot.matches = [];
          continue;
        }

        for (const w of snapshot.matches) {
          if (
            !w.matchedItemId ||
            !activeIdSet.has(w.matchedItemId) ||
            completedTombstonesRef.current.has(w.matchedItemId)
          ) {
            continue;
          }

          const listForItem = matchesByItem.get(w.matchedItemId) || [];
          // Deduplicate same row detected in the 8% overlap between adjacent strips
          const isOverlapDuplicate = listForItem.some(
            (ex) =>
              Math.abs(ex.bbox.y0 - w.bbox.y0) < 26 &&
              Math.abs(ex.bbox.x0 - w.bbox.x0) < 50
          );

          if (!isOverlapDuplicate) {
            mergedWords.push(w);
            listForItem.push(w);
            matchesByItem.set(w.matchedItemId, listForItem);
          }
        }
      }

      const detectedGroups: DetectedMatchGroup[] = [];
      for (const target of freshTargets) {
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

      const result: ScanResult = {
        allWords: mergedWords,
        matchedWords: mergedWords,
        detectedGroups,
        fullText: '',
        processingTimeMs,
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
    },
    []
  );

  /**
   * Scans a single horizontal strip (0 = Top 10%-42%, 1 = Center 34%-66%, 2 = Bottom 58%-90%)
   * at 960x320 resolution on its dedicated Web Worker thread (~110ms-140ms) and immediately
   * maps any matches back to full intrinsic video coordinates (videoW x videoH).
   */
  const scanBandIndex = useCallback(
    async (
      bandIdx: 0 | 1 | 2,
      source: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement,
      enableHaptics = true,
      enableSound = true
    ): Promise<ScanResult | null> => {
      const worker = workersRef.current[bandIdx];
      if (
        !worker ||
        bandBusyRef.current[bandIdx] ||
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

      bandBusyRef.current[bandIdx] = true;
      const startTime = performance.now();

      try {
        const band = HORIZONTAL_BANDS[bandIdx];
        const bandStartY = Math.round(videoH * band.startRatio);
        const bandHeight = Math.max(1, Math.round(videoH * (band.endRatio - band.startRatio)));

        if (!stripCanvasesRef.current[bandIdx]) {
          const c = document.createElement('canvas');
          c.width = STRIP_W;
          c.height = STRIP_H;
          stripCanvasesRef.current[bandIdx] = c;
        }
        const stripCanvas = stripCanvasesRef.current[bandIdx]!;
        if (stripCanvas.width !== STRIP_W || stripCanvas.height !== STRIP_H) {
          stripCanvas.width = STRIP_W;
          stripCanvas.height = STRIP_H;
        }

        const stripCtx = stripCanvas.getContext('2d', { alpha: false });
        if (!stripCtx) return null;

        // Draw clean raw horizontal band into 960x320 strip canvas (NO heavy pixel thresholding filters!)
        stripCtx.drawImage(
          source,
          0,
          bandStartY,
          videoW,
          bandHeight,
          0,
          0,
          STRIP_W,
          STRIP_H
        );

        const ret = await worker.recognize(stripCanvas);
        const data = ret.data;

        const freshTargets = activeItemsRef.current.filter(
          (item) => !item.isCompleted && !completedTombstonesRef.current.has(item.id)
        );

        if (freshTargets.length === 0) {
          bandResultsRef.current[bandIdx] = { matches: [], timestamp: performance.now() };
          return emitMergedStripResults(
            videoW,
            videoH,
            Math.round(performance.now() - startTime),
            enableHaptics,
            enableSound
          );
        }

        const preparedTargets = prepareTargets(freshTargets);

        // Convert strip (960 x 320) coordinates directly to full intrinsic video (videoW x videoH)
        const toFullVideoBbox = (b: { x0: number; y0: number; x1: number; y1: number }) => ({
          x0: (b.x0 / STRIP_W) * videoW,
          y0: bandStartY + (b.y0 / STRIP_H) * bandHeight,
          x1: (b.x1 / STRIP_W) * videoW,
          y1: bandStartY + (b.y1 / STRIP_H) * bandHeight,
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

        // Strict Substring Matching (with 0<->O and 1<->I equivalence) across all targets simultaneously
        const bandMatches: MatchedWord[] = [];

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
              const slicedStripBbox = sliceSubTokenBbox(
                w.bbox,
                w.text,
                pt.rawTrimmed,
                cleanWord,
                pt.cleanTarget
              );
              const fullVideoBbox = toFullVideoBbox(slicedStripBbox);

              bandMatches.push({
                id: `b${bandIdx}-${pt.item.id}-${wIdx}-${tIdx}`,
                text: w.text,
                normalizedText: cleanWord,
                confidence: w.confidence,
                bbox: fullVideoBbox,
                isMatch: true,
                score: isDirectHit ? 1.0 : 0.96,
                matchedItemId: pt.item.id,
                matchedItemText: pt.item.text,
              });
            }
          }
        }

        // Sliding-window evaluation across adjacent words on the same line for multi-word targets
        for (let lIdx = 0; lIdx < linesList.length; lIdx++) {
          const line = linesList[lIdx];
          const lWords = line.words;
          if (lWords.length < 2) continue;

          for (let tIdx = 0; tIdx < preparedTargets.length; tIdx++) {
            const pt = preparedTargets[tIdx];
            if (completedTombstonesRef.current.has(pt.item.id)) continue;

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

                const unionStripBbox = {
                  x0: Math.min(...slice.map((sw) => sw.bbox.x0)),
                  y0: Math.min(...slice.map((sw) => sw.bbox.y0)),
                  x1: Math.max(...slice.map((sw) => sw.bbox.x1)),
                  y1: Math.max(...slice.map((sw) => sw.bbox.y1)),
                };
                const fullVideoBbox = toFullVideoBbox(unionStripBbox);

                bandMatches.push({
                  id: `b${bandIdx}-mw-${pt.item.id}-${lIdx}-${start}`,
                  text: slice.map((sw) => sw.text).join(' '),
                  normalizedText: combinedClean,
                  confidence: line.confidence,
                  bbox: fullVideoBbox,
                  isMatch: true,
                  score: 0.95,
                  matchedItemId: pt.item.id,
                  matchedItemText: pt.item.text,
                });
              }
            }
          }
        }

        // Update this strip's snapshot and immediately emit merged results across all 3 strips!
        bandResultsRef.current[bandIdx] = {
          matches: bandMatches,
          timestamp: performance.now(),
        };

        return emitMergedStripResults(
          videoW,
          videoH,
          Math.round(performance.now() - startTime),
          enableHaptics,
          enableSound
        );
      } catch (err) {
        console.warn(`OCR strip ${bandIdx} scan error:`, err);
        return null;
      } finally {
        bandBusyRef.current[bandIdx] = false;
      }
    },
    [isInitializing, emitMergedStripResults]
  );

  /**
   * Fires all 3 horizontal strips in parallel across the 3 workers.
   */
  const scanAllStripsParallel = useCallback(
    async (
      source: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement,
      enableHaptics = true,
      enableSound = true
    ): Promise<void> => {
      await Promise.all([
        scanBandIndex(0, source, enableHaptics, enableSound),
        scanBandIndex(1, source, enableHaptics, enableSound),
        scanBandIndex(2, source, enableHaptics, enableSound),
      ]);
    },
    [scanBandIndex]
  );

  return {
    isInitializing,
    lastScanResult,
    error,
    scanBandIndex,
    scanAllStripsParallel,
    purgeItem,
    purgeMultipleItems,
  };
}
