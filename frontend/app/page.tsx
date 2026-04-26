'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useLoading } from '@/lib/loadingState';

const API_BASE = process.env.NEXT_PUBLIC_WS_URL?.replace(/^ws/, 'http') ?? 'http://localhost:4000';

const PRESETS = [
  {
    label: 'Palisades Fire — Jan 2025',
    city: 'Pacific Palisades, Los Angeles, CA',
    datetime: '2025-01-07T08:00',
    lat: '34.0531',
    lng: '-118.5260',
    acres: '50',
    windSpeed: '45',
    windDirection: '45',
    durationHours: '6',
  },
] as const;

const EMBERS = [
  { left: 12, delay: 0.0, duration: 3.8, size: 5, drift: -22, color: '#f97316' },
  { left: 27, delay: 0.6, duration: 4.5, size: 4, drift:  18, color: '#ef4444' },
  { left: 41, delay: 1.1, duration: 3.2, size: 6, drift: -35, color: '#fb923c' },
  { left: 55, delay: 0.3, duration: 5.0, size: 3, drift:  28, color: '#fbbf24' },
  { left: 68, delay: 1.7, duration: 3.6, size: 5, drift: -14, color: '#f97316' },
  { left: 80, delay: 0.9, duration: 4.2, size: 4, drift:  38, color: '#ef4444' },
  { left: 19, delay: 2.1, duration: 3.9, size: 3, drift:  20, color: '#fb923c' },
  { left: 35, delay: 1.4, duration: 4.8, size: 6, drift: -28, color: '#fbbf24' },
  { left: 49, delay: 0.2, duration: 3.5, size: 4, drift:  16, color: '#f97316' },
  { left: 63, delay: 2.5, duration: 4.1, size: 5, drift: -40, color: '#ef4444' },
  { left: 75, delay: 0.7, duration: 3.3, size: 3, drift:  30, color: '#fb923c' },
  { left:  8, delay: 1.9, duration: 5.2, size: 4, drift: -18, color: '#fbbf24' },
  { left: 22, delay: 3.0, duration: 3.7, size: 6, drift:  24, color: '#f97316' },
  { left: 46, delay: 2.3, duration: 4.4, size: 3, drift: -32, color: '#ef4444' },
  { left: 58, delay: 0.5, duration: 3.1, size: 5, drift:  12, color: '#fb923c' },
  { left: 71, delay: 1.6, duration: 4.7, size: 4, drift: -26, color: '#fbbf24' },
  { left: 87, delay: 2.8, duration: 3.4, size: 3, drift:  36, color: '#f97316' },
  { left: 32, delay: 0.4, duration: 4.0, size: 5, drift: -10, color: '#ef4444' },
  { left: 90, delay: 1.2, duration: 5.5, size: 4, drift:  22, color: '#fb923c' },
  { left:  4, delay: 3.3, duration: 3.6, size: 6, drift: -38, color: '#fbbf24' },
];

const SYSTEMS = [
  { label: 'Fire Behavior Analysis',    color: '#e05555' },
  { label: 'Evacuation Coordination',   color: '#5588ee' },
  { label: 'Resource Deployment',       color: '#44bb66' },
  { label: 'Infrastructure Monitoring', color: '#ddbb44' },
  { label: 'Public Communications',     color: '#dd8844' },
  { label: 'Traffic Management',        color: '#ee8822' },
  { label: 'Incident Command (IAP)',     color: '#9966ee' },
];

interface FormState {
  city: string;
  datetime: string;
  lat: string;
  lng: string;
  acres: string;
  windSpeed: string;
  windDirection: string;
  durationHours: string;
  enableTts: boolean;
}

function bearingToCardinal(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

export default function SetupPage() {
  const router = useRouter();
  const { setPhase } = useLoading();
  const [form, setForm] = useState<FormState>({
    city: '',
    datetime: new Date().toISOString().slice(0, 16),
    lat: '',
    lng: '',
    acres: '10',
    windSpeed: '35',
    windDirection: '45',
    durationHours: '6',
    enableTts: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preset, setPreset] = useState('');

  function applyPreset(label: string) {
    const p = PRESETS.find((x) => x.label === label);
    if (!p) return;
    setPreset(label);
    setForm(f => ({
      city: p.city,
      datetime: p.datetime,
      lat: p.lat,
      lng: p.lng,
      acres: p.acres,
      windSpeed: p.windSpeed,
      windDirection: p.windDirection,
      durationHours: p.durationHours,
      enableTts: f.enableTts,
    }));
  }

  function update(key: keyof FormState, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setPreset('');
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.city.trim()) { setError('Location required.'); return; }
    setLoading(true);
    setPhase('setup');
    try {
      const windSpeedMph = Number.parseFloat(form.windSpeed);
      const windFromDeg = Number.parseFloat(form.windDirection);
      // Convert UI (mph + FROM degrees) to U/V components (m/s) for unambiguous backend storage
      const _speedMs = (Number.isFinite(windSpeedMph) ? windSpeedMph : 35) * 0.44704;
      const _rad = (Number.isFinite(windFromDeg) ? windFromDeg : 45) * Math.PI / 180;
      const windU = parseFloat((-_speedMs * Math.sin(_rad)).toFixed(4));
      const windV = parseFloat((-_speedMs * Math.cos(_rad)).toFixed(4));
      const res = await fetch(`${API_BASE}/api/setup-scenario`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          city: form.city.trim(),
          datetime: form.datetime,
          fireLat: parseFloat(form.lat) || null,
          fireLng: parseFloat(form.lng) || null,
          initialAcres: parseFloat(form.acres) || 10,
          windU,
          windV,
          durationHours: parseFloat(form.durationHours) || 6,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Setup failed');

      (window as unknown as Record<string, unknown>).__PYROTECH_GEOJSON_PROMISE__ = fetch(`${API_BASE}/api/geojson-bundle`, { cache: 'no-store' })
        .then(r => r.ok ? r.json() : null)
        .catch(() => null);

      sessionStorage.setItem('pyrotech_scenario', JSON.stringify({ ...data, enableTts: form.enableTts }));
      setPhase('connecting');
      router.push('/dashboard');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setPhase('idle');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="sp-root">
      <div className="sp-scan" aria-hidden="true" />
      {/* Fire glow at bottom */}
      <div aria-hidden="true" style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: '200px',
        background: 'radial-gradient(ellipse 80% 100% at 50% 100%, oklch(40% 0.2 30 / 0.25) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />
      {/* Ember particles */}
      <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        {EMBERS.map((e, i) => (
          <span
            key={i}
            style={{
              position: 'absolute',
              bottom: '-10px',
              left: `${e.left}%`,
              width: `${e.size}px`,
              height: `${e.size}px`,
              borderRadius: '50%',
              background: e.color,
              boxShadow: `0 0 ${e.size * 2}px ${e.color}`,
              animation: `ember-rise ${e.duration}s ease-in ${e.delay}s infinite`,
              ['--drift' as string]: `${e.drift}px`,
            }}
          />
        ))}
      </div>
      <div className="sp-particles" aria-hidden="true">
        {Array.from({ length: 16 }).map((_, i) => (
          <div key={i} className="sp-particle" style={{ '--i': i } as React.CSSProperties} />
        ))}
      </div>

      <main className="sp-main">
        {/* Left: Identity */}
        <div className="sp-left">
          <div className="sp-ics-tag">ICS-PYROTECH-1 · Training Scenario</div>
          <h1 className="sp-title">PYROTECH</h1>
          <p className="sp-desc">
            Multi-agent AI incident command simulation. Configure a U.S. wildfire scenario
            and deploy seven specialized AI systems to model coordinated disaster response
            in real time.
          </p>
          <div className="sp-sys-label">Command Systems</div>
          <ul className="sp-systems" aria-label="Active command systems">
            {SYSTEMS.map(({ label, color }) => (
              <li key={label} className="sp-system">
                <span className="sp-sys-dot" style={{ background: color }} aria-hidden="true" />
                {label}
              </li>
            ))}
          </ul>
        </div>

        {/* Right: Configuration */}
        <div className="sp-right">
          <div className="sp-panel">
            <form onSubmit={handleSubmit} className="sp-form" noValidate>

              <div className="sp-field">
                <span className="sp-fl">Scenario Presets</span>
                <div className="sp-presets">
                  {PRESETS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => applyPreset(p.label)}
                      className={`sp-chip ${preset === p.label ? 'sp-chip--on' : ''}`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <hr className="sp-rule" />

              <div className="sp-field">
                <label className="sp-fl" htmlFor="city">Location</label>
                <input
                  id="city"
                  type="text"
                  className="sp-input"
                  placeholder="City, county, or ZIP — U.S. only"
                  value={form.city}
                  onChange={(e) => update('city', e.target.value)}
                  required
                />
                <span className="sp-hint">Infrastructure fetched via OpenStreetMap</span>
              </div>

              <div className="sp-field">
                <label className="sp-fl" htmlFor="datetime">Simulation Start</label>
                <input
                  id="datetime"
                  type="datetime-local"
                  className="sp-input"
                  value={form.datetime}
                  onChange={(e) => update('datetime', e.target.value)}
                />
              </div>

              <div className="sp-field">
                <span className="sp-fl">
                  Fire Origin <span className="sp-fl-opt">optional</span>
                </span>
                <div className="sp-coord-row">
                  <div className="sp-coord">
                    <label className="sp-sublabel" htmlFor="lat">Latitude</label>
                    <input
                      id="lat"
                      type="number"
                      step="any"
                      className="sp-input"
                      placeholder="34.0531"
                      value={form.lat}
                      onChange={(e) => update('lat', e.target.value)}
                    />
                  </div>
                  <div className="sp-coord">
                    <label className="sp-sublabel" htmlFor="lng">Longitude</label>
                    <input
                      id="lng"
                      type="number"
                      step="any"
                      className="sp-input"
                      placeholder="-118.5260"
                      value={form.lng}
                      onChange={(e) => update('lng', e.target.value)}
                    />
                  </div>
                </div>
                <span className="sp-hint">Defaults to city center if omitted</span>
              </div>

              <div className="sp-field">
                <div className="sp-slider-header">
                  <label className="sp-fl" htmlFor="acres">Initial Fire Size</label>
                  <span className="sp-readout">{form.acres} ac</span>
                </div>
                <input
                  id="acres"
                  type="range"
                  min="1" max="500" step="1"
                  className="sp-slider sp-slider--fire"
                  value={form.acres}
                  onChange={(e) => update('acres', e.target.value)}
                />
                <div className="sp-scale"><span>1 ac</span><span>250 ac</span><span>500 ac</span></div>
              </div>

              <div className="sp-field">
                <div className="sp-slider-header">
                  <label className="sp-fl" htmlFor="windSpeed">Wind Speed</label>
                  <span className="sp-readout">{form.windSpeed} mph</span>
                </div>
                <input
                  id="windSpeed"
                  type="range"
                  min="0" max="80" step="1"
                  className="sp-slider sp-slider--wind"
                  value={form.windSpeed}
                  onChange={(e) => update('windSpeed', e.target.value)}
                />
                <div className="sp-scale"><span>Calm</span><span>40 mph</span><span>80 mph</span></div>
              </div>

              <div className="sp-field">
                <div className="sp-slider-header">
                  <label className="sp-fl" htmlFor="windDir">Wind Direction</label>
                  <div className="sp-bearing">
                    <input
                      type="number"
                      min="0" max="359" step="1"
                      className="sp-bearing-input"
                      value={form.windDirection}
                      onChange={(e) => update('windDirection', e.target.value)}
                    />
                    <span className="sp-bearing-unit">°</span>
                    <span className="sp-cardinal">{bearingToCardinal(Number(form.windDirection))}</span>
                  </div>
                </div>
                <input
                  id="windDir"
                  type="range"
                  min="0" max="359" step="1"
                  className="sp-slider sp-slider--bearing"
                  value={form.windDirection}
                  onChange={(e) => update('windDirection', e.target.value)}
                />
                <span className="sp-hint">0° = N · 90° = E · 180° = S · 270° = W</span>
              </div>

              <div className="sp-field">
                <span className="sp-fl">Duration</span>
                <div className="sp-duration">
                  {(['1', '3', '6', '12'] as const).map((h) => (
                    <button
                      key={h}
                      type="button"
                      onClick={() => update('durationHours', h)}
                      className={`sp-dur ${form.durationHours === h ? 'sp-dur--on' : ''}`}
                    >
                      {h}h
                    </button>
                  ))}
                </div>
                <span className="sp-hint">~30 seconds of real time per simulated hour</span>
              </div>

              <div className="sp-field">
                <label className="sp-tts-row" htmlFor="enableTts">
                  <input
                    id="enableTts"
                    type="checkbox"
                    className="sp-tts-check"
                    checked={form.enableTts}
                    onChange={(e) => setForm(f => ({ ...f, enableTts: e.target.checked }))}
                  />
                  <span className="sp-fl" style={{ margin: 0 }}>Sequential agent voice transmission</span>
                </label>
                <span className="sp-hint">Each agent waits for the previous radio call to finish. Muting is allowed but does not skip the queue.</span>
              </div>

              {error && (
                <div className="sp-error" role="alert">
                  <span className="sp-error-mark" aria-hidden="true">!</span>
                  {error}
                </div>
              )}

              <button
                type="submit"
                className="sp-launch"
                disabled={loading}
                id="launch-simulation-btn"
              >
                {loading ? (
                  <><span className="sp-spinner" aria-hidden="true" /> Fetching infrastructure data</>
                ) : (
                  <><span aria-hidden="true">▶</span> Launch Simulation</>
                )}
              </button>
            </form>
          </div>

          <p className="sp-footer">
            OpenStreetMap · Nominatim · NASA FIRMS · ElevenLabs
          </p>
        </div>
      </main>

      <style>{`
        .sp-root {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--background);
          position: relative;
          overflow: hidden;
          padding: 3rem 1.5rem;
        }

        .sp-scan {
          position: absolute;
          inset: 0;
          pointer-events: none;
          background: repeating-linear-gradient(
            0deg,
            transparent 0,
            transparent 3px,
            oklch(100% 0 0 / 0.007) 3px,
            oklch(100% 0 0 / 0.007) 4px
          );
        }

        .sp-particles { position: absolute; inset: 0; pointer-events: none; }
        .sp-particle {
          position: absolute;
          bottom: -20px;
          left: calc(var(--i) * 6.5%);
          width: 3px;
          height: 3px;
          border-radius: 50%;
          background: var(--accent);
          box-shadow: 0 0 6px var(--accent);
          animation: sp-rise calc(5s + var(--i) * 0.35s) ease-in infinite;
          animation-delay: calc(var(--i) * 0.45s);
          opacity: 0;
        }
        @keyframes sp-rise {
          0%   { transform: translateY(0) scale(1);       opacity: 0.65; }
          80%  { transform: translateY(-80vh) scale(0.3); opacity: 0.12; }
          100% { transform: translateY(-96vh) scale(0);   opacity: 0; }
        }

        .sp-main {
          position: relative;
          z-index: 10;
          width: 100%;
          max-width: 1100px;
          display: grid;
          grid-template-columns: 1fr 500px;
          gap: 5rem;
          align-items: start;
        }

        /* LEFT */
        .sp-left { padding-top: 0.5rem; }

        .sp-ics-tag {
          font-family: var(--font-condensed);
          font-size: 0.62rem;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          color: var(--text-muted);
          margin-bottom: 1.5rem;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .sp-ics-tag::before {
          content: '';
          display: block;
          width: 18px;
          height: 1px;
          background: var(--text-muted);
          flex-shrink: 0;
        }

        .sp-title {
          font-family: var(--font-condensed);
          font-size: clamp(4.5rem, 10vw, 7.5rem);
          font-weight: 800;
          letter-spacing: 0.06em;
          line-height: 0.88;
          margin: 0 0 1.1rem;
          color: var(--accent);
          text-shadow: 0 0 80px oklch(68% 0.18 45 / 0.22);
        }

        .sp-desc {
          font-size: 0.875rem;
          line-height: 1.65;
          color: var(--text-secondary);
          max-width: 340px;
          margin-bottom: 2.5rem;
        }

        .sp-sys-label {
          font-family: var(--font-condensed);
          font-size: 0.6rem;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          color: var(--text-muted);
          margin-bottom: 0.8rem;
        }

        .sp-systems {
          list-style: none;
          padding: 0;
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 7px;
        }

        .sp-system {
          display: flex;
          align-items: center;
          gap: 9px;
          font-family: var(--font-condensed);
          font-size: 0.72rem;
          font-weight: 600;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--text-secondary);
        }

        .sp-sys-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          flex-shrink: 0;
          opacity: 0.85;
        }

        /* RIGHT */
        .sp-right { display: flex; flex-direction: column; gap: 0.6rem; }

        .sp-panel {
          background: var(--surface);
          border: 1px solid var(--border);
          padding: 2.25rem;
        }

        .sp-form { display: flex; flex-direction: column; gap: 1.5rem; }
        .sp-field { display: flex; flex-direction: column; gap: 7px; }
        .sp-rule { border: none; border-top: 1px solid var(--border-subtle); margin: 0.25rem 0; }

        .sp-fl {
          font-family: var(--font-condensed);
          font-size: 0.76rem;
          font-weight: 700;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: oklch(70% 0.006 24);
        }
        .sp-fl-opt {
          font-weight: 400;
          font-size: 0.64rem;
          color: var(--text-muted);
          letter-spacing: 0.08em;
          text-transform: lowercase;
          margin-left: 5px;
        }
        .sp-sublabel { font-size: 0.66rem; letter-spacing: 0.06em; color: var(--text-secondary); }
        .sp-hint { font-size: 0.7rem; color: var(--text-secondary); line-height: 1.4; }
        .sp-tts-row { display: flex; align-items: center; gap: 8px; cursor: pointer; }
        .sp-tts-check { width: 14px; height: 14px; accent-color: var(--accent); flex-shrink: 0; cursor: pointer; }

        .sp-input {
          background: var(--background);
          border: 1px solid var(--border);
          color: var(--text-primary);
          font-family: var(--font-body);
          font-size: 0.9375rem;
          padding: 12px 14px;
          outline: none;
          transition: border-color 0.15s, box-shadow 0.15s;
          color-scheme: dark;
          width: 100%;
          box-sizing: border-box;
          border-radius: 2px;
        }
        .sp-input:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 2px oklch(68% 0.18 45 / 0.2);
        }
        .sp-input::placeholder { color: var(--text-muted); }

        .sp-coord-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .sp-coord { display: flex; flex-direction: column; gap: 4px; }

        .sp-slider-header { display: flex; align-items: baseline; justify-content: space-between; }
        .sp-readout {
          font-family: var(--font-mono);
          font-size: 0.8rem;
          color: var(--accent);
          font-weight: 600;
          letter-spacing: 0.04em;
        }

        .sp-slider {
          width: 100%;
          -webkit-appearance: none;
          height: 4px;
          border-radius: 2px;
          outline: none;
          cursor: pointer;
          margin: 9px 0 3px;
        }
        .sp-slider--fire    { background: var(--accent); }
        .sp-slider--wind    { background: var(--accent-blue); }
        .sp-slider--bearing { background: var(--border-bright); }

        .sp-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          cursor: pointer;
          transition: transform 0.1s;
        }
        .sp-slider--fire::-webkit-slider-thumb    { background: var(--accent);      box-shadow: 0 0 7px var(--accent); }
        .sp-slider--wind::-webkit-slider-thumb    { background: var(--accent-blue); box-shadow: 0 0 7px var(--accent-blue); }
        .sp-slider--bearing::-webkit-slider-thumb { background: var(--text-secondary); }
        .sp-slider::-webkit-slider-thumb:hover { transform: scale(1.3); }

        .sp-scale {
          display: flex;
          justify-content: space-between;
          font-family: var(--font-condensed);
          font-size: 0.62rem;
          color: var(--text-secondary);
          letter-spacing: 0.05em;
        }

        .sp-bearing { display: flex; align-items: center; gap: 4px; }
        .sp-bearing-input {
          background: var(--background);
          border: 1px solid var(--border);
          color: var(--text-primary);
          font-family: var(--font-mono);
          font-size: 0.8rem;
          padding: 5px 8px;
          outline: none;
          width: 58px;
          text-align: right;
          border-radius: 2px;
          color-scheme: dark;
        }
        .sp-bearing-input:focus { border-color: var(--accent); }
        .sp-bearing-unit { font-family: var(--font-mono); font-size: 0.8rem; color: var(--text-secondary); }
        .sp-cardinal {
          font-family: var(--font-condensed);
          font-size: 0.75rem;
          font-weight: 700;
          color: var(--accent-blue);
          letter-spacing: 0.1em;
          min-width: 26px;
          text-align: center;
        }

        .sp-presets { display: flex; flex-wrap: wrap; gap: 6px; }
        .sp-chip {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--text-secondary);
          font-family: var(--font-condensed);
          font-size: 0.72rem;
          font-weight: 600;
          letter-spacing: 0.06em;
          padding: 5px 10px;
          border-radius: 2px;
          cursor: pointer;
          transition: all 0.15s;
        }
        .sp-chip:hover { border-color: oklch(68% 0.18 45 / 0.6); color: var(--accent); }
        .sp-chip--on   { border-color: var(--accent); color: var(--accent); background: oklch(68% 0.18 45 / 0.08); }

        .sp-duration { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
        .sp-dur {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--text-secondary);
          font-family: var(--font-condensed);
          font-size: 0.88rem;
          font-weight: 700;
          letter-spacing: 0.12em;
          padding: 11px 0;
          cursor: pointer;
          transition: all 0.15s;
          border-radius: 2px;
        }
        .sp-dur:hover  { border-color: oklch(68% 0.18 45 / 0.5); color: var(--accent); }
        .sp-dur--on    { border-color: var(--accent); color: var(--accent); background: oklch(68% 0.18 45 / 0.1); }

        .sp-error {
          background: oklch(63% 0.22 27 / 0.08);
          border: 1px solid oklch(63% 0.22 27 / 0.3);
          color: oklch(74% 0.16 28);
          font-size: 0.8rem;
          padding: 9px 12px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .sp-error-mark {
          font-family: var(--font-condensed);
          font-size: 0.9rem;
          font-weight: 800;
          color: var(--accent-red);
          flex-shrink: 0;
        }

        .sp-launch {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          background: var(--accent);
          color: oklch(9% 0.008 24);
          font-family: var(--font-condensed);
          font-size: 0.92rem;
          font-weight: 700;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          border: none;
          padding: 15px;
          cursor: pointer;
          transition: box-shadow 0.18s;
          width: 100%;
          margin-top: 0.25rem;
          border-radius: 2px;
        }
        .sp-launch:hover:not(:disabled) {
          box-shadow: 0 0 0 2px oklch(68% 0.18 45 / 0.5), 0 0 24px oklch(68% 0.18 45 / 0.18);
        }
        .sp-launch:active:not(:disabled) { box-shadow: none; }
        .sp-launch:disabled { opacity: 0.5; cursor: not-allowed; }

        .sp-spinner {
          width: 14px;
          height: 14px;
          border: 2px solid oklch(9% 0.008 24 / 0.35);
          border-top-color: oklch(9% 0.008 24);
          border-radius: 50%;
          animation: sp-spin 0.7s linear infinite;
          display: inline-block;
          flex-shrink: 0;
        }
        @keyframes sp-spin { to { transform: rotate(360deg); } }

        .sp-footer {
          font-family: var(--font-condensed);
          font-size: 0.58rem;
          color: var(--text-muted);
          letter-spacing: 0.12em;
          text-align: center;
        }

        @media (max-width: 740px) {
          .sp-main { grid-template-columns: 1fr; gap: 2.5rem; }
          .sp-left { display: none; }
        }
        @media (max-width: 480px) {
          .sp-root { padding: 2rem 1rem; }
        }
      `}</style>
    </div>
  );
}
