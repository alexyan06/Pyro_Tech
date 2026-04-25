'use client';

import { useEffect, useState, useRef } from 'react';

interface LoadingScreenProps {
  visible: boolean;
}

const PHASES = [
  'Connecting to incident command...',
  'Loading scenario data...',
  'Initializing fire physics model...',
  'Deploying field agents...',
  'Awaiting first transmissions...',
];

const PHASE_INTERVAL_MS = 2200;
const TOTAL_PROGRESS_MS = 15000;

// 20 ember particles with fixed seeds — no hydration mismatch
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

export default function LoadingScreen({ visible }: LoadingScreenProps) {
  // tick drives re-renders; phase/progress are derived from elapsed time
  const [tick, setTick] = useState(0);
  const [opacity, setOpacity] = useState(0);
  const [mounted, setMounted] = useState(false);
  const startedAtRef = useRef(0);

  // Mount/unmount with fade — all setStates deferred via setTimeout
  useEffect(() => {
    if (visible) {
      startedAtRef.current = Date.now();
      const t = setTimeout(() => {
        setMounted(true);
        setOpacity(1);
      }, 0);
      return () => clearTimeout(t);
    } else {
      const t1 = setTimeout(() => setOpacity(0), 0);
      const t2 = setTimeout(() => setMounted(false), 650);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
  }, [visible]);

  // Tick every 100ms to drive phase + progress re-renders
  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => setTick(t => t + 1), 100);
    return () => clearInterval(id);
  }, [visible]);

  if (!mounted) return null;

  const elapsed = tick * 100;
  const phase = Math.min(Math.floor(elapsed / PHASE_INTERVAL_MS), PHASES.length - 1);
  const progress = Math.min(elapsed / TOTAL_PROGRESS_MS, 0.97);

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
        transition: 'opacity 0.6s ease-out',
        pointerEvents: opacity < 0.5 ? 'none' : 'all',
      }}
    >
      {/* Ember particles */}
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

      {/* Background fire glow at bottom */}
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: '180px',
        background: 'radial-gradient(ellipse 80% 100% at 50% 100%, oklch(40% 0.2 30 / 0.35) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      {/* Center content */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem', position: 'relative' }}>

        {/* PyroTech wordmark */}
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

        {/* Divider */}
        <div style={{
          width: '240px',
          height: '1px',
          background: 'linear-gradient(to right, transparent, var(--accent-orange), transparent)',
          opacity: 0.4,
        }} />

        {/* Status message */}
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.78rem',
          letterSpacing: '0.06em',
          color: 'var(--text-secondary)',
          minHeight: '1.4em',
          textAlign: 'center',
          animation: 'pulse-glow 2s ease-in-out infinite',
        }}>
          {PHASES[phase]}
        </div>

      </div>

      {/* Progress bar */}
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
