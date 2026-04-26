'use client';

import { useCallback, useEffect } from 'react';
import type { PlaybookData, PlaybookSection } from '@/lib/types';
import { AGENT_CONFIG } from '@/lib/types';
import type { AgentName } from '@/lib/types';

interface PlaybookViewerProps {
  playbook: PlaybookData | null;
  onClose: () => void;
}

const AGENT_TOKEN: Record<string, string> = {
  disaster: 'var(--accent-red)',
  evacuation: 'var(--accent-blue)',
  resource: 'var(--accent-green)',
  infrastructure: 'var(--accent-yellow)',
  communications: 'var(--accent-orange)',
  synthesis: 'var(--accent-purple)',
  traffic: 'var(--accent-orange)',
};

function getTimecode(section: PlaybookSection): string {
  if (section.time_elapsed) return `T+${section.time_elapsed.toUpperCase()}`;
  const hoursValue = section.elapsed_hours ?? section.tick;
  if (hoursValue == null) return 'T+00:00';
  const totalMinutes = Math.round(hoursValue * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `T+${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function inferDurationHours(playbook: PlaybookData): number {
  if (playbook.duration_hours != null) return playbook.duration_hours;
  let max = 0;
  for (const s of playbook.sections) {
    const v = s.elapsed_hours ?? s.tick ?? 0;
    if (v > max) max = v;
  }
  return max;
}

function formatDuration(hours: number): string {
  const totalMinutes = Math.max(0, Math.round(hours * 60));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function formatGenerated(raw: string): string {
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function PanelButton({
  label,
  onClick,
  variant = 'neutral',
}: {
  label: string;
  onClick: () => void;
  variant?: 'neutral' | 'command';
}) {
  const color = variant === 'command' ? 'var(--accent-purple)' : 'var(--text-secondary)';
  return (
    <button
      onClick={onClick}
      style={{
        height: '30px',
        border: '1px solid var(--border)',
        borderRadius: '2px',
        padding: '0 14px',
        background: 'transparent',
        color,
        fontFamily: 'var(--font-condensed)',
        fontSize: '0.72rem',
        fontWeight: 600,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        cursor: 'pointer',
        transition: 'background 0.15s ease, border-color 0.15s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--surface-raised)';
        e.currentTarget.style.borderColor = 'var(--border-bright)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.borderColor = 'var(--border)';
      }}
    >
      {label}
    </button>
  );
}

function MetaField({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <span
        style={{
          fontFamily: 'var(--font-condensed)',
          fontSize: '0.54rem',
          fontWeight: 600,
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.78rem',
          fontWeight: 600,
          letterSpacing: '0.04em',
          color: 'var(--text-primary)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </span>
    </div>
  );
}

function CallsignRow({
  color,
  callsign,
  timecode,
}: {
  color: string;
  callsign: string;
  timecode: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      <span
        style={{
          fontFamily: 'var(--font-condensed)',
          fontSize: '0.7rem',
          fontWeight: 700,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color,
          flexShrink: 0,
        }}
      >
        {callsign}
      </span>
      <span
        aria-hidden
        style={{
          flex: 1,
          height: '1px',
          background: color,
          opacity: 0.18,
        }}
      />
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.7rem',
          fontWeight: 600,
          letterSpacing: '0.04em',
          color: 'var(--text-secondary)',
          flexShrink: 0,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {timecode}
      </span>
    </div>
  );
}

export default function PlaybookViewer({ playbook, onClose }: PlaybookViewerProps) {
  const handleDownloadPdf = useCallback(async () => {
    if (!playbook) return;

    const pdfMake = await import('pdfmake/build/pdfmake');
    const pdfFonts = await import('pdfmake/build/vfs_fonts');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfMakeInstance = (pdfMake as any).default || pdfMake;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fonts = pdfFonts as any;
    if (fonts.default?.pdfMake?.vfs) {
      pdfMakeInstance.vfs = fonts.default.pdfMake.vfs;
    } else if (fonts.pdfMake?.vfs) {
      pdfMakeInstance.vfs = fonts.pdfMake.vfs;
    }

    const docDefinition = {
      pageSize: 'A4' as const,
      pageMargins: [40, 60, 40, 60] as [number, number, number, number],
      content: [
        {
          text: playbook.title,
          style: 'header',
          margin: [0, 0, 0, 10] as [number, number, number, number],
        },
        {
          text: playbook.scenario,
          style: 'subheader',
          margin: [0, 0, 0, 20] as [number, number, number, number],
        },
        {
          text: `Generated: ${playbook.generated_at}`,
          style: 'meta',
          margin: [0, 0, 0, 30] as [number, number, number, number],
        },
        ...playbook.sections.flatMap((section) => [
          {
            text: section.title,
            style: 'sectionHeader',
            margin: [0, 15, 0, 5] as [number, number, number, number],
          },
          {
            text: `Agent: ${section.agent} | Time Elapsed: ${section.time_elapsed ?? `${section.tick ?? 0}h`}`,
            style: 'meta',
            margin: [0, 0, 0, 5] as [number, number, number, number],
          },
          {
            text: section.content,
            style: 'body',
            margin: [0, 0, 0, 10] as [number, number, number, number],
          },
        ]),
        {
          text: 'Summary',
          style: 'sectionHeader',
          margin: [0, 20, 0, 5] as [number, number, number, number],
        },
        {
          text: playbook.summary,
          style: 'body',
        },
      ],
      styles: {
        header: { fontSize: 22, bold: true, color: '#ff4444' },
        subheader: { fontSize: 14, color: '#666666' },
        meta: { fontSize: 9, color: '#999999', italics: true },
        sectionHeader: { fontSize: 14, bold: true, color: '#333333' },
        body: { fontSize: 11, lineHeight: 1.4 },
      },
    };

    pdfMakeInstance.createPdf(docDefinition).download('pyrotech-playbook.pdf');
  }, [playbook]);

  useEffect(() => {
    if (!playbook) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playbook, onClose]);

  if (!playbook) return null;

  const generatedDisplay = formatGenerated(playbook.generated_at);
  const durationDisplay = formatDuration(inferDurationHours(playbook));
  const sectionsDisplay = String(playbook.sections.length).padStart(2, '0');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Incident Action Plan"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        background: 'oklch(4% 0.005 24 / 0.78)',
        animation: 'iap-overlay-in 180ms cubic-bezier(0.22, 1, 0.36, 1)',
      }}
    >
      <style>{`
        @keyframes iap-overlay-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes iap-document-in {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          maxWidth: '820px',
          maxHeight: '88vh',
          background: 'var(--surface)',
          border: '1px solid var(--border-bright)',
          borderRadius: '2px',
          animation: 'iap-document-in 220ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        <div style={{ height: '2px', background: 'var(--accent)' }} />

        <header
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '24px',
            padding: '18px 24px 16px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontFamily: 'var(--font-condensed)',
                fontSize: '0.56rem',
                fontWeight: 600,
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                color: 'var(--text-muted)',
              }}
            >
              Incident Action Plan
            </div>
            <h2
              style={{
                margin: '6px 0 0',
                fontFamily: 'var(--font-condensed)',
                fontSize: '1.05rem',
                fontWeight: 700,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'var(--text-primary)',
                lineHeight: 1.1,
              }}
            >
              {playbook.title}
            </h2>
            <p
              style={{
                margin: '8px 0 0',
                fontFamily: 'var(--font-body)',
                fontSize: '0.78rem',
                lineHeight: 1.55,
                color: 'var(--text-secondary)',
                maxWidth: '60ch',
              }}
            >
              {playbook.scenario}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
            <PanelButton label="Export PDF" onClick={handleDownloadPdf} variant="command" />
            <PanelButton label="Close" onClick={onClose} />
          </div>
        </header>

        <div
          style={{
            display: 'flex',
            gap: '36px',
            padding: '12px 24px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--background)',
          }}
        >
          <MetaField label="Generated" value={generatedDisplay} />
          <MetaField label="Duration" value={durationDisplay} />
          <MetaField label="Sections" value={sectionsDisplay} />
        </div>

        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '4px 24px 24px',
          }}
        >
          {playbook.sections.map((section, i) => {
            const agentKey = section.agent as AgentName;
            const config = AGENT_CONFIG[agentKey];
            const tokenColor = AGENT_TOKEN[section.agent] ?? 'var(--text-muted)';
            const callsign = (config?.label ?? section.agent).toUpperCase();
            return (
              <article
                key={i}
                style={{
                  paddingTop: '20px',
                  paddingBottom: '22px',
                  borderBottom:
                    i === playbook.sections.length - 1
                      ? 'none'
                      : '1px solid var(--border-subtle)',
                }}
              >
                <CallsignRow color={tokenColor} callsign={callsign} timecode={getTimecode(section)} />
                <h3
                  style={{
                    margin: '12px 0 10px',
                    fontFamily: 'var(--font-condensed)',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: 'var(--text-primary)',
                  }}
                >
                  {section.title}
                </h3>
                <p
                  style={{
                    margin: 0,
                    fontFamily: 'var(--font-body)',
                    fontSize: '0.86rem',
                    lineHeight: 1.65,
                    color: 'var(--text-primary)',
                    maxWidth: '70ch',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {section.content}
                </p>
              </article>
            );
          })}

          <article
            style={{
              marginTop: '6px',
              paddingTop: '24px',
              paddingBottom: '6px',
              borderTop: '1px solid var(--border)',
            }}
          >
            <CallsignRow
              color="var(--accent-purple)"
              callsign="Incident Command"
              timecode="Consolidated"
            />
            <p
              style={{
                margin: '14px 0 0',
                fontFamily: 'var(--font-body)',
                fontSize: '0.86rem',
                lineHeight: 1.65,
                color: 'var(--text-primary)',
                maxWidth: '70ch',
                whiteSpace: 'pre-wrap',
              }}
            >
              {playbook.summary}
            </p>
          </article>
        </div>
      </div>
    </div>
  );
}
