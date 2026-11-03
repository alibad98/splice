'use client';

// Interactive dot-grid background for the auth brand panel. Original implementation (canvas 2D, no dependencies),
// in the spirit of React Bits' "Dot Grid" (reactbits.dev, MIT + Commons Clause; no code copied).
// - Dots near the pointer warm from paper to coral and swell; a click sends a ripple through the grid.
// - With no pointer (touch, or the cursor is over the form) a soft light drifts on a slow Lissajous path.
// - The grid fades out toward the panel edges so centred content sits on a calm stage.
// - Frames only run while the panel is on screen and the tab is visible; DPR capped at 2.
// - prefers-reduced-motion: one static frame, no listeners.
import { useEffect, useRef } from 'react';

const GAP = 22;
const BASE_R = 1.15;
const HOVER_R = 2.6;
const REACH = 170;
const IDLE_STRENGTH = 0.5;
const EDGE_FADE = 96;
const PUSH = 7;
const BASE = [245, 241, 238] as const; // paper
const HOT = [255, 106, 92] as const; // coral (dark-theme primary)
const AMBER = [255, 194, 61] as const;

interface Ripple {
  x: number;
  y: number;
  t0: number;
}

export function DotField({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !host || !ctx) return;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let width = 0;
    let height = 0;
    let dots: { x: number; y: number }[] = [];
    const pointer = { x: -9999, y: -9999, active: false };
    // Eased copy of the pointer so the glow trails smoothly instead of snapping.
    const glow = { x: -9999, y: -9999, strength: 0 };
    const ripples: Ripple[] = [];
    let frame = 0;
    let running = false;
    let onScreen = true;

    const resize = () => {
      const rect = host.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cols = Math.ceil(width / GAP) + 1;
      const rows = Math.ceil(height / GAP) + 1;
      const offX = (width - (cols - 1) * GAP) / 2;
      const offY = (height - (rows - 1) * GAP) / 2;
      dots = [];
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) dots.push({ x: offX + c * GAP, y: offY + r * GAP });
      if (!running) draw(performance.now());
    };

    const mix = (a: readonly number[], b: readonly number[], t: number) => a.map((v, i) => Math.round(v + (b[i]! - v) * t));

    function draw(now: number) {
      ctx!.clearRect(0, 0, width, height);
      const t = reduce ? 0 : now / 1000;
      // Pointer when present, otherwise a slow drifting light (static centre-ish point under reduced motion).
      const tx = pointer.active ? pointer.x : width * (0.5 + Math.sin(t * 0.21) * 0.3);
      const ty = pointer.active ? pointer.y : height * (0.5 + Math.cos(t * 0.17 + 1) * 0.3);
      const ease = pointer.active ? 0.18 : 0.04;
      glow.x += (tx - glow.x) * ease;
      glow.y += (ty - glow.y) * ease;
      glow.strength += ((pointer.active ? 1 : reduce ? 0 : IDLE_STRENGTH) - glow.strength) * 0.05;

      for (let i = ripples.length - 1; i >= 0; i--) if (now - ripples[i]!.t0 > 1400) ripples.splice(i, 1);

      for (const d of dots) {
        // Ambient breath: a soft diagonal wave.
        const wave = reduce ? 0 : (Math.sin((d.x + d.y) * 0.012 - t * 0.9) + 1) / 2;
        let heat = 0;
        let dx = 0;
        let dy = 0;
        if (glow.strength > 0.01) {
          const ex = d.x - glow.x;
          const ey = d.y - glow.y;
          const dist = Math.hypot(ex, ey);
          if (dist < REACH) {
            const f = (1 - dist / REACH) ** 2 * glow.strength;
            heat = f;
            if (dist > 0.01) {
              dx += (ex / dist) * PUSH * f;
              dy += (ey / dist) * PUSH * f;
            }
          }
        }
        for (const rp of ripples) {
          const age = (now - rp.t0) / 1000;
          const front = age * 520;
          const ex = d.x - rp.x;
          const ey = d.y - rp.y;
          const dist = Math.hypot(ex, ey);
          const band = Math.max(0, 1 - Math.abs(dist - front) / 46) * Math.max(0, 1 - age / 1.4);
          if (band > 0 && dist > 0.01) {
            heat = Math.max(heat, band * 0.9);
            dx += (ex / dist) * 9 * band;
            dy += (ey / dist) * 9 * band;
          }
        }
        const r = BASE_R + (HOVER_R - BASE_R) * heat;
        const edge = Math.min(1, Math.min(d.x, width - d.x, d.y, height - d.y) / EDGE_FADE);
        const alpha = (0.12 + wave * 0.07 + heat * 0.75) * edge * edge * (3 - 2 * edge);
        const color = heat > 0.55 ? mix(HOT, AMBER, (heat - 0.55) / 0.45 * 0.6) : mix(BASE, HOT, heat / 0.55);
        ctx!.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},${alpha.toFixed(3)})`;
        ctx!.beginPath();
        ctx!.arc(d.x + dx, d.y + dy, r, 0, Math.PI * 2);
        ctx!.fill();
      }
    }

    const loop = (now: number) => {
      draw(now);
      frame = requestAnimationFrame(loop);
    };
    const start = () => {
      if (running || reduce || !onScreen || document.hidden) return;
      running = true;
      frame = requestAnimationFrame(loop);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(frame);
    };

    // Start the drifting light at the centre rather than flying in from a corner.
    glow.x = host.clientWidth / 2;
    glow.y = host.clientHeight / 2;
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();
    if (reduce) return () => ro.disconnect();

    const onMove = (e: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      pointer.x = e.clientX - rect.left;
      pointer.y = e.clientY - rect.top;
      pointer.active = true;
    };
    const onLeave = () => {
      pointer.active = false;
    };
    const onDown = (e: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      ripples.push({ x: e.clientX - rect.left, y: e.clientY - rect.top, t0: performance.now() });
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    const io = new IntersectionObserver(([entry]) => {
      onScreen = Boolean(entry?.isIntersecting);
      if (onScreen) start();
      else stop();
    });

    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerleave', onLeave);
    host.addEventListener('pointerdown', onDown);
    document.addEventListener('visibilitychange', onVisibility);
    io.observe(host);
    start();

    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
      host.removeEventListener('pointerdown', onDown);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" className={`pointer-events-none absolute inset-0 ${className ?? ''}`} />;
}
