'use client';

import { useState, useCallback, useMemo } from 'react';
import type { StateSnapshot } from '@/lib/types';

export function useReplay(snapshots: StateSnapshot[]) {
  const [replayTick, setReplayTickRaw] = useState<number | null>(null);

  const isReplaying = replayTick !== null;

  // O(1) lookup by tick — avoids array.find scan on every render
  const snapshotMap = useMemo(
    () => new Map(snapshots.map(s => [s.payload.tick, s])),
    [snapshots],
  );

  const replaySnapshot = isReplaying
    ? (snapshotMap.get(replayTick) ?? snapshots[snapshots.length - 1] ?? null)
    : null;

  const setReplayTick = useCallback((tick: number | null) => {
    setReplayTickRaw(tick);
  }, []);

  const exitReplay = useCallback(() => setReplayTickRaw(null), []);

  // Avoid spread operator to prevent call-stack issues with large arrays
  let maxTick = 0, minTick = 0;
  if (snapshots.length > 0) {
    minTick = snapshots[0].payload.tick;
    maxTick = snapshots[0].payload.tick;
    for (let i = 1; i < snapshots.length; i++) {
      const t = snapshots[i].payload.tick;
      if (t < minTick) minTick = t;
      if (t > maxTick) maxTick = t;
    }
  }

  return { isReplaying, replayTick, replaySnapshot, setReplayTick, exitReplay, minTick, maxTick };
}
