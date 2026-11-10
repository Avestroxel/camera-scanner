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
    setTimeout(() => triggerHaptic(80), 160);

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

    for (let i = 0; i < 70; i++) {
      particles.push({
        x: canvas.width * 0.5 + (Math.random() - 0.5) * 50,
        y: canvas.height * 0.45 + (Math.random() - 0.5) * 50,
        w: Math.random() * 7 + 4,
        h: Math.random() * 5 + 3,
        color: colors[Math.floor(Math.random() * colors.length)],
        vx: (Math.random() - 0.5) * 12,
        vy: Math.random() * -10 - 3,
        rotation: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 0.2,
        opacity: 1,
      });
    }

    let animId: number;
    const gravity = 0.26;

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in overflow-hidden">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 pointer-events-none z-10 w-full h-full"
      />

      <div
        className="relative z-20 w-full max-w-xs rounded-2xl ios-glass-card p-5 text-center text-white shadow-2xl space-y-4"
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        <div className="relative mx-auto w-14 h-14 rounded-full bg-gradient-to-tr from-emerald-500 to-teal-400 p-0.5 flex items-center justify-center shadow-lg shadow-emerald-500/30">
          <div className="w-full h-full rounded-full bg-slate-950 flex items-center justify-center">
            <CheckCircle2 className="w-7 h-7 text-emerald-400 stroke-[2.5]" />
          </div>
          <Sparkles className="absolute -top-1 -right-1 w-4 h-4 text-amber-400 animate-spin" />
        </div>

        <div className="space-y-1">
          <h2 className="text-base font-extrabold text-white tracking-tight">
            {t.completedAllTitle}
          </h2>
          <p className="text-[11px] text-slate-300 leading-relaxed">
            {t.completedAllSubtitle}
          </p>
        </div>

        {completedItems.length > 0 && (
          <div className="p-2.5 rounded-xl bg-black/40 border border-white/5 max-h-28 overflow-y-auto space-y-1 text-left">
            <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1" dir={isRtl ? 'rtl' : 'ltr'}>
              {t.completedItemsHistory} ({completedItems.length})
            </div>
            <div className="flex flex-wrap gap-1" dir={isRtl ? 'rtl' : 'ltr'}>
              {completedItems.map((item) => (
                <span
                  key={item.id}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 text-[10px] font-medium border border-emerald-500/25 line-through decoration-emerald-500/60"
                >
                  <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400 shrink-0" />
                  <span className="truncate max-w-[120px]">{item.text}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={onRestart}
          className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-500 hover:brightness-110 active:scale-95 text-slate-950 font-black text-xs shadow-lg shadow-emerald-950/30 transition-all flex items-center justify-center gap-2"
        >
          <RotateCcw className="w-4 h-4 stroke-[2.5]" />
          <span>{t.startNewBatch}</span>
        </button>
      </div>
    </div>
  );
};
