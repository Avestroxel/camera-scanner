import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  ArrowLeft,
  Zap,
  ZapOff,
  CheckCircle2,
  X,
  Check,
  ChevronDown,
  RefreshCw,
} from 'lucide-react';
import { OcrLanguage, MatchMode, MatchedWord, ChecklistItem, DetectedMatchGroup } from '../types';
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
  onRestartBatch: () => void;
}

interface StickyBoxTrack {
  key: string;
  matchedItemId?: string;
  // Coordinates in 580px ocrCanvas space
  bbox: { x0: number; y0: number; x1: number; y1: number };
  // Screen-space smoothed coordinates
  x: number;
  y: number;
  w: number;
  h: number;
  // Screen-space velocity for sticky prediction between ~100ms OCR cycles
  vx: number;
  vy: number;
  targetX: number;
  targetY: number;
  targetW: number;
  targetH: number;
  lastSeenAt: number;
  initialized: boolean;
}

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

  // Zoom control state (Hardware or Digital fallback)
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [hardwareZoomAvailable, setHardwareZoomAvailable] = useState(false);
  const [zoomMinMax, setZoomMinMax] = useState<{ min: number; max: number }>({ min: 1, max: 3 });

  // Auto (~100ms cycle) vs Manual (Tap to scan)
  const [scanMode, setScanMode] = useState<'auto' | 'manual'>('auto');
  const [manualScanPulse, setManualScanPulse] = useState(false);

  // OCR Hook (Tesseract v5 + PSM 11 + Raw 580px canvas + 4.0.0_fast dual-worker scheduler)
  const {
    isInitializing,
    initStatusText,
    workerStatus,
    rawTextPreview,
    isProcessing,
    lastScanResult,
    scanSource,
  } = useOCRScanner(ocrLanguage);

  const stickyTracksRef = useRef<StickyBoxTrack[]>([]);
  const detectedGroupsRef = useRef<DetectedMatchGroup[]>([]);
  const scanDimsRef = useRef<{ w: number; h: number }>({ w: 580, h: 326 });
  const activeChecklistRef = useRef<ChecklistItem[]>(checklist);
  activeChecklistRef.current = checklist;

  // Sync latest OCR matched bounding boxes into stickyTracksRef with anti-flicker grace window
  useEffect(() => {
    if (!lastScanResult) return;

    const now = performance.now();
    detectedGroupsRef.current = lastScanResult.detectedGroups;
    scanDimsRef.current = {
      w: lastScanResult.frameWidth,
      h: lastScanResult.frameHeight,
    };

    const currentTracks = stickyTracksRef.current;
    const incomingWords = lastScanResult.matchedWords;
    const updatedTracks: StickyBoxTrack[] = [];
    const usedPrevIndices = new Set<number>();

    for (let i = 0; i < incomingWords.length; i++) {
      const m = incomingWords[i];
      const mCx = (m.bbox.x0 + m.bbox.x1) * 0.5;
      const mCy = (m.bbox.y0 + m.bbox.y1) * 0.5;

      let bestPrevIdx = -1;
      let bestDist = 130; // max distance in 580px OCR space to associate same word track

      for (let j = 0; j < currentTracks.length; j++) {
        if (usedPrevIndices.has(j)) continue;
        const p = currentTracks[j];
        if (p.matchedItemId !== m.matchedItemId) continue;

        const pCx = (p.bbox.x0 + p.bbox.x1) * 0.5;
        const pCy = (p.bbox.y0 + p.bbox.y1) * 0.5;
        const dist = Math.hypot(mCx - pCx, mCy - pCy);
        if (dist < bestDist) {
          bestDist = dist;
          bestPrevIdx = j;
        }
      }

      if (bestPrevIdx >= 0) {
        usedPrevIndices.add(bestPrevIdx);
        const prev = currentTracks[bestPrevIdx];
        updatedTracks.push({
          ...prev,
          bbox: m.bbox,
          lastSeenAt: now,
        });
      } else {
        updatedTracks.push({
          key: `${m.id}-${now}-${i}`,
          matchedItemId: m.matchedItemId,
          bbox: m.bbox,
          x: 0,
          y: 0,
          w: 0,
          h: 0,
          vx: 0,
          vy: 0,
          targetX: 0,
          targetY: 0,
          targetW: 0,
          targetH: 0,
          lastSeenAt: now,
          initialized: false,
        });
      }
    }

    // Keep recently seen tracks alive during brief single-frame motion blur (240ms hold window)
    for (let j = 0; j < currentTracks.length; j++) {
      if (usedPrevIndices.has(j)) continue;
      const p = currentTracks[j];
      const stillInQueue = activeChecklistRef.current.some((item) => item.id === p.matchedItemId);
      if (stillInQueue && now - p.lastSeenAt < 240) {
        updatedTracks.push(p);
      }
    }

    stickyTracksRef.current = updatedTracks;
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

  // Initialize Camera Stream with 60fps shutter speed to eliminate motion blur while moving
  const initCamera = useCallback(async () => {
    setCameraError(null);
    stopTracks();

    try {
      const constraints: MediaStreamConstraints = {
        audio: false,
        video: {
          facingMode: isFrontCamera ? 'user' : { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 60, min: 30 },
          // @ts-expect-error continuous focus and exposure modes reduce motion blur
          advanced: [{ focusMode: 'continuous' }, { exposureMode: 'continuous' }],
        },
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      // Check capabilities for Torch & Hardware Zoom
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        const trackWithCaps = videoTrack as MediaStreamTrack & { getCapabilities?: () => unknown };
        const capabilities = (typeof trackWithCaps.getCapabilities === 'function' ? trackWithCaps.getCapabilities() : {}) as {
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
      console.warn('Advanced camera constraints failed, trying basic:', err);
      try {
        const fallbackStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: isFrontCamera ? 'user' : { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 60 },
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
    stickyTracksRef.current = [];
  };

  // Apply Hardware / Digital Zoom (1x, 2x, 3x)
  const applyZoom = async (level: number) => {
    setZoomLevel(level);
    stickyTracksRef.current = [];
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

  // Manual scan trigger (called on viewfinder tap in manual mode or via button)
  const triggerManualScan = useCallback(async () => {
    const video = videoRef.current;
    const currentItems = activeChecklistRef.current;
    if (video && !isInitializing && currentItems.length > 0) {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
        setManualScanPulse(true);
        triggerHaptic(40);
        await scanSource(video, currentItems, matchMode, true, true);
        setTimeout(() => setManualScanPulse(false), 500);
      }
    }
  }, [isInitializing, matchMode, scanSource]);

  // Ultra-Fast Raw Frame OCR Loop (~50ms overlapping dual-worker dispatch -> ~100ms effective cycle)
  useEffect(() => {
    if (scanMode !== 'auto' || isInitializing) return;

    const intervalId = setInterval(() => {
      const video = videoRef.current;
      const currentItems = activeChecklistRef.current;

      if (video && currentItems.length > 0) {
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
          void scanSource(video, currentItems, matchMode, true, true);
        }
      }
    }, 50);

    return () => {
      clearInterval(intervalId);
    };
  }, [isInitializing, scanSource, matchMode, scanMode]);

  // Sticky 60fps Green Pill Box Renderer (Velocity-Assisted Coordinate Interpolation)
  useEffect(() => {
    let animId: number;

    const render = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      const video = videoRef.current;

      if (canvas && container && video) {
        const rect = video.getBoundingClientRect();
        const screenW = rect.width || container.clientWidth;
        const screenH = rect.height || container.clientHeight;
        const dpr = window.devicePixelRatio || 1;

        const targetCanvasW = Math.round(screenW * dpr);
        const targetCanvasH = Math.round(screenH * dpr);

        if (canvas.width !== targetCanvasW || canvas.height !== targetCanvasH) {
          canvas.width = targetCanvasW;
          canvas.height = targetCanvasH;
        }

        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, screenW, screenH);

          const srcW = scanDimsRef.current.w;
          const srcH = scanDimsRef.current.h;

          if (srcW > 0 && srcH > 0 && screenW > 0 && screenH > 0) {
            const effectiveZoom = !hardwareZoomAvailable && zoomLevel > 1 ? zoomLevel : 1;
            const scale = Math.max(screenW / srcW, screenH / srcH) * effectiveZoom;
            const offsetX = (screenW - srcW * scale) / 2;
            const offsetY = (screenH - srcH * scale) / 2;

            const now = performance.now();
            // Prune expired tracks (> 280ms without OCR confirmation)
            const activeTracks = stickyTracksRef.current.filter(
              (tr) => now - tr.lastSeenAt < 280
            );
            stickyTracksRef.current = activeTracks;

            for (let i = 0; i < activeTracks.length; i++) {
              const tr = activeTracks[i];
              let tx = tr.bbox.x0 * scale + offsetX;
              const ty = tr.bbox.y0 * scale + offsetY;
              const tw = (tr.bbox.x1 - tr.bbox.x0) * scale;
              const th = (tr.bbox.y1 - tr.bbox.y0) * scale;

              if (isFrontCamera) {
                tx = screenW - (tx + tw);
              }

              if (!tr.initialized) {
                tr.x = tx;
                tr.y = ty;
                tr.w = tw;
                tr.h = th;
                tr.targetX = tx;
                tr.targetY = ty;
                tr.targetW = tw;
                tr.targetH = th;
                tr.initialized = true;
              } else {
                // If target position just updated from OCR, compute instantaneous velocity
                if (tr.targetX !== tx || tr.targetY !== ty) {
                  tr.vx = (tx - tr.targetX) * 0.25;
                  tr.vy = (ty - tr.targetY) * 0.25;
                  tr.targetX = tx;
                  tr.targetY = ty;
                  tr.targetW = tw;
                  tr.targetH = th;
                } else {
                  // Apply damped velocity prediction between OCR frames so box glides with camera motion
                  tr.targetX += tr.vx;
                  tr.targetY += tr.vy;
                  tr.vx *= 0.82;
                  tr.vy *= 0.82;
                }

                // High-speed 60fps sticky spring interpolation
                const lerp = 0.62;
                tr.x += (tr.targetX - tr.x) * lerp;
                tr.y += (tr.targetY - tr.y) * lerp;
                tr.w += (tr.targetW - tr.w) * lerp;
                tr.h += (tr.targetH - tr.h) * lerp;
              }

              // Tight green pill box geometry
              const padX = 4;
              const padY = 2;
              const rx = tr.x - padX;
              const ry = tr.y - padY;
              const rw = tr.w + padX * 2;
              const rh = tr.h + padY * 2;
              const pillRadius = Math.min(8, Math.max(4, rh * 0.32));

              // Smooth fade-out if track is at the end of its hold window
              const ageMs = now - tr.lastSeenAt;
              const fadeAlpha = ageMs > 180 ? Math.max(0, 1 - (ageMs - 180) / 100) : 1;

              ctx.save();
              ctx.globalAlpha = fadeAlpha;
              ctx.shadowColor = '#22c55e';
              ctx.shadowBlur = 8;

              // Tight translucent green pill fill
              ctx.fillStyle = 'rgba(34, 197, 94, 0.24)';
              ctx.beginPath();
              ctx.roundRect(rx, ry, rw, rh, pillRadius);
              ctx.fill();

              // Crisp bright green pill stroke
              ctx.strokeStyle = '#22c55e';
              ctx.lineWidth = 2.4;
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
  }, [isFrontCamera, hardwareZoomAvailable, zoomLevel]);

  // Handle "تەواو" (Done) button action on a found item
  const handleMarkItemDone = (item: ChecklistItem) => {
    triggerHaptic(60);

    setSuccessToast(t.completedToast(item.text));
    setTimeout(() => {
      setSuccessToast(null);
    }, 1800);

    stickyTracksRef.current = stickyTracksRef.current.filter(
      (b) => b.matchedItemId !== item.id
    );
    detectedGroupsRef.current = detectedGroupsRef.current.filter((g) => g.item.id !== item.id);

    onCompleteItem(item);
  };

  const handleExit = () => {
    stopTracks();
    onBack();
  };

  const totalCount = Math.max(initialTotalCount, checklist.length + completedItems.length);
  const remainingCount = checklist.length;
  const detectedGroups = lastScanResult?.detectedGroups || [];
  const isAllCompleted = checklist.length === 0 && totalCount > 0;

  // If all items completed, stop camera tracks immediately
  useEffect(() => {
    if (isAllCompleted) {
      stopTracks();
    }
  }, [isAllCompleted, stopTracks]);

  return (
    <div
      ref={containerRef}
      onClick={scanMode === 'manual' ? triggerManualScan : undefined}
      className={`fixed inset-0 w-screen h-[100dvh] overflow-hidden bg-black select-none touch-none transition-all duration-300 ${
        manualScanPulse ? 'ring-4 ring-inset ring-[#22c55e]/70' : ''
      }`}
      dir="ltr"
    >
      {/* Full-Screen Edge-to-Edge Camera View with digital zoom transform fallback */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{
          transform: `${isFrontCamera ? 'scaleX(-1)' : ''} ${!hardwareZoomAvailable && zoomLevel > 1 ? `scale(${zoomLevel})` : ''}`,
          transformOrigin: 'center center',
        }}
        className="absolute inset-0 w-full h-full object-cover transition-transform duration-200"
      />

      {/* Transparent 60fps Full-Screen Canvas Overlay */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none z-10"
      />

      {/* 1. TOP MINIMALIST GEOMETRIC BAR (Pushed comfortably down to top-20, clear of Dynamic Island) */}
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

        {/* Live OCR Debug / Raw Detected Text Preview Bar */}
        <div
          className="w-full px-3 py-1.5 bg-white/90 dark:bg-[#0f0f0f]/90 backdrop-blur-md border border-[#cbd5e1] dark:border-white/50 text-[11px] text-[#0f172a] dark:text-neutral-200 flex items-center justify-between gap-2"
          dir={isRtl ? 'rtl' : 'ltr'}
        >
          <span className="font-mono truncate w-full">
            {rawTextPreview ? `${t.cameraSees}: "${rawTextPreview}"` : initStatusText}
          </span>
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

      {/* 2. BOTTOM AREA: Match Cards + 1x/2x/3x Distance Zoom Bar */}
      <div className="absolute bottom-0 inset-x-0 z-30 pb-[max(env(safe-area-inset-bottom,16px),24px)] px-4 pt-4 flex flex-col items-center gap-3 pointer-events-auto max-w-md mx-auto">
        {/* MATCHED ITEM POPUP BOX (Appears immediately whenever item detected) */}
        {detectedGroups.length > 0 && !showQueueDropdown && (
          <div
            className="w-full flex flex-col gap-2"
            dir={isRtl ? 'rtl' : 'ltr'}
          >
            {detectedGroups.map((group) => (
              <div
                key={group.item.id}
                className="flex items-center justify-between gap-3 px-4 py-3 bg-white/95 dark:bg-[#0f0f0f]/95 backdrop-blur-md border-2 border-[#22c55e] shadow-2xl"
              >
                <div className="min-w-0 flex-1 flex items-center gap-2.5">
                  <Check className="w-5 h-5 text-[#22c55e] stroke-[3] shrink-0" />
                  <div className="min-w-0">
                    <h4 className="text-sm font-extrabold text-[#0f172a] dark:text-white truncate">
                      {group.item.text}
                    </h4>
                    <span className="text-[10px] text-[#22c55e] font-mono tabular-nums">
                      {group.primaryWord.confidence}%
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => handleMarkItemDone(group.item)}
                  className="px-4 py-2 bg-[#248a3d] hover:bg-[#2aa147] active:scale-95 text-white font-bold text-xs sm:text-sm transition-all flex items-center gap-1.5 shrink-0"
                >
                  <Check className="w-4 h-4 stroke-[3]" />
                  <span>{t.doneButton}</span>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Manual Tap-to-Scan Prompt when in manual mode */}
        {scanMode === 'manual' && detectedGroups.length === 0 && (
          <button
            onClick={triggerManualScan}
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
