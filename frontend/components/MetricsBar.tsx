'use client';

import { useEffect, useRef, useState } from 'react';
import type { StateSnapshot } from '@/lib/types';

interface MetricsBarProps {
  snapshot: StateSnapshot['payload'] | null;
  simTimeString?: string;
}

interface MetricItemProps {
  label: string;
  value: string | number;
  color: string;
  primary?: boolean;
}

function MetricItem({ label, value, color, primary }: MetricItemProps) {
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
      <span style={{
        fontFamily: 'var(--font-condensed)',
        fontSize: '0.64rem',
        letterSpacing: '0.12em',
        textTransform: 'uppercase' as const,
        color: 'var(--text-secondary)',
        whiteSpace: 'nowrap' as const,
      }}>
        {label}
      </span>
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
          <MetricItem label="Acres Burned"  value="—" color="var(--accent-red)"    primary />
          <Divider />
          <MetricItem label="Evacuees"      value="—" color="var(--accent-blue)"   />
          <Divider />
          <MetricItem label="Shelter"       value="—" color="var(--accent-green)"  />
          <Divider />
          <MetricItem label="Routes Closed" value="—" color="var(--accent-orange)" />
          <Divider />
          <MetricItem label="Offline"       value="—" color="var(--accent-yellow)" />
          <Divider />
          <MetricItem label="Pop. at Risk"  value="—" color="var(--accent-purple)" />
          <Divider />
          <MetricItem label="Congested"     value="—" color="var(--accent-orange)" />
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
        <MetricItem label="Acres Burned"  value={animatedAcres.toLocaleString()}                            color="var(--accent-red)"    primary />
        <Divider />
        <MetricItem label="Evacuees"      value={evacuation.total_evacuees.toLocaleString()}                color="var(--accent-blue)"   />
        <Divider />
        <MetricItem label="Shelter"       value={shelterPct}                                                color="var(--accent-green)"  />
        <Divider />
        <MetricItem label="Routes Closed" value={evacuation.routes_closed}                                  color="var(--accent-orange)" />
        <Divider />
        <MetricItem label="Offline"       value={infrastructure.facilities_offline}                         color="var(--accent-yellow)" />
        <Divider />
        <MetricItem label="Pop. at Risk"  value={evacuation.total_population_at_risk?.toLocaleString() ?? 0} color="var(--accent-purple)" />
        <Divider />
        <MetricItem label="Congested"     value={evacuation.congested_routes ?? 0}                          color="var(--accent-orange)" />
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
