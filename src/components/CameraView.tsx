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
} from 'lucide-react';
import { OcrLanguage, MatchMode, ChecklistItem, DetectedMatchGroup } from '../types';
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

interface TrackedLiveBox {
  key: string;
  targetId: string;
  // Full intrinsic video coordinates (videoW x videoH)
  bbox: { x0: number; y0: number; x1: number; y1: number };
  // Rendered screen-space coordinates
  renderX: number;
  renderY: number;
  renderW: number;
  renderH: number;
  lastSeenTimestamp: number;
  initialized: boolean;
}

const BOX_TTL_MS = 400;

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
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [cameraError, setCameraError] = useState<string | null>(null);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [isTorchOn, setIsTorchOn] = useState(false);
  const [isFrontCamera, setIsFrontCamera] = useState(false);
  const [showQueueDropdown, setShowQueueDropdown] = useState(false);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  // Zoom control state (Hardware optical zoom or synchronized CSS digital zoom fallback)
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [hardwareZoomAvailable, setHardwareZoomAvailable] = useState(false);
  const [zoomMinMax, setZoomMinMax] = useState<{ min: number; max: number }>({ min: 1, max: 3 });

  // Auto (100% live 3-strip parallel stream) vs Tap (manual live scan trigger)
  const [scanMode, setScanMode] = useState<'auto' | 'manual'>('auto');
  const [manualScanPulse, setManualScanPulse] = useState(false);

  // 3-Worker Parallel Horizontal Strip Live Stream OCR Hook
  const {
    isInitializing,
    lastScanResult,
    scanBandIndex,
    scanAllStripsParallel,
    purgeItem,
    purgeMultipleItems,
  } = useOCRScanner(ocrLanguage, checklist);

  const trackedBoxesRef = useRef<TrackedLiveBox[]>([]);
  const detectedGroupsRef = useRef<DetectedMatchGroup[]>([]);
  const scanDimsRef = useRef<{ w: number; h: number }>({ w: 1920, h: 1080 });
  const activeChecklistRef = useRef<ChecklistItem[]>(checklist);
  activeChecklistRef.current = checklist;
  const completedIdsRef = useRef<Set<string>>(new Set());

  // Keep completedIdsRef synced with active checklist
  useEffect(() => {
    const activeIds = new Set(checklist.map((i) => i.id));
    for (const id of Array.from(completedIdsRef.current)) {
      if (activeIds.has(id)) {
        completedIdsRef.current.delete(id);
      }
    }
    trackedBoxesRef.current = trackedBoxesRef.current.filter(
      (b) => activeIds.has(b.targetId) && !completedIdsRef.current.has(b.targetId)
    );
  }, [checklist]);

  // Sync latest merged 3-strip OCR matches into trackedBoxesRef
  useEffect(() => {
    if (!lastScanResult) return;

    const now = performance.now();
    const activeIds = new Set(
      activeChecklistRef.current
        .filter((i) => !completedIdsRef.current.has(i.id))
        .map((i) => i.id)
    );

    detectedGroupsRef.current = lastScanResult.detectedGroups.filter((g) =>
      activeIds.has(g.item.id)
    );

    const videoW = lastScanResult.frameWidth || 1920;
    const videoH = lastScanResult.frameHeight || 1080;
    scanDimsRef.current = { w: videoW, h: videoH };

    const currentTracks = trackedBoxesRef.current.filter(
      (t) => activeIds.has(t.targetId) && !completedIdsRef.current.has(t.targetId)
    );
    const incomingWords = lastScanResult.matchedWords.filter(
      (w) => w.matchedItemId && activeIds.has(w.matchedItemId) && !completedIdsRef.current.has(w.matchedItemId)
    );

    const updatedTracks: TrackedLiveBox[] = [];
    const matchedPrevIndices = new Set<number>();

    for (let i = 0; i < incomingWords.length; i++) {
      const m = incomingWords[i];
      const targetId = m.matchedItemId!;

      const mCx = (m.bbox.x0 + m.bbox.x1) * 0.5;
      const mCy = (m.bbox.y0 + m.bbox.y1) * 0.5;

      // Associate with nearest existing box of the same target item (< 85px in video coordinates)
      let bestPrevIdx = -1;
      let bestDist = 85;

      for (let j = 0; j < currentTracks.length; j++) {
        if (matchedPrevIndices.has(j)) continue;
        const p = currentTracks[j];
        if (p.targetId !== targetId) continue;

        const pCx = (p.bbox.x0 + p.bbox.x1) * 0.5;
        const pCy = (p.bbox.y0 + p.bbox.y1) * 0.5;
        const dist = Math.hypot(mCx - pCx, mCy - pCy);
        if (dist < bestDist) {
          bestDist = dist;
          bestPrevIdx = j;
        }
      }

      if (bestPrevIdx >= 0) {
        matchedPrevIndices.add(bestPrevIdx);
        const prev = currentTracks[bestPrevIdx];
        updatedTracks.push({
          ...prev,
          bbox: m.bbox,
          lastSeenTimestamp: now,
        });
      } else {
        updatedTracks.push({
          key: `${targetId}_${i}_${now}`,
          targetId,
          bbox: m.bbox,
          renderX: 0,
          renderY: 0,
          renderW: 0,
          renderH: 0,
          lastSeenTimestamp: now,
          initialized: false,
        });
      }
    }

    trackedBoxesRef.current = updatedTracks;
  }, [lastScanResult]);

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

  // Initialize Full HD 1080p Live Camera Stream (1920x1080 @ 30fps, continuous focus)
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
    trackedBoxesRef.current = [];
  };

  // Apply Hardware Optical Zoom (or synchronized CSS parent zoom fallback)
  const applyZoom = async (level: number) => {
    setZoomLevel(level);
    trackedBoxesRef.current = [];
    if (!streamRef.current) return;
    const videoTrack = streamRef.current.getVideoTracks()[0];

    if (videoTrack && hardwareZoomAvailable) {
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

  // Manual live scan trigger (fires all 3 strips in parallel without freezing the video)
  const triggerManualLiveScan = useCallback(async () => {
    const video = videoRef.current;
    const currentItems = activeChecklistRef.current.filter(
      (i) => !completedIdsRef.current.has(i.id)
    );
    if (video && !isInitializing && currentItems.length > 0) {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
        setManualScanPulse(true);
        triggerHaptic(40);
        await scanAllStripsParallel(video, true, true);
        setTimeout(() => setManualScanPulse(false), 400);
      }
    }
  }, [isInitializing, scanAllStripsParallel]);

  // 3-Worker Parallel Horizontal Strip Live Stream Engine
  // Runs 3 independent parallel worker loops (Band 0: Top 10%-42%, Band 1: Center 34%-66%, Band 2: Bottom 58%-90%)
  useEffect(() => {
    if (scanMode !== 'auto' || isInitializing) return;

    let isRunning = true;

    const runStripWorkerLoop = async (bandIdx: 0 | 1 | 2) => {
      while (isRunning) {
        const video = videoRef.current;
        const hasActiveTargets = activeChecklistRef.current.some(
          (i) => !completedIdsRef.current.has(i.id)
        );

        if (
          video &&
          hasActiveTargets &&
          video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
          video.videoWidth > 0
        ) {
          await scanBandIndex(bandIdx, video, true, true);
          await new Promise((r) => setTimeout(r, 10));
        } else {
          await new Promise((r) => setTimeout(r, 45));
        }
      }
    };

    void runStripWorkerLoop(0);
    void runStripWorkerLoop(1);
    void runStripWorkerLoop(2);

    return () => {
      isRunning = false;
    };
  }, [isInitializing, scanBandIndex, scanMode]);

  // Instant Live Coordinate Mapping (Zero Offset Drift, Snap on 1st Frame, Lerp = 0.6, 400ms Expiry)
  useEffect(() => {
    let animId: number;

    const render = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      const videoEl = videoRef.current;

      if (canvas && container && videoEl) {
        const viewW = container.clientWidth || window.innerWidth;
        const viewH = container.clientHeight || window.innerHeight;
        const dpr = window.devicePixelRatio || 1;

        const targetW = Math.round(viewW * dpr);
        const targetH = Math.round(viewH * dpr);

        if (canvas.width !== targetW || canvas.height !== targetH) {
          canvas.width = targetW;
          canvas.height = targetH;
        }

        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, viewW, viewH);

          const videoW = videoEl.videoWidth || scanDimsRef.current.w;
          const videoH = videoEl.videoHeight || scanDimsRef.current.h;

          if (videoW > 0 && videoH > 0 && viewW > 0 && viewH > 0) {
            // Exact object-fit: cover transformation from full video coordinates to screen rect
            const scale = Math.max(viewW / videoW, viewH / videoH);
            const offsetX = (viewW - videoW * scale) / 2;
            const offsetY = (viewH - videoH * scale) / 2;

            const now = performance.now();
            const liveActiveIds = new Set(
              activeChecklistRef.current
                .filter((i) => !completedIdsRef.current.has(i.id))
                .map((i) => i.id)
            );

            // Expire boxes after 400ms so boxes never stick in mid-air when the camera moves
            const activeTracks = trackedBoxesRef.current.filter(
              (tr) =>
                now - tr.lastSeenTimestamp < BOX_TTL_MS &&
                liveActiveIds.has(tr.targetId) &&
                !completedIdsRef.current.has(tr.targetId)
            );
            trackedBoxesRef.current = activeTracks;

            for (let i = 0; i < activeTracks.length; i++) {
              const tr = activeTracks[i];
              let screenX = tr.bbox.x0 * scale + offsetX;
              const screenY = tr.bbox.y0 * scale + offsetY;
              const screenW = (tr.bbox.x1 - tr.bbox.x0) * scale;
              const screenH = (tr.bbox.y1 - tr.bbox.y0) * scale;

              if (isFrontCamera) {
                screenX = viewW - (screenX + screenW);
              }

              // Snap immediately on first detection; lerp = 0.6 on micro-movements
              if (!tr.initialized) {
                tr.renderX = screenX;
                tr.renderY = screenY;
                tr.renderW = screenW;
                tr.renderH = screenH;
                tr.initialized = true;
              } else {
                const moveDist = Math.hypot(screenX - tr.renderX, screenY - tr.renderY);
                if (moveDist >= 55) {
                  tr.renderX = screenX;
                  tr.renderY = screenY;
                  tr.renderW = screenW;
                  tr.renderH = screenH;
                } else {
                  const lerp = 0.6;
                  tr.renderX += (screenX - tr.renderX) * lerp;
                  tr.renderY += (screenY - tr.renderY) * lerp;
                  tr.renderW += (screenW - tr.renderW) * lerp;
                  tr.renderH += (screenH - tr.renderH) * lerp;
                }
              }

              // Clean green pill box geometry
              const padX = 3;
              const padY = 1.5;
              const rx = tr.renderX - padX;
              const ry = tr.renderY - padY;
              const rw = tr.renderW + padX * 2;
              const rh = tr.renderH + padY * 2;
              const pillRadius = Math.min(6, Math.max(3, rh * 0.3));

              ctx.save();
              ctx.globalAlpha = 1;
              ctx.shadowColor = '#22c55e';
              ctx.shadowBlur = 6;

              ctx.fillStyle = 'rgba(34, 197, 94, 0.25)';
              ctx.beginPath();
              ctx.roundRect(rx, ry, rw, rh, pillRadius);
              ctx.fill();

              ctx.strokeStyle = '#22c55e';
              ctx.lineWidth = 2.2;
              ctx.stroke();

              ctx.restore();
            }
          }
        }
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(animId);
    };
  }, [isFrontCamera]);

  // Handle single item "✓" completion
  const handleMarkItemDone = (item: ChecklistItem) => {
    triggerHaptic(60);

    completedIdsRef.current.add(item.id);
    purgeItem(item.id);

    trackedBoxesRef.current = trackedBoxesRef.current.filter(
      (b) => b.targetId !== item.id
    );
    detectedGroupsRef.current = detectedGroupsRef.current.filter(
      (g) => g.item.id !== item.id
    );

    setSuccessToast(t.completedToast(item.text));
    setTimeout(() => {
      setSuccessToast(null);
    }, 1800);

    onCompleteItem(item);
  };

  // Handle "Mark All Found (✓)" batch completion
  const handleMarkAllFound = (groups: DetectedMatchGroup[]) => {
    if (groups.length === 0) return;
    triggerHaptic(80);

    const itemsToComplete = groups.map((g) => g.item);
    const idsToPurge = itemsToComplete.map((i) => i.id);

    for (const id of idsToPurge) {
      completedIdsRef.current.add(id);
    }
    purgeMultipleItems(idsToPurge);

    const purgeSet = new Set(idsToPurge);
    trackedBoxesRef.current = trackedBoxesRef.current.filter(
      (b) => !purgeSet.has(b.targetId)
    );
    detectedGroupsRef.current = [];

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
  };

  const handleExit = () => {
    stopTracks();
    onBack();
  };

  const totalCount = Math.max(initialTotalCount, checklist.length + completedItems.length);
  const remainingCount = checklist.length;
  const activeIdSet = new Set(checklist.map((i) => i.id));
  const detectedGroups = (lastScanResult?.detectedGroups || []).filter(
    (g) => activeIdSet.has(g.item.id) && !completedIdsRef.current.has(g.item.id)
  );
  const isAllCompleted = checklist.length === 0 && totalCount > 0;

  useEffect(() => {
    if (isAllCompleted) {
      stopTracks();
    }
  }, [isAllCompleted, stopTracks]);

  const digitalZoomCss = !hardwareZoomAvailable && zoomLevel > 1 ? `scale(${zoomLevel})` : '';

  return (
    <div
      ref={containerRef}
      onClick={scanMode === 'manual' ? triggerManualLiveScan : undefined}
      className={`fixed inset-0 w-screen h-[100dvh] overflow-hidden bg-black select-none touch-none transition-all duration-300 ${
        manualScanPulse ? 'ring-4 ring-inset ring-[#22c55e]/70' : ''
      }`}
      dir="ltr"
    >
      {/* 100% Continuous Live Video & Transparent Canvas Overlay */}
      <div
        style={{
          transform: digitalZoomCss || undefined,
          transformOrigin: 'center center',
        }}
        className="absolute inset-0 w-full h-full transition-transform duration-200"
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{
            transform: isFrontCamera ? 'scaleX(-1)' : undefined,
            transformOrigin: 'center center',
          }}
          className="absolute inset-0 w-full h-full object-cover"
        />

        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full pointer-events-none z-10"
        />
      </div>

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
            <span>{t.remainingItems}: {remainingCount}</span>
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform ${
                showQueueDropdown ? 'rotate-180' : ''
              }`}
            />
          </button>

          {/* Scan Mode: Auto vs Tap */}
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
                {isTorchOn ? <Zap className="w-4 h-4 fill-current" /> : <ZapOff className="w-4 h-4" />}
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
              <span>{t.activeChecklist} ({checklist.length})</span>
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

      {/* 2. BOTTOM AREA: Compact Horizontal Multi-Match Chips + "Mark All Found (✓)" + 1x/2x/3x Zoom Bar */}
      <div className="absolute bottom-0 inset-x-0 z-30 pb-[max(env(safe-area-inset-bottom,16px),24px)] px-4 pt-4 flex flex-col items-center gap-2.5 pointer-events-auto max-w-md mx-auto">
        {detectedGroups.length > 0 && !showQueueDropdown && (
          <div
            className="w-full bg-white/95 dark:bg-[#0f0f0f]/95 backdrop-blur-md border-2 border-[#22c55e] p-2.5 shadow-2xl flex flex-col gap-2"
            dir={isRtl ? 'rtl' : 'ltr'}
          >
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

            {/* "Mark All Found (✓)" Action Button when multiple items are detected simultaneously */}
            {detectedGroups.length > 1 && (
              <button
                onClick={() => handleMarkAllFound(detectedGroups)}
                className="w-full py-2 px-3 bg-[#248a3d] hover:bg-[#2aa147] active:scale-98 text-white font-extrabold text-xs border border-white/30 transition flex items-center justify-center gap-1.5"
              >
                <CheckCheck className="w-4 h-4 stroke-[2.75]" />
                <span>Mark All Found ({detectedGroups.length}) ✓</span>
              </button>
            )}
          </div>
        )}

        {/* Manual Tap-to-Scan Prompt when in manual mode */}
        {scanMode === 'manual' && detectedGroups.length === 0 && (
          <button
            onClick={triggerManualLiveScan}
            className="px-4 py-2 bg-white/95 dark:bg-[#0f0f0f]/95 border border-[#cbd5e1] dark:border-white/75 text-xs font-bold text-[#0f172a] dark:text-white shadow-lg active:scale-95 transition"
          >
            {t.tapScreenToScan}
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
                  zoomLevel === lvl
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
            <p className="text-xs text-slate-500 dark:text-neutral-400">{t.cameraErrorInstructions}</p>
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
