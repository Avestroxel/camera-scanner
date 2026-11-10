import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  ArrowLeft,
  Zap,
  ZapOff,
  Volume2,
  VolumeX,
  RefreshCw,
  Camera,
  AlertTriangle,
  Upload,
  CheckCircle2,
  SlidersHorizontal,
  ListOrdered,
  X,
  Check,
  ChevronDown,
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
  initialImageSrc?: string | null;
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
  initialImageSrc,
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
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [hapticsEnabled, setHapticsEnabled] = useState(true);
  const [activeMatchMode, setActiveMatchMode] = useState<MatchMode>(matchMode);
  const [showSettings, setShowSettings] = useState(false);
  const [showQueueDrawer, setShowQueueDrawer] = useState(false);
  const [snapshot, setSnapshot] = useState<SnapshotData | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  // Still/demo image mode fallback
  const [staticImageSrc, setStaticImageSrc] = useState<string | null>(initialImageSrc || null);
  const staticImageRef = useRef<HTMLImageElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // OCR Hook
  const {
    isInitializing,
    initProgress,
    initStatusText,
    isProcessing,
    lastScanResult,
    scanSource,
  } = useOCRScanner(ocrLanguage);

  // Keep a ref of matched words and detected groups for 60fps canvas drawing
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

  // Clean up media tracks helper
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

  // Initialize Camera Stream
  const initCamera = useCallback(async () => {
    setCameraError(null);
    stopTracks();

    try {
      const constraints: MediaStreamConstraints = {
        audio: false,
        video: {
          facingMode: isFrontCamera ? 'user' : { ideal: 'environment' },
          width: { ideal: 1920, min: 640 },
          height: { ideal: 1080, min: 480 },
        },
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      // Check torch capability on active video track
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        const trackWithCaps = videoTrack as MediaStreamTrack & { getCapabilities?: () => unknown };
        const capabilities = (typeof trackWithCaps.getCapabilities === 'function' ? trackWithCaps.getCapabilities() : {}) as { torch?: boolean };
        setTorchAvailable(Boolean(capabilities?.torch));
      }
    } catch (err) {
      console.warn('Camera error:', err);
      const errorMsg =
        err instanceof Error && err.name === 'NotAllowedError'
          ? t.cameraPermissionDenied
          : 'Unable to start camera stream. You can upload or test with a sample photo.';
      setCameraError(errorMsg);
    }
  }, [isFrontCamera, stopTracks, t.cameraPermissionDenied]);

  // Start camera on mount & change
  useEffect(() => {
    if (!staticImageSrc) {
      initCamera();
    }
    return () => {
      stopTracks();
    };
  }, [initCamera, staticImageSrc, stopTracks]);

  // Toggle Torch/Flashlight
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
        console.warn('Torch toggle failed:', err);
      }
    }
  };

  // Flip Camera
  const flipCamera = () => {
    setIsFrontCamera((prev) => !prev);
    setIsTorchOn(false);
  };

  // Throttled Scanning Loop against all remaining items in active checklist
  useEffect(() => {
    let timer: NodeJS.Timeout;

    const runLoop = async () => {
      const source = staticImageSrc ? staticImageRef.current : videoRef.current;
      const currentItems = activeChecklistRef.current;
      if (source && !isInitializing && currentItems.length > 0) {
        await scanSource(source, currentItems, activeMatchMode, hapticsEnabled, soundEnabled);
      }
      timer = setTimeout(runLoop, 650);
    };

    timer = setTimeout(runLoop, 350);

    return () => {
      clearTimeout(timer);
    };
  }, [
    isInitializing,
    scanSource,
    activeMatchMode,
    hapticsEnabled,
    soundEnabled,
    staticImageSrc,
  ]);

  // 60 FPS Canvas Highlighting Render Loop with precise coordinate mapping
  useEffect(() => {
    let animId: number;

    const render = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      const video = videoRef.current;
      const staticImg = staticImageRef.current;

      if (canvas && container) {
        const sW = container.clientWidth;
        const sH = container.clientHeight;

        if (canvas.width !== sW || canvas.height !== sH) {
          canvas.width = sW;
          canvas.height = sH;
        }

        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, sW, sH);

          let vW = 0;
          let vH = 0;
          if (staticImageSrc && staticImg) {
            vW = staticImg.naturalWidth || staticImg.width;
            vH = staticImg.naturalHeight || staticImg.height;
          } else if (video) {
            vW = video.videoWidth;
            vH = video.videoHeight;
          }

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

              if (isFrontCamera && !staticImageSrc) {
                x0 = sW - (x0 + bW);
              }

              const padX = Math.max(4, bW * 0.1);
              const padY = Math.max(3, bH * 0.15);
              const rx = x0 - padX;
              const ry = y0 - padY;
              const rw = bW + padX * 2;
              const rh = bH + padY * 2;

              const pulse = 0.85 + Math.sin(time * 3.5 + i) * 0.15;

              ctx.save();
              ctx.shadowColor = '#10b981';
              ctx.shadowBlur = 16 * pulse;

              // Translucent green highlight fill
              ctx.fillStyle = `rgba(16, 185, 129, ${0.24 * pulse})`;
              ctx.beginPath();
              ctx.roundRect(rx, ry, rw, rh, 8);
              ctx.fill();

              // Glowing border stroke
              ctx.strokeStyle = `rgba(52, 211, 153, ${0.95 * pulse})`;
              ctx.lineWidth = 2.5;
              ctx.stroke();

              // Corner reticle accents
              const cornerLen = Math.min(10, rw * 0.25);
              ctx.strokeStyle = '#00f2fe';
              ctx.lineWidth = 3.5;
              ctx.beginPath();
              ctx.moveTo(rx, ry + cornerLen);
              ctx.lineTo(rx, ry);
              ctx.lineTo(rx + cornerLen, ry);

              ctx.moveTo(rx + rw - cornerLen, ry);
              ctx.lineTo(rx + rw, ry);
              ctx.lineTo(rx + rw, ry + cornerLen);

              ctx.moveTo(rx, ry + rh - cornerLen);
              ctx.lineTo(rx, ry + rh);
              ctx.lineTo(rx + cornerLen, ry + rh);

              ctx.moveTo(rx + rw - cornerLen, ry + rh);
              ctx.lineTo(rx + rw, ry + rh);
              ctx.lineTo(rx + rw, ry + rh - cornerLen);
              ctx.stroke();

              // Floating pill badge displaying target item text and match confidence
              const displayLabel = m.matchedItemText || m.text;
              const badgeText = `${displayLabel} • ${m.confidence}%`;
              ctx.font = 'bold 11px sans-serif';
              const textMetrics = ctx.measureText(badgeText);
              const pillW = textMetrics.width + 14;
              const pillH = 20;
              const pillX = Math.max(6, Math.min(sW - pillW - 6, rx + (rw - pillW) / 2));
              const pillY = Math.max(6, ry - pillH - 4);

              ctx.shadowBlur = 6;
              ctx.shadowColor = '#06b6d4';
              ctx.fillStyle = 'rgba(9, 13, 22, 0.92)';
              ctx.beginPath();
              ctx.roundRect(pillX, pillY, pillW, pillH, 6);
              ctx.fill();

              ctx.strokeStyle = '#34d399';
              ctx.lineWidth = 1;
              ctx.stroke();

              ctx.fillStyle = '#34d399';
              ctx.fillText(badgeText, pillX + 7, pillY + 14);

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
  }, [isFrontCamera, staticImageSrc]);

  // Handle "تەواو" (Done) button action on a found item
  const handleMarkItemDone = (item: ChecklistItem) => {
    triggerHaptic(60);

    // Show temporary completion toast
    setSuccessToast(t.completedToast(item.text));
    setTimeout(() => {
      setSuccessToast(null);
    }, 2200);

    // Instantly remove matching word overlays from the current frame
    matchesRef.current = matchesRef.current.filter((w) => w.matchedItemId !== item.id);
    detectedGroupsRef.current = detectedGroupsRef.current.filter((g) => g.item.id !== item.id);

    // Call parent to remove from active checklist
    onCompleteItem(item);
  };

  // Capture High-Res Snapshot Compositing Video Frame + Glowing Overlay
  const captureSnapshot = (targetQueryText?: string) => {
    const video = videoRef.current;
    const staticImg = staticImageRef.current;
    const source = staticImageSrc ? staticImg : video;

    if (!source) return;

    let srcW = 0;
    let srcH = 0;
    if (staticImageSrc && staticImg) {
      srcW = staticImg.naturalWidth || staticImg.width;
      srcH = staticImg.naturalHeight || staticImg.height;
    } else if (video) {
      srcW = video.videoWidth;
      srcH = video.videoHeight;
    }

    if (srcW === 0 || srcH === 0) return;

    const snapCanvas = document.createElement('canvas');
    snapCanvas.width = srcW;
    snapCanvas.height = srcH;
    const ctx = snapCanvas.getContext('2d');
    if (!ctx) return;

    if (isFrontCamera && !staticImageSrc) {
      ctx.translate(srcW, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(source, 0, 0, srcW, srcH);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    } else {
      ctx.drawImage(source, 0, 0, srcW, srcH);
    }

    const matches = matchesRef.current;
    for (const m of matches) {
      let x0 = m.bbox.x0;
      const y0 = m.bbox.y0;
      const w = m.bbox.x1 - m.bbox.x0;
      const h = m.bbox.y1 - m.bbox.y0;

      if (isFrontCamera && !staticImageSrc) {
        x0 = srcW - (x0 + w);
      }

      ctx.save();
      ctx.shadowColor = '#10b981';
      ctx.shadowBlur = 18;
      ctx.fillStyle = 'rgba(16, 185, 129, 0.28)';
      ctx.beginPath();
      ctx.roundRect(x0 - 4, y0 - 4, w + 8, h + 8, 8);
      ctx.fill();

      ctx.strokeStyle = '#34d399';
      ctx.lineWidth = 4;
      ctx.stroke();

      const label = m.matchedItemText || m.text;
      const badgeText = `${label} (${m.confidence}%)`;
      ctx.font = 'bold 20px sans-serif';
      const tw = ctx.measureText(badgeText).width;
      ctx.fillStyle = 'rgba(9, 13, 22, 0.92)';
      ctx.beginPath();
      ctx.roundRect(x0, Math.max(10, y0 - 32), tw + 16, 28, 6);
      ctx.fill();

      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 1.5;
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

  // Handle Image Upload Fallback
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          stopTracks();
          setCameraError(null);
          setStaticImageSrc(event.target.result as string);
        }
      };
      reader.readAsDataURL(file);
    }
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
      className="relative w-full h-[100dvh] overflow-hidden bg-black select-none touch-none"
      dir="ltr"
    >
      <input
        type="file"
        ref={fileInputRef}
        accept="image/*"
        className="hidden"
        onChange={handleFileUpload}
      />

      {/* Camera Video Feed */}
      {!staticImageSrc && (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`absolute inset-0 w-full h-full object-cover transition-transform duration-300 ${
            isFrontCamera ? 'scale-x-[-1]' : ''
          }`}
        />
      )}

      {/* Static Image Mode (Fallback or Photo Pick) */}
      {staticImageSrc && (
        <img
          ref={staticImageRef}
          src={staticImageSrc}
          alt="Scanning source"
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}

      {/* Transparent 60fps Canvas Overlay for Glowing Highlights */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none z-10"
      />

      {/* Center Reticle / Active Scanner Laser Animation */}
      <div className="absolute inset-0 pointer-events-none z-10 flex items-center justify-center">
        <div className="relative w-64 h-48 border border-white/20 rounded-2xl pointer-events-none opacity-40">
          <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-cyan-400 rounded-tl-lg" />
          <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-cyan-400 rounded-tr-lg" />
          <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-cyan-400 rounded-bl-lg" />
          <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-cyan-400 rounded-br-lg" />
        </div>
        <div className="absolute w-72 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_8px_#00f2fe] animate-scan-line pointer-events-none" />
      </div>

      {/* TOP FLOATING GLASSMORPHIC BAR */}
      <div className="absolute top-0 inset-x-0 z-30 p-3 pt-[calc(var(--sat)+10px)] flex flex-col gap-2 pointer-events-auto">
        <div className="flex items-center justify-between gap-2 p-2 rounded-2xl glass-panel shadow-2xl">
          {/* Back Button */}
          <button
            onClick={handleExit}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-white font-medium text-xs active:scale-95 transition"
          >
            <ArrowLeft className="w-4 h-4 text-cyan-400" />
            <span className="hidden xs:inline">{t.cameraBack}</span>
          </button>

          {/* Interactive Remaining Queue Pill (Tap to toggle drawer) */}
          <button
            onClick={() => setShowQueueDrawer((prev) => !prev)}
            className="flex-1 min-w-0 max-w-[210px] sm:max-w-xs flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900/90 border border-cyan-500/40 hover:border-cyan-400 text-white transition active:scale-95 shadow-md"
            dir={isRtl ? 'rtl' : 'ltr'}
          >
            <ListOrdered className="w-4 h-4 text-cyan-400 shrink-0" />
            <span className="text-xs font-bold text-white truncate">
              {t.remainingOf(remainingCount, totalCount)}
            </span>
            <ChevronDown
              className={`w-3.5 h-3.5 text-slate-400 transition-transform ${
                showQueueDrawer ? 'rotate-180' : ''
              }`}
            />
          </button>

          {/* Right Action Icons (Torch, Flip, Mute, Settings) */}
          <div className="flex items-center gap-1 shrink-0">
            {torchAvailable && !staticImageSrc && (
              <button
                onClick={toggleTorch}
                aria-label="Toggle Torch"
                className={`p-2 rounded-xl transition ${
                  isTorchOn
                    ? 'bg-amber-400 text-slate-950 shadow-md shadow-amber-400/30'
                    : 'bg-slate-800/80 text-slate-300 hover:text-white'
                }`}
              >
                {isTorchOn ? <Zap className="w-4 h-4 fill-current" /> : <ZapOff className="w-4 h-4" />}
              </button>
            )}

            {!staticImageSrc && (
              <button
                onClick={flipCamera}
                aria-label={t.switchCamera}
                className="p-2 rounded-xl bg-slate-800/80 text-slate-300 hover:text-white transition active:rotate-180 duration-300"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            )}

            <button
              onClick={() => setSoundEnabled((prev) => !prev)}
              aria-label="Toggle Sound"
              className={`p-2 rounded-xl transition ${
                soundEnabled
                  ? 'bg-slate-800/80 text-cyan-400'
                  : 'bg-slate-800/80 text-slate-500'
              }`}
            >
              {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            </button>

            <button
              onClick={() => setShowSettings((prev) => !prev)}
              aria-label="Settings"
              className={`p-2 rounded-xl transition ${
                showSettings ? 'bg-cyan-500 text-slate-950' : 'bg-slate-800/80 text-slate-300'
              }`}
            >
              <SlidersHorizontal className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Success Toast */}
        {successToast && (
          <div className="self-center px-4 py-2 rounded-full bg-emerald-500 text-slate-950 font-bold text-xs shadow-xl shadow-emerald-500/40 animate-bounce flex items-center gap-1.5 z-40">
            <CheckCircle2 className="w-4 h-4" />
            <span>{successToast}</span>
          </div>
        )}

        {/* Collapsible Settings Tray */}
        {showSettings && (
          <div
            className="p-3 rounded-2xl glass-panel border border-cyan-500/20 text-xs text-white space-y-2 animate-fade-in"
            dir={isRtl ? 'rtl' : 'ltr'}
          >
            <div className="flex items-center justify-between">
              <span className="text-slate-300">{t.matchMode}:</span>
              <div className="flex gap-1">
                {(['contains', 'exact', 'fuzzy'] as MatchMode[]).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setActiveMatchMode(mode)}
                    className={`px-2.5 py-1 rounded-lg font-medium transition ${
                      activeMatchMode === mode
                        ? 'bg-cyan-500 text-slate-950 font-bold'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {mode === 'contains'
                      ? t.matchContains
                      : mode === 'exact'
                      ? t.matchExact
                      : t.matchFuzzy}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between pt-1 border-t border-slate-800">
              <span className="text-slate-300">Haptics:</span>
              <button
                onClick={() => setHapticsEnabled((prev) => !prev)}
                className={`px-3 py-1 rounded-lg font-medium transition ${
                  hapticsEnabled
                    ? 'bg-emerald-500 text-slate-950 font-bold'
                    : 'bg-slate-800 text-slate-400'
                }`}
              >
                {hapticsEnabled ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* REMAINING CHECKLIST DRAWER (Toggled by top pill) */}
      {showQueueDrawer && (
        <div
          className="absolute inset-x-0 top-[calc(var(--sat)+62px)] z-30 p-3 max-h-[62vh] overflow-y-auto animate-fade-in pointer-events-auto"
          dir={isRtl ? 'rtl' : 'ltr'}
        >
          <div className="rounded-3xl glass-panel border border-cyan-500/30 p-4 shadow-2xl text-white space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <div className="flex items-center gap-2">
                <ListOrdered className="w-4 h-4 text-cyan-400" />
                <h3 className="text-sm font-bold">{t.openDrawer}</h3>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-400 font-mono">
                  {checklist.length}
                </span>
              </div>
              <button
                onClick={() => setShowQueueDrawer(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* List of remaining items */}
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {checklist.map((item, idx) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-900/80 border border-slate-800 hover:border-slate-700 transition"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-5 h-5 rounded-md bg-slate-800 text-slate-400 font-mono text-[11px] flex items-center justify-center shrink-0">
                      {idx + 1}
                    </span>
                    <span className="text-xs font-semibold text-white truncate">
                      {item.text}
                    </span>
                  </div>
                  <button
                    onClick={() => handleMarkItemDone(item)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500 text-emerald-400 hover:text-slate-950 font-bold text-xs border border-emerald-500/30 transition shrink-0 active:scale-95"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>{t.doneButton}</span>
                  </button>
                </div>
              ))}
            </div>

            {completedItems.length > 0 && (
              <div className="pt-2 border-t border-slate-800 text-xs text-slate-400">
                <span className="font-semibold text-slate-300">
                  {t.completedItemsHistory} ({completedItems.length}):
                </span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {completedItems.map((c) => (
                    <span
                      key={c.id}
                      className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 text-[11px] line-through decoration-emerald-500/60"
                    >
                      {c.text}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* DOCKED MATCH ACTION CARDS (Appears when 1 or more items from checklist are detected) */}
      {detectedGroups.length > 0 && !showQueueDrawer && (
        <div
          className="absolute bottom-24 inset-x-0 z-30 px-3 max-h-48 overflow-y-auto flex flex-col gap-2 pointer-events-auto"
          dir={isRtl ? 'rtl' : 'ltr'}
        >
          <div className="text-[11px] font-bold text-emerald-400 px-1 uppercase tracking-wider flex items-center gap-1.5 shadow-sm">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            <span>{t.detectedOnScreen} ({detectedGroups.length})</span>
          </div>

          {detectedGroups.map((group) => (
            <div
              key={group.item.id}
              className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-slate-900/95 border-2 border-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.35)] backdrop-blur-xl animate-fade-in"
            >
              {/* Matched item text and confidence */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <h4 className="text-sm font-extrabold text-white truncate">
                    {group.item.text}
                  </h4>
                </div>
                <div className="text-[11px] text-emerald-400/90 font-mono mt-0.5">
                  {t.confidence}: {group.primaryWord.confidence}%
                </div>
              </div>

              {/* Action Buttons: Quick Snapshot + Big Green "تەواو" Button */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => captureSnapshot(group.item.text)}
                  title={t.takeSnapshot}
                  className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 active:scale-95 transition"
                >
                  <Camera className="w-4 h-4 text-cyan-400" />
                </button>

                <button
                  onClick={() => handleMarkItemDone(group.item)}
                  className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-400 hover:brightness-110 active:scale-95 text-slate-950 font-black text-sm shadow-lg shadow-emerald-500/40 transition-all flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4 stroke-[3]" />
                  <span>{t.doneButton}</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* BOTTOM CONTROLS & MAIN SHUTTER BUTTON */}
      <div className="absolute bottom-0 inset-x-0 z-20 p-4 pb-[calc(var(--sab)+14px)] flex items-center justify-between gap-4 pointer-events-auto">
        <button
          onClick={() => fileInputRef.current?.click()}
          aria-label={t.uploadTestImage}
          className="w-12 h-12 rounded-2xl glass-panel hover:bg-slate-800 text-slate-300 hover:text-white flex items-center justify-center shadow-lg active:scale-90 transition"
        >
          <Upload className="w-5 h-5 text-cyan-400" />
        </button>

        {/* Central Shutter Button */}
        <div className="relative flex items-center justify-center">
          <button
            onClick={() => captureSnapshot()}
            aria-label={t.takeSnapshot}
            className="group relative w-18 h-18 sm:w-20 sm:h-20 rounded-full p-1 bg-gradient-to-tr from-cyan-500 via-teal-400 to-emerald-400 shadow-[0_0_25px_rgba(6,182,212,0.4)] active:scale-95 transition-all flex items-center justify-center"
          >
            <div className="w-full h-full rounded-full bg-slate-950 flex items-center justify-center border-2 border-white/80 group-hover:border-cyan-300 transition">
              <Camera className="w-7 h-7 text-white group-hover:text-cyan-400 group-hover:scale-110 transition stroke-[2.2]" />
            </div>
            {detectedGroups.length > 0 && (
              <span className="absolute inset-0 rounded-full border-2 border-emerald-400 animate-ping opacity-60 pointer-events-none" />
            )}
          </button>
        </div>

        {/* Right Info: Live / Found Status Pill */}
        <div className="w-12 h-12 flex items-center justify-center text-xs font-mono">
          {detectedGroups.length > 0 ? (
            <span className="px-2 py-1 rounded-lg bg-emerald-500/20 text-emerald-400 font-bold border border-emerald-500/30 animate-pulse">
              {detectedGroups.length}✓
            </span>
          ) : (
            <span className="text-slate-500 font-semibold">
              {isProcessing ? 'SCAN' : 'LIVE'}
            </span>
          )}
        </div>
      </div>

      {/* CAMERA ERROR OVERLAY */}
      {cameraError && !staticImageSrc && (
        <div className="absolute inset-0 z-40 bg-slate-950/95 backdrop-blur-md p-6 flex flex-col items-center justify-center text-center text-white space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/30">
            <AlertTriangle className="w-8 h-8" />
          </div>
          <div className="max-w-xs space-y-2">
            <h3 className="text-lg font-bold text-white">{t.cameraPermissionDenied}</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              {t.cameraErrorInstructions}
            </p>
          </div>
          <div className="flex flex-col gap-2.5 w-full max-w-xs pt-2">
            <button
              onClick={initCamera}
              className="w-full py-3 px-4 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-sm shadow-lg shadow-cyan-500/25 active:scale-95 transition"
            >
              {t.retryCamera}
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-medium text-sm border border-slate-700 flex items-center justify-center gap-2 active:scale-95 transition"
            >
              <Upload className="w-4 h-4 text-cyan-400" />
              <span>{t.useUploadInstead}</span>
            </button>
            <button
              onClick={handleExit}
              className="w-full py-2.5 text-xs text-slate-400 hover:text-white transition"
            >
              {t.cameraBack}
            </button>
          </div>
        </div>
      )}

      {/* INITIALIZING OVERLAY */}
      {isInitializing && (
        <div className="absolute inset-0 z-20 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center text-white space-y-3">
          <div className="w-12 h-12 rounded-xl bg-cyan-500/20 text-cyan-400 flex items-center justify-center border border-cyan-500/40 animate-pulse">
            <ListOrdered className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h4 className="text-sm font-semibold">{initStatusText}</h4>
            <div className="w-48 h-2 bg-slate-800 rounded-full overflow-hidden border border-slate-700">
              <div
                className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-300"
                style={{ width: `${initProgress}%` }}
              />
            </div>
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

      {/* Celebratory Completion Overlay when all items are done */}
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
