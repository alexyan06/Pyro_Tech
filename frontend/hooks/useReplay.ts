'use client';

import { useState, useCallback } from 'react';
import type { StateSnapshot } from '@/lib/types';

export function useReplay(snapshots: StateSnapshot[]) {
  const [replayTick, setReplayTickRaw] = useState<number | null>(null);

  const isReplaying = replayTick !== null;

  const replaySnapshot = isReplaying
    ? snapshots.find(s => s.payload.tick === replayTick) ?? snapshots[snapshots.length - 1] ?? null
    : null;

  const setReplayTick = useCallback((tick: number | null) => {
    setReplayTickRaw(tick);
  }, []);

  const exitReplay = useCallback(() => setReplayTickRaw(null), []);

  const maxTick = snapshots.length > 0 ? Math.max(...snapshots.map(s => s.payload.tick)) : 0;
  const minTick = snapshots.length > 0 ? Math.min(...snapshots.map(s => s.payload.tick)) : 0;

  return { isReplaying, replayTick, replaySnapshot, setReplayTick, exitReplay, minTick, maxTick };
}
