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

interface StickyRecentMatch {
  word: MatchedWord;
  item: ChecklistItem;
  timestamp: number;
  missedFrames: number;
}

const FAST_LANG_CDN = 'https://tessdata.projectnaptha.com/4.0.0_fast';
export const OCR_CANVAS_WIDTH = 1024;
const STICKY_MEMORY_MS = 3500;
const MIN_MISSED_SCANS_TO_KEEP = 6;

// Module-level singleton worker cache so opening the camera has 0ms initialization delay
let singletonWorker: Worker | null = null;
let singletonLang: OcrLanguage | null = null;
let singletonInitPromise: Promise<Worker> | null = null;

async function getOrCreateSingletonWorker(
  lang: OcrLanguage,
  onProgress?: (progress: number, statusText: string) => void
): Promise<Worker> {
  if (singletonWorker && singletonLang === lang) {
    onProgress?.(100, 'Ready / Scanning...');
    return singletonWorker;
  }

  if (singletonInitPromise && singletonLang === lang) {
    return singletonInitPromise;
  }

  // If language changed, terminate old worker first
  if (singletonWorker && singletonLang !== lang) {
    const oldWorker = singletonWorker;
    singletonWorker = null;
    singletonLang = null;
    singletonInitPromise = null;
    try {
      await oldWorker.terminate();
    } catch {
      // ignore
    }
  }

  singletonLang = lang;
  singletonInitPromise = (async () => {
    onProgress?.(20, `Loading Fast ${lang}...`);
    let worker: Worker;
    try {
      worker = await createWorker(lang, 1, {
        langPath: FAST_LANG_CDN,
        logger: (m) => {
          if (m.status) {
            if (m.status === 'loading tesseract core') {
              onProgress?.(35, 'Loading Fast Core...');
            } else if (m.status === 'initializing tesseract') {
              onProgress?.(65, 'Initializing OCR...');
            } else if (m.status.includes('loading') || m.status.includes('traineddata')) {
              const p = Math.round((m.progress || 0) * 30) + 65;
              onProgress?.(
                Math.min(98, p),
                `Fast Model ${lang} (${Math.round((m.progress || 0) * 100)}%)...`
              );
            }
          }
        },
      });
    } catch {
      worker = await createWorker(lang, 1);
    }

    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SPARSE_TEXT, // '11' - Sparse text - ultra fast
      load_system_dawg: '0',
      load_freq_dawg: '0',
      tessjs_create_hocr: '0',
      tessjs_create_tsv: '0',
      tessjs_create_box: '0',
      tessjs_create_unlv: '0',
      tessjs_create_osd: '0',
    });

    singletonWorker = worker;
    onProgress?.(100, 'Ready / Scanning...');
    return worker;
  })();

  try {
    return await singletonInitPromise;
  } catch (err) {
    singletonWorker = null;
    singletonLang = null;
    singletonInitPromise = null;
    throw err;
  }
}

/**
 * Pre-warms the persistent fast OCR worker while the user is still on the Home Screen
 * so opening the camera starts scanning immediately with zero wait.
 */
export function prewarmOCRWorker(lang: OcrLanguage): void {
  void getOrCreateSingletonWorker(lang).catch(() => {
    // handled when scanner mounts
  });
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

/**
 * Exact character-proportional horizontal bounding box slicer.
 * If the matched word is inside a longer token (e.g. "netlify" inside "camscanner07.netlify.app"),
 * slices x0 and x1 proportionally by character index BEFORE screen scaling.
 */
function sliceExactTokenBbox(
  bbox: { x0: number; y0: number; x1: number; y1: number },
  rawWordText: string,
  targetText: string
): { x0: number; y0: number; x1: number; y1: number } {
  const wordStr = rawWordText.trim();
  const targetStr = targetText.trim();
  if (!wordStr || !targetStr) return bbox;

  const fullTokenLen = Math.max(1, wordStr.length);
  const lowerWord = wordStr.toLowerCase();
  const lowerTarget = targetStr.toLowerCase();

  let matchStartIdx = lowerWord.indexOf(lowerTarget);
  let matchLen = targetStr.length;
  let denomLen = fullTokenLen;

  if (matchStartIdx < 0) {
    const normWord = normalizeText(wordStr).toLowerCase();
    const normTarget = normalizeText(targetStr).toLowerCase();
    matchStartIdx = normWord.indexOf(normTarget);
    matchLen = normTarget.length;
    denomLen = Math.max(1, normWord.length);
  }

  const charStartRatio = matchStartIdx >= 0 ? matchStartIdx / denomLen : 0;
  const charWidthRatio =
    matchStartIdx >= 0 ? Math.min(1 - charStartRatio, matchLen / denomLen) : 1;

  const rawWordW = bbox.x1 - bbox.x0;
  const exactX0 = bbox.x0 + rawWordW * charStartRatio;
  const exactW = rawWordW * charWidthRatio;

  return {
    x0: exactX0,
    y0: bbox.y0,
    x1: exactX0 + exactW,
    y1: bbox.y1,
  };
}

export function useOCRScanner(selectedLang: OcrLanguage, liveChecklist: ChecklistItem[] = []) {
  const alreadyReady = singletonWorker !== null && singletonLang === selectedLang;
  const [isInitializing, setIsInitializing] = useState(!alreadyReady);
  const [initProgress, setInitProgress] = useState(alreadyReady ? 100 : 15);
  const [initStatusText, setInitStatusText] = useState(
    alreadyReady ? 'Ready / Scanning...' : 'Loading Fast OCR Engine...'
  );
  const [workerStatus, setWorkerStatus] = useState<'initializing' | 'ready' | 'error'>(
    alreadyReady ? 'ready' : 'initializing'
  );
  const [rawTextPreview, setRawTextPreview] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastScanResult, setLastScanResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const workerRef = useRef<Worker | null>(alreadyReady ? singletonWorker : null);
  const ocrCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isBusyRef = useRef<boolean>(false);
  const previousMatchedItemIdsRef = useRef<Set<string>>(new Set());
  const recentMatchesRef = useRef<StickyRecentMatch[]>([]);

  // Live checklist ref & completed tombstone set so in-flight OCR scans NEVER resurrect a "Done" item
  const liveChecklistRef = useRef<ChecklistItem[]>(liveChecklist);
  liveChecklistRef.current = liveChecklist;
  const completedTombstonesRef = useRef<Set<string>>(new Set());

  // Keep tombstones synced if checklist resets
  useEffect(() => {
    const currentActiveIds = new Set(liveChecklist.map((i) => i.id));
    // If an item is back in active checklist (e.g. batch restart), remove from tombstones
    for (const id of Array.from(completedTombstonesRef.current)) {
      if (currentActiveIds.has(id)) {
        completedTombstonesRef.current.delete(id);
      }
    }
    // Also immediately prune any removed/completed items from sticky memory & lastScanResult
    recentMatchesRef.current = recentMatchesRef.current.filter((m) =>
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

  // Immediately purge a completed item from all OCR memory and state
  const purgeItem = useCallback((itemId: string) => {
    completedTombstonesRef.current.add(itemId);
    previousMatchedItemIdsRef.current.delete(itemId);
    recentMatchesRef.current = recentMatchesRef.current.filter(
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

  // Attach to or initialize the singleton worker
  useEffect(() => {
    let isCancelled = false;

    async function attachWorker() {
      if (singletonWorker && singletonLang === selectedLang) {
        workerRef.current = singletonWorker;
        setIsInitializing(false);
        setWorkerStatus('ready');
        setInitProgress(100);
        setInitStatusText('Ready / Scanning...');
        setError(null);
        return;
      }

      setIsInitializing(true);
      setWorkerStatus('initializing');

      try {
        const w = await getOrCreateSingletonWorker(selectedLang, (prog, text) => {
          if (!isCancelled) {
            setInitProgress(prog);
            setInitStatusText(text);
          }
        });

        if (!isCancelled) {
          workerRef.current = w;
          setIsInitializing(false);
          setWorkerStatus('ready');
          setInitProgress(100);
          setInitStatusText('Ready / Scanning...');
          setError(null);
        }
      } catch (err) {
        if (!isCancelled) {
          console.error('OCR worker init error:', err);
          const errorMsg = err instanceof Error ? err.message : String(err);
          setError(`Worker Error: ${errorMsg}`);
          setWorkerStatus('error');
          setInitStatusText(`Error: ${errorMsg}`);
          setIsInitializing(false);
        }
      }
    }

    attachWorker();

    return () => {
      isCancelled = true;
    };
  }, [selectedLang]);

  /**
   * Full-Frame 1024px OCR Pipeline (Zero Cropping = 100% Exact Coordinate Alignment):
   * Always draws the FULL <video> frame (0, 0, ocrW, ocrH) where ocrW = 1024 and
   * ocrH = Math.round(1024 * (video.videoHeight / video.videoWidth)).
   */
  const scanSource = useCallback(
    async (
      source: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement,
      _targetItems: ChecklistItem[],
      _mode: MatchMode,
      enableHaptics = true,
      enableSound = true
    ): Promise<ScanResult | null> => {
      const worker = workerRef.current;
      if (
        !worker ||
        isBusyRef.current ||
        isInitializing ||
        liveChecklistRef.current.length === 0
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

      isBusyRef.current = true;
      setIsProcessing(true);
      const startTime = performance.now();

      try {
        // Always draw the FULL <video> frame onto offscreen ocrCanvas (width = 1024, proportional height)
        const ocrW = OCR_CANVAS_WIDTH;
        const ocrH = Math.max(1, Math.round(OCR_CANVAS_WIDTH * (videoH / videoW)));

        if (!ocrCanvasRef.current) {
          ocrCanvasRef.current = document.createElement('canvas');
        }
        const ocrCanvas = ocrCanvasRef.current;
        if (ocrCanvas.width !== ocrW || ocrCanvas.height !== ocrH) {
          ocrCanvas.width = ocrW;
          ocrCanvas.height = ocrH;
        }

        const ocrCtx = ocrCanvas.getContext('2d', { alpha: false });
        if (!ocrCtx) {
          return null;
        }

        // Draw FULL <video> frame directly — NO sub-region cropping, NO CSS/SVG filters
        ocrCtx.drawImage(source, 0, 0, ocrW, ocrH);

        const ret = await worker.recognize(ocrCanvas);
        const data = ret.data;
        const rawFullText = (data.text || '').trim();

        const sanitizedPreview = rawFullText.replace(/\s+/g, ' ').slice(0, 60);
        setRawTextPreview(sanitizedPreview);

        // Read the LIVE active checklist AFTER recognize() resolves so items marked "Done"
        // while this frame was being processed are never matched or resurrected!
        const freshTargetItems = liveChecklistRef.current.filter(
          (item) => !item.isCompleted && !completedTombstonesRef.current.has(item.id)
        );

        if (freshTargetItems.length === 0) {
          recentMatchesRef.current = [];
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

        // Extract words and lines in 1024px ocrCanvas space
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

        const currentFrameWords: MatchedWord[] = [];

        for (const targetItem of freshTargetItems) {
          if (completedTombstonesRef.current.has(targetItem.id)) continue;
          const cleanTarget = clean(targetItem.text);
          if (!cleanTarget) continue;

          let matchedInWords = false;

          // 1. Word-level match with exact character-index proportional sub-slicing
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
              const exactBbox = sliceExactTokenBbox(w.bbox, w.text, targetItem.text);
              const matchObj: MatchedWord = {
                id: `w-${targetItem.id}-${i}`,
                text: w.text,
                normalizedText: cleanWord,
                confidence: w.confidence,
                bbox: exactBbox,
                isMatch: true,
                score: isDirectMatch ? 1.0 : 0.9,
                matchedItemId: targetItem.id,
                matchedItemText: targetItem.text,
              };

              currentFrameWords.push(matchObj);
            }
          }

          // 2. Multi-word phrase fallback (tight union of matching words inside the line)
          if (!matchedInWords && targetItem.text.trim().includes(' ')) {
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
                  targetParts.some((tp) => cw.includes(tp) || tp.includes(cw))
                );
              });

              if (matchingLineWords.length > 0) {
                const bboxToUse = {
                  x0: Math.min(...matchingLineWords.map((lw) => lw.bbox.x0)),
                  y0: Math.min(...matchingLineWords.map((lw) => lw.bbox.y0)),
                  x1: Math.max(...matchingLineWords.map((lw) => lw.bbox.x1)),
                  y1: Math.max(...matchingLineWords.map((lw) => lw.bbox.y1)),
                };

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

                currentFrameWords.push(matchObj);
              }
            }
          }
        }

        // Fuse with 3500ms / 6-missed-scans persistent lock-on memory (strictly excluding completed tombstones)
        const now = performance.now();
        const activeTargetIds = new Set(freshTargetItems.map((t) => t.id));
        const targetById = new Map(freshTargetItems.map((t) => [t.id, t]));

        // Group current frame matches by target item ID (pick highest confidence/score or keep multiple distinct instances)
        const seenItemIdsThisScan = new Set<string>();
        const survivingMemory: StickyRecentMatch[] = [];

        // Keep existing locked-on entries that are still active and within 3500ms or <= 6 missed scans
        for (const prev of recentMatchesRef.current) {
          if (
            !activeTargetIds.has(prev.item.id) ||
            completedTombstonesRef.current.has(prev.item.id)
          ) {
            continue;
          }
          const nextMissed = prev.missedFrames + 1;
          if (now - prev.timestamp < STICKY_MEMORY_MS || nextMissed <= MIN_MISSED_SCANS_TO_KEEP) {
            survivingMemory.push({
              ...prev,
              missedFrames: nextMissed,
            });
          }
        }

        for (const w of currentFrameWords) {
          if (!w.matchedItemId || completedTombstonesRef.current.has(w.matchedItemId)) continue;
          const item = targetById.get(w.matchedItemId);
          if (!item) continue;

          // Match to existing tracked entry for this target item anywhere on screen
          const existingIdx = survivingMemory.findIndex(
            (m) => m.item.id === item.id && !seenItemIdsThisScan.has(`${item.id}-${m.word.id}`)
          );

          if (existingIdx >= 0 && !seenItemIdsThisScan.has(item.id)) {
            seenItemIdsThisScan.add(item.id);
            survivingMemory[existingIdx] = {
              word: w,
              item,
              timestamp: now,
              missedFrames: 0,
            };
          } else if (!seenItemIdsThisScan.has(item.id)) {
            seenItemIdsThisScan.add(item.id);
            survivingMemory.push({
              word: w,
              item,
              timestamp: now,
              missedFrames: 0,
            });
          }
        }

        recentMatchesRef.current = survivingMemory;

        const fusedMatchedWords = survivingMemory.map((m) => m.word);
        const itemToMatchesMap = new Map<string, MatchedWord[]>();
        for (const m of survivingMemory) {
          if (!itemToMatchesMap.has(m.item.id)) {
            itemToMatchesMap.set(m.item.id, []);
          }
          itemToMatchesMap.get(m.item.id)!.push(m.word);
        }

        const detectedGroups: DetectedMatchGroup[] = [];
        for (const target of freshTargetItems) {
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
          allWords: currentFrameWords,
          matchedWords: currentFrameWords,
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
    purgeItem,
  };
}
