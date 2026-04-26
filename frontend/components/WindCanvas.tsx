'use client';
import { useRef, useEffect } from 'react';

interface WindCanvasProps {
  windU: number;
  windV: number;
  mapBearing: number;
  mapPitch: number;
}

const NUM_PARTICLES   = 110;
const TRAIL_FRAMES    = 30;
const SQUIGGLE_AMP    = 11;
const SQUIGGLE_FREQ   = 0.042;
// Trail opacity is split into this many buckets — one stroke() call each instead of one per segment.
const OPACITY_BUCKETS = 6;

type Particle = {
  cx: number;
  cy: number;
  phase: number;
  history: [number, number][];
};

export default function WindCanvas({ windU, windV, mapBearing, mapPitch }: WindCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const syncSize = () => {
      canvas.width  = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    syncSize();
    const ro = new ResizeObserver(syncSize);
    ro.observe(canvas);

    const mag = Math.sqrt(windU * windU + windV * windV);
    if (mag < 0.1) { ro.disconnect(); return; }

    // Geographic TO-bearing → screen direction, accounting for map rotation and pitch
    const geoBearing  = Math.atan2(windU, windV);
    const screenAngle = geoBearing - mapBearing * (Math.PI / 180);
    let nx = Math.sin(screenAngle);
    let ny = -Math.cos(screenAngle);
    ny *= Math.cos(mapPitch * (Math.PI / 180)); // foreshorten depth axis
    const len = Math.sqrt(nx * nx + ny * ny);
    nx /= len;
    ny /= len;

    const px =  ny;   // perpendicular (clockwise 90°)
    const py = -nx;

    const speed = 1.8 * Math.min(2.2, 0.5 + mag / 10);

    function spawnParticle(w: number, h: number, aged = false): Particle {
      const p: Particle = {
        cx: Math.random() * w,
        cy: Math.random() * h,
        phase: Math.random() * Math.PI * 2,
        history: [],
      };
      if (aged) {
        const age = Math.floor(Math.random() * TRAIL_FRAMES);
        for (let i = 0; i < age; i++) {
          const sq = Math.sin(i * SQUIGGLE_FREQ + p.phase) * SQUIGGLE_AMP;
          p.history.push([p.cx + px * sq, p.cy + py * sq]);
          p.cx += nx * speed;
          p.cy += ny * speed;
        }
      }
      return p;
    }

    const particles = Array.from({ length: NUM_PARTICLES }, () =>
      spawnParticle(canvas.width, canvas.height, true),
    );

    let animId: number;

    function frame() {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // Pre-allocate one Path2D per opacity bucket + one for all arrowheads.
      // This collapses ~3,200 stroke() calls into OPACITY_BUCKETS + 1 calls.
      const trailPaths = Array.from({ length: OPACITY_BUCKETS }, () => new Path2D());
      const arrowPath  = new Path2D();

      for (const p of particles) {
        // Advance particle
        const age = p.history.length;
        const sq  = Math.sin(age * SQUIGGLE_FREQ + p.phase) * SQUIGGLE_AMP;
        p.history.push([p.cx + px * sq, p.cy + py * sq]);
        if (p.history.length > TRAIL_FRAMES) p.history.shift();
        p.cx += nx * speed;
        p.cy += ny * speed;

        // Wrap and clear history on edge crossing
        const margin = 70;
        let wrapped = false;
        if      (p.cx < -margin)    { p.cx += w + margin * 2; wrapped = true; }
        else if (p.cx > w + margin) { p.cx -= w + margin * 2; wrapped = true; }
        if      (p.cy < -margin)    { p.cy += h + margin * 2; wrapped = true; }
        else if (p.cy > h + margin) { p.cy -= h + margin * 2; wrapped = true; }
        if (wrapped) { p.history = []; continue; }

        if (p.history.length < 2) continue;

        // Batch trail segments into opacity buckets
        for (let i = 1; i < p.history.length; i++) {
          const t      = i / p.history.length;
          const bucket = Math.min(OPACITY_BUCKETS - 1, Math.floor(t * OPACITY_BUCKETS));
          trailPaths[bucket].moveTo(p.history[i - 1][0], p.history[i - 1][1]);
          trailPaths[bucket].lineTo(p.history[i][0],     p.history[i][1]);
        }

        // Batch arrowhead into shared path
        const [hx, hy] = p.history[p.history.length - 1];
        const as = 5;
        arrowPath.moveTo(hx + nx * as,                              hy + ny * as);
        arrowPath.lineTo(hx - nx * as * 0.7 + px * as * 0.55,      hy - ny * as * 0.7 + py * as * 0.55);
        arrowPath.lineTo(hx - nx * as * 0.7 - px * as * 0.55,      hy - ny * as * 0.7 - py * as * 0.55);
        arrowPath.closePath();
      }

      // One stroke per opacity bucket (6 calls total for all 110 particle trails)
      ctx.lineWidth = 1.3;
      ctx.lineCap   = 'round';
      for (let b = 0; b < OPACITY_BUCKETS; b++) {
        ctx.strokeStyle = `rgba(150, 205, 255, ${((b + 1) / OPACITY_BUCKETS) * 0.36})`;
        ctx.stroke(trailPaths[b]);
      }

      // One fill call for all 110 arrowheads
      ctx.fillStyle = 'rgba(175, 225, 255, 0.42)';
      ctx.fill(arrowPath);

      animId = requestAnimationFrame(frame);
    }

    animId = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
    };
  }, [windU, windV, mapBearing, mapPitch]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 5,
      }}
    />
  );
}
