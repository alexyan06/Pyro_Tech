'use client';

import { useEffect, useRef, useState } from 'react';
import type { StateSnapshot } from '@/lib/types';

interface MetricsBarProps {
  snapshot: StateSnapshot['payload'] | null;
  simTimeString?: string;
}

interface StatCardProps {
  label: string;
  value: string | number;
  icon: string;
  color: string;
}

function StatCard({ label, value, icon, color }: StatCardProps) {
  return (
    <div
      className="flex items-center gap-3 rounded-lg border px-4 py-2"
      style={{
        borderColor: color + '33',
        background: color + '0a',
      }}
    >
      <span className="text-lg">{icon}</span>
      <div>
        <p
          className="text-lg font-bold tabular-nums transition-all duration-500"
          style={{ color }}
        >
          {value}
        </p>
        <p className="text-xs text-gray-500">{label}</p>
      </div>
    </div>
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
      // Ease out cubic
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

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [target, duration]);

  return displayed;
}

export default function MetricsBar({ snapshot, simTimeString }: MetricsBarProps) {
  const acresBurnedTarget = snapshot?.fire.acres_burned ?? 0;
  const animatedAcres = useCountUp(acresBurnedTarget);

  if (!snapshot) {
    return (
      <div
        className="flex items-center gap-4 border-b px-4 py-3"
        style={{
          borderColor: 'var(--border)',
          background: 'var(--panel-bg)',
        }}
      >
        <StatCard
          label="Acres Burned"
          value="--"
          icon={'\u{1F525}'}
          color="var(--accent-red)"
        />
        <StatCard
          label="Evacuees"
          value="--"
          icon={'\u{1F6B6}'}
          color="var(--accent-blue)"
        />
        <StatCard
          label="Shelters"
          value="--"
          icon={'\u{1F3E0}'}
          color="var(--accent-green)"
        />
        <StatCard
          label="Routes Closed"
          value="--"
          icon={'\u{26D4}'}
          color="var(--accent-orange)"
        />
        <StatCard
          label="Facilities Offline"
          value="--"
          icon={'\u{26A0}\u{FE0F}'}
          color="var(--accent-yellow)"
        />
        <StatCard
          label="Pop. at Risk"
          value="--"
          icon={'\u{26A0}'}
          color="#e879f9"
        />
        <StatCard
          label="Congested Routes"
          value="--"
          icon={'\u{1F6A6}'}
          color="#f97316"
        />
        <div className="ml-auto text-xs text-gray-600">
          Awaiting simulation...
        </div>
      </div>
    );
  }

  const { fire, evacuation, resources, infrastructure } = snapshot;

  // Calculate shelter capacity percentage
  const shelterEntries = Object.values(resources.shelters);
  const totalOccupancy = shelterEntries.reduce(
    (sum, s) => sum + s.occupancy,
    0,
  );
  const totalCapacity = shelterEntries.reduce(
    (sum, s) => sum + s.capacity,
    0,
  );
  const shelterPct =
    totalCapacity > 0
      ? `${Math.round((totalOccupancy / totalCapacity) * 100)}%`
      : '0%';

  return (
    <div
      className="flex items-center gap-4 border-b px-4 py-3"
      style={{
        borderColor: 'var(--border)',
        background: 'var(--panel-bg)',
      }}
    >
      <StatCard
        label="Acres Burned"
        value={animatedAcres.toLocaleString()}
        icon={'\u{1F525}'}
        color="var(--accent-red)"
      />
      <StatCard
        label="Evacuees"
        value={evacuation.total_evacuees.toLocaleString()}
        icon={'\u{1F6B6}'}
        color="var(--accent-blue)"
      />
      <StatCard
        label="Shelters"
        value={shelterPct}
        icon={'\u{1F3E0}'}
        color="var(--accent-green)"
      />
      <StatCard
        label="Routes Closed"
        value={evacuation.routes_closed}
        icon={'\u{26D4}'}
        color="var(--accent-orange)"
      />
      <StatCard
        label="Facilities Offline"
        value={infrastructure.facilities_offline}
        icon={'\u{26A0}\u{FE0F}'}
        color="var(--accent-yellow)"
      />
      <StatCard
        label="Pop. at Risk"
        value={evacuation.total_population_at_risk?.toLocaleString() ?? 0}
        icon={'\u{26A0}'}
        color="#e879f9"
      />
      <StatCard
        label="Congested Routes"
        value={evacuation.congested_routes ?? 0}
        icon={'\u{1F6A6}'}
        color="#f97316"
      />
      <div className="ml-auto text-right">
        <p className="text-xs text-gray-500">Sim Time</p>
        <p className="font-mono text-sm text-gray-300">
          {simTimeString || snapshot.sim_time}
        </p>
        <p className="text-xs text-gray-600">
          {fire.spread_rate_acres_hr.toFixed(0)} ac/hr spread rate
        </p>
      </div>
    </div>
  );
}
