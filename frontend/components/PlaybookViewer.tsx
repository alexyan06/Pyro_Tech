'use client';

import { useCallback } from 'react';
import type { PlaybookData } from '@/lib/types';
import { AGENT_CONFIG } from '@/lib/types';
import type { AgentName } from '@/lib/types';

interface PlaybookViewerProps {
  playbook: PlaybookData | null;
  onClose: () => void;
}

function getTimeElapsedLabel(section: { time_elapsed?: string; tick?: number }) {
  return section.time_elapsed ?? (section.tick != null ? `${section.tick}h` : '0m');
}

export default function PlaybookViewer({
  playbook,
  onClose,
}: PlaybookViewerProps) {
  const handleDownloadPdf = useCallback(async () => {
    if (!playbook) return;

    // Dynamic import pdfmake for client-side only
    const pdfMake = await import('pdfmake/build/pdfmake');
    const pdfFonts = await import('pdfmake/build/vfs_fonts');

    // Assign virtual file system
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
            text: `Agent: ${section.agent} | Time Elapsed: ${getTimeElapsedLabel(section)}`,
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

    pdfMakeInstance.createPdf(docDefinition).download('ember-playbook.pdf');
  }, [playbook]);

  if (!playbook) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div
        className="relative flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl border"
        style={{
          borderColor: 'var(--border)',
          background: 'var(--panel-bg)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between border-b px-6 py-4"
          style={{ borderColor: 'var(--border)' }}
        >
          <div>
            <h2 className="text-xl font-bold text-white">{playbook.title}</h2>
            <p className="mt-1 text-sm text-gray-500">{playbook.scenario}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleDownloadPdf}
              className="rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors"
              style={{
                background: 'linear-gradient(135deg, #aa66ff, #4488ff)',
              }}
            >
              Download PDF
            </button>
            <button
              onClick={onClose}
              className="rounded-lg border px-4 py-2 text-sm text-gray-400 transition-colors hover:bg-gray-800"
              style={{ borderColor: 'var(--border)' }}
            >
              Close
            </button>
          </div>
        </div>

        {/* Sections */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {playbook.sections.map((section, i) => {
            const agentKey = section.agent as AgentName;
            const config = AGENT_CONFIG[agentKey];
            return (
              <div
                key={i}
                className="mb-4 rounded-lg border p-4"
                style={{
                  borderColor: config ? config.color + '33' : 'var(--border)',
                  background: config ? config.color + '08' : 'transparent',
                }}
              >
                <div className="mb-2 flex items-center gap-2">
                  {config && (
                    <span className="text-sm">{config.emoji}</span>
                  )}
                  <h3
                    className="text-sm font-semibold"
                    style={{ color: config?.color || 'var(--foreground)' }}
                  >
                    {section.title}
                  </h3>
                  <span className="ml-auto text-xs text-gray-600">
                    Time Elapsed: {getTimeElapsedLabel(section)}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-300">
                  {section.content}
                </p>
              </div>
            );
          })}

          {/* Summary */}
          <div
            className="mt-6 rounded-lg border p-4"
            style={{ borderColor: 'var(--accent-purple)' + '33' }}
          >
            <h3
              className="mb-2 text-sm font-semibold"
              style={{ color: 'var(--accent-purple)' }}
            >
              Summary
            </h3>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-300">
              {playbook.summary}
            </p>
          </div>

          <p className="mt-4 text-xs text-gray-600">
            Generated: {playbook.generated_at}
          </p>
        </div>
      </div>
    </div>
  );
}
