import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  ArrowLeft,
  Zap,
  ZapOff,
  X,
  Check,
  CheckCheck,
  ChevronDown,
  RefreshCw,
  Play,
  ScanLine,
} from 'lucide-react';
import {
  OcrLanguage,
  MatchMode,
  MatchedWord,
  ChecklistItem,
  DetectedMatchGroup,
} from '../types';
import { Translation } from '../translations';
import { useOCRScanner } from '../hooks/useOCRScanner';
import { CelebrationOverlay } from './CelebrationOverlay';
import { triggerHaptic } from '../utils/audioAlert';

interface Props {
  checklist: ChecklistItem[];
  completedItems: ChecklistItem[];
  initialTotalCount: number;
  ocrLanguage: OcrLanguage;
  matchMode: MatchMode;
  t: Translation;
  isRtl: boolean;
  onBack: () => void;
  onCompleteItem: (item: ChecklistItem) => void;
  onCompleteMultipleItems?: (items: ChecklistItem[]) => void;
  onRestartBatch: () => void;
}

type ScannerViewState = 'LIVE_VIEWFINDER' | 'FROZEN_LOCK';

interface CompletedFreezeBox {
  id: string;
  itemId: string;
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

const THUMB_W = 64;
const THUMB_H = 36;
const STEADY_DIFF_THRESHOLD = 8.0;

export const CameraView: React.FC<Props> = ({
  checklist,
  completedItems,
  initialTotalCount,
  ocrLanguage,
  matchMode,
  t,
  isRtl,
  onBack,
  onCompleteItem,
  onCompleteMultipleItems,
  onRestartBatch,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const frozenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Offscreen clean bitmap of the frozen frame + 64x36 motion-stability thumbnail canvas
  const frozenBitmapRef = useRef<HTMLCanvasElement | null>(null);
  const motionThumbCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const prevThumbLumaRef = useRef<Uint8Array | null>(null);

  const [viewState, setViewState] = useState<ScannerViewState>('LIVE_VIEWFINDER');
  const viewStateRef = useRef<ScannerViewState>('LIVE_VIEWFINDER');
  viewStateRef.current = viewState;

  const [isSteady, setIsSteady] = useState<boolean>(false);
  const [shutterFlash, setShutterFlash] = useState<boolean>(false);
  const [frozenAnalyzing, setFrozenAnalyzing] = useState<boolean>(false);

  // Active & completed boxes on the current frozen frame (in exact frozenBitmap pixel coordinates)
  const [frozenMatchedWords, setFrozenMatchedWords] = useState<MatchedWord[]>([]);
  const [frozenDetectedGroups, setFrozenDetectedGroups] = useState<DetectedMatchGroup[]>([]);
  const [completedOnFreezeBoxes, setCompletedOnFreezeBoxes] = useState<CompletedFreezeBox[]>([]);

  const [cameraError, setCameraError] = useState<string | null>(null);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [isTorchOn, setIsTorchOn] = useState(false);
  const [isFrontCamera, setIsFrontCamera] = useState(false);
  const [showQueueDropdown, setShowQueueDropdown] = useState(false);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  // Live hardware/digital zoom (1x, 2x, 3x) + Frozen pinch-to-zoom & pan (1x..4x)
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [hardwareZoomAvailable, setHardwareZoomAvailable] = useState(false);
  const [zoomMinMax, setZoomMinMax] = useState<{ min: number; max: number }>({ min: 1, max: 3 });

  const [frozenPan, setFrozenPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const touchGestureRef = useRef<{
    isDragging: boolean;
    hasMoved: boolean;
    startX: number;
    startY: number;
    startPanX: number;
    startPanY: number;
    initialPinchDist: number | null;
    initialZoom: number;
  }>({
    isDragging: false,
    hasMoved: false,
    startX: 0,
    startY: 0,
    startPanX: 0,
    startPanY: 0,
    initialPinchDist: null,
    initialZoom: 1,
  });

  // Auto-Freeze vs Tap-to-Freeze mode
  const [scanMode, setScanMode] = useState<'auto' | 'manual'>('auto');

  const {
    isInitializing,
    isScanningSnapshot,
    scanSnapshot,
    purgeItem,
    purgeMultipleItems,
  } = useOCRScanner(ocrLanguage, checklist);

  const activeChecklistRef = useRef<ChecklistItem[]>(checklist);
  activeChecklistRef.current = checklist;
  const completedIdsRef = useRef<Set<string>>(new Set());

  // Sync completedIdsRef if checklist resets
  useEffect(() => {
    const activeIds = new Set(checklist.map((i) => i.id));
    for (const id of Array.from(completedIdsRef.current)) {
      if (activeIds.has(id)) {
        completedIdsRef.current.delete(id);
      }
    }
  }, [checklist]);

  // Redraw the FROZEN_LOCK canvas (clean frozen snapshot bitmap + 100% pixel-locked green boxes & ✓ badges)
  const renderFrozenCanvas = useCallback(() => {
    const canvas = frozenCanvasRef.current;
    const sourceBitmap = frozenBitmapRef.current;
    if (!canvas || !sourceBitmap || sourceBitmap.width === 0 || sourceBitmap.height === 0) {
      return;
    }

    const snapW = sourceBitmap.width;
    const snapH = sourceBitmap.height;

    if (canvas.width !== snapW || canvas.height !== snapH) {
      canvas.width = snapW;
      canvas.height = snapH;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 1. Draw the exact high-resolution snapshot bitmap that Tesseract analyzed
    ctx.clearRect(0, 0, snapW, snapH);
    ctx.drawImage(sourceBitmap, 0, 0, snapW, snapH);

    // Scale stroke and padding proportionally to the high-res snapshot dimensions
    const scaleFactor = Math.max(1, snapW / 500);
    const padX = Math.round(5 * scaleFactor);
    const padY = Math.round(2.5 * scaleFactor);

    // 2. Draw subtle completed checkmark badges for items checked off on this frozen screen
    for (const doneBox of completedOnFreezeBoxes) {
      const rx = doneBox.bbox.x0 - padX;
      const ry = doneBox.bbox.y0 - padY;
      const rw = doneBox.bbox.x1 - doneBox.bbox.x0 + padX * 2;
      const rh = doneBox.bbox.y1 - doneBox.bbox.y0 + padY * 2;
      const radius = Math.min(10 * scaleFactor, Math.max(4 * scaleFactor, rh * 0.3));

      ctx.save();
      ctx.fillStyle = 'rgba(34, 197, 94, 0.16)';
      ctx.beginPath();
      ctx.roundRect(rx, ry, rw, rh, radius);
      ctx.fill();

      ctx.strokeStyle = 'rgba(34, 197, 94, 0.65)';
      ctx.lineWidth = 1.6 * scaleFactor;
      ctx.setLineDash([4 * scaleFactor, 3 * scaleFactor]);
      ctx.stroke();

      // Small green ✓ circle badge on the right edge of the completed box
      const badgeR = Math.max(8 * scaleFactor, Math.min(13 * scaleFactor, rh * 0.42));
      const badgeCx = rx + rw;
      const badgeCy = ry;

      ctx.setLineDash([]);
      ctx.fillStyle = '#22c55e';
      ctx.beginPath();
      ctx.arc(badgeCx, badgeCy, badgeR, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2 * scaleFactor;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(badgeCx - badgeR * 0.42, badgeCy + badgeR * 0.02);
      ctx.lineTo(badgeCx - badgeR * 0.1, badgeCy + badgeR * 0.35);
      ctx.lineTo(badgeCx + badgeR * 0.45, badgeCy - badgeR * 0.32);
      ctx.stroke();
      ctx.restore();
    }

    // 3. Draw active 100% solid green pill boxes directly in snapshot pixel space (0.00px drift!)
    for (const word of frozenMatchedWords) {
      if (word.matchedItemId && completedIdsRef.current.has(word.matchedItemId)) continue;

      const rx = word.bbox.x0 - padX;
      const ry = word.bbox.y0 - padY;
      const rw = word.bbox.x1 - word.bbox.x0 + padX * 2;
      const rh = word.bbox.y1 - word.bbox.y0 + padY * 2;
      const pillRadius = Math.min(10 * scaleFactor, Math.max(4 * scaleFactor, rh * 0.32));

      ctx.save();
      ctx.globalAlpha = 1;
      ctx.shadowColor = '#22c55e';
      ctx.shadowBlur = 8 * scaleFactor;

      ctx.fillStyle = 'rgba(34, 197, 94, 0.26)';
      ctx.beginPath();
      ctx.roundRect(rx, ry, rw, rh, pillRadius);
      ctx.fill();

      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 2.6 * scaleFactor;
      ctx.stroke();
      ctx.restore();
    }
  }, [frozenMatchedWords, completedOnFreezeBoxes]);

  useEffect(() => {
    if (viewState === 'FROZEN_LOCK') {
      renderFrozenCanvas();
    }
  }, [viewState, renderFrozenCanvas]);

  // Clean up media tracks immediately to release camera indicator on iOS/Android
  const stopTracks = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore
        }
      });
      streamRef.current = null;
    }
  }, []);

  // Handle visibility change: instantly stop camera on minimize / tab switch
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        stopTracks();
      } else if (document.visibilityState === 'visible') {
        initCamera();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [stopTracks]);

  // Initialize Full HD 1080p Camera Stream (1920x1080 @ 30fps, continuous focus)
  const initCamera = useCallback(async () => {
    setCameraError(null);
    stopTracks();

    try {
      const constraints: MediaStreamConstraints = {
        audio: false,
        video: {
          facingMode: isFrontCamera ? 'user' : { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 },
          // @ts-expect-error continuous focus and exposure modes keep small receipt text sharp
          advanced: [{ focusMode: 'continuous' }, { exposureMode: 'continuous' }],
        },
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        const trackWithCaps = videoTrack as MediaStreamTrack & { getCapabilities?: () => unknown };
        const capabilities = (typeof trackWithCaps.getCapabilities === 'function'
          ? trackWithCaps.getCapabilities()
          : {}) as {
          torch?: boolean;
          zoom?: { min: number; max: number; step: number };
        };

        setTorchAvailable(Boolean(capabilities?.torch));

        if (capabilities?.zoom && capabilities.zoom.max > 1) {
          setHardwareZoomAvailable(true);
          setZoomMinMax({
            min: capabilities.zoom.min || 1,
            max: capabilities.zoom.max || 5,
          });
        } else {
          setHardwareZoomAvailable(false);
        }
      }
    } catch (err) {
      console.warn('Advanced camera constraints failed, trying basic Full HD:', err);
      try {
        const fallbackStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: isFrontCamera ? 'user' : { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30 },
          },
        });
        streamRef.current = fallbackStream;
        if (videoRef.current) {
          videoRef.current.srcObject = fallbackStream;
          await videoRef.current.play();
        }
      } catch (finalErr) {
        console.warn('Final camera error:', finalErr);
        setCameraError(t.cameraPermissionDenied);
      }
    }
  }, [isFrontCamera, stopTracks, t.cameraPermissionDenied]);

  useEffect(() => {
    initCamera();
    return () => {
      stopTracks();
    };
  }, [initCamera, stopTracks]);

  // Resume Live Camera Viewfinder ("Scan Next / بەردەوامبوون")
  const handleResumeLiveCamera = useCallback(() => {
    triggerHaptic(35);
    setViewState('LIVE_VIEWFINDER');
    setFrozenMatchedWords([]);
    setFrozenDetectedGroups([]);
    setCompletedOnFreezeBoxes([]);
    setFrozenAnalyzing(false);
    setFrozenPan({ x: 0, y: 0 });
    prevThumbLumaRef.current = null;
  }, []);

  // Instant Manual Tap-to-Freeze & High-Res Scan
  const triggerFreezeAndScan = useCallback(async () => {
    const video = videoRef.current;
    const currentItems = activeChecklistRef.current.filter(
      (i) => !completedIdsRef.current.has(i.id)
    );
    if (!video || isInitializing || currentItems.length === 0) return;
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth === 0) return;

    // 1. Immediate shutter flash + haptic + freeze current frame onto frozenBitmapRef
    triggerHaptic(50);
    setShutterFlash(true);
    setTimeout(() => setShutterFlash(false), 180);

    if (!frozenBitmapRef.current) {
      frozenBitmapRef.current = document.createElement('canvas');
    }

    setCompletedOnFreezeBoxes([]);
    setFrozenMatchedWords([]);
    setFrozenDetectedGroups([]);
    setFrozenPan({ x: 0, y: 0 });
    setFrozenAnalyzing(true);
    setViewState('FROZEN_LOCK');

    const output = await scanSnapshot(video, matchMode, {
      forceCaptureCanvas: frozenBitmapRef.current,
      enableHaptics: true,
      enableSound: true,
    });

    setFrozenAnalyzing(false);

    if (output) {
      setFrozenMatchedWords(output.result.matchedWords);
      setFrozenDetectedGroups(output.result.detectedGroups);
      renderFrozenCanvas();
    }
  }, [isInitializing, matchMode, scanSnapshot, renderFrozenCanvas]);

  // State A (LIVE_VIEWFINDER): 120ms Motion Stability Detector + Auto-Freeze Smart Lock
  useEffect(() => {
    if (viewState !== 'LIVE_VIEWFINDER' || isInitializing) return;

    let isCancelled = false;
    let isScanInFlight = false;

    const intervalId = setInterval(async () => {
      if (isCancelled || viewStateRef.current !== 'LIVE_VIEWFINDER') return;

      const video = videoRef.current;
      const currentItems = activeChecklistRef.current.filter(
        (i) => !completedIdsRef.current.has(i.id)
      );
      if (
        !video ||
        currentItems.length === 0 ||
        video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
        video.videoWidth === 0
      ) {
        return;
      }

      // 1. Measure motion stability via tiny 64x36 grayscale thumbnail comparison every 120ms
      if (!motionThumbCanvasRef.current) {
        motionThumbCanvasRef.current = document.createElement('canvas');
        motionThumbCanvasRef.current.width = THUMB_W;
        motionThumbCanvasRef.current.height = THUMB_H;
      }
      const thumbCtx = motionThumbCanvasRef.current.getContext('2d', {
        alpha: false,
        willReadFrequently: true,
      });
      if (!thumbCtx) return;

      thumbCtx.drawImage(video, 0, 0, THUMB_W, THUMB_H);
      const rgba = thumbCtx.getImageData(0, 0, THUMB_W, THUMB_H).data;
      const pixelCount = THUMB_W * THUMB_H;
      const currLuma = new Uint8Array(pixelCount);

      let diffSum = 0;
      const prevLuma = prevThumbLumaRef.current;

      for (let i = 0, p = 0; i < pixelCount; i++, p += 4) {
        const y = (rgba[p] * 77 + rgba[p + 1] * 150 + rgba[p + 2] * 29) >> 8;
        currLuma[i] = y;
        if (prevLuma) {
          diffSum += Math.abs(y - prevLuma[i]);
        }
      }
      prevThumbLumaRef.current = currLuma;

      const meanDiff = prevLuma ? diffSum / pixelCount : 999;
      const phoneIsSteady = meanDiff < STEADY_DIFF_THRESHOLD;
      setIsSteady(phoneIsSteady);

      // 2. In Auto-Freeze mode, when the phone is held steady, capture high-res snapshot & scan
      if (scanMode === 'auto' && phoneIsSteady && !isScanInFlight) {
        isScanInFlight = true;
        try {
          if (!frozenBitmapRef.current) {
            frozenBitmapRef.current = document.createElement('canvas');
          }

          const output = await scanSnapshot(video, matchMode, {
            forceCaptureCanvas: frozenBitmapRef.current,
            enableHaptics: true,
            enableSound: true,
          });

          // Auto-Freeze on Match: the instant >=1 target items are found, lock onto FROZEN_LOCK!
          if (
            !isCancelled &&
            viewStateRef.current === 'LIVE_VIEWFINDER' &&
            output &&
            output.result.detectedGroups.length > 0
          ) {
            setShutterFlash(true);
            setTimeout(() => setShutterFlash(false), 180);

            setCompletedOnFreezeBoxes([]);
            setFrozenMatchedWords(output.result.matchedWords);
            setFrozenDetectedGroups(output.result.detectedGroups);
            setFrozenPan({ x: 0, y: 0 });
            setViewState('FROZEN_LOCK');
          }
        } finally {
          isScanInFlight = false;
        }
      }
    }, 120);

    return () => {
      isCancelled = true;
      clearInterval(intervalId);
    };
  }, [viewState, isInitializing, scanMode, matchMode, scanSnapshot]);

  // Torch Toggle
  const toggleTorch = async () => {
    if (!streamRef.current || !torchAvailable) return;
    const videoTrack = streamRef.current.getVideoTracks()[0];
    if (videoTrack) {
      try {
        const nextTorch = !isTorchOn;
        await videoTrack.applyConstraints({
          advanced: [{ torch: nextTorch } as MediaTrackConstraintSet & { torch: boolean }],
        });
        setIsTorchOn(nextTorch);
      } catch (err) {
        console.warn('Torch failed:', err);
      }
    }
  };

  // Flip Camera
  const flipCamera = () => {
    setIsFrontCamera((prev) => !prev);
    setIsTorchOn(false);
    handleResumeLiveCamera();
  };

  // Apply Zoom (1x, 2x, 3x) — works in both LIVE_VIEWFINDER and FROZEN_LOCK
  const applyZoom = async (level: number) => {
    setZoomLevel(level);
    if (level === 1) {
      setFrozenPan({ x: 0, y: 0 });
    }
    if (!streamRef.current) return;
    const videoTrack = streamRef.current.getVideoTracks()[0];

    if (videoTrack && hardwareZoomAvailable && viewState === 'LIVE_VIEWFINDER') {
      try {
        const clampedZoom = Math.min(zoomMinMax.max, Math.max(zoomMinMax.min, level));
        await videoTrack.applyConstraints({
          advanced: [{ zoom: clampedZoom } as MediaTrackConstraintSet & { zoom: number }],
        });
      } catch (err) {
        console.warn('Hardware zoom failed:', err);
      }
    }
  };

  // Handle single item "✓ Done" completion (from bottom chip OR direct tap on a green box)
  const handleMarkItemDone = useCallback(
    (item: ChecklistItem) => {
      triggerHaptic(60);

      completedIdsRef.current.add(item.id);
      purgeItem(item.id);

      // Convert active green boxes for this item into completed ✓ badges on the frozen image
      setFrozenMatchedWords((prevWords) => {
        const wordsForCompleted = prevWords.filter((w) => w.matchedItemId === item.id);
        if (wordsForCompleted.length > 0) {
          setCompletedOnFreezeBoxes((prevDone) => [
            ...prevDone,
            ...wordsForCompleted.map((w) => ({
              id: w.id,
              itemId: item.id,
              text: item.text,
              bbox: w.bbox,
            })),
          ]);
        }
        return prevWords.filter((w) => w.matchedItemId !== item.id);
      });

      setFrozenDetectedGroups((prevGroups) => {
        const remaining = prevGroups.filter((g) => g.item.id !== item.id);
        // If all found items on this frozen frame have now been checked off and more items remain in the checklist,
        // automatically unfreeze back to LIVE_VIEWFINDER after a brief 420ms confirmation!
        const totalRemainingInQueue = activeChecklistRef.current.filter(
          (i) => i.id !== item.id && !completedIdsRef.current.has(i.id)
        ).length;
        if (remaining.length === 0 && totalRemainingInQueue > 0 && viewStateRef.current === 'FROZEN_LOCK') {
          setTimeout(() => {
            if (viewStateRef.current === 'FROZEN_LOCK') {
              handleResumeLiveCamera();
            }
          }, 420);
        }
        return remaining;
      });

      setSuccessToast(t.completedToast(item.text));
      setTimeout(() => {
        setSuccessToast(null);
      }, 1800);

      onCompleteItem(item);
    },
    [onCompleteItem, purgeItem, t, handleResumeLiveCamera]
  );

  // Handle "Mark All Found (✓)" batch completion
  const handleMarkAllFound = (groups: DetectedMatchGroup[]) => {
    if (groups.length === 0) return;
    triggerHaptic(80);

    const itemsToComplete = groups.map((g) => g.item);
    const idsToPurge = itemsToComplete.map((i) => i.id);
    const purgeSet = new Set(idsToPurge);

    for (const id of idsToPurge) {
      completedIdsRef.current.add(id);
    }
    purgeMultipleItems(idsToPurge);

    setFrozenMatchedWords((prevWords) => {
      const wordsForCompleted = prevWords.filter(
        (w) => w.matchedItemId && purgeSet.has(w.matchedItemId)
      );
      if (wordsForCompleted.length > 0) {
        setCompletedOnFreezeBoxes((prevDone) => [
          ...prevDone,
          ...wordsForCompleted.map((w) => ({
            id: w.id,
            itemId: w.matchedItemId!,
            text: w.matchedItemText || w.text,
            bbox: w.bbox,
          })),
        ]);
      }
      return prevWords.filter((w) => !w.matchedItemId || !purgeSet.has(w.matchedItemId));
    });
    setFrozenDetectedGroups([]);

    const summaryText =
      itemsToComplete.length === 1
        ? t.completedToast(itemsToComplete[0].text)
        : `✓ ${itemsToComplete.length} items marked done`;
    setSuccessToast(summaryText);
    setTimeout(() => {
      setSuccessToast(null);
    }, 1800);

    if (onCompleteMultipleItems) {
      onCompleteMultipleItems(itemsToComplete);
    } else {
      for (const item of itemsToComplete) {
        onCompleteItem(item);
      }
    }

    const totalRemainingInQueue = activeChecklistRef.current.filter(
      (i) => !purgeSet.has(i.id) && !completedIdsRef.current.has(i.id)
    ).length;
    if (totalRemainingInQueue > 0) {
      setTimeout(() => {
        if (viewStateRef.current === 'FROZEN_LOCK') {
          handleResumeLiveCamera();
        }
      }, 450);
    }
  };

  // Interactive Direct Tap-on-Box in FROZEN_LOCK Mode
  const handleFrozenCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (viewState !== 'FROZEN_LOCK' || touchGestureRef.current.hasMoved) return;

    const canvas = frozenCanvasRef.current;
    if (!canvas || canvas.width === 0 || canvas.height === 0) return;

    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    // Convert client tap coordinates into the displayed rect of the canvas (accounting for object-fit: cover)
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;

    const snapW = canvas.width;
    const snapH = canvas.height;
    const coverScale = Math.max(rect.width / snapW, rect.height / snapH);
    const offsetX = (rect.width - snapW * coverScale) * 0.5;
    const offsetY = (rect.height - snapH * coverScale) * 0.5;

    const tapSnapX = (localX - offsetX) / coverScale;
    const tapSnapY = (localY - offsetY) / coverScale;

    // Generous touch hit-padding (18px in snapshot space) so small receipt rows are effortless to tap
    const hitPad = Math.max(16, snapW * 0.018);

    for (const word of frozenMatchedWords) {
      if (!word.matchedItemId || completedIdsRef.current.has(word.matchedItemId)) continue;
      if (
        tapSnapX >= word.bbox.x0 - hitPad &&
        tapSnapX <= word.bbox.x1 + hitPad &&
        tapSnapY >= word.bbox.y0 - hitPad &&
        tapSnapY <= word.bbox.y1 + hitPad
      ) {
        const matchedItem = activeChecklistRef.current.find((i) => i.id === word.matchedItemId);
        if (matchedItem) {
          e.stopPropagation();
          handleMarkItemDone(matchedItem);
          return;
        }
      }
    }

    // If no matches exist on this frozen snapshot and user taps background, resume live viewfinder
    if (frozenDetectedGroups.length === 0 && !frozenAnalyzing) {
      handleResumeLiveCamera();
    }
  };

  // Touch Pinch-to-Zoom (1x..4x) & Pan on Frozen Snapshot
  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (viewState !== 'FROZEN_LOCK') return;

    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      touchGestureRef.current.initialPinchDist = Math.hypot(dx, dy);
      touchGestureRef.current.initialZoom = zoomLevel;
      touchGestureRef.current.hasMoved = true;
    } else if (e.touches.length === 1) {
      touchGestureRef.current.isDragging = true;
      touchGestureRef.current.hasMoved = false;
      touchGestureRef.current.startX = e.touches[0].clientX;
      touchGestureRef.current.startY = e.touches[0].clientY;
      touchGestureRef.current.startPanX = frozenPan.x;
      touchGestureRef.current.startPanY = frozenPan.y;
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (viewState !== 'FROZEN_LOCK') return;

    if (e.touches.length === 2 && touchGestureRef.current.initialPinchDist) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const ratio = dist / touchGestureRef.current.initialPinchDist;
      const nextZoom = Math.min(4, Math.max(1, Number((touchGestureRef.current.initialZoom * ratio).toFixed(2))));
      setZoomLevel(nextZoom);
      if (nextZoom <= 1.02) {
        setFrozenPan({ x: 0, y: 0 });
      }
      touchGestureRef.current.hasMoved = true;
    } else if (e.touches.length === 1 && touchGestureRef.current.isDragging && zoomLevel > 1) {
      const dx = e.touches[0].clientX - touchGestureRef.current.startX;
      const dy = e.touches[0].clientY - touchGestureRef.current.startY;
      if (Math.hypot(dx, dy) > 8) {
        touchGestureRef.current.hasMoved = true;
        const maxPan = 220 * (zoomLevel - 1);
        setFrozenPan({
          x: Math.max(-maxPan, Math.min(maxPan, touchGestureRef.current.startPanX + dx)),
          y: Math.max(-maxPan, Math.min(maxPan, touchGestureRef.current.startPanY + dy)),
        });
      }
    }
  };

  const handleTouchEnd = () => {
    touchGestureRef.current.isDragging = false;
    touchGestureRef.current.initialPinchDist = null;
  };

  const handleExit = () => {
    stopTracks();
    onBack();
  };

  const totalCount = Math.max(initialTotalCount, checklist.length + completedItems.length);
  const remainingCount = checklist.length;
  const activeIdSet = new Set(checklist.map((i) => i.id));
  const detectedGroups = frozenDetectedGroups.filter(
    (g) => activeIdSet.has(g.item.id) && !completedIdsRef.current.has(g.item.id)
  );
  const isAllCompleted = checklist.length === 0 && totalCount > 0;

  useEffect(() => {
    if (isAllCompleted) {
      stopTracks();
    }
  }, [isAllCompleted, stopTracks]);

  const liveDigitalZoomCss =
    viewState === 'LIVE_VIEWFINDER' && !hardwareZoomAvailable && zoomLevel > 1
      ? `scale(${zoomLevel})`
      : '';
  const frozenZoomPanCss =
    viewState === 'FROZEN_LOCK'
      ? `translate3d(${frozenPan.x}px, ${frozenPan.y}px, 0) scale(${zoomLevel})`
      : '';

  return (
    <div
      ref={containerRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className="fixed inset-0 w-screen h-[100dvh] overflow-hidden bg-black select-none touch-none"
      dir="ltr"
    >
      {/* STATE A: LIVE_VIEWFINDER (Tap anywhere on live video to freeze & scan immediately) */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        onClick={viewState === 'LIVE_VIEWFINDER' ? triggerFreezeAndScan : undefined}
        style={{
          transform:
            `${isFrontCamera ? 'scaleX(-1)' : ''} ${liveDigitalZoomCss}`.trim() || undefined,
          transformOrigin: 'center center',
        }}
        className={`absolute inset-0 w-full h-full object-cover transition-transform duration-150 ${
          viewState === 'FROZEN_LOCK' ? 'opacity-0 pointer-events-none' : 'opacity-100 cursor-pointer'
        }`}
      />

      {/* STATE B: FROZEN_LOCK (100% Pixel-Accurate Highlighted Inspection Bitmap + Pinch Zoom/Pan + Tap Box) */}
      <div
        style={{
          transform: frozenZoomPanCss || undefined,
          transformOrigin: 'center center',
        }}
        className={`absolute inset-0 w-full h-full z-10 transition-transform duration-75 ${
          viewState === 'FROZEN_LOCK' ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      >
        <canvas
          ref={frozenCanvasRef}
          onClick={handleFrozenCanvasClick}
          style={{
            transform: isFrontCamera ? 'scaleX(-1)' : undefined,
            transformOrigin: 'center center',
          }}
          className="w-full h-full object-cover cursor-pointer"
        />
      </div>

      {/* Crisp Camera Shutter Flash Effect on Freeze */}
      {shutterFlash && (
        <div className="fixed inset-0 bg-white/75 z-40 pointer-events-none transition-opacity duration-150" />
      )}

      {/* 1. TOP MINIMALIST GEOMETRIC BAR */}
      <div className="absolute top-20 inset-x-0 z-30 px-4 flex flex-col items-center gap-2 pointer-events-auto max-w-md mx-auto">
        <div className="w-full h-12 px-3 bg-white/95 dark:bg-[#0f0f0f]/95 backdrop-blur-md border border-[#cbd5e1] dark:border-white/75 flex items-center justify-between gap-2 shadow-lg">
          {/* Back Button */}
          <button
            onClick={handleExit}
            className="min-w-[38px] min-h-[38px] flex items-center justify-center text-[#0f172a] dark:text-white hover:opacity-75 active:scale-95 transition"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5 stroke-[2.5]" />
          </button>

          {/* Remaining Items Queue Trigger */}
          <button
            onClick={() => setShowQueueDropdown((prev) => !prev)}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-100 dark:bg-[#1a1a1a] border border-[#cbd5e1] dark:border-white/30 text-[#0f172a] dark:text-white text-xs font-bold active:scale-95 transition tabular-nums"
            dir={isRtl ? 'rtl' : 'ltr'}
          >
            <span>
              {t.remainingItems}: {remainingCount}
            </span>
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform ${
                showQueueDropdown ? 'rotate-180' : ''
              }`}
            />
          </button>

          {/* Scan Mode: Auto-Freeze vs Tap-to-Freeze */}
          <div className="flex items-center bg-slate-100 dark:bg-[#0a0a0a] p-0.5 text-[11px] font-bold border border-[#cbd5e1] dark:border-white/50">
            <button
              onClick={() => setScanMode('auto')}
              className={`px-2 py-1 transition active:scale-95 ${
                scanMode === 'auto'
                  ? 'bg-[#248a3d] text-white'
                  : 'text-slate-600 dark:text-neutral-400'
              }`}
            >
              Auto
            </button>
            <button
              onClick={() => setScanMode('manual')}
              className={`px-2 py-1 transition active:scale-95 ${
                scanMode === 'manual'
                  ? 'bg-[#248a3d] text-white'
                  : 'text-slate-600 dark:text-neutral-400'
              }`}
            >
              Tap
            </button>
          </div>

          <div className="flex items-center gap-1">
            {/* Torch Button */}
            {torchAvailable && (
              <button
                onClick={toggleTorch}
                className={`min-w-[36px] min-h-[36px] flex items-center justify-center transition ${
                  isTorchOn
                    ? 'text-amber-500'
                    : 'text-slate-600 dark:text-neutral-300 hover:opacity-80'
                }`}
                aria-label="Torch"
              >
                {isTorchOn ? (
                  <Zap className="w-4 h-4 fill-current" />
                ) : (
                  <ZapOff className="w-4 h-4" />
                )}
              </button>
            )}

            {/* Flip Camera */}
            <button
              onClick={flipCamera}
              className="min-w-[36px] min-h-[36px] flex items-center justify-center text-slate-600 dark:text-neutral-300 hover:opacity-80 transition active:rotate-180 duration-300"
              aria-label="Flip"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Success Toast */}
        {successToast && (
          <div className="w-full px-4 py-2 bg-[#248a3d] text-white font-bold text-xs border border-white/50 shadow-lg flex items-center justify-center gap-2 z-40">
            <Check className="w-4 h-4 stroke-[3]" />
            <span>{successToast}</span>
          </div>
        )}

        {/* Dropdown for Remaining Items */}
        {showQueueDropdown && (
          <div
            className="w-full bg-white/95 dark:bg-[#0f0f0f]/95 backdrop-blur-md border border-[#cbd5e1] dark:border-white/75 p-3 shadow-2xl space-y-2 text-xs text-[#0f172a] dark:text-white"
            dir={isRtl ? 'rtl' : 'ltr'}
          >
            <div className="flex items-center justify-between pb-2 border-b border-[#cbd5e1] dark:border-white/25 text-xs font-bold">
              <span>
                {t.activeChecklist} ({checklist.length})
              </span>
              <button
                onClick={() => setShowQueueDropdown(false)}
                className="p-1 text-slate-500 dark:text-neutral-400 hover:opacity-80"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="max-h-40 overflow-y-auto space-y-2 pr-0.5">
              {checklist.map((item, idx) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-2 px-3 py-2 bg-slate-50 dark:bg-[#0a0a0a] border border-[#cbd5e1] dark:border-white/50"
                >
                  <span className="truncate text-xs font-bold tabular-nums" dir="ltr">
                    {idx + 1}. {item.text}
                  </span>
                  <button
                    onClick={() => handleMarkItemDone(item)}
                    className="px-2.5 py-1 bg-[#248a3d] hover:bg-[#2aa147] text-white text-[11px] font-bold transition active:scale-95 flex items-center gap-1"
                  >
                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                    <span>{t.doneButton}</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 2. BOTTOM AREA: Frozen Match Chips + "Scan Next / بەردەوامبوون" + 1x/2x/3x Zoom Bar */}
      <div className="absolute bottom-0 inset-x-0 z-30 pb-[max(env(safe-area-inset-bottom,16px),24px)] px-4 pt-4 flex flex-col items-center gap-2.5 pointer-events-auto max-w-md mx-auto">
        {/* FROZEN_LOCK Inspection Panel */}
        {viewState === 'FROZEN_LOCK' && !showQueueDropdown && (
          <div
            className="w-full bg-white/95 dark:bg-[#0f0f0f]/95 backdrop-blur-md border-2 border-[#22c55e] p-2.5 shadow-2xl flex flex-col gap-2"
            dir={isRtl ? 'rtl' : 'ltr'}
          >
            {frozenAnalyzing ? (
              <div className="py-2 flex items-center justify-center gap-2 text-xs font-bold text-[#0f172a] dark:text-white">
                <ScanLine className="w-4 h-4 text-[#22c55e] animate-pulse" />
                <span>Scanning high-res frame...</span>
              </div>
            ) : detectedGroups.length > 0 ? (
              <>
                {/* Compact Horizontal Chips for all simultaneously detected items */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {detectedGroups.map((group) => (
                    <div
                      key={group.item.id}
                      className="inline-flex items-center gap-2 pl-2.5 pr-1.5 py-1 bg-slate-100 dark:bg-[#161616] border border-[#cbd5e1] dark:border-white/40 text-xs font-extrabold text-[#0f172a] dark:text-white"
                    >
                      <span className="truncate max-w-[140px]" dir="ltr">
                        {group.item.text}
                      </span>
                      {group.words.length > 1 && (
                        <span className="text-[10px] font-mono text-[#22c55e] tabular-nums">
                          ×{group.words.length}
                        </span>
                      )}
                      <button
                        onClick={() => handleMarkItemDone(group.item)}
                        className="px-2 py-1 bg-[#248a3d] hover:bg-[#2aa147] active:scale-95 text-white font-bold text-[11px] transition flex items-center gap-1 shrink-0"
                        title={t.doneButton}
                      >
                        <Check className="w-3.5 h-3.5 stroke-[3]" />
                        <span>{t.doneButton}</span>
                      </button>
                    </div>
                  ))}
                </div>

                {/* "Mark All Found (✓)" Action Button when multiple items are detected */}
                {detectedGroups.length > 1 && (
                  <button
                    onClick={() => handleMarkAllFound(detectedGroups)}
                    className="w-full py-2 px-3 bg-[#248a3d] hover:bg-[#2aa147] active:scale-98 text-white font-extrabold text-xs border border-white/30 transition flex items-center justify-center gap-1.5"
                  >
                    <CheckCheck className="w-4 h-4 stroke-[2.75]" />
                    <span>Mark All Found ({detectedGroups.length}) ✓</span>
                  </button>
                )}
              </>
            ) : (
              <div className="py-1 text-center text-xs font-bold text-slate-600 dark:text-neutral-300">
                No target match in this frame
              </div>
            )}

            {/* Prominent "Resume Live Camera / Scan Next" Action Button */}
            <button
              onClick={handleResumeLiveCamera}
              className="w-full py-2 px-3 bg-slate-900 dark:bg-white text-white dark:text-[#0a0a0a] font-extrabold text-xs border border-[#cbd5e1] dark:border-white transition active:scale-98 flex items-center justify-center gap-1.5"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>{ isRtl ? 'بەردەوامبوون / سکانێکی نوێ' : 'Scan Next / Resume Camera' }</span>
            </button>
          </div>
        )}

        {/* LIVE_VIEWFINDER Trigger Button (Hold steady in Auto mode or Tap anytime to freeze & scan) */}
        {viewState === 'LIVE_VIEWFINDER' && (
          <button
            onClick={triggerFreezeAndScan}
            className="px-4 py-2 bg-white/95 dark:bg-[#0f0f0f]/95 border border-[#cbd5e1] dark:border-white/75 text-xs font-bold text-[#0f172a] dark:text-white shadow-lg active:scale-95 transition flex items-center gap-2"
          >
            <span
              className={`w-2 h-2 rounded-full ${
                isScanningSnapshot
                  ? 'bg-[#22c55e] animate-ping'
                  : isSteady
                  ? 'bg-[#22c55e]'
                  : 'bg-amber-400'
              }`}
            />
            <span>
              {scanMode === 'manual'
                ? t.tapScreenToScan
                : isScanningSnapshot
                ? 'Scanning steady frame...'
                : 'Hold steady or Tap to Freeze & Scan'}
            </span>
          </button>
        )}

        {/* Minimalist Rectangular Distance Zoom Selector (1x | 2x | 3x) */}
        <div className="inline-flex items-center bg-white/95 dark:bg-[#0f0f0f]/95 border border-[#cbd5e1] dark:border-white/75 p-1 text-xs font-bold shadow-lg tabular-nums">
          {[1, 2, 3].map((lvl, idx) => (
            <React.Fragment key={lvl}>
              {idx > 0 && (
                <div className="w-[1px] h-4 bg-[#cbd5e1] dark:bg-white/40 mx-0.5" />
              )}
              <button
                onClick={() => applyZoom(lvl)}
                className={`px-3.5 py-1 transition active:scale-95 ${
                  Math.round(zoomLevel) === lvl
                    ? 'bg-[#248a3d] text-white font-extrabold'
                    : 'text-[#0f172a] dark:text-white hover:opacity-75'
                }`}
              >
                {lvl}x
              </button>
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* CAMERA ERROR OVERLAY */}
      {cameraError && (
        <div className="fixed inset-0 z-40 bg-[#f8fafc] dark:bg-[#0a0a0a] p-6 flex flex-col items-center justify-center text-center text-[#0f172a] dark:text-white space-y-4">
          <div className="w-full max-w-xs border border-[#cbd5e1] dark:border-white/75 bg-white dark:bg-[#0f0f0f] p-6 space-y-4">
            <h3 className="text-base font-extrabold">{t.cameraPermissionDenied}</h3>
            <p className="text-xs text-slate-500 dark:text-neutral-400">
              {t.cameraErrorInstructions}
            </p>
            <div className="flex flex-col gap-2.5 pt-2">
              <button
                onClick={initCamera}
                className="py-3 px-4 bg-[#248a3d] text-white font-bold text-xs"
              >
                {t.retryCamera}
              </button>
              <button
                onClick={handleExit}
                className="py-2.5 border border-[#cbd5e1] dark:border-white/50 text-xs font-bold"
              >
                {t.cameraBack}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Celebratory Completion Overlay */}
      {isAllCompleted && (
        <CelebrationOverlay
          completedItems={completedItems}
          t={t}
          isRtl={isRtl}
          onRestart={onRestartBatch}
        />
      )}
    </div>
  );
};
