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

  // Thermal optimization: Auto (cool 900ms throttled) vs Manual (0% idle CPU tap-to-scan)
  const [scanMode, setScanMode] = useState<'auto' | 'manual'>('auto');
  const [manualScanPulse, setManualScanPulse] = useState(false);

  // OCR Hook (Tesseract v5 + PSM 11)
  const {
    isInitializing,
    initStatusText,
    workerStatus,
    rawTextPreview,
    isProcessing,
    lastScanResult,
    scanSource,
  } = useOCRScanner(ocrLanguage);

  const matchesRef = useRef<MatchedWord[]>([]);
  const detectedGroupsRef = useRef<DetectedMatchGroup[]>([]);
  const activeChecklistRef = useRef<ChecklistItem[]>(checklist);
  activeChecklistRef.current = checklist;

  useEffect(() => {
    if (lastScanResult) {
      matchesRef.current = lastScanResult.matchedWords;
      detectedGroupsRef.current = lastScanResult.detectedGroups;
    }
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

  // Initialize Camera Stream strictly with { video: ..., audio: false }
  const initCamera = useCallback(async () => {
    setCameraError(null);
    stopTracks();

    try {
      const constraints: MediaStreamConstraints = {
        audio: false, // Strictly no audio recording
        video: {
          facingMode: isFrontCamera ? 'user' : { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 24, max: 30 },
          // @ts-expect-error continuous focus mode
          advanced: [{ focusMode: 'continuous' }],
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
            frameRate: { ideal: 24, max: 30 },
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
  };

  // Apply Hardware / Digital Zoom (1x, 2x, 3x)
  const applyZoom = async (level: number) => {
    setZoomLevel(level);
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

  // Throttled OCR scanning loop (Cool CPU Mode: 900ms between completed frames in auto mode)
  useEffect(() => {
    let timer: NodeJS.Timeout;
    let isCancelled = false;

    const runLoop = async () => {
      if (isCancelled || scanMode !== 'auto') return;
      const video = videoRef.current;
      const currentItems = activeChecklistRef.current;

      if (video && !isInitializing && currentItems.length > 0) {
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
          await scanSource(video, currentItems, matchMode, true, true);
        }
      }

      if (!isCancelled && scanMode === 'auto') {
        // 900ms cool interval stops mobile CPU thermal throttling
        timer = setTimeout(runLoop, 900);
      }
    };

    if (scanMode === 'auto') {
      timer = setTimeout(runLoop, 400);
    }

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [isInitializing, scanSource, matchMode, scanMode]);

  // 60 FPS Canvas Highlighting Loop with support for Digital / Hardware Zoom mapping
  useEffect(() => {
    let animId: number;

    const render = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      const video = videoRef.current;

      if (canvas && container && video) {
        const sW = container.clientWidth;
        const sH = container.clientHeight;

        if (canvas.width !== sW || canvas.height !== sH) {
          canvas.width = sW;
          canvas.height = sH;
        }

        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, sW, sH);

          const vW = video.videoWidth;
          const vH = video.videoHeight;

          if (vW > 0 && vH > 0) {
            const scale = Math.max(sW / vW, sH / vH);
            const renderW = vW * scale;
            const renderH = vH * scale;
            const offsetX = (sW - renderW) / 2;
            const offsetY = (sH - renderH) / 2;

            const matches = matchesRef.current;
            const time = performance.now() * 0.003;

            for (let i = 0; i < matches.length; i++) {
              const m = matches[i];
              let x0 = m.bbox.x0 * scale + offsetX;
              const y0 = m.bbox.y0 * scale + offsetY;
              const bW = (m.bbox.x1 - m.bbox.x0) * scale;
              const bH = (m.bbox.y1 - m.bbox.y0) * scale;

              if (isFrontCamera) {
                x0 = sW - (x0 + bW);
              }

              const padX = Math.max(3, bW * 0.08);
              const padY = Math.max(3, bH * 0.12);
              const rx = x0 - padX;
              const ry = y0 - padY;
              const rw = bW + padX * 2;
              const rh = bH + padY * 2;

              const pulse = 0.88 + Math.sin(time * 3.5 + i) * 0.12;

              ctx.save();
              ctx.shadowColor = '#10b981';
              ctx.shadowBlur = 12 * pulse;

              // Translucent green highlight fill
              ctx.fillStyle = `rgba(16, 185, 129, ${0.2 * pulse})`;
              ctx.beginPath();
              ctx.roundRect(rx, ry, rw, rh, 6);
              ctx.fill();

              // Glowing border stroke
              ctx.strokeStyle = `rgba(52, 211, 153, ${0.9 * pulse})`;
              ctx.lineWidth = 2;
              ctx.stroke();

              // Floating pill badge displaying target item text and match confidence
              const displayLabel = m.matchedItemText || m.text;
              const badgeText = `${displayLabel} • ${m.confidence}%`;
              ctx.font = 'bold 10px sans-serif';
              const textMetrics = ctx.measureText(badgeText);
              const pillW = textMetrics.width + 12;
              const pillH = 17;
              const pillX = Math.max(4, Math.min(sW - pillW - 4, rx + (rw - pillW) / 2));
              const pillY = Math.max(4, ry - pillH - 3);

              ctx.shadowBlur = 4;
              ctx.shadowColor = '#06b6d4';
              ctx.fillStyle = 'rgba(10, 12, 18, 0.88)';
              ctx.beginPath();
              ctx.roundRect(pillX, pillY, pillW, pillH, 5);
              ctx.fill();

              ctx.strokeStyle = '#34d399';
              ctx.lineWidth = 0.8;
              ctx.stroke();

              ctx.fillStyle = '#34d399';
              ctx.fillText(badgeText, pillX + 6, pillY + 12);

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

  // Handle "تەواو" (Done) button action on a found item
  const handleMarkItemDone = (item: ChecklistItem) => {
    triggerHaptic(60);

    setSuccessToast(t.completedToast(item.text));
    setTimeout(() => {
      setSuccessToast(null);
    }, 1800);

    matchesRef.current = matchesRef.current.filter((w) => w.matchedItemId !== item.id);
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
        manualScanPulse ? 'ring-4 ring-inset ring-amber-400/60' : ''
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
        className="fixed inset-0 w-full h-full object-cover transition-transform duration-200"
      />

      {/* Transparent 60fps Full-Screen Canvas Overlay */}
      <canvas
        ref={canvasRef}
        className="fixed inset-0 w-full h-full pointer-events-none z-10"
      />

      {/* 1. TOP FLOATING PILL BAR (Pushed comfortably down to top-20, clear of Dynamic Island) */}
      <div className="absolute top-20 inset-x-0 z-30 px-3 flex flex-col items-center gap-1.5 pointer-events-auto">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full ios-glass shadow-lg">
          {/* Back Button */}
          <button
            onClick={handleExit}
            className="p-1 rounded-full text-slate-300 hover:text-white active:scale-95 transition"
            aria-label="Back"
          >
            <ArrowLeft className="w-4 h-4 text-cyan-400" />
          </button>

          {/* Remaining Items Pill */}
          <button
            onClick={() => setShowQueueDropdown((prev) => !prev)}
            className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/10 hover:bg-white/15 text-white text-xs font-semibold active:scale-95 transition"
            dir={isRtl ? 'rtl' : 'ltr'}
          >
            <span>{t.remainingItems}: {remainingCount}</span>
            <ChevronDown
              className={`w-3 h-3 text-slate-400 transition-transform ${
                showQueueDropdown ? 'rotate-180' : ''
              }`}
            />
          </button>

          {/* Thermal Optimization Mode: Auto (Cool 900ms) vs Tap (0% idle CPU) */}
          <div className="flex items-center rounded-full bg-black/40 p-0.5 text-[10px] font-semibold border border-white/10">
            <button
              onClick={() => setScanMode('auto')}
              className={`px-2 py-0.5 rounded-full transition active:scale-95 ${
                scanMode === 'auto'
                  ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {t.autoScan}
            </button>
            <button
              onClick={() => setScanMode('manual')}
              className={`px-2 py-0.5 rounded-full transition active:scale-95 ${
                scanMode === 'manual'
                  ? 'bg-amber-400 text-slate-950 font-bold shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {t.tapToScan}
            </button>
          </div>

          {/* Torch Button */}
          {torchAvailable && (
            <button
              onClick={toggleTorch}
              className={`p-1 rounded-full transition ${
                isTorchOn ? 'text-amber-400' : 'text-slate-400 hover:text-white'
              }`}
              aria-label="Torch"
            >
              {isTorchOn ? <Zap className="w-3.5 h-3.5 fill-current" /> : <ZapOff className="w-3.5 h-3.5" />}
            </button>
          )}

          {/* Flip Camera */}
          <button
            onClick={flipCamera}
            className="p-1 rounded-full text-slate-400 hover:text-white transition active:rotate-180 duration-300"
            aria-label="Flip"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Minimal Live OCR Status / Preview Bar */}
        <div
          className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full ios-glass-pill text-[10px] text-slate-300 shadow-sm"
          dir={isRtl ? 'rtl' : 'ltr'}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              workerStatus === 'ready'
                ? isProcessing
                  ? 'bg-cyan-400 animate-ping'
                  : 'bg-emerald-400'
                : 'bg-amber-400'
            }`}
          />
          <span className="font-mono text-cyan-300 truncate max-w-[200px]">
            {rawTextPreview ? `"${rawTextPreview}"` : initStatusText}
          </span>
        </div>

        {/* Success Toast */}
        {successToast && (
          <div className="px-3.5 py-1.5 rounded-full bg-emerald-500 text-slate-950 font-bold text-xs shadow-lg animate-bounce flex items-center gap-1.5 z-40 mt-1">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>{successToast}</span>
          </div>
        )}

        {/* Dropdown for Remaining Items */}
        {showQueueDropdown && (
          <div
            className="w-full max-w-xs rounded-2xl ios-glass-card p-3 shadow-2xl space-y-2 mt-1 animate-fade-in text-xs text-white"
            dir={isRtl ? 'rtl' : 'ltr'}
          >
            <div className="flex items-center justify-between pb-1.5 border-b border-white/10 text-[11px] font-semibold text-slate-300">
              <span>{t.activeChecklist} ({checklist.length})</span>
              <button
                onClick={() => setShowQueueDropdown(false)}
                className="p-0.5 text-slate-400 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
              {checklist.map((item, idx) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-2 p-1.5 rounded-lg bg-black/40 border border-white/5"
                >
                  <span className="truncate text-[11px] font-medium text-slate-200">
                    {idx + 1}. {item.text}
                  </span>
                  <button
                    onClick={() => handleMarkItemDone(item)}
                    className="px-2 py-0.5 rounded bg-emerald-500/20 hover:bg-emerald-500 text-emerald-300 hover:text-slate-950 text-[10px] font-bold border border-emerald-500/30 transition active:scale-95"
                  >
                    {t.doneButton}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 2. BOTTOM AREA: Match Cards + 1x/2x/3x Distance Zoom Pill (No shutter button) */}
      <div className="absolute bottom-0 inset-x-0 z-30 pb-[max(env(safe-area-inset-bottom,16px),20px)] p-4 flex flex-col items-center gap-2.5 pointer-events-auto">
        {/* MATCHED ITEM POPUP CARD (Appears immediately whenever item detected) */}
        {detectedGroups.length > 0 && !showQueueDropdown && (
          <div
            className="w-full max-w-xs flex flex-col gap-1.5 animate-fade-in"
            dir={isRtl ? 'rtl' : 'ltr'}
          >
            {detectedGroups.map((group) => (
              <div
                key={group.item.id}
                className="flex items-center justify-between gap-2.5 p-3 rounded-2xl ios-glass-card border-2 border-emerald-500 shadow-[0_0_25px_rgba(16,185,129,0.45)] backdrop-blur-xl"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <h4 className="text-sm font-extrabold text-white truncate">
                      {group.item.text}
                    </h4>
                  </div>
                  <span className="text-[10px] text-emerald-400/90 font-mono">
                    {group.primaryWord.confidence}%
                  </span>
                </div>

                <button
                  onClick={() => handleMarkItemDone(group.item)}
                  className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 hover:brightness-110 active:scale-95 text-slate-950 font-black text-xs sm:text-sm shadow-lg shadow-emerald-500/30 transition-all flex items-center gap-1.5 shrink-0"
                >
                  <Check className="w-4 h-4 stroke-[3]" />
                  <span>{t.doneButton}</span>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Manual Tap-to-Scan Floating Prompt when in manual mode */}
        {scanMode === 'manual' && detectedGroups.length === 0 && (
          <button
            onClick={triggerManualScan}
            className={`px-3.5 py-1.5 rounded-full ios-glass text-xs font-semibold text-amber-300 border border-amber-400/30 flex items-center gap-1.5 shadow-lg active:scale-95 transition ${
              manualScanPulse ? 'bg-amber-400/20' : ''
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
            <span>{t.tapScreenToScan}</span>
          </button>
        )}

        {/* Distance Zoom Toggle Pill (1x | 2x | 3x) */}
        <div className="inline-flex items-center rounded-full ios-glass p-0.5 text-xs font-semibold shadow-md">
          {[1, 2, 3].map((lvl) => (
            <button
              key={lvl}
              onClick={() => applyZoom(lvl)}
              className={`px-3 py-1 rounded-full transition active:scale-95 ${
                zoomLevel === lvl
                  ? 'bg-white text-slate-950 font-bold shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              {lvl}x
            </button>
          ))}
        </div>
      </div>

      {/* CAMERA ERROR OVERLAY */}
      {cameraError && (
        <div className="fixed inset-0 z-40 bg-black/90 backdrop-blur-md p-6 flex flex-col items-center justify-center text-center text-white space-y-3">
          <h3 className="text-sm font-bold text-white">{t.cameraPermissionDenied}</h3>
          <p className="text-xs text-slate-400 max-w-xs">{t.cameraErrorInstructions}</p>
          <div className="flex flex-col gap-2 w-full max-w-xs pt-2">
            <button
              onClick={initCamera}
              className="py-2.5 px-4 rounded-xl bg-cyan-500 text-slate-950 font-bold text-xs"
            >
              {t.retryCamera}
            </button>
            <button
              onClick={handleExit}
              className="py-2 text-xs text-slate-400 hover:text-white"
            >
              {t.cameraBack}
            </button>
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
