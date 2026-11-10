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
  Search,
  CheckCircle2,
  SlidersHorizontal,
} from 'lucide-react';
import { OcrLanguage, MatchMode, MatchedWord, SnapshotData } from '../types';
import { Translation } from '../translations';
import { useOCRScanner } from '../hooks/useOCRScanner';
import { SnapshotModal } from './SnapshotModal';

interface Props {
  searchQuery: string;
  ocrLanguage: OcrLanguage;
  matchMode: MatchMode;
  t: Translation;
  isRtl: boolean;
  initialImageSrc?: string | null;
  onBack: () => void;
  onUpdateQuery: (query: string) => void;
}

export const CameraView: React.FC<Props> = ({
  searchQuery,
  ocrLanguage,
  matchMode,
  t,
  isRtl,
  initialImageSrc,
  onBack,
  onUpdateQuery,
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
  const [snapshot, setSnapshot] = useState<SnapshotData | null>(null);
  const [isEditingQuery, setIsEditingQuery] = useState(false);
  const [queryInput, setQueryInput] = useState(searchQuery);

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

  // Keep a ref of matched words for real-time 60fps canvas animation
  const matchesRef = useRef<MatchedWord[]>([]);
  const frameDimRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });

  useEffect(() => {
    if (lastScanResult) {
      matchesRef.current = lastScanResult.matchedWords;
      frameDimRef.current = {
        width: lastScanResult.frameWidth,
        height: lastScanResult.frameHeight,
      };
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

  // Throttled Scanning Loop (runs every ~650ms)
  useEffect(() => {
    let timer: NodeJS.Timeout;

    const runLoop = async () => {
      const source = staticImageSrc ? staticImageRef.current : videoRef.current;
      if (source && !isInitializing) {
        await scanSource(source, searchQuery, activeMatchMode, hapticsEnabled, soundEnabled);
      }
      timer = setTimeout(runLoop, 650);
    };

    timer = setTimeout(runLoop, 400);

    return () => {
      clearTimeout(timer);
    };
  }, [
    isInitializing,
    scanSource,
    searchQuery,
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

          // Get intrinsic dimensions
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
            // Precise object-fit: cover mapping
            const scale = Math.max(sW / vW, sH / vH);
            const renderW = vW * scale;
            const renderH = vH * scale;
            const offsetX = (sW - renderW) / 2;
            const offsetY = (sH - renderH) / 2;

            const matches = matchesRef.current;
            const time = performance.now() * 0.003;

            // Draw glowing highlight boxes
            for (let i = 0; i < matches.length; i++) {
              const m = matches[i];
              let x0 = m.bbox.x0 * scale + offsetX;
              let y0 = m.bbox.y0 * scale + offsetY;
              let bW = (m.bbox.x1 - m.bbox.x0) * scale;
              const bH = (m.bbox.y1 - m.bbox.y0) * scale;

              // Mirror if front camera is active
              if (isFrontCamera && !staticImageSrc) {
                x0 = sW - (x0 + bW);
              }

              // Add a slight generous padding for modern look
              const padX = Math.max(4, bW * 0.1);
              const padY = Math.max(3, bH * 0.15);
              const rx = x0 - padX;
              const ry = y0 - padY;
              const rw = bW + padX * 2;
              const rh = bH + padY * 2;

              // Animated glow pulsing
              const pulse = 0.85 + Math.sin(time * 3 + i) * 0.15;

              ctx.save();
              ctx.shadowColor = '#10b981';
              ctx.shadowBlur = 14 * pulse;

              // Translucent green/teal highlight fill
              ctx.fillStyle = `rgba(16, 185, 129, ${0.22 * pulse})`;
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
              // Top-left
              ctx.moveTo(rx, ry + cornerLen);
              ctx.lineTo(rx, ry);
              ctx.lineTo(rx + cornerLen, ry);
              // Top-right
              ctx.moveTo(rx + rw - cornerLen, ry);
              ctx.lineTo(rx + rw, ry);
              ctx.lineTo(rx + rw, ry + cornerLen);
              // Bottom-left
              ctx.moveTo(rx, ry + rh - cornerLen);
              ctx.lineTo(rx, ry + rh);
              ctx.lineTo(rx + cornerLen, ry + rh);
              // Bottom-right
              ctx.moveTo(rx + rw - cornerLen, ry + rh);
              ctx.lineTo(rx + rw, ry + rh);
              ctx.lineTo(rx + rw, ry + rh - cornerLen);
              ctx.stroke();

              // Floating pill badge label above the matched word
              const badgeText = `${m.text} (${m.confidence}%)`;
              ctx.font = 'bold 11px sans-serif';
              const textMetrics = ctx.measureText(badgeText);
              const pillW = textMetrics.width + 12;
              const pillH = 18;
              const pillX = Math.max(6, Math.min(sW - pillW - 6, rx + (rw - pillW) / 2));
              const pillY = Math.max(6, ry - pillH - 4);

              ctx.shadowBlur = 6;
              ctx.shadowColor = '#06b6d4';
              ctx.fillStyle = 'rgba(9, 13, 22, 0.9)';
              ctx.beginPath();
              ctx.roundRect(pillX, pillY, pillW, pillH, 6);
              ctx.fill();

              ctx.strokeStyle = '#34d399';
              ctx.lineWidth = 1;
              ctx.stroke();

              ctx.fillStyle = '#34d399';
              ctx.fillText(badgeText, pillX + 6, pillY + 13);

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

  // Capture High-Res Snapshot Compositing Video Frame + Glowing Overlay
  const captureSnapshot = () => {
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

    // Create high-res composite canvas
    const snapCanvas = document.createElement('canvas');
    snapCanvas.width = srcW;
    snapCanvas.height = srcH;
    const ctx = snapCanvas.getContext('2d');
    if (!ctx) return;

    // Draw video frame
    if (isFrontCamera && !staticImageSrc) {
      ctx.translate(srcW, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(source, 0, 0, srcW, srcH);
      ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset
    } else {
      ctx.drawImage(source, 0, 0, srcW, srcH);
    }

    // Overlay matched highlights in native resolution coordinates
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

      // Label badge
      const badgeText = `${m.text} (${m.confidence}%)`;
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
      searchQuery,
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

  // Return cleanly to home view
  const handleExit = () => {
    stopTracks();
    onBack();
  };

  const matchesCount = lastScanResult?.matchedWords?.length || 0;

  return (
    <div
      ref={containerRef}
      className="relative w-full h-[100dvh] overflow-hidden bg-black select-none touch-none"
      dir="ltr" // Viewfinder coordinate container is ltr, controls handle their own dir
    >
      {/* Hidden File Input for Fallback Photo Test */}
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
        {/* Subtle HUD crosshair frame */}
        <div className="relative w-64 h-48 border border-white/20 rounded-2xl pointer-events-none opacity-40">
          <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-cyan-400 rounded-tl-lg" />
          <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-cyan-400 rounded-tr-lg" />
          <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-cyan-400 rounded-bl-lg" />
          <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-cyan-400 rounded-br-lg" />
        </div>
        {/* Animated laser line */}
        <div className="absolute w-72 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_8px_#00f2fe] animate-scan-line pointer-events-none" />
      </div>

      {/* TOP FLOATING GLASSMORPHIC CONTROLS BAR */}
      <div className="absolute top-0 inset-x-0 z-30 p-3 pt-[calc(var(--sat)+12px)] flex flex-col gap-2 pointer-events-auto">
        <div className="flex items-center justify-between gap-2 p-2 rounded-2xl glass-panel shadow-2xl">
          {/* Back Button */}
          <button
            onClick={handleExit}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-white font-medium text-xs active:scale-95 transition"
          >
            <ArrowLeft className="w-4 h-4 text-cyan-400" />
            <span className="hidden xs:inline">{t.cameraBack}</span>
          </button>

          {/* Current Target Badge & Quick Edit */}
          <div className="flex-1 min-w-0 max-w-[200px] sm:max-w-xs text-center">
            {isEditingQuery ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (queryInput.trim()) {
                    onUpdateQuery(queryInput.trim());
                  }
                  setIsEditingQuery(false);
                }}
                className="flex items-center"
              >
                <input
                  type="text"
                  value={queryInput}
                  onChange={(e) => setQueryInput(e.target.value)}
                  autoFocus
                  onBlur={() => setIsEditingQuery(false)}
                  className="w-full px-2.5 py-1 text-xs rounded-lg bg-slate-900 text-white border border-cyan-500 outline-none"
                />
              </form>
            ) : (
              <button
                onClick={() => {
                  setQueryInput(searchQuery);
                  setIsEditingQuery(true);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900/90 border border-slate-700/80 hover:border-cyan-500/50 text-white max-w-full transition group"
              >
                <Search className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                <span className="text-xs font-semibold truncate">
                  "{searchQuery || '...'}"
                </span>
              </button>
            )}
          </div>

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

        {/* Status Pill Indicator */}
        <div className="flex items-center justify-center">
          <div
            className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-medium backdrop-blur-md shadow-lg transition-all ${
              matchesCount > 0
                ? 'bg-emerald-500/90 text-slate-950 font-bold shadow-emerald-500/40 animate-pulse'
                : 'bg-slate-900/80 text-slate-300 border border-slate-700/60'
            }`}
          >
            {isInitializing ? (
              <>
                <div className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                <span>{initStatusText}</span>
              </>
            ) : matchesCount > 0 ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-slate-950" />
                <span>
                  {t.matchFound} ({matchesCount} {t.matchesCount})
                </span>
              </>
            ) : (
              <>
                <div
                  className={`w-2 h-2 rounded-full ${
                    isProcessing ? 'bg-cyan-400 animate-ping' : 'bg-slate-500'
                  }`}
                />
                <span>
                  {isProcessing ? t.scanning : t.noMatches}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Collapsible Quick Settings Tray */}
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

      {/* CAMERA ERROR / PERMISSION FALLBACK OVERLAY */}
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

      {/* INITIALIZING PROGRESS OVERLAY */}
      {isInitializing && (
        <div className="absolute inset-0 z-20 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center text-white space-y-3">
          <div className="w-12 h-12 rounded-xl bg-cyan-500/20 text-cyan-400 flex items-center justify-center border border-cyan-500/40 animate-pulse">
            <Search className="w-6 h-6" />
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

      {/* BOTTOM FLOATING CONTROLS & SHUTTER BUTTON */}
      <div className="absolute bottom-0 inset-x-0 z-30 p-4 pb-[calc(var(--sab)+16px)] flex items-center justify-between gap-4 pointer-events-auto">
        {/* Left: Upload photo replacement button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          aria-label={t.uploadTestImage}
          className="w-12 h-12 rounded-2xl glass-panel hover:bg-slate-800 text-slate-300 hover:text-white flex items-center justify-center shadow-lg active:scale-90 transition"
        >
          <Upload className="w-5 h-5 text-cyan-400" />
        </button>

        {/* Center: Large Floating Camera Shutter Button */}
        <div className="relative flex items-center justify-center">
          <button
            onClick={captureSnapshot}
            aria-label={t.takeSnapshot}
            className="group relative w-18 h-18 sm:w-20 sm:h-20 rounded-full p-1 bg-gradient-to-tr from-cyan-500 via-teal-400 to-emerald-400 shadow-[0_0_25px_rgba(6,182,212,0.4)] active:scale-95 transition-all flex items-center justify-center"
          >
            <div className="w-full h-full rounded-full bg-slate-950 flex items-center justify-center border-2 border-white/80 group-hover:border-cyan-300 transition">
              <Camera className="w-7 h-7 text-white group-hover:text-cyan-400 group-hover:scale-110 transition stroke-[2.2]" />
            </div>
            {/* Shutter pulsing ring when match is locked */}
            {matchesCount > 0 && (
              <span className="absolute inset-0 rounded-full border-2 border-emerald-400 animate-ping opacity-60 pointer-events-none" />
            )}
          </button>
        </div>

        {/* Right: Reset or Switch back to camera if in static mode */}
        {staticImageSrc ? (
          <button
            onClick={() => {
              setStaticImageSrc(null);
              initCamera();
            }}
            className="px-3 py-2 rounded-xl glass-panel text-xs text-cyan-400 font-semibold hover:bg-slate-800 active:scale-90 transition"
          >
            Camera
          </button>
        ) : (
          <div className="w-12 h-12 flex items-center justify-center text-xs text-slate-400">
            {matchesCount > 0 ? (
              <span className="font-mono text-emerald-400 font-bold">
                {matchesCount}✓
              </span>
            ) : (
              <span className="font-mono text-slate-500">LIVE</span>
            )}
          </div>
        )}
      </div>

      {/* Snapshot Preview Modal */}
      {snapshot && (
        <SnapshotModal
          snapshot={snapshot}
          t={t}
          isRtl={isRtl}
          onClose={() => setSnapshot(null)}
        />
      )}
    </div>
  );
};
