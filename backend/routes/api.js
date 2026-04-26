const express = require('express');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const DATA_DIR = path.join(__dirname, '../../data/geojson');
const { fetchAllForBbox } = require('../data/overpassFetcher');
const { setScenarioState, getScenarioState } = require('../data/scenarioState');
const { fetchPopulationForBbox } = require('../data/populationFetcher');
const { synthesizeEvacuationZones } = require('../data/zoneSynthesizer');
const { normalizeInitialAcres } = require('../simulation/scenarioInputs');

// Rate limiter for scenario setup (expensive external calls)
const setupLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // Limit each IP to 5 requests per window
  message: { error: 'Too many scenario requests. Please wait a minute.' }
});

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ---------------------------------------------------------------------------
// GeoJSON static files (fallback / pre-seeded LA data)
// ---------------------------------------------------------------------------
/**
 * Filter a FeatureCollection of Point features to those inside (or within a buffer of) bbox.
 * bbox format: [west, south, east, north]
 */
function geoFilter(fc, bbox, buffer = 0.3) {
  if (!fc?.features?.length || !bbox) return fc;
  const [west, south, east, north] = bbox;
  return {
    ...fc,
    features: fc.features.filter(f => {
      const c = f.geometry?.coordinates;
      if (!c) return false;
      // Handle Point [lng, lat] or LineString/Polygon (use first coord)
      const lng = Array.isArray(c[0]) ? (Array.isArray(c[0][0]) ? c[0][0][0] : c[0][0]) : c[0];
      const lat = Array.isArray(c[0]) ? (Array.isArray(c[0][0]) ? c[0][0][1] : c[0][1]) : c[1];
      return lng >= west - buffer && lng <= east + buffer &&
             lat >= south - buffer && lat <= north + buffer;
    }),
  };
}

router.get('/geojson/:filename', (req, res) => {
  const { filename } = req.params;
  // Hardened regex: strictly letters, numbers, underscores, and dashes. No dots except the final extension.
  if (!/^[a-z0-9_-]+\.geojson$/.test(filename)) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  const fileKey = filename.replace('.geojson', '');
  const keyMap = {
    hospitals:         'hospitals',
    fire_stations:     'fireStations',
    shelters:          'shelters',
    evacuation_routes: 'routes',
    evacuation_zones:  'evacuationZones',
  };

  const state = getScenarioState();
  let filterBbox = null;
  if (state?.bbox && state.bbox.length === 4) {
    const [s, w, n, e] = state.bbox;
    filterBbox = [w, s, e, n];
  }

  let osmFC = null;
  if (state?.geojson && keyMap[fileKey]) {
    osmFC = state.geojson[keyMap[fileKey]] || null;
  }
  if (fileKey === 'population_tracts' && state?.populationTracts) {
    osmFC = state.populationTracts;
  }

  const filePath = path.join(DATA_DIR, filename);
  let staticFC = null;
  if (fs.existsSync(filePath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      staticFC = filterBbox ? geoFilter(raw, filterBbox) : raw;
    } catch (err) {
      console.warn(`[API] Failed to parse ${filename}:`, err.message);
    }
  }

  // Combined GeoJSON structure
  const merged = { type: 'FeatureCollection', features: [] };
  const seen = new Set();
  
  if (osmFC?.features) {
    for (const f of osmFC.features) {
      const id = f.properties?.id || f.properties?.shelter_id || f.properties?.route_id;
      if (id) seen.add(id);
      merged.features.push(f);
    }
  }
  
  if (staticFC?.features) {
    for (const f of staticFC.features) {
      const id = f.properties?.id || f.properties?.id || f.properties?.shelter_id || f.properties?.route_id;
      if (!id || !seen.has(id)) merged.features.push(f);
    }
  }

  // If both sources failed and file doesn't exist on disk, 404
  if (merged.features.length === 0 && !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found', filename });
  }

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.json(merged);
});

// ---------------------------------------------------------------------------
// Unified GeoJSON Bundle (Pre-loading support)
// ---------------------------------------------------------------------------
router.get('/geojson-bundle', (req, res) => {
  const state = getScenarioState();
  if (!state) return res.status(404).json({ error: 'No active scenario' });

  const { geojson, populationTracts } = state;
  res.json({
    shelters:          geojson?.shelters          || { type: 'FeatureCollection', features: [] },
    hospitals:         geojson?.hospitals         || { type: 'FeatureCollection', features: [] },
    fire_stations:     geojson?.fireStations      || { type: 'FeatureCollection', features: [] },
    evacuation_routes: geojson?.routes            || { type: 'FeatureCollection', features: [] },
    evacuation_zones:  geojson?.evacuationZones     || { type: 'FeatureCollection', features: [] },
    population_tracts: populationTracts           || { type: 'FeatureCollection', features: [] },
  });
});

// ---------------------------------------------------------------------------
// NASA FIRMS proxy
// ---------------------------------------------------------------------------
const { fetchFIRMS } = require('../simulation/firmsFetcher');
router.get('/firms', async (req, res) => {
  try {
    const lat  = req.query.lat  ? parseFloat(req.query.lat)  : undefined;
    const lng  = req.query.lng  ? parseFloat(req.query.lng)  : undefined;
    const date = req.query.date ?? null;
    const points = await fetchFIRMS({ lat, lng, date });
    res.json({ points, fetched_at: new Date().toISOString() });
  } catch {
    res.json({ points: [] });
  }
});

// ---------------------------------------------------------------------------
// Current scenario state
// ---------------------------------------------------------------------------
router.get('/scenario', (req, res) => {
  const state = getScenarioState();
  if (!state) return res.status(404).json({ error: 'No active scenario' });
  // Return metadata only (no full GeoJSON to keep payload small)
  const { geojson: _omit, ...meta } = state;
  res.json(meta);
});

// ---------------------------------------------------------------------------
// [POST] /api/setup-scenario
// Geocodes a city/zip, fetches OSM infrastructure, saves to in-memory state.
// ---------------------------------------------------------------------------
router.post('/setup-scenario', setupLimiter, async (req, res) => {
  const { city, datetime, fireLat, fireLng, initialAcres, durationHours, windU, windV } = req.body ?? {};
  const parsedDurationHours = Number(durationHours);
  const normalizedInitialAcres = normalizeInitialAcres(initialAcres);
  const parsedWindU = Number(windU);
  const parsedWindV = Number(windV);

  if (!city || typeof city !== 'string' || !city.trim()) {
    return res.status(400).json({ error: 'city is required' });
  }

  try {
    // 1. Geocode via Nominatim (free, no API key needed). Bare 5-digit ZIP
    // inputs are US postal codes for this app; constrain them so "47906" does
    // not resolve to an unrelated international postal code.
    const trimmedCity = city.trim();
    const isUsZip = /^\d{5}$/.test(trimmedCity);
    const geoParams = new URLSearchParams({
      format: 'json',
      limit: '1',
      q: isUsZip ? `${trimmedCity}, United States` : trimmedCity,
    });
    if (isUsZip) geoParams.set('countrycodes', 'us');
    const geoUrl = `https://nominatim.openstreetmap.org/search?${geoParams.toString()}`;

    const geoRes = await fetch(geoUrl, {
      headers: { 'User-Agent': 'Ember-WildfireSim/2.0 (LAHacks 2026)' },
    });

    if (!geoRes.ok) throw new Error(`Nominatim error: HTTP ${geoRes.status}`);
    const geoData = await geoRes.json();

    if (!geoData.length) {
      return res.status(422).json({ error: `Could not geocode "${city}". Try a more specific US location.` });
    }

    const place = geoData[0];
    const centerLat = parseFloat(place.lat);
    const centerLng = parseFloat(place.lon);

    // Center the data-fetch area on the fire origin (or city center if not specified).
    // ~25 km radius — large enough to cover realistic fire spread, regardless of city boundary size.
    const RADIUS = 0.22;
    const originLat = (fireLat != null) ? fireLat : centerLat;
    const originLng = (fireLng != null) ? fireLng : centerLng;
    const bbox = [
      originLat - RADIUS, // south
      originLng - RADIUS, // west
      originLat + RADIUS, // north
      originLng + RADIUS, // east
    ];

    console.log(`[Setup] Geocoded "${city}" → ${place.display_name}`);
    console.log(`[Setup] BBOX: ${JSON.stringify(bbox)}`);

    // 2. Fetch OSM infrastructure and population data for the BBOX in parallel.
    //    bbox here is [south, west, north, east] (overpassFetcher format).
    //    populationFetcher expects [west, south, east, north].
    const [south, west, north, east] = bbox;
    const popBbox = [west, south, east, north];

    console.log('[Setup] Fetching OSM data (this may take ~15s)…');
    const [geojson, populationTracts] = await Promise.all([
      fetchAllForBbox(bbox),
      fetchPopulationForBbox(popBbox).catch(err => {
        console.warn('[Setup] Population fetch error (non-fatal):', err.message);
        return { type: 'FeatureCollection', features: [] };
      }),
    ]);

    // Strip everything below the big-highway tier so the frontend, simulation,
    // and road graph all agree on the same sparse, highway-only network.
    const HIGHWAY_WHITELIST = new Set(['motorway', 'trunk', 'primary']);
    if (geojson.routes?.features) {
      const before = geojson.routes.features.length;
      geojson.routes.features = geojson.routes.features.filter(f => {
        const hwy = f.properties?.highway;
        return !hwy || HIGHWAY_WHITELIST.has(hwy);
      });
      console.log(`[Setup] Route highway filter: ${before} → ${geojson.routes.features.length}`);
    }

    console.log(`[Setup] Population tracts: ${populationTracts.features.length} features`);

    // Synthesize evacuation zones from shelters + population tracts
    const evacuationZones = synthesizeEvacuationZones(geojson.shelters, populationTracts);
    console.log(`[Setup] Synthesized ${evacuationZones.features.length} evacuation zones`);
    // Attach synthesized zones to the geojson bundle so /api/geojson/evacuation_zones serves them
    geojson.evacuationZones = evacuationZones;

    // 3. Persist to in-memory state
    const scenario = {
      city: city.trim(),
      displayName: place.display_name,
      centerLat,
      centerLng,
      bbox,
      datetime: datetime || new Date().toISOString(),
      fireLat: fireLat ?? centerLat,
      fireLng: fireLng ?? centerLng,
      initialAcres: normalizedInitialAcres,
      durationHours: Number.isFinite(parsedDurationHours) ? Math.min(12, Math.max(1, parsedDurationHours)) : 6,
      metrics: {
        // Default: 35 mph from NE (45° FROM) as U/V components (m/s)
        windU: Number.isFinite(parsedWindU) ? parsedWindU : parseFloat((-35 * 0.44704 * Math.sin(Math.PI / 4)).toFixed(4)),
        windV: Number.isFinite(parsedWindV) ? parsedWindV : parseFloat((-35 * 0.44704 * Math.cos(Math.PI / 4)).toFixed(4)),
        temp: 85,
        humidity: 15,
      },
      geojson,
      populationTracts,
    };

    setScenarioState(scenario);

    // 4. Build a natural-language scenario string for the simulation engine
    const fireOriginLabel = fireLat && fireLng
      ? `at lat ${fireLat}, lng ${fireLng}`
      : `near the center of ${city.trim()}`;

    const scenarioText =
      `Simulate a wildfire that starts ${fireOriginLabel} in ${place.display_name}. ` +
      `The fire begins on ${datetime ?? 'now'} with an initial size of ${normalizedInitialAcres} acres. ` +
      `Use the fetched infrastructure data (hospitals, fire stations, power substations, routes, evacuation zones, and shelters) ` +
      `to coordinate emergency response.`;

    const { geojson: _omit1, populationTracts: _omit2, ...meta } = scenario;
    res.json({ ...meta, scenarioText });

  } catch (err) {
    console.error('[Setup] Error:', err.message);
    res.status(500).json({ error: err.message ?? 'Internal error during scenario setup' });
  }
});

module.exports = router;
