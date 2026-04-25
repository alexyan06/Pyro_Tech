'use client';

import { useEffect, useRef } from 'react';
import { sanitizeAgentText } from '@/lib/agentText';
import type { AgentName } from '@/lib/types';
import { AGENT_CONFIG } from '@/lib/types';

interface AgentFeedProps {
  timeline: Array<{ agent: AgentName; text: string }>;
  currentAgent: AgentName | null;
  currentText: string;
}

export default function AgentFeed({
  timeline,
  currentAgent,
  currentText,
}: AgentFeedProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Append in-progress streaming message at the end
  const allMessages = [
    ...timeline,
    ...(currentAgent && currentText ? [{ agent: currentAgent, text: currentText, isStreaming: true }] : []),
  ];

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [allMessages.length, currentText]);

  return (
    <div
      ref={scrollRef}
      className="flex h-full flex-col gap-3 overflow-y-auto p-4"
      style={{ background: 'var(--panel-bg)' }}
    >
      <div className="mb-2 text-xs italic text-gray-500">
        Agent decisions update the map in real time.
      </div>

      {allMessages.length === 0 && (
        <div className="flex h-full items-center justify-center text-gray-600">
          <p className="text-sm">Agent feed will appear here during simulation...</p>
        </div>
      )}

      {allMessages.map((msg, i) => {
        const isStreaming = 'isStreaming' in msg && msg.isStreaming;
        const config      = AGENT_CONFIG[msg.agent];
        const isSecondary = msg.agent === 'infrastructure' || msg.agent === 'communications';

        return (
          <div
            key={`${msg.agent}-${i}`}
            className="rounded-lg border px-3 py-2"
            style={{ 
              borderColor: config.color + '33', 
              background: config.color + '0a',
              opacity: isSecondary ? 0.7 : 1,
            }}
          >
            {/* Header row */}
            <div className="mb-1 flex items-center gap-2">
              <span className="text-sm">{config.emoji}</span>
              <span
                className="text-xs font-semibold uppercase tracking-wider"
                style={{ color: config.color }}
              >
                {config.label}
              </span>
              {isSecondary && (
                <span className="text-[10px] text-gray-500 ml-1 uppercase">(Support)</span>
              )}
              {isStreaming && (
                <span className="ml-auto text-xs text-gray-600 animate-pulse">
                  streaming…
                </span>
              )}
            </div>

            {/* Message body — all JSON fences stripped */}
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed" style={{ color: isSecondary ? '#9ca3af' : '#d1d5db' }}>
              {sanitizeAgentText(msg.text)}
              {isStreaming && (
                <span className="animate-pulse-glow ml-0.5 text-white">|</span>
              )}
            </p>
          </div>
        );
      })}
    </div>
  );
}
