'use client';

import { useState } from 'react';

interface LegendItem {
  type: 'swatch' | 'dot' | 'arc' | 'icon' | 'text' | 'heatmap' | 'trail';
  color?: string;
  borderColor?: string;
  icon?: string;
  label: string;
}

interface LegendGroup {
  title: string;
  items: LegendItem[];
}

const STATIC_LEGEND_GROUPS: LegendGroup[] = [
  {
    title: 'Disaster State',
    items: [
      { type: 'swatch', color: 'rgba(220, 60, 0, 0.47)', borderColor: 'rgba(255, 140, 0, 1)', label: 'Active Fire Perimeter' },
      { type: 'trail', color: 'rgba(255, 190, 80, 0.9)', label: 'Wind / Head Fire Direction' },
      { type: 'dot', color: 'rgba(255, 80, 30, 0.9)', borderColor: 'rgba(255, 255, 255, 0.6)', label: 'Satellite Fire Detection (FIRMS)' },
      { type: 'swatch', color: 'rgba(59, 130, 246, 0.3)', borderColor: 'rgba(34, 197, 94, 0.8)', label: 'Suppression Zone' },
    ],
  },
  {
    title: 'Evacuation Zones',
    items: [
      { type: 'swatch', color: 'rgba(239, 68, 68, 0.47)', borderColor: 'rgba(239, 68, 68, 1)', label: 'Mandatory' },
      { type: 'swatch', color: 'rgba(249, 115, 22, 0.39)', borderColor: 'rgba(249, 115, 22, 1)', label: 'Warning' },
      { type: 'swatch', color: 'rgba(234, 179, 8, 0.31)', borderColor: 'rgba(234, 179, 8, 1)', label: 'Voluntary' },
    ],
  },
  {
    title: 'Traffic & Roads',
    items: [
      { type: 'swatch', color: 'rgba(60, 70, 85, 120)', borderColor: 'rgba(60, 70, 85, 180)', label: 'Highway — Open' },
      { type: 'swatch', color: 'rgba(150, 100, 20, 180)', borderColor: 'rgba(180, 80, 20, 200)', label: 'Highway — Congested' },
      { type: 'swatch', color: 'rgba(239, 68, 68, 0.85)', borderColor: 'rgba(239, 68, 68, 1)', label: 'Highway — Closed' },
      { type: 'trail', color: 'rgba(96, 250, 180, 1)', label: 'Traffic — Flowing' },
      { type: 'trail', color: 'rgba(250, 204, 21, 1)', label: 'Traffic — Slowed' },
      { type: 'trail', color: 'rgba(249, 115, 22, 1)', label: 'Traffic — Rerouting' },
    ],
  },
  {
    title: 'Facilities & Demographics',
    items: [
      { type: 'text', icon: 'H', color: '#3b82f6', label: 'Hospital' },
      { type: 'text', icon: 'FS', color: '#eab308', label: 'Fire Station' },
      { type: 'text', icon: 'SHL', color: '#22c55e', label: 'Shelter — Open/Active' },
      { type: 'text', icon: 'SHL', color: '#f97316', label: 'Shelter — Full' },
      { type: 'text', icon: '🚒', color: '#ef4444', label: 'Engine Dispatch' },
      { type: 'text', icon: 'DZR', color: '#facc15', label: 'Dozer Dispatch' },
      { type: 'heatmap', color: 'linear-gradient(90deg, rgba(96,165,250,0.4) 0%, rgba(255,216,92,0.8) 50%, rgba(239,68,68,1) 100%)', label: 'Population Density' },
    ],
  },
  {
    title: 'Facility Status',
    items: [
      { type: 'dot', color: 'rgba(239, 68, 68, 1)', borderColor: 'rgba(255, 140, 0, 1)', label: 'Burning / Impacted' },
      { type: 'dot', color: 'rgba(245, 158, 11, 1)', borderColor: 'rgba(255, 255, 255, 0.8)', label: 'At Risk' },
      { type: 'dot', color: 'rgba(156, 163, 175, 1)', borderColor: 'rgba(255, 255, 255, 0.8)', label: 'Offline / Disabled' },
      { type: 'dot', color: 'rgba(59, 130, 246, 1)', borderColor: 'rgba(34, 197, 94, 1)', label: 'Contained / Recovered' },
      { type: 'dot', color: 'rgba(255, 255, 255, 0.5)', borderColor: 'rgba(255, 255, 255, 1)', label: 'Recent Agent Action' },
    ],
  },
];

export default function MapLegend() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div
      style={{
        position: 'absolute',
        bottom: '1.5rem',
        left: '1rem',
        zIndex: 20,
        display: 'flex',
        flexDirection: 'column',
        gap: '0',
        pointerEvents: 'auto',
      }}
    >
      <button
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
        aria-label="Toggle map legend"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem',
          padding: '0.35rem 0.65rem',
          background: 'rgba(10, 10, 20, 0.82)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: collapsed ? '8px' : '8px 8px 0 0',
          cursor: 'pointer',
          color: '#e2e8f0',
          fontSize: '0.7rem',
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          transition: 'background 0.2s',
        }}
      >
        <span style={{ fontSize: '0.85rem' }}>🗺</span>
        <span>Legend</span>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: '0.75rem',
            opacity: 0.6,
            transform: collapsed ? 'rotate(0deg)' : 'rotate(180deg)',
            transition: 'transform 0.25s',
            display: 'inline-block',
          }}
        >
          ▲
        </span>
      </button>

      {!collapsed && (
        <div
          style={{
            background: 'rgba(10, 10, 20, 0.82)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderTop: 'none',
            borderRadius: '0 0 8px 8px',
            padding: '0.55rem 0.75rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.6rem',
            minWidth: '205px',
            maxHeight: '400px',
            overflowY: 'auto'
          }}
        >
          {STATIC_LEGEND_GROUPS.map((group) => (
            <div key={group.title}>
              <div style={{ fontSize: '0.65rem', color: '#94a3b8', marginBottom: '0.3rem', textTransform: 'uppercase', fontWeight: 600 }}>
                {group.title}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                {group.items.map((item) => (
                  <LegendRow key={item.label} item={item} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LegendRow({ item }: { item: LegendItem }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.55rem',
      }}
    >
      <Symbol item={item} />
      <span
        style={{
          fontSize: '0.72rem',
          color: '#cbd5e1',
          lineHeight: 1.3,
          whiteSpace: 'nowrap',
        }}
      >
        {item.label}
      </span>
    </div>
  );
}

function Symbol({ item }: { item: LegendItem }) {
  const SIZE = 14;

  if (item.type === 'text') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: SIZE + 4, flexShrink: 0 }}>
        <span
          style={{
            fontSize: '0.6rem',
            fontWeight: 700,
            fontFamily: 'monospace',
            color: item.color,
            border: `1px solid ${item.color}`,
            borderRadius: '3px',
            padding: '0 2px',
            background: 'rgba(0,0,0,0.3)',
          }}
        >
          {item.icon}
        </span>
      </div>
    );
  }

  if (item.type === 'icon') {
    return (
      <span
        style={{ fontSize: '0.9rem', width: SIZE + 4, textAlign: 'center', flexShrink: 0 }}
      >
        {item.icon}
      </span>
    );
  }

  if (item.type === 'dot') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: SIZE + 4, flexShrink: 0 }}>
        <span
          style={{
            display: 'inline-block',
            width: SIZE,
            height: SIZE,
            borderRadius: '50%',
            background: item.color,
            border: `1.5px solid ${item.borderColor ?? 'transparent'}`,
          }}
        />
      </div>
    );
  }

  if (item.type === 'arc') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: SIZE + 4, flexShrink: 0 }}>
        <svg
          width={SIZE + 2}
          height={SIZE}
          viewBox="0 0 18 16"
          fill="none"
        >
          <path
            d="M2 14 Q9 0 16 14"
            stroke={item.color ?? '#facc15'}
            strokeWidth="2.5"
            strokeLinecap="round"
            fill="none"
            opacity="0.9"
          />
        </svg>
      </div>
    );
  }
  
  if (item.type === 'heatmap') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: SIZE + 4, flexShrink: 0 }}>
        <span
          style={{
            display: 'inline-block',
            width: SIZE + 2,
            height: SIZE - 2,
            borderRadius: '2px',
            background: item.color,
          }}
        />
      </div>
    );
  }

  if (item.type === 'trail') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: SIZE + 4, flexShrink: 0 }}>
        <span
          style={{
            display: 'inline-block',
            width: SIZE + 2,
            height: '3px',
            borderRadius: '1px',
            background: item.color,
            boxShadow: `0 0 4px ${item.color}`,
          }}
        />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: SIZE + 4, flexShrink: 0 }}>
      <span
        style={{
          display: 'inline-block',
          width: SIZE + 2,
          height: SIZE - 2,
          borderRadius: '2px',
          background: item.color,
          border: `1.5px solid ${item.borderColor ?? 'transparent'}`,
        }}
      />
    </div>
  );
}
