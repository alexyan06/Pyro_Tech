'use client';

interface ReplayScrubberProps {
  minTick: number;
  maxTick: number;
  replayTick: number | null;
  isReplaying: boolean;
  onSetTick: (tick: number | null) => void;
  onExit: () => void;
}

export default function ReplayScrubber({
  minTick,
  maxTick,
  replayTick,
  isReplaying,
  onSetTick,
  onExit,
}: ReplayScrubberProps) {
  if (maxTick === 0) return null; // Nothing to replay yet

  return (
    <div
      className="flex items-center gap-3 border-t px-4 py-2"
      style={{ borderColor: 'var(--border)', background: 'var(--panel-bg)' }}
    >
      <span
        className="text-xs font-semibold uppercase tracking-widest"
        style={{ color: 'var(--accent-purple)', minWidth: '4.5rem' }}
      >
        REPLAY
      </span>

      <input
        type="range"
        min={minTick}
        max={maxTick}
        step={1}
        value={replayTick ?? maxTick}
        onChange={(e) => onSetTick(Number(e.target.value))}
        className="flex-1 accent-purple-500"
        style={{ accentColor: 'var(--accent-purple)' }}
      />

      <span className="text-xs text-gray-400" style={{ minWidth: '3.5rem' }}>
        RUN&nbsp;{replayTick ?? maxTick}&nbsp;/&nbsp;{maxTick}
      </span>

      {isReplaying && (
        <button
          onClick={onExit}
          className="rounded-lg border px-3 py-1 text-xs text-gray-400 hover:bg-gray-800 transition-colors"
          style={{ borderColor: 'var(--border)' }}
        >
          Live
        </button>
      )}
    </div>
  );
}
