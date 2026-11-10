import { useEffect, useRef, useState, useCallback } from 'react';
import { createWorker, Worker, PSM } from 'tesseract.js';
import { OcrLanguage, MatchMode, MatchedWord, ScanResult, ChecklistItem, DetectedMatchGroup } from '../types';
import { checkMatch, cleanAlphanumeric, normalizeText } from '../utils/textMatcher';
import { triggerHaptic, playMatchChime } from '../utils/audioAlert';

interface RawOCRWord {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  lineIndex: number;
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
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeLangRef = useRef<OcrLanguage>(selectedLang);
  const isBusyRef = useRef(false);
  const previousMatchedItemIdsRef = useRef<Set<string>>(new Set());

  // Initialize or reinitialize Tesseract v5 worker with PSM 11 (Sparse text for fine/faint text)
  useEffect(() => {
    let isCancelled = false;
    activeLangRef.current = selectedLang;

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
                setInitStatusText(`Downloading ${selectedLang} (${Math.round((m.progress || 0) * 100)}%)...`);
              }
            }
          },
        });

        if (isCancelled) {
          await worker.terminate();
          return;
        }

        // PSM 11 = Sparse text: finds small, faint, and isolated words accurately across the frame
        await worker.setParameters({
          tessedit_pageseg_mode: PSM.SPARSE_TEXT,
          preserve_interword_spaces: '1',
        });

        workerRef.current = worker;
        setIsInitializing(false);
        setWorkerStatus('ready');
        setInitProgress(100);
        setInitStatusText('Ready');
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

  /**
   * If an OCR word token contains extra prefix/suffix characters around the target word
   * (e.g. "item:Recording" or "123-Recording" when searching "Recording"),
   * slice the bounding box horizontally to wrap ONLY the matched target characters.
   */
  const tightenWordBbox = (
    bbox: { x0: number; y0: number; x1: number; y1: number },
    detectedText: string,
    targetText: string
  ) => {
    const normDetected = normalizeText(cleanAlphanumeric(detectedText));
    const normTarget = normalizeText(cleanAlphanumeric(targetText));

    if (
      normDetected.length > normTarget.length + 1 &&
      normTarget.length >= 2 &&
      normDetected.includes(normTarget)
    ) {
      const idx = normDetected.indexOf(normTarget);
      if (idx >= 0) {
        const totalWidth = bbox.x1 - bbox.x0;
        const startRatio = idx / normDetected.length;
        const endRatio = (idx + normTarget.length) / normDetected.length;
        return {
          x0: bbox.x0 + totalWidth * startRatio,
          y0: bbox.y0,
          x1: bbox.x0 + totalWidth * endRatio,
          y1: bbox.y1,
        };
      }
    }
    return bbox;
  };

  // Main scan function: High-clarity 1280px pipeline for faint & fine text + strict word-level bbox extraction
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

      if (source instanceof HTMLVideoElement) {
        if (source.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || source.videoWidth === 0) {
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

        // Preserve full 1280px detail (and upscale low-res frames to 1280px) so small/fine text is crisp
        const targetW = srcW < 1280 ? 1280 : Math.min(1440, srcW);
        const scaleX = targetW / srcW;
        const targetH = Math.round(srcH * scaleX);
        const scaleY = targetH / srcH;

        if (!offscreenCanvasRef.current) {
          offscreenCanvasRef.current = document.createElement('canvas');
        }
        const canvas = offscreenCanvasRef.current;
        if (canvas.width !== targetW || canvas.height !== targetH) {
          canvas.width = targetW;
          canvas.height = targetH;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          isBusyRef.current = false;
          setIsProcessing(false);
          return null;
        }

        // High-quality bicubic-like smoothing + GPU contrast/brightness boost for faint & fine text
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.filter = 'grayscale(1) contrast(1.75) brightness(1.06)';
        ctx.drawImage(source, 0, 0, targetW, targetH);
        ctx.filter = 'none';

        const ret = await workerRef.current.recognize(canvas);
        const rawFullText = (ret.data.text || '').trim();

        // Update raw text preview
        const sanitizedPreview = rawFullText.replace(/\s+/g, ' ').slice(0, 50);
        setRawTextPreview(sanitizedPreview);

        // Extract STRICTLY word-level tokens (NEVER whole line.bbox!)
        const rawWords: RawOCRWord[] = [];
        let lineCounter = 0;

        if (ret.data.lines && ret.data.lines.length > 0) {
          for (const line of ret.data.lines) {
            lineCounter++;
            if (line.words && line.words.length > 0) {
              for (const w of line.words) {
                const txt = (w.text || '').trim();
                if (txt.length > 0 && w.bbox) {
                  rawWords.push({
                    text: txt,
                    confidence: Math.round(w.confidence || 0),
                    bbox: w.bbox,
                    lineIndex: lineCounter,
                  });
                }
              }
            }
          }
        }

        // Fallback to top-level words or nested blocks->paragraphs->lines->words if lines array was empty
        if (rawWords.length === 0) {
          const topWords = (ret.data as unknown as { words?: Array<{ text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }> }).words;
          if (topWords && topWords.length > 0) {
            for (const w of topWords) {
              const txt = (w.text || '').trim();
              if (txt.length > 0 && w.bbox) {
                rawWords.push({
                  text: txt,
                  confidence: Math.round(w.confidence || 0),
                  bbox: w.bbox,
                  lineIndex: 0,
                });
              }
            }
          } else if (ret.data.blocks) {
            for (const block of ret.data.blocks) {
              if (block.paragraphs) {
                for (const p of block.paragraphs) {
                  if (p.lines) {
                    for (const l of p.lines) {
                      lineCounter++;
                      if (l.words) {
                        for (const w of l.words) {
                          const txt = (w.text || '').trim();
                          if (txt.length > 0 && w.bbox) {
                            rawWords.push({
                              text: txt,
                              confidence: Math.round(w.confidence || 0),
                              bbox: w.bbox,
                              lineIndex: lineCounter,
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

        // Exact inverse scale back to native video source coordinates (srcW x srcH)
        const invScaleX = 1 / scaleX;
        const invScaleY = 1 / scaleY;

        const allWords: MatchedWord[] = [];
        const matchedWords: MatchedWord[] = [];
        const itemToMatchesMap = new Map<string, MatchedWord[]>();

        // 1. Evaluate every individual word token first
        const matchedWordIndicesByTarget = new Map<string, Set<number>>();

        for (let i = 0; i < rawWords.length; i++) {
          const w = rawWords[i];
          let bestItem: ChecklistItem | null = null;
          let highestScore = 0;

          for (const item of targetItems) {
            // Only single-word match here if target doesn't require multiple words, or if single word contains it
            const { isMatch, score } = checkMatch(w.text, item.text, mode);
            if (isMatch && score > highestScore) {
              highestScore = score;
              bestItem = item;
            }
          }

          const tightCanvasBbox = bestItem
            ? tightenWordBbox(w.bbox, w.text, bestItem.text)
            : w.bbox;

          const nativeBbox = {
            x0: tightCanvasBbox.x0 * invScaleX,
            y0: tightCanvasBbox.y0 * invScaleY,
            x1: tightCanvasBbox.x1 * invScaleX,
            y1: tightCanvasBbox.y1 * invScaleY,
          };

          const isMatch = Boolean(bestItem);
          const wordItem: MatchedWord = {
            id: `word-${i}-${Date.now()}`,
            text: w.text,
            normalizedText: w.text,
            confidence: w.confidence,
            bbox: nativeBbox,
            isMatch,
            score: highestScore,
            matchedItemId: bestItem?.id,
            matchedItemText: bestItem?.text,
          };

          allWords.push(wordItem);

          if (isMatch && bestItem) {
            matchedWords.push(wordItem);
            if (!itemToMatchesMap.has(bestItem.id)) {
              itemToMatchesMap.set(bestItem.id, []);
            }
            itemToMatchesMap.get(bestItem.id)!.push(wordItem);

            if (!matchedWordIndicesByTarget.has(bestItem.id)) {
              matchedWordIndicesByTarget.set(bestItem.id, new Set());
            }
            matchedWordIndicesByTarget.get(bestItem.id)!.add(i);
          }
        }

        // 2. Multi-word phrase support: check consecutive word slices (2 to 4 words on the same line)
        // Computes tight union bbox of ONLY the consecutive matched words, never the whole line!
        for (const item of targetItems) {
          const targetWordsCount = item.text.trim().split(/\s+/).length;
          // Also check 2-word slice in case OCR split a single target word into two adjacent tokens
          const maxWindow = Math.min(4, Math.max(2, targetWordsCount + 1));

          for (let i = 0; i < rawWords.length; i++) {
            const alreadyMatchedIndices = matchedWordIndicesByTarget.get(item.id);
            if (alreadyMatchedIndices && alreadyMatchedIndices.has(i)) continue;

            for (let winLen = 2; winLen <= maxWindow && i + winLen <= rawWords.length; winLen++) {
              const slice = rawWords.slice(i, i + winLen);
              // Must be on the same line
              if (slice.some((sw) => sw.lineIndex !== slice[0].lineIndex)) break;
              // Skip if any word in slice already matched this item individually
              if (alreadyMatchedIndices && slice.some((_, idx) => alreadyMatchedIndices.has(i + idx))) {
                continue;
              }

              const joinedText = slice.map((s) => s.text).join(' ');
              const { isMatch, score } = checkMatch(joinedText, item.text, mode);

              // Ensure the match actually spans the slice (neither the first nor last word alone is the full match)
              if (isMatch) {
                const firstAlone = checkMatch(slice[0].text, item.text, mode).isMatch;
                const lastAlone = checkMatch(slice[slice.length - 1].text, item.text, mode).isMatch;
                if (!firstAlone && !lastAlone) {
                  const unionX0 = Math.min(...slice.map((s) => s.bbox.x0)) * invScaleX;
                  const unionY0 = Math.min(...slice.map((s) => s.bbox.y0)) * invScaleY;
                  const unionX1 = Math.max(...slice.map((s) => s.bbox.x1)) * invScaleX;
                  const unionY1 = Math.max(...slice.map((s) => s.bbox.y1)) * invScaleY;
                  const avgConf = Math.round(
                    slice.reduce((acc, s) => acc + s.confidence, 0) / slice.length
                  );

                  const phraseMatch: MatchedWord = {
                    id: `phrase-${i}-${winLen}-${Date.now()}`,
                    text: joinedText,
                    normalizedText: joinedText,
                    confidence: avgConf,
                    bbox: {
                      x0: unionX0,
                      y0: unionY0,
                      x1: unionX1,
                      y1: unionY1,
                    },
                    isMatch: true,
                    score,
                    matchedItemId: item.id,
                    matchedItemText: item.text,
                  };

                  matchedWords.push(phraseMatch);
                  if (!itemToMatchesMap.has(item.id)) {
                    itemToMatchesMap.set(item.id, []);
                  }
                  itemToMatchesMap.get(item.id)!.push(phraseMatch);

                  if (!matchedWordIndicesByTarget.has(item.id)) {
                    matchedWordIndicesByTarget.set(item.id, new Set());
                  }
                  for (let k = 0; k < winLen; k++) {
                    matchedWordIndicesByTarget.get(item.id)!.add(i + k);
                  }
                  break;
                }
              }
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
          allWords,
          matchedWords,
          detectedGroups,
          fullText: rawFullText,
          processingTimeMs: Math.round(endTime - startTime),
          frameWidth: srcW,
          frameHeight: srcH,
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
  };
}
