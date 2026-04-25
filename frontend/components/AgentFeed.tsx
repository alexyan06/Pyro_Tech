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

export default function AgentFeed({ timeline, currentAgent, currentText }: AgentFeedProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

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
      style={{
        height: '100%',
        overflowY: 'auto',
        padding: '1.25rem 1rem',
        background: 'var(--panel-bg)',
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
      }}
    >
      {allMessages.length === 0 && (
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <p style={{
            fontFamily: 'var(--font-condensed)',
            fontSize: '0.72rem',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
          }}>
            Awaiting agent transmissions
          </p>
        </div>
      )}

      {allMessages.map((msg, i) => {
        const isStreaming = 'isStreaming' in msg && msg.isStreaming;
        const config = AGENT_CONFIG[msg.agent];
        const isSecondary = msg.agent === 'infrastructure' || msg.agent === 'communications';

        return (
          <div
            key={`${msg.agent}-${i}`}
            style={{
              paddingTop: i === 0 ? 0 : '1.1rem',
              paddingBottom: '1.1rem',
              borderBottom: i < allMessages.length - 1
                ? '1px solid var(--border-subtle)'
                : 'none',
              opacity: isSecondary ? 0.72 : 1,
            }}
          >
            {/* Callsign row */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '0.45rem',
            }}>
              <span style={{
                fontFamily: 'var(--font-condensed)',
                fontSize: '0.7rem',
                fontWeight: 700,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: config.color,
                flexShrink: 0,
              }}>
                {config.label}
              </span>
              {isSecondary && (
                <span style={{
                  fontFamily: 'var(--font-condensed)',
                  fontSize: '0.58rem',
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: 'var(--text-muted)',
                }}>
                  Support
                </span>
              )}
              <div style={{
                flex: 1,
                height: '1px',
                background: config.color,
                opacity: 0.15,
              }} />
              {isStreaming && (
                <span style={{
                  fontFamily: 'var(--font-condensed)',
                  fontSize: '0.58rem',
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: 'var(--text-muted)',
                  flexShrink: 0,
                  animation: 'pulse-glow 1.5s ease-in-out infinite',
                }}>
                  Transmitting
                </span>
              )}
            </div>

            {/* Message body */}
            <p style={{
              margin: 0,
              fontSize: '0.84rem',
              lineHeight: 1.65,
              color: isSecondary ? 'var(--text-secondary)' : 'var(--text-primary)',
              whiteSpace: 'pre-wrap',
            }}>
              {sanitizeAgentText(msg.text)}
              {isStreaming && (
                <span style={{
                  display: 'inline-block',
                  width: '7px',
                  height: '1em',
                  background: 'var(--text-secondary)',
                  marginLeft: '2px',
                  verticalAlign: 'text-bottom',
                  animation: 'cursor-blink 1s step-end infinite',
                }} />
              )}
            </p>
          </div>
        );
      })}
    </div>
  );
}
