'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

export type LoadingPhase = 'idle' | 'setup' | 'connecting' | 'awaiting-snapshot' | 'done';

interface LoadingStateValue {
  phase: LoadingPhase;
  setPhase: (phase: LoadingPhase) => void;
}

const LoadingStateContext = createContext<LoadingStateValue | null>(null);

export function LoadingProvider({ children }: { children: React.ReactNode }) {
  const [phase, setPhaseState] = useState<LoadingPhase>('idle');

  const setPhase = useCallback((next: LoadingPhase) => {
    setPhaseState(prev => (prev === next ? prev : next));
  }, []);

  const value = useMemo<LoadingStateValue>(() => ({ phase, setPhase }), [phase, setPhase]);

  return <LoadingStateContext.Provider value={value}>{children}</LoadingStateContext.Provider>;
}

export function useLoading(): LoadingStateValue {
  const ctx = useContext(LoadingStateContext);
  if (!ctx) throw new Error('useLoading must be used inside <LoadingProvider>');
  return ctx;
}
