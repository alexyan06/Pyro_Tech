'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';

const API_BASE = process.env.NEXT_PUBLIC_WS_URL?.replace(/^ws/, 'http') ?? 'http://localhost:4000';

const PRESETS = [
  {
    label: 'Los Angeles — Palisades Fire',
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

interface FormState {
  city: string;
  datetime: string;
  lat: string;
  lng: string;
  acres: string;
  windSpeed: string;
  windDirection: string;
  durationHours: string;
}

export default function SetupPage() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>({
    city: '',
    datetime: new Date().toISOString().slice(0, 16),
    lat: '',
    lng: '',
    acres: '10',
    windSpeed: '35',
    windDirection: '45',
    durationHours: '6',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preset, setPreset] = useState('');

  function applyPreset(label: string) {
    const p = PRESETS.find((x) => x.label === label);
    if (!p) return;
    setPreset(label);
    setForm({
      city: p.city,
      datetime: p.datetime,
      lat: p.lat,
      lng: p.lng,
      acres: p.acres,
      windSpeed: p.windSpeed,
      windDirection: p.windDirection,
      durationHours: p.durationHours,
    });
  }

  function update(key: keyof FormState, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setPreset('');
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.city.trim()) { setError('Please enter a city or zip code.'); return; }
    setLoading(true);
    try {
      const windSpeed = Number.parseFloat(form.windSpeed);
      const windDirection = Number.parseFloat(form.windDirection);
      const res = await fetch(`${API_BASE}/api/setup-scenario`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          city: form.city.trim(),
          datetime: form.datetime,
          fireLat: parseFloat(form.lat) || null,
          fireLng: parseFloat(form.lng) || null,
          initialAcres: parseFloat(form.acres) || 10,
          windSpeed: Number.isFinite(windSpeed) ? windSpeed : 35,
          windDirection: Number.isFinite(windDirection) ? windDirection : 45,
          durationHours: parseFloat(form.durationHours) || 6,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Setup failed');

      // PRE-FETCH: Start loading the map data immediately while the user is redirecting.
      // This will be stored as a Promise in the window object to be ready for the dashboard.
      (window as unknown as Record<string, unknown>).__EMBER_GEOJSON_PROMISE__ = fetch(`${API_BASE}/api/geojson-bundle`, { cache: 'no-store' })
        .then(res => res.ok ? res.json() : null)
        .catch(() => null);

      sessionStorage.setItem('ember_scenario', JSON.stringify(data));
      router.push('/dashboard');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="setup-root">
      <div className="setup-grid" />
      <div className="particles">
        {Array.from({ length: 20 }).map((_, i) => (
          <div key={i} className="particle" style={{ '--i': i } as React.CSSProperties} />
        ))}
      </div>

      <main className="setup-main">
        <div className="setup-hero">
          <div className="ember-badge"><span className="ember-badge-dot" />WILDFIRE SIMULATION PLATFORM</div>
          <h1 className="setup-title"><span className="title-ember">EMBER</span></h1>
          <p className="setup-subtitle">
            Configure your simulation scenario. Select a US location, set fire parameters,
            and deploy our multi-agent AI to model disaster response in real time.
          </p>
        </div>

        <div className="setup-card">
          <form onSubmit={handleSubmit} className="setup-form" noValidate>

            <div className="form-section">
              <label className="form-label">Quick Presets</label>
              <div className="preset-row">
                {PRESETS.map((p) => (
                  <button key={p.label} type="button"
                    onClick={() => applyPreset(p.label)}
                    className={`preset-chip ${preset === p.label ? 'preset-chip--active' : ''}`}>
                    🔥 {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="form-divider" />

            <div className="form-section">
              <label className="form-label" htmlFor="city">📍 City or Zip Code</label>
              <input id="city" type="text" className="form-input"
                placeholder="e.g. Pacific Palisades, CA or 90272"
                value={form.city} onChange={(e) => update('city', e.target.value)} required />
              <span className="form-hint">Used to fetch infrastructure data via OpenStreetMap</span>
            </div>

            <div className="form-section">
              <label className="form-label" htmlFor="datetime">🕐 Simulation Start Date &amp; Time</label>
              <input id="datetime" type="datetime-local" className="form-input"
                value={form.datetime} onChange={(e) => update('datetime', e.target.value)} />
            </div>

            <div className="form-section">
              <label className="form-label">🔥 Fire Origin (optional)</label>
              <div className="coord-row">
                <div className="coord-field">
                  <label className="coord-label" htmlFor="lat">Latitude</label>
                  <input id="lat" type="number" step="any" className="form-input"
                    placeholder="e.g. 34.0531" value={form.lat} onChange={(e) => update('lat', e.target.value)} />
                </div>
                <div className="coord-field">
                  <label className="coord-label" htmlFor="lng">Longitude</label>
                  <input id="lng" type="number" step="any" className="form-input"
                    placeholder="e.g. -118.5260" value={form.lng} onChange={(e) => update('lng', e.target.value)} />
                </div>
              </div>
              <span className="form-hint">Leave blank to use the center of the selected city</span>
            </div>

            <div className="form-section">
              <label className="form-label" htmlFor="acres">📐 Initial Fire Size (Acres)</label>
              <div className="acres-row">
                <input id="acres" type="range" min="1" max="500" step="1" className="acres-slider"
                  value={form.acres} onChange={(e) => update('acres', e.target.value)} />
                <span className="acres-value">{form.acres} ac</span>
              </div>
            </div>

            <div className="form-section">
              <label className="form-label" htmlFor="windSpeed">💨 Wind Speed</label>
              <div className="acres-row">
                <input id="windSpeed" type="range" min="0" max="80" step="1" className="wind-slider"
                  value={form.windSpeed} onChange={(e) => update('windSpeed', e.target.value)} />
                <span className="acres-value">{form.windSpeed} mph</span>
              </div>
              <span className="form-hint">Higher wind stretches the fire head and increases spot fire risk.</span>
            </div>

            <div className="form-section">
              <label className="form-label" htmlFor="windDirection">🧭 Wind Direction</label>
              <div className="wind-degree-row">
                <input id="windDirection" type="range" min="0" max="359" step="1" className="wind-slider"
                  value={form.windDirection} onChange={(e) => update('windDirection', e.target.value)} />
                <input type="number" min="0" max="359" step="1" className="wind-degree-input"
                  value={form.windDirection} onChange={(e) => update('windDirection', e.target.value)} />
                <span className="wind-degree-unit">°</span>
              </div>
              <span className="form-hint">Direction the wind is pushing the fire toward, in degrees: 0=N, 90=E, 180=S, 270=W.</span>
            </div>

            <div className="form-section">
              <label className="form-label">⏱ Simulation Duration</label>
              <div className="duration-row">
                {['1', '3', '6', '12'].map((hours) => (
                  <button
                    key={hours}
                    type="button"
                    onClick={() => update('durationHours', hours)}
                    className={`duration-option ${form.durationHours === hours ? 'duration-option--active' : ''}`}
                  >
                    {hours} hr
                  </button>
                ))}
              </div>
              <span className="form-hint">Each simulated hour runs in about 30 seconds.</span>
            </div>

            {error && <div className="form-error" role="alert">⚠ {error}</div>}

            <button type="submit" className="submit-btn" disabled={loading} id="launch-simulation-btn">
              {loading
                ? <><span className="spinner" />Fetching infrastructure data...</>
                : <><span className="btn-icon">▶</span>Launch Simulation</>}
            </button>
          </form>
        </div>

        <p className="setup-footer">
          Powered by OpenStreetMap · Nominatim · NASA FIRMS · ElevenLabs AI Voices
        </p>
      </main>

      <style>{`
        .setup-root{min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--background);position:relative;overflow:hidden;padding:2rem 1rem;}
        .setup-grid{position:absolute;inset:0;background-image:radial-gradient(circle,#ffffff0a 1px,transparent 1px);background-size:32px 32px;pointer-events:none;}
        .particles{position:absolute;inset:0;pointer-events:none;}
        .particle{position:absolute;bottom:-20px;left:calc(var(--i)*5.2%);width:4px;height:4px;border-radius:50%;background:#ff4444;box-shadow:0 0 8px #ff4444,0 0 16px #ff8844;animation:rise calc(4s + var(--i)*0.3s) ease-in infinite;animation-delay:calc(var(--i)*0.4s);opacity:0;}
        @keyframes rise{0%{transform:translateY(0) scale(1);opacity:.9;}80%{transform:translateY(-80vh) scale(.4);opacity:.3;}100%{transform:translateY(-95vh) scale(0);opacity:0;}}
        .setup-main{position:relative;z-index:10;width:100%;max-width:580px;display:flex;flex-direction:column;align-items:center;gap:2rem;}
        .setup-hero{text-align:center;}
        .ember-badge{display:inline-flex;align-items:center;gap:6px;border:1px solid #ff444440;background:#ff44440d;color:#ff6666;font-size:.65rem;letter-spacing:.18em;text-transform:uppercase;padding:4px 12px;border-radius:999px;margin-bottom:1.2rem;}
        .ember-badge-dot{width:6px;height:6px;border-radius:50%;background:#ff4444;box-shadow:0 0 6px #ff4444;animation:blink 1.5s ease-in-out infinite;}
        @keyframes blink{0%,100%{opacity:1;}50%{opacity:.3;}}
        .setup-title{font-size:clamp(3rem,10vw,5.5rem);font-weight:900;letter-spacing:.08em;margin:0 0 .6rem;line-height:1;}
        .title-ember{background:linear-gradient(135deg,#ff4444 0%,#ff8844 50%,#ffcc00 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;filter:drop-shadow(0 0 30px #ff444480);}
        .setup-subtitle{color:#9ca3af;font-size:.9rem;line-height:1.6;max-width:440px;margin:0 auto;}
        .setup-card{width:100%;background:#111111ee;border:1px solid #2a2a2a;border-radius:16px;padding:2rem;backdrop-filter:blur(12px);box-shadow:0 0 0 1px #ff444410,0 24px 60px #00000080,inset 0 1px 0 #ffffff08;}
        .setup-form{display:flex;flex-direction:column;gap:1.4rem;}
        .form-section{display:flex;flex-direction:column;gap:6px;}
        .form-divider{border:none;border-top:1px solid #222;margin:.2rem 0;}
        .form-label{font-size:.75rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#9ca3af;}
        .form-input{background:#0a0a0a;border:1px solid #2a2a2a;border-radius:8px;color:#e0e0e0;font-size:.9rem;padding:10px 14px;outline:none;transition:border-color .2s,box-shadow .2s;color-scheme:dark;width:100%;box-sizing:border-box;}
        .form-input:focus{border-color:#ff4444;box-shadow:0 0 0 3px #ff444420;}
        .form-input::placeholder{color:#4b5563;}
        .form-hint{font-size:.7rem;color:#4b5563;font-style:italic;}
        .preset-row{display:flex;flex-wrap:wrap;gap:8px;}
        .preset-chip{border:1px solid #2a2a2a;background:transparent;color:#9ca3af;font-size:.75rem;padding:6px 12px;border-radius:8px;cursor:pointer;transition:all .2s;}
        .preset-chip:hover{border-color:#ff444480;color:#ff6666;background:#ff44440d;}
        .preset-chip--active{border-color:#ff4444;color:#ff4444;background:#ff44441a;}
        .coord-row{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
        .coord-field{display:flex;flex-direction:column;gap:4px;}
        .coord-label{font-size:.7rem;color:#6b7280;}
        .acres-row{display:flex;align-items:center;gap:14px;}
        .acres-slider{flex:1;-webkit-appearance:none;height:4px;border-radius:4px;background:linear-gradient(to right,#ff4444 0%,#ff8844 50%,#ffcc00 100%);outline:none;cursor:pointer;}
        .acres-slider::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;border-radius:50%;background:#ff4444;box-shadow:0 0 8px #ff4444;cursor:pointer;transition:transform .1s;}
        .acres-slider::-webkit-slider-thumb:hover{transform:scale(1.2);}
        .acres-value{min-width:56px;text-align:right;font-family:'Courier New',monospace;font-size:.85rem;color:#ff8844;font-weight:600;}
        .wind-slider{flex:1;-webkit-appearance:none;height:4px;border-radius:4px;background:linear-gradient(to right,#38bdf8 0%,#facc15 55%,#ff4444 100%);outline:none;cursor:pointer;}
        .wind-slider::-webkit-slider-thumb{-webkit-appearance:none;width:18px;height:18px;border-radius:50%;background:#38bdf8;box-shadow:0 0 8px #38bdf8;cursor:pointer;transition:transform .1s;}
        .wind-slider::-webkit-slider-thumb:hover{transform:scale(1.2);}
        .wind-degree-row{display:grid;grid-template-columns:1fr 72px 16px;align-items:center;gap:8px;}
        .wind-degree-input{background:#0a0a0a;border:1px solid #2a2a2a;border-radius:8px;color:#e0f2fe;font-family:'Courier New',monospace;font-size:.85rem;font-weight:700;padding:8px 10px;outline:none;text-align:right;width:100%;box-sizing:border-box;}
        .wind-degree-input:focus{border-color:#38bdf8;box-shadow:0 0 0 3px #38bdf820;}
        .wind-degree-unit{color:#7dd3fc;font-family:'Courier New',monospace;font-size:.9rem;font-weight:700;}
        .duration-row{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;}
        .duration-option{border:1px solid #2a2a2a;background:#0a0a0a;color:#9ca3af;font-size:.8rem;font-weight:600;padding:8px 10px;border-radius:8px;cursor:pointer;transition:all .2s;}
        .duration-option:hover{border-color:#ff884480;color:#ff8844;background:#ff88440d;}
        .duration-option--active{border-color:#ff8844;color:#ffcc00;background:#ff88441a;box-shadow:0 0 12px #ff884420;}
        .form-error{background:#ff444415;border:1px solid #ff444440;border-radius:8px;color:#ff6666;font-size:.8rem;padding:10px 14px;}
        .submit-btn{display:flex;align-items:center;justify-content:center;gap:10px;background:linear-gradient(135deg,#ff4444,#ff6622);color:white;font-size:.9rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;border:none;border-radius:10px;padding:14px 24px;cursor:pointer;transition:all .2s;box-shadow:0 4px 24px #ff444440;margin-top:.4rem;}
        .submit-btn:hover:not(:disabled){transform:translateY(-2px);box-shadow:0 8px 32px #ff444460;}
        .submit-btn:active:not(:disabled){transform:translateY(0);}
        .submit-btn:disabled{opacity:.5;cursor:not-allowed;}
        .btn-icon{font-size:.75rem;}
        .spinner{width:16px;height:16px;border:2px solid #ffffff40;border-top-color:white;border-radius:50%;animation:spin .7s linear infinite;}
        @keyframes spin{to{transform:rotate(360deg);}}
        .setup-footer{font-size:.65rem;color:#374151;letter-spacing:.05em;text-align:center;}
      `}</style>
    </div>
  );
}
