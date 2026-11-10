import React, { useEffect, useRef } from 'react';
import { CheckCircle2, RotateCcw, Sparkles } from 'lucide-react';
import { ChecklistItem } from '../types';
import { Translation } from '../translations';
import { triggerHaptic } from '../utils/audioAlert';

interface Props {
  completedItems: ChecklistItem[];
  t: Translation;
  isRtl: boolean;
  onRestart: () => void;
}

export const CelebrationOverlay: React.FC<Props> = ({
  completedItems,
  t,
  isRtl,
  onRestart,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    triggerHaptic(100);
    setTimeout(() => triggerHaptic(80), 180);

    // Run simple 60fps lightweight canvas confetti
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    interface Particle {
      x: number;
      y: number;
      w: number;
      h: number;
      color: string;
      vx: number;
      vy: number;
      rotation: number;
      vRot: number;
      opacity: number;
    }

    const colors = ['#10b981', '#06b6d4', '#38bdf8', '#34d399', '#f59e0b', '#ec4899', '#a855f7'];
    const particles: Particle[] = [];

    for (let i = 0; i < 90; i++) {
      particles.push({
        x: canvas.width * 0.5 + (Math.random() - 0.5) * 60,
        y: canvas.height * 0.45 + (Math.random() - 0.5) * 60,
        w: Math.random() * 8 + 6,
        h: Math.random() * 6 + 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        vx: (Math.random() - 0.5) * 14,
        vy: Math.random() * -12 - 4,
        rotation: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 0.2,
        opacity: 1,
      });
    }

    let animId: number;
    const gravity = 0.28;

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      let alive = false;
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += gravity;
        p.rotation += p.vRot;
        if (p.y > canvas.height * 0.6) {
          p.opacity -= 0.015;
        }

        if (p.opacity > 0) {
          alive = true;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rotation);
          ctx.fillStyle = p.color;
          ctx.globalAlpha = Math.max(0, p.opacity);
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          ctx.restore();
        }
      }

      if (alive) {
        animId = requestAnimationFrame(render);
      }
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md animate-fade-in overflow-hidden">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 pointer-events-none z-10 w-full h-full"
      />

      <div
        className="relative z-20 w-full max-w-sm rounded-3xl bg-slate-900/95 border border-emerald-500/40 p-6 text-center text-white shadow-2xl space-y-5"
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        {/* Animated Icon */}
        <div className="relative mx-auto w-20 h-20 rounded-full bg-gradient-to-tr from-emerald-500 to-teal-400 p-1 flex items-center justify-center shadow-lg shadow-emerald-500/40 animate-bounce">
          <div className="w-full h-full rounded-full bg-slate-950 flex items-center justify-center">
            <CheckCircle2 className="w-10 h-10 text-emerald-400 stroke-[2.5]" />
          </div>
          <Sparkles className="absolute -top-1 -right-1 w-6 h-6 text-amber-400 animate-spin" />
        </div>

        {/* Title & Description */}
        <div className="space-y-2">
          <h2 className="text-xl font-extrabold text-white tracking-tight">
            {t.completedAllTitle}
          </h2>
          <p className="text-xs text-slate-300 leading-relaxed px-2">
            {t.completedAllSubtitle}
          </p>
        </div>

        {/* Completed items badges */}
        {completedItems.length > 0 && (
          <div className="p-3 rounded-2xl bg-slate-800/70 border border-slate-700/60 max-h-36 overflow-y-auto space-y-1.5 text-left">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5" dir={isRtl ? 'rtl' : 'ltr'}>
              {t.completedItemsHistory} ({completedItems.length})
            </div>
            <div className="flex flex-wrap gap-1.5" dir={isRtl ? 'rtl' : 'ltr'}>
              {completedItems.map((item) => (
                <span
                  key={item.id}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 text-xs font-medium border border-emerald-500/30 line-through decoration-emerald-500/60"
                >
                  <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                  <span className="truncate max-w-[140px]">{item.text}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Restart Action Button */}
        <button
          onClick={onRestart}
          className="w-full py-4 px-6 rounded-2xl bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 hover:brightness-110 active:scale-95 text-slate-950 font-black text-sm sm:text-base shadow-xl shadow-emerald-950/40 transition-all flex items-center justify-center gap-2.5"
        >
          <RotateCcw className="w-5 h-5 stroke-[2.5]" />
          <span>{t.startNewBatch}</span>
        </button>
      </div>
    </div>
  );
};
