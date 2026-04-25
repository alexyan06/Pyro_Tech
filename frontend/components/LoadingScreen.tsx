'use client';

import { useEffect, useRef, useState } from 'react';
import { useLoading, type LoadingPhase } from '@/lib/loadingState';

const PHASE_MESSAGES: Record<LoadingPhase, string> = {
  'idle': '',
  'setup': 'Loading scenario data...',
  'connecting': 'Connecting to incident command...',
  'awaiting-snapshot': 'Initializing fire physics model...',
  'done': 'Awaiting first transmissions...',
};

// Per-phase progress ceilings. Bar eases toward the ceiling for the current
// phase and never reverses. 'done' eases all the way to 1.0, then we fade out.
const PHASE_CAP: Record<LoadingPhase, number> = {
  'idle': 0,
  'setup': 0.40,
  'connecting': 0.65,
  'awaiting-snapshot': 0.90,
  'done': 1.0,
};

const FADE_MS = 650;

const EMBERS = [
  { left: 12, delay: 0.0, duration: 3.8, size: 5, drift: -22, color: '#f97316' },
  { left: 27, delay: 0.6, duration: 4.5, size: 4, drift:  18, color: '#ef4444' },
  { left: 41, delay: 1.1, duration: 3.2, size: 6, drift: -35, color: '#fb923c' },
  { left: 55, delay: 0.3, duration: 5.0, size: 3, drift:  28, color: '#fbbf24' },
  { left: 68, delay: 1.7, duration: 3.6, size: 5, drift: -14, color: '#f97316' },
  { left: 80, delay: 0.9, duration: 4.2, size: 4, drift:  38, color: '#ef4444' },
  { left: 19, delay: 2.1, duration: 3.9, size: 3, drift:  20, color: '#fb923c' },
  { left: 35, delay: 1.4, duration: 4.8, size: 6, drift: -28, color: '#fbbf24' },
  { left: 49, delay: 0.2, duration: 3.5, size: 4, drift:  16, color: '#f97316' },
  { left: 63, delay: 2.5, duration: 4.1, size: 5, drift: -40, color: '#ef4444' },
  { left: 75, delay: 0.7, duration: 3.3, size: 3, drift:  30, color: '#fb923c' },
  { left:  8, delay: 1.9, duration: 5.2, size: 4, drift: -18, color: '#fbbf24' },
  { left: 22, delay: 3.0, duration: 3.7, size: 6, drift:  24, color: '#f97316' },
  { left: 46, delay: 2.3, duration: 4.4, size: 3, drift: -32, color: '#ef4444' },
  { left: 58, delay: 0.5, duration: 3.1, size: 5, drift:  12, color: '#fb923c' },
  { left: 71, delay: 1.6, duration: 4.7, size: 4, drift: -26, color: '#fbbf24' },
  { left: 87, delay: 2.8, duration: 3.4, size: 3, drift:  36, color: '#f97316' },
  { left: 32, delay: 0.4, duration: 4.0, size: 5, drift: -10, color: '#ef4444' },
  { left: 90, delay: 1.2, duration: 5.5, size: 4, drift:  22, color: '#fb923c' },
  { left:  4, delay: 3.3, duration: 3.6, size: 6, drift: -38, color: '#fbbf24' },
];

export default function LoadingScreen() {
  const { phase, setPhase } = useLoading();
  const [progress, setProgress] = useState(0);
  const [opacity, setOpacity] = useState(0);
  const [mounted, setMounted] = useState(false);

  // The visible state lags `phase`: while the bar is finishing its 'done' tween
  // and fading out we keep the overlay mounted. After fade, we reset to idle.
  const phaseRef = useRef(phase);
  const progressRef = useRef(0);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Mount + fade-in when leaving idle
  useEffect(() => {
    if (phase === 'idle') return;
    const tMount = window.setTimeout(() => setMounted(true), 0);
    const tFadeIn = window.setTimeout(() => setOpacity(1), 0);
    return () => {
      window.clearTimeout(tMount);
      window.clearTimeout(tFadeIn);
    };
  }, [phase]);

  // Fade-out when 'done' bar reaches 1.0
  useEffect(() => {
    if (phase !== 'done') return;
    if (progress < 0.999) return;
    const tFadeOut = window.setTimeout(() => setOpacity(0), 0);
    const tFade = window.setTimeout(() => {
      setMounted(false);
      progressRef.current = 0;
      setProgress(0);
      setPhase('idle');
    }, FADE_MS);
    return () => {
      window.clearTimeout(tFadeOut);
      window.clearTimeout(tFade);
    };
  }, [phase, progress, setPhase]);

  // Tween progress toward current phase's cap on each animation frame.
  useEffect(() => {
    if (!mounted) return;
    let raf = 0;
    const tick = () => {
      const p = phaseRef.current;
      const target = PHASE_CAP[p];
      const cur = progressRef.current;
      if (cur < target) {
        // 'done' tween is sharper so the bar fills to 100% well within the
        // backend's lead-in window (SIM_LEAD_IN_MS = 1400 ms). Other phases
        // ease gently with a minimum step so the bar never visually stalls.
        const step = p === 'done'
          ? Math.max(0.012, (target - cur) * 0.18)
          : Math.max(0.0018, (target - cur) * 0.04);
        progressRef.current = Math.min(cur + step, target);
        setProgress(progressRef.current);
      }
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [mounted]);

  if (!mounted) return null;

  const message = PHASE_MESSAGES[phase] || PHASE_MESSAGES['setup'];

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'oklch(4% 0.01 24)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        opacity,
        transition: `opacity ${FADE_MS}ms ease-out`,
        pointerEvents: opacity < 0.5 ? 'none' : 'all',
      }}
    >
      {EMBERS.map((e, i) => (
        <span
          key={i}
          style={{
            position: 'absolute',
            bottom: '-10px',
            left: `${e.left}%`,
            width: `${e.size}px`,
            height: `${e.size}px`,
            borderRadius: '50%',
            background: e.color,
            boxShadow: `0 0 ${e.size * 2}px ${e.color}`,
            animation: `ember-rise ${e.duration}s ease-in ${e.delay}s infinite`,
            ['--drift' as string]: `${e.drift}px`,
          }}
        />
      ))}

      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: '180px',
        background: 'radial-gradient(ellipse 80% 100% at 50% 100%, oklch(40% 0.2 30 / 0.35) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem', position: 'relative' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            fontFamily: 'var(--font-condensed)',
            fontSize: 'clamp(3rem, 8vw, 5.5rem)',
            fontWeight: 700,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--accent-orange)',
            textShadow: '0 0 40px oklch(60% 0.22 40 / 0.6), 0 0 80px oklch(50% 0.2 30 / 0.3)',
            lineHeight: 1,
          }}>
            PYROTECH
          </div>
          <div style={{
            fontFamily: 'var(--font-condensed)',
            fontSize: 'clamp(0.7rem, 1.5vw, 0.9rem)',
            letterSpacing: '0.35em',
            textTransform: 'uppercase',
            color: 'var(--text-secondary)',
            marginTop: '0.4rem',
          }}>
            AI Wildfire Incident Command
          </div>
        </div>

        <div style={{
          width: '240px',
          height: '1px',
          background: 'linear-gradient(to right, transparent, var(--accent-orange), transparent)',
          opacity: 0.4,
        }} />

        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.78rem',
          letterSpacing: '0.06em',
          color: 'var(--text-secondary)',
          minHeight: '1.4em',
          textAlign: 'center',
          animation: 'pulse-glow 2s ease-in-out infinite',
        }}>
          {message}
        </div>
      </div>

      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: '2px',
        background: 'var(--border)',
      }}>
        <div style={{
          height: '100%',
          width: `${progress * 100}%`,
          background: 'linear-gradient(to right, var(--accent-red), var(--accent-orange))',
          boxShadow: '0 0 8px var(--accent-orange)',
          transition: 'width 0.1s linear',
        }} />
      </div>
    </div>
  );
}
