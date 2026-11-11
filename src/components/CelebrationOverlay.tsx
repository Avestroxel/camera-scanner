import React, { useEffect, useRef } from 'react';
import { Check, RotateCcw } from 'lucide-react';
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

    const colors = ['#22c55e', '#248a3d', '#16a34a', '#ffffff', '#e2e8f0'];
    const particles: Particle[] = [];

    for (let i = 0; i < 55; i++) {
      particles.push({
        x: canvas.width * 0.5 + (Math.random() - 0.5) * 50,
        y: canvas.height * 0.45 + (Math.random() - 0.5) * 50,
        w: Math.random() * 7 + 4,
        h: Math.random() * 5 + 3,
        color: colors[Math.floor(Math.random() * colors.length)],
        vx: (Math.random() - 0.5) * 11,
        vy: Math.random() * -9 - 3,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-5 bg-black/85 backdrop-blur-md overflow-hidden">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 pointer-events-none z-10 w-full h-full"
      />

      <div
        className="relative z-20 w-full max-w-xs bg-white dark:bg-[#0f0f0f] border border-[#cbd5e1] dark:border-white/75 p-6 text-center text-[#0f172a] dark:text-white shadow-2xl space-y-5"
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        <div className="mx-auto w-14 h-14 bg-[#248a3d] flex items-center justify-center">
          <Check className="w-8 h-8 text-white stroke-[3]" />
        </div>

        <div className="space-y-1.5">
          <h2 className="text-base font-extrabold tracking-tight">
            {t.completedAllTitle}
          </h2>
          <p className="text-xs text-slate-600 dark:text-neutral-400 leading-relaxed">
            {t.completedAllSubtitle}
          </p>
        </div>

        {completedItems.length > 0 && (
          <div className="p-3 bg-slate-50 dark:bg-[#0a0a0a] border border-[#cbd5e1] dark:border-white/40 max-h-32 overflow-y-auto space-y-1.5 text-left">
            {completedItems.map((item, idx) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-2 text-xs font-bold tabular-nums"
                dir="ltr"
              >
                <span className="truncate">
                  {idx + 1}. {item.text}
                </span>
                <Check className="w-4 h-4 text-[#22c55e] stroke-[3] shrink-0" />
              </div>
            ))}
          </div>
        )}

        <button
          onClick={onRestart}
          className="w-full py-3.5 px-4 bg-[#248a3d] hover:bg-[#2aa147] active:scale-95 text-white font-extrabold text-xs transition-all flex items-center justify-center gap-2"
        >
          <RotateCcw className="w-4 h-4 stroke-[2.5]" />
          <span>{t.cameraBack}</span>
        </button>
      </div>
    </div>
  );
};
