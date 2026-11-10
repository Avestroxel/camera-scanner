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
import { OcrLanguage, MatchMode, MatchedWord, SnapshotData, ChecklistItem, DetectedMatchGroup } from '../types';
import { Translation } from '../translations';
import { useOCRScanner } from '../hooks/useOCRScanner';
import { SnapshotModal } from './SnapshotModal';
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
  const [snapshot, setSnapshot] = useState<SnapshotData | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  // OCR Hook (Tesseract v5 compatible)
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

  const stopTracks = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // Ignore track stop error
        }
      });
      streamRef.current = null;
    }
  }, []);

  const initCamera = useCallback(async () => {
    setCameraError(null);
    stopTracks();

    try {
      const constraints: MediaStreamConstraints = {
        audio: false,
        video: {
          facingMode: isFrontCamera ? 'user' : { ideal: 'environment' },
          width: { ideal: 1280, min: 640 },
          height: { ideal: 720, min: 480 },
          // @ts-expect-error focusMode is supported on mobile Chromium
          advanced: [{ focusMode: 'continuous' }],
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
        const capabilities = (typeof trackWithCaps.getCapabilities === 'function' ? trackWithCaps.getCapabilities() : {}) as { torch?: boolean };
        setTorchAvailable(Boolean(capabilities?.torch));
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

  const flipCamera = () => {
    setIsFrontCamera((prev) => !prev);
    setIsTorchOn(false);
  };

  // Throttled OCR scanning across the entire camera frame
  useEffect(() => {
    let timer: NodeJS.Timeout;

    const runLoop = async () => {
      const video = videoRef.current;
      const currentItems = activeChecklistRef.current;

      if (video && !isInitializing && currentItems.length > 0) {
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
          await scanSource(video, currentItems, matchMode, true, true);
        }
      }
      timer = setTimeout(runLoop, 650);
    };

    timer = setTimeout(runLoop, 350);

    return () => {
      clearTimeout(timer);
    };
  }, [isInitializing, scanSource, matchMode]);

  // 60 FPS Canvas Highlighting Loop mapping intrinsic video to full-screen cover
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

  const handleMarkItemDone = (item: ChecklistItem) => {
    triggerHaptic(60);

    setSuccessToast(t.completedToast(item.text));
    setTimeout(() => {
      setSuccessToast(null);
    }, 2000);

    matchesRef.current = matchesRef.current.filter((w) => w.matchedItemId !== item.id);
    detectedGroupsRef.current = detectedGroupsRef.current.filter((g) => g.item.id !== item.id);

    onCompleteItem(item);
  };

  const captureSnapshot = (targetQueryText?: string) => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;

    const srcW = video.videoWidth;
    const srcH = video.videoHeight;

    const snapCanvas = document.createElement('canvas');
    snapCanvas.width = srcW;
    snapCanvas.height = srcH;
    const ctx = snapCanvas.getContext('2d');
    if (!ctx) return;

    if (isFrontCamera) {
      ctx.translate(srcW, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, srcW, srcH);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    } else {
      ctx.drawImage(video, 0, 0, srcW, srcH);
    }

    const matches = matchesRef.current;
    for (const m of matches) {
      let x0 = m.bbox.x0;
      const y0 = m.bbox.y0;
      const w = m.bbox.x1 - m.bbox.x0;
      const h = m.bbox.y1 - m.bbox.y0;

      if (isFrontCamera) {
        x0 = srcW - (x0 + w);
      }

      ctx.save();
      ctx.shadowColor = '#10b981';
      ctx.shadowBlur = 16;
      ctx.fillStyle = 'rgba(16, 185, 129, 0.25)';
      ctx.beginPath();
      ctx.roundRect(x0 - 4, y0 - 4, w + 8, h + 8, 8);
      ctx.fill();

      ctx.strokeStyle = '#34d399';
      ctx.lineWidth = 3.5;
      ctx.stroke();

      const label = m.matchedItemText || m.text;
      const badgeText = `${label} (${m.confidence}%)`;
      ctx.font = 'bold 20px sans-serif';
      const tw = ctx.measureText(badgeText).width;
      ctx.fillStyle = 'rgba(10, 12, 18, 0.92)';
      ctx.beginPath();
      ctx.roundRect(x0, Math.max(10, y0 - 32), tw + 16, 28, 6);
      ctx.fill();

      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      ctx.fillStyle = '#34d399';
      ctx.fillText(badgeText, x0 + 8, Math.max(30, y0 - 11));
      ctx.restore();
    }

    const dataUrl = snapCanvas.toDataURL('image/png');
    const matchedStrings = matches.map((m) => m.text);

    setSnapshot({
      imageUrl: dataUrl,
      timestamp: Date.now(),
      searchQuery: targetQueryText || checklist.map((i) => i.text).join(', '),
      matchesCount: matches.length,
      matchedWords: matchedStrings,
      fullOcrText: lastScanResult?.fullText || '',
    });
  };

  const handleExit = () => {
    stopTracks();
    onBack();
  };

  const totalCount = Math.max(initialTotalCount, checklist.length + completedItems.length);
  const remainingCount = checklist.length;
  const detectedGroups = lastScanResult?.detectedGroups || [];
  const isAllCompleted = checklist.length === 0 && totalCount > 0;

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 w-screen h-[100dvh] overflow-hidden bg-black select-none touch-none"
      dir="ltr"
    >
      {/* Full-Screen Camera View */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={`fixed inset-0 w-full h-full object-cover transition-transform duration-300 ${
          isFrontCamera ? 'scale-x-[-1]' : ''
        }`}
      />

      {/* Transparent 60fps Full-Screen Canvas Overlay */}
      <canvas
        ref={canvasRef}
        className="fixed inset-0 w-full h-full pointer-events-none z-10"
      />

      {/* TOP FLOATING PILL BAR (iOS Camera Style) */}
      <div className="absolute top-0 inset-x-0 z-30 p-2.5 pt-safe flex flex-col items-center gap-1.5 pointer-events-auto">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full ios-glass shadow-lg">
          {/* Back Button */}
          <button
            onClick={handleExit}
            className="p-1 rounded-full text-slate-300 hover:text-white active:scale-95 transition"
            aria-label="Back"
          >
            <ArrowLeft className="w-4 h-4 text-cyan-400" />
          </button>

          {/* Remaining Items Pill & Dropdown Toggle */}
          <button
            onClick={() => setShowQueueDropdown((prev) => !prev)}
            className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/10 hover:bg-white/15 text-white text-xs font-semibold active:scale-95 transition"
            dir={isRtl ? 'rtl' : 'ltr'}
          >
            <span>{t.remainingItems}: {remainingCount}</span>
            <ChevronDown
              className={`w-3 h-3 text-slate-400 transition-transform ${
                showQueueDropdown ? 'rotate-180' : ''
              }`}
            />
          </button>

          {/* Torch Button (if supported) */}
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

      {/* BOTTOM FLOATING CONTROLS */}
      <div className="absolute bottom-0 inset-x-0 z-30 pb-safe p-4 flex flex-col items-center gap-3 pointer-events-auto">
        {/* MATCHED ITEM POPUP CARD (Right above shutter button) */}
        {detectedGroups.length > 0 && !showQueueDropdown && (
          <div
            className="w-full max-w-xs flex flex-col gap-1.5 animate-fade-in"
            dir={isRtl ? 'rtl' : 'ltr'}
          >
            {detectedGroups.map((group) => (
              <div
                key={group.item.id}
                className="flex items-center justify-between gap-2.5 p-2.5 rounded-2xl ios-glass-card border border-emerald-500/50 shadow-[0_0_20px_rgba(16,185,129,0.3)] backdrop-blur-xl"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <h4 className="text-xs font-bold text-white truncate">
                      {group.item.text}
                    </h4>
                  </div>
                  <span className="text-[10px] text-emerald-400/90 font-mono">
                    {group.primaryWord.confidence}%
                  </span>
                </div>

                <button
                  onClick={() => handleMarkItemDone(group.item)}
                  className="px-3.5 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 hover:brightness-110 active:scale-95 text-slate-950 font-black text-xs shadow-md shadow-emerald-500/30 transition-all flex items-center gap-1"
                >
                  <Check className="w-3.5 h-3.5 stroke-[3]" />
                  <span>{t.doneButton}</span>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Minimalist Apple/iOS Circular Shutter Button */}
        <div className="relative flex items-center justify-center">
          <button
            onClick={() => captureSnapshot()}
            aria-label="Capture"
            className="w-16 h-16 rounded-full border-4 border-white/80 p-1 flex items-center justify-center active:scale-90 transition-transform shadow-lg shadow-black/50"
          >
            <div className="w-full h-full rounded-full bg-white active:bg-slate-200 transition" />
          </button>
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

      {/* Snapshot Preview Modal */}
      {snapshot && (
        <SnapshotModal
          snapshot={snapshot}
          t={t}
          isRtl={isRtl}
          onClose={() => setSnapshot(null)}
        />
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
