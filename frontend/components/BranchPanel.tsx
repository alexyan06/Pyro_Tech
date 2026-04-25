'use client';

import { useState, useRef, useEffect } from 'react';
import { sanitizeAgentText } from '@/lib/agentText';
import type { BranchAgentMessage } from '@/hooks/useSimulation';

const AGENT_COLORS: Record<string, string> = {
  disaster:       '#ef4444', // red
  evacuation:     '#f97316', // orange
  resource:       '#22c55e', // green
  infrastructure: '#3b82f6', // blue
  communications: '#a855f7', // purple
  synthesis:      '#eab308', // yellow
};

const WHAT_IF_PRESETS = [
  'Wind shifts NE at 70mph',
  'Fire jumps PCH into Malibu',
  'Power grid fully offline',
  'Canyon Road becomes blocked',
];

interface BranchPanelProps {
  isRunning: boolean;
  branchRunning: boolean;
  branchModifier: string;
  branchMessages: BranchAgentMessage[];
  onStartBranch: (modifier: string) => void;
  onClearBranch: () => void;
}

function AgentTag({ name }: { name: string }) {
  const color = AGENT_COLORS[name] ?? '#9ca3af';
  return (
    <span
      className="mr-2 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest"
      style={{ background: color + '22', color, border: `1px solid ${color}55` }}
    >
      {name}
    </span>
  );
}

function MessageCard({ msg }: { msg: BranchAgentMessage }) {
  const clean = sanitizeAgentText(msg.text);
  const first300 = clean.slice(0, 400) + (clean.length > 400 ? '…' : '');

  return (
    <div
      className="mb-2 rounded-lg border p-2 text-xs"
      style={{
        borderColor: (AGENT_COLORS[msg.agent] ?? '#374151') + '44',
        background: '#0f172a',
      }}
    >
      <div className="mb-1 flex items-center justify-between">
        <AgentTag name={msg.agent} />
        <span className="text-[10px] text-gray-500">Tick {msg.tick}</span>
      </div>
      <p className="leading-relaxed text-gray-300">{first300}</p>
    </div>
  );
}

export default function BranchPanel({
  isRunning,
  branchRunning,
  branchModifier,
  branchMessages,
  onStartBranch,
  onClearBranch,
}: BranchPanelProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const feedRef = useRef<HTMLDivElement>(null);

  // Auto-scroll branch feed
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [branchMessages]);

  const handleSubmit = () => {
    const modifier = input.trim();
    if (!modifier) return;
    onStartBranch(modifier);
  };

  const handlePreset = (preset: string) => {
    setInput(preset);
  };

  const hasResults = branchMessages.length > 0;

  return (
    <>
      {/* Toggle button — always visible when sim has ever started */}
      {(isRunning || hasResults) && (
        <button
          onClick={() => setOpen(o => !o)}
          className="absolute bottom-16 right-4 z-50 flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all hover:opacity-90"
          style={{
            background: open ? '#1e40af' : '#0f172a',
            borderColor: open ? '#3b82f6' : '#374151',
            color: open ? '#93c5fd' : '#9ca3af',
          }}
          title="What-If Branching: fork the simulation with a different scenario"
        >
          <span>⚡</span>
          <span>WHAT IF?</span>
          {branchRunning && (
            <span className="ml-1 h-2 w-2 animate-pulse rounded-full bg-blue-400" />
          )}
        </button>
      )}

      {/* Panel overlay */}
      {open && (
        <div
          className="absolute bottom-28 right-4 z-50 flex w-80 flex-col rounded-xl border shadow-2xl"
          style={{ background: '#0a0f1e', borderColor: '#1e3a5f', maxHeight: '70vh' }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between rounded-t-xl border-b px-4 py-2"
            style={{ borderColor: '#1e3a5f', background: '#0d1a2e' }}
          >
            <div>
              <span className="text-xs font-bold text-blue-400 tracking-widest">⚡ WHAT-IF BRANCH</span>
              {branchModifier && (
                <p className="mt-0.5 truncate text-[10px] text-blue-300 opacity-70">{branchModifier}</p>
              )}
            </div>
            <button
              onClick={() => setOpen(false)}
              className="ml-2 text-gray-500 hover:text-gray-300 text-sm leading-none"
            >
              ✕
            </button>
          </div>

          {/* Input */}
          <div className="border-b px-3 py-2" style={{ borderColor: '#1e3a5f' }}>
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              disabled={branchRunning}
              rows={2}
              placeholder="What if wind shifts NE at 70mph?"
              className="w-full resize-none rounded-lg border bg-transparent p-2 text-xs text-gray-200 placeholder-gray-600 outline-none focus:border-blue-500"
              style={{ borderColor: '#1e3a5f' }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); }}}
            />
            <div className="mt-1.5 flex flex-wrap gap-1">
              {WHAT_IF_PRESETS.map(p => (
                <button
                  key={p}
                  onClick={() => handlePreset(p)}
                  disabled={branchRunning}
                  className="rounded border px-1.5 py-0.5 text-[10px] text-gray-400 hover:text-blue-300 transition-colors"
                  style={{ borderColor: '#1e3a5f' }}
                >
                  {p}
                </button>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <button
                onClick={handleSubmit}
                disabled={branchRunning || !input.trim()}
                className="flex-1 rounded-lg py-1 text-xs font-semibold transition-all disabled:opacity-40"
                style={{ background: '#1d4ed8', color: '#dbeafe' }}
              >
                {branchRunning ? 'Branching…' : 'Fork Simulation'}
              </button>
              {hasResults && (
                <button
                  onClick={() => { onClearBranch(); setInput(''); }}
                  disabled={branchRunning}
                  className="rounded-lg px-3 py-1 text-xs text-gray-400 hover:text-red-400 transition-colors border"
                  style={{ borderColor: '#1e3a5f' }}
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Branch messages feed */}
          {(hasResults || branchRunning) && (
            <div ref={feedRef} className="flex-1 overflow-y-auto p-2" style={{ minHeight: '100px', maxHeight: '340px' }}>
              {branchRunning && branchMessages.length === 0 && (
                <div className="flex items-center gap-2 p-2 text-xs text-blue-400">
                  <span className="animate-pulse">●</span>
                  <span>Forking simulation…</span>
                </div>
              )}
              {branchMessages.map((msg, i) => (
                <MessageCard key={`${msg.agent}-${msg.tick}-${i}`} msg={msg} />
              ))}
              {branchRunning && branchMessages.length > 0 && (
                <div className="flex items-center gap-2 px-2 py-1 text-[10px] text-blue-400">
                  <span className="animate-pulse">●</span>
                  <span>Branch running…</span>
                </div>
              )}
              {!branchRunning && hasResults && (
                <div className="py-1 text-center text-[10px] text-green-500 opacity-60">
                  Branch complete — {branchMessages.length} agent outputs
                </div>
              )}
            </div>
          )}

          {!hasResults && !branchRunning && (
            <div className="p-3 text-center text-[10px] text-gray-600">
              Fork the simulation to explore alternative outcomes
            </div>
          )}
        </div>
      )}
    </>
  );
}
