'use client';

import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { StateSnapshot } from '@/lib/types';

interface MetricsBarProps {
  snapshot: StateSnapshot['payload'] | null;
  simTimeString?: string;
}

const TOOLTIP_MARGIN = 8; // px from viewport edges

function Tooltip({ text, anchorLeft, anchorTop }: { text: string; anchorLeft: number; anchorTop: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState(anchorLeft);

  useLayoutEffect(() => {
    if (!ref.current) return;
    const { width } = ref.current.getBoundingClientRect();
    const centered = anchorLeft - width / 2;
    const clamped  = Math.min(
      Math.max(centered, TOOLTIP_MARGIN),
      window.innerWidth - width - TOOLTIP_MARGIN,
    );
    setLeft(clamped);
  }, [anchorLeft]);

  return (
    <div ref={ref} style={{
      position: 'fixed',
      top: anchorTop,
      left,
      background: 'var(--panel-bg)',
      border: '1px solid var(--border-bright)',
      borderRadius: '3px',
      padding: '5px 9px',
      fontSize: '0.72rem',
      lineHeight: 1.4,
      color: 'var(--text-primary)',
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
      zIndex: 9999,
      boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
    }}>
      {text}
    </div>
  );
}

interface MetricItemProps {
  label: string;
  value: string | number;
  color: string;
  primary?: boolean;
  tooltip?: string;
}

function MetricItem({ label, value, color, primary, tooltip }: MetricItemProps) {
  const labelRef = useRef<HTMLSpanElement>(null);
  const [tipPos, setTipPos] = useState<{ top: number; left: number } | null>(null);

  const enter = useCallback(() => {
    if (!labelRef.current) return;
    const r = labelRef.current.getBoundingClientRect();
    setTipPos({ top: r.bottom + 6, left: r.left + r.width / 2 });
  }, []);
  const leave = useCallback(() => setTipPos(null), []);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-start',
      padding: primary ? '0 22px 0 0' : '0 18px',
      gap: '3px',
      flexShrink: 0,
    }}>
      <span style={{
        fontFamily: 'var(--font-mono)',
        fontSize: primary ? '1.15rem' : '0.96rem',
        fontWeight: 600,
        lineHeight: 1,
        color,
        fontVariantNumeric: 'tabular-nums',
        letterSpacing: '0.02em',
        transition: 'all 0.5s ease-out',
      }}>
        {value}
      </span>
      <span
        ref={labelRef}
        onMouseEnter={enter}
        onMouseLeave={leave}
        style={{
          fontFamily: 'var(--font-condensed)',
          fontSize: '0.64rem',
          letterSpacing: '0.12em',
          textTransform: 'uppercase' as const,
          color: 'var(--text-secondary)',
          whiteSpace: 'nowrap' as const,
          cursor: tooltip ? 'default' : undefined,
          borderBottom: tooltip ? '1px dotted var(--border-bright)' : undefined,
        }}
      >
        {label}
      </span>

      {tipPos && tooltip && createPortal(
        <Tooltip text={tooltip} anchorLeft={tipPos.left} anchorTop={tipPos.top} />,
        document.body,
      )}
    </div>
  );
}

function Divider() {
  return (
    <div style={{
      width: '1px',
      height: '28px',
      background: 'var(--border)',
      flexShrink: 0,
    }} />
  );
}

function useCountUp(target: number, duration = 1000): number {
  const [displayed, setDisplayed] = useState(target);
  const prevRef = useRef(target);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const start = prevRef.current;
    if (start === target) return;
    const startTime = performance.now();

    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayed(Math.round(start + (target - start) * eased));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        prevRef.current = target;
      }
    };

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, [target, duration]);

  return displayed;
}

export default function MetricsBar({ snapshot, simTimeString }: MetricsBarProps) {
  const acresBurnedTarget = snapshot?.fire.acres_burned ?? 0;
  const animatedAcres = useCountUp(acresBurnedTarget);

  const baseStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    borderBottom: '1px solid var(--border)',
    background: 'var(--surface)',
    padding: '0 1rem',
    height: '54px',
    overflowX: 'auto',
    gap: 0,
    flexShrink: 0,
  };

  if (!snapshot) {
    return (
      <div style={baseStyle}>
        <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
          <MetricItem label="Acres Burned"  value="—" color="var(--accent-red)"    primary tooltip="Total land area consumed by the active fire perimeter" />
          <Divider />
          <MetricItem label="Evacuees"      value="—" color="var(--accent-blue)"   tooltip="People ordered to evacuate across all active zones" />
          <Divider />
          <MetricItem label="Shelter"       value="—" color="var(--accent-green)"  tooltip="Percentage of total shelter capacity currently occupied" />
          <Divider />
          <MetricItem label="Routes Closed" value="—" color="var(--accent-orange)" tooltip="Evacuation routes closed due to fire, damage, or hazard" />
          <Divider />
          <MetricItem label="Offline"       value="—" color="var(--accent-yellow)" tooltip="Infrastructure facilities offline (power, water, hospitals)" />
          <Divider />
          <MetricItem label="Pop. at Risk"  value="—" color="var(--accent-purple)" tooltip="Residents inside zones under any active evacuation status" />
          <Divider />
          <MetricItem label="Congested"     value="—" color="var(--accent-orange)" tooltip="Routes still open but experiencing heavy evacuation traffic" />
        </div>
        <span style={{
          fontFamily: 'var(--font-condensed)',
          fontSize: '0.66rem',
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--text-secondary)',
          marginLeft: 'auto',
          paddingLeft: '1rem',
          flexShrink: 0,
        }}>
          Awaiting simulation
        </span>
      </div>
    );
  }

  const { fire, evacuation, resources, infrastructure } = snapshot;

  const shelterEntries = Object.values(resources.shelters);
  const totalOccupancy = shelterEntries.reduce((sum, s) => sum + s.occupancy, 0);
  const totalCapacity  = shelterEntries.reduce((sum, s) => sum + s.capacity, 0);
  const shelterPct = totalCapacity > 0
    ? `${Math.round((totalOccupancy / totalCapacity) * 100)}%`
    : '0%';

  return (
    <div style={baseStyle}>
      <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
        <MetricItem label="Acres Burned"  value={animatedAcres.toLocaleString()}                             color="var(--accent-red)"    primary tooltip="Total land area consumed by the active fire perimeter" />
        <Divider />
        <MetricItem label="Evacuees"      value={evacuation.total_evacuees.toLocaleString()}                 color="var(--accent-blue)"   tooltip="People ordered to evacuate across all active zones" />
        <Divider />
        <MetricItem label="Shelter"       value={shelterPct}                                                 color="var(--accent-green)"  tooltip="Percentage of total shelter capacity currently occupied" />
        <Divider />
        <MetricItem label="Routes Closed" value={evacuation.routes_closed}                                   color="var(--accent-orange)" tooltip="Evacuation routes closed due to fire, damage, or hazard" />
        <Divider />
        <MetricItem label="Offline"       value={infrastructure.facilities_offline}                          color="var(--accent-yellow)" tooltip="Infrastructure facilities offline (power, water, hospitals)" />
        <Divider />
        <MetricItem label="Pop. at Risk"  value={evacuation.total_population_at_risk?.toLocaleString() ?? 0} color="var(--accent-purple)" tooltip="Residents inside zones under any active evacuation status" />
        <Divider />
        <MetricItem label="Congested"     value={evacuation.congested_routes ?? 0}                           color="var(--accent-orange)" tooltip="Routes still open but experiencing heavy evacuation traffic" />
      </div>

      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        paddingLeft: '1.25rem',
        flexShrink: 0,
        borderLeft: '1px solid var(--border)',
        marginLeft: '0.5rem',
        paddingTop: '2px',
        paddingBottom: '2px',
      }}>
        <span style={{
          fontFamily: 'var(--font-condensed)',
          fontSize: '0.62rem',
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: 'var(--text-secondary)',
        }}>
          Sim Time
        </span>
        <span className="sim-clock">
          {simTimeString || snapshot.sim_time}
        </span>
        <span style={{
          fontFamily: 'var(--font-condensed)',
          fontSize: '0.62rem',
          color: 'var(--text-secondary)',
          letterSpacing: '0.06em',
        }}>
          {fire.spread_rate_acres_hr.toFixed(0)} ac/hr spread
        </span>
      </div>
    </div>
  );
}
