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

interface StickyRecentMatch {
  word: MatchedWord;
  item: ChecklistItem;
  timestamp: number;
}

const FAST_LANG_CDN = 'https://tessdata.projectnaptha.com/4.0.0_fast';
const PARALLEL_WORKERS = 2;

// Pass 0: High-resolution full-frame overview width (2.2x sharper than 580px)
const FULL_PASS_MAX_WIDTH = 1280;
// Pass 1: 1:1 Native sensor pixel crop dimensions (ZERO downscaling for distant/small text)
const NATIVE_CROP_MAX_W = 960;
const NATIVE_CROP_MAX_H = 680;
// 450ms sticky box memory window across dual passes
const STICKY_MEMORY_MS = 450;

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
  const [initStatusText, setInitStatusText] = useState('Loading Fast HD OCR Engine...');
  const [workerStatus, setWorkerStatus] = useState<'initializing' | 'ready' | 'error'>('initializing');
  const [rawTextPreview, setRawTextPreview] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastScanResult, setLastScanResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const schedulerRef = useRef<Scheduler | null>(null);
  const workersRef = useRef<Worker[]>([]);
  // Dual offscreen canvas pool (Slot 0: Full-Frame HD Pass, Slot 1: 1:1 Native Pixel Distant Pass)
  const canvasPoolRef = useRef<[HTMLCanvasElement | null, HTMLCanvasElement | null]>([null, null]);
  const passToggleRef = useRef<number>(0);
  const activeJobsRef = useRef<number>(0);
  const previousMatchedItemIdsRef = useRef<Set<string>>(new Set());
  // 450ms sticky match memory so Pass 0 (Full Frame) and Pass 1 (1:1 Center Crop) fuse seamlessly
  const recentMatchesRef = useRef<StickyRecentMatch[]>([]);

  // Initialize Dual-Worker Tesseract v5 Scheduler with 4.0.0_fast + PSM 11 + DAWG disabled
  useEffect(() => {
    let isCancelled = false;

    async function setupFastScheduler() {
      setIsInitializing(true);
      setWorkerStatus('initializing');
      setInitProgress(15);
      setInitStatusText(`Loading Fast HD ${selectedLang}...`);

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
                          setInitStatusText('Initializing Dual HD Workers...');
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

          // PSM 11 (Sparse text - ultra fast) + 300 DPI hint for small distant text + disable DAWGs
          await worker.setParameters({
            tessedit_pageseg_mode: PSM.SPARSE_TEXT,
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
        setInitStatusText('Ready / HD 1:1 Scanning...');
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

  /**
   * Dual-Pass High-Resolution 1:1 Pixel Pipeline:
   * - Pass 0 (Full-Frame HD): Captures the entire frame up to 1280px wide to catch text anywhere on screen.
   * - Pass 1 (1:1 Native Pixel Center Crop): Captures the central region at true 1:1 sensor resolution
   *   with ZERO downscaling so small or distant text is read cleanly without zooming in.
   * All bounding boxes are transformed back into unified native video coordinates (videoW x videoH).
   */
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
      const startTime = performance.now();

      try {
        // Alternate between Pass 0 (Full-Frame High-Res) and Pass 1 (1:1 Native Pixel Center Crop)
        const passType = passToggleRef.current % 2;
        passToggleRef.current = (passToggleRef.current + 1) % 2;

        if (!canvasPoolRef.current[passType]) {
          canvasPoolRef.current[passType] = document.createElement('canvas');
        }
        const ocrCanvas = canvasPoolRef.current[passType]!;

        // Coordinate mapping parameters from ocrCanvas -> native video (videoW x videoH)
        let cropOffsetX = 0;
        let cropOffsetY = 0;
        let scaleToVideoX = 1;
        let scaleToVideoY = 1;

        if (passType === 1 && (videoW > NATIVE_CROP_MAX_W || videoH > NATIVE_CROP_MAX_H)) {
          // PASS 1: 1:1 Native Sensor Pixel Center Crop (ZERO downscaling for distant small text)
          const cropW = Math.min(videoW, NATIVE_CROP_MAX_W);
          const cropH = Math.min(videoH, NATIVE_CROP_MAX_H);
          cropOffsetX = Math.round((videoW - cropW) * 0.5);
          cropOffsetY = Math.round((videoH - cropH) * 0.5);

          if (ocrCanvas.width !== cropW || ocrCanvas.height !== cropH) {
            ocrCanvas.width = cropW;
            ocrCanvas.height = cropH;
          }

          const ocrCtx = ocrCanvas.getContext('2d', { alpha: false });
          if (!ocrCtx) return null;

          ocrCtx.imageSmoothingEnabled = false;
          ocrCtx.drawImage(source, cropOffsetX, cropOffsetY, cropW, cropH, 0, 0, cropW, cropH);
          scaleToVideoX = 1;
          scaleToVideoY = 1;
        } else {
          // PASS 0: High-Resolution Full-Frame Pass (up to 1280px wide)
          const ocrW = Math.min(videoW, FULL_PASS_MAX_WIDTH);
          const ocrH = Math.max(1, Math.round((videoH / videoW) * ocrW));

          if (ocrCanvas.width !== ocrW || ocrCanvas.height !== ocrH) {
            ocrCanvas.width = ocrW;
            ocrCanvas.height = ocrH;
          }

          const ocrCtx = ocrCanvas.getContext('2d', { alpha: false });
          if (!ocrCtx) return null;

          ocrCtx.imageSmoothingEnabled = true;
          ocrCtx.imageSmoothingQuality = 'high';
          ocrCtx.drawImage(source, 0, 0, ocrW, ocrH);

          cropOffsetX = 0;
          cropOffsetY = 0;
          scaleToVideoX = videoW / ocrW;
          scaleToVideoY = videoH / ocrH;
        }

        const ret = await schedulerRef.current.addJob('recognize', ocrCanvas);
        const data = ret.data;
        const rawFullText = (data.text || '').trim();

        if (rawFullText) {
          const sanitizedPreview = rawFullText.replace(/\s+/g, ' ').slice(0, 60);
          setRawTextPreview(sanitizedPreview);
        }

        // Helper to map ocrCanvas bbox -> native videoW x videoH coordinate space
        const toVideoBbox = (b: { x0: number; y0: number; x1: number; y1: number }) => ({
          x0: b.x0 * scaleToVideoX + cropOffsetX,
          y0: b.y0 * scaleToVideoY + cropOffsetY,
          x1: b.x1 * scaleToVideoX + cropOffsetX,
          y1: b.y1 * scaleToVideoY + cropOffsetY,
        });

        // Extract words and lines mapped to native videoW x videoH coordinates
        const wordsList: RawWordItem[] = [];
        const linesList: RawLineItem[] = [];

        const rawTopWords = (data as unknown as { words?: RawWordItem[] }).words;
        if (rawTopWords && Array.isArray(rawTopWords) && rawTopWords.length > 0) {
          for (const w of rawTopWords) {
            if (w.text && w.text.trim() && w.bbox) {
              wordsList.push({
                text: w.text.trim(),
                confidence: Math.round(w.confidence || 85),
                bbox: toVideoBbox(w.bbox),
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
                    bbox: toVideoBbox(w.bbox),
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
                bbox: toVideoBbox(line.bbox),
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
                            bbox: toVideoBbox(w.bbox),
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
                        bbox: toVideoBbox(l.bbox),
                        words: lineWords,
                      });
                    }
                  }
                }
              }
            }
          }
        }

        const currentPassWords: MatchedWord[] = [];

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
                id: `w-${targetItem.id}-${passType}-${i}`,
                text: w.text,
                normalizedText: cleanWord,
                confidence: w.confidence,
                bbox: tightBbox,
                isMatch: true,
                score: isDirectMatch ? 1.0 : 0.9,
                matchedItemId: targetItem.id,
                matchedItemText: targetItem.text,
              };

              currentPassWords.push(matchObj);
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
                id: `l-${targetItem.id}-${passType}-${lIdx}`,
                text: line.text,
                normalizedText: cleanLine,
                confidence: line.confidence,
                bbox: bboxToUse,
                isMatch: true,
                score: 0.95,
                matchedItemId: targetItem.id,
                matchedItemText: targetItem.text,
              };

              currentPassWords.push(matchObj);
            }
          }
        }

        // Fuse current pass detections with 450ms sticky match memory across Pass 0 and Pass 1
        const now = performance.now();
        const activeTargetIds = new Set(targetItems.map((t) => t.id));
        const survivingMemory = recentMatchesRef.current.filter(
          (entry) =>
            now - entry.timestamp < STICKY_MEMORY_MS &&
            activeTargetIds.has(entry.item.id)
        );

        const targetById = new Map(targetItems.map((t) => [t.id, t]));
        const dedupRadius = Math.max(90, videoW * 0.06);

        for (const w of currentPassWords) {
          const item = w.matchedItemId ? targetById.get(w.matchedItemId) : undefined;
          if (!item) continue;

          const wCx = (w.bbox.x0 + w.bbox.x1) * 0.5;
          const wCy = (w.bbox.y0 + w.bbox.y1) * 0.5;

          // Replace existing memory entry if it represents the same physical word on screen
          const existingIdx = survivingMemory.findIndex((m) => {
            if (m.item.id !== item.id) return false;
            const mCx = (m.word.bbox.x0 + m.word.bbox.x1) * 0.5;
            const mCy = (m.word.bbox.y0 + m.word.bbox.y1) * 0.5;
            return Math.hypot(wCx - mCx, wCy - mCy) < dedupRadius;
          });

          if (existingIdx >= 0) {
            survivingMemory[existingIdx] = { word: w, item, timestamp: now };
          } else {
            survivingMemory.push({ word: w, item, timestamp: now });
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
          allWords: fusedMatchedWords,
          matchedWords: fusedMatchedWords,
          detectedGroups,
          fullText: rawFullText,
          processingTimeMs: Math.round(endTime - startTime),
          // Always report native videoW x videoH so screen overlay mapping is 100% unified
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
