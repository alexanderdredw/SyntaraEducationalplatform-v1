'use client';

import { useEffect, useRef } from 'react';
import { usePreferences } from '../../preferences/preferences-provider';

const COUNT = 60;
const DISTANCE = 150;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
}

/**
 * Сеть частиц Главной (js/effects/Particles.js атласа): 60 точек, линии до 150 px, прозрачность холста 0,4 — как в
 * оригинале (при запуске оригинал добавляет ещё 60 точек к первым 60 — так же и здесь; после изменения размера —
 * 60). REQ-ATL-06.2: пауза, когда вкладка скрыта; при prefers-reduced-motion и «Экономии трафика» — один
 * статичный кадр.
 */
export function Particles() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { dataSaver } = usePreferences();

  useEffect(() => {
    const el = canvas.current;
    const container = el?.parentElement;
    const ctx = el?.getContext('2d');
    if (!el || !container || !ctx) return;
    const still = dataSaver || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let width = 0;
    let height = 0;
    let particles: Particle[] = [];
    let frame = 0;

    const make = (): Particle => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.5,
      vy: (Math.random() - 0.5) * 0.5,
      size: Math.random() * 2 + 1,
      color: `rgba(255, 255, 255, ${Math.random() * 0.5 + 0.1})`,
    });

    const draw = (move: boolean) => {
      ctx.clearRect(0, 0, width, height);
      particles.forEach((p, i) => {
        if (move) {
          p.x += p.vx;
          p.y += p.vy;
          if (p.x < 0 || p.x > width) p.vx *= -1;
          if (p.y < 0 || p.y > height) p.vy *= -1;
        }
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        for (let j = i + 1; j < particles.length; j++) {
          const q = particles[j]!;
          const dist = Math.hypot(p.x - q.x, p.y - q.y);
          if (dist < DISTANCE) {
            ctx.strokeStyle = `rgba(255, 255, 255, ${1 - (dist / DISTANCE) * 0.2})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
            ctx.stroke();
          }
        }
      });
    };

    const loop = () => {
      draw(true);
      frame = requestAnimationFrame(loop);
    };
    const start = () => {
      if (!frame && !still && !document.hidden) frame = requestAnimationFrame(loop);
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
    };

    const resize = () => {
      if (container.offsetWidth === width && container.offsetHeight === height) return;
      width = container.offsetWidth;
      height = container.offsetHeight;
      el.width = width;
      el.height = height;
      particles = Array.from({ length: COUNT }, make);
      if (still) draw(false);
    };
    const onVisibility = () => (document.hidden ? stop() : start());

    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    particles.push(...Array.from({ length: COUNT }, make));
    if (still) draw(false);
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [dataSaver]);

  return (
    <canvas
      ref={canvas}
      aria-hidden="true"
      className="hero-particles"
      data-testid="atlas-particles"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        opacity: 0.4,
      }}
    />
  );
}
