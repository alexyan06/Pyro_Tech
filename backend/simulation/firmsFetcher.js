/**
 * firmsFetcher.js
 *
 * Fetches active fire detections from NASA FIRMS.
 * Requires NASA_FIRMS_API_KEY in .env.
 *
 * Source selection:
 *   - Simulation date within last 7 days → VIIRS_SNPP_NRT  (near-real-time)
 *   - Older historical date             → VIIRS_SNPP_SP   (standard product archive)
 *
 * Bbox is derived from the fire origin rather than hardcoded to LA County.
 *
 * @param {object} [opts]
 * @param {number} [opts.lat]    Fire origin latitude  (default 34.05)
 * @param {number} [opts.lng]    Fire origin longitude (default -118.52)
 * @param {string} [opts.date]   ISO-8601 simulation date (default: today)
 * @param {number} [opts.radius] Fetch radius in degrees (default 0.5 → ~55km)
 */
async function fetchFIRMS({ lat = 34.05, lng = -118.52, date = null, radius = 0.5 } = {}) {
  const apiKey = process.env.NASA_FIRMS_API_KEY;
  if (!apiKey) {
    console.warn('[FIRMS] NASA_FIRMS_API_KEY not set — skipping fire hotspot fetch');
    return [];
  }

  // Pick source based on how old the date is
  const simDate = date ? new Date(date) : new Date();
  const ageMs   = Date.now() - simDate.getTime();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const source  = ageMs > sevenDaysMs ? 'VIIRS_SNPP_SP' : 'VIIRS_SNPP_NRT';

  // Dynamic bbox centered on fire origin
  const west  = (lng - radius).toFixed(4);
  const south = (lat - radius).toFixed(4);
  const east  = (lng + radius).toFixed(4);
  const north = (lat + radius).toFixed(4);
  const bbox  = `${west},${south},${east},${north}`;

  // Date string for the API (YYYY-MM-DD)
  const dateStr = simDate.toISOString().slice(0, 10);

  const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${apiKey}/${source}/${bbox}/1/${dateStr}`;
  console.log(`[FIRMS] Fetching ${source} detections for bbox ${bbox} on ${dateStr}`);

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Ember-WildfireSim/2.0' },
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) {
      const body = await res.text();
      console.warn(`[FIRMS] HTTP ${res.status}: ${body.slice(0, 120)}`);
      return [];
    }

    const csv    = await res.text();
    const points = parseFIRMScsv(csv);
    console.log(`[FIRMS] ${points.length} fire detections`);
    return points;
  } catch (err) {
    console.warn('[FIRMS] Fetch error:', err.message);
    return [];
  }
}

function parseFIRMScsv(csv) {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];
  const header  = lines[0].split(',').map(h => h.trim());
  const latIdx  = header.indexOf('latitude');
  const lngIdx  = header.indexOf('longitude');
  const briIdx  = header.indexOf('bright_ti4') !== -1 ? header.indexOf('bright_ti4') : header.indexOf('brightness');
  const confIdx = header.indexOf('confidence');
  if (latIdx === -1 || lngIdx === -1) return [];

  const points = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const lat  = parseFloat(cols[latIdx]);
    const lng  = parseFloat(cols[lngIdx]);
    if (isNaN(lat) || isNaN(lng)) continue;
    points.push({
      lng,
      lat,
      brightness: briIdx !== -1 ? parseFloat(cols[briIdx]) || 320 : 320,
      confidence: confIdx !== -1 ? cols[confIdx]?.trim() || 'nominal' : 'nominal',
    });
  }
  return points;
}

module.exports = { fetchFIRMS };
