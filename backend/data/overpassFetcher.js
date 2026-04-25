/**
 * overpassFetcher.js
 * ------------------
 * Modular backend functions for fetching OSM infrastructure data on demand.
 * Accepts a dynamic BBOX and returns GeoJSON FeatureCollections in memory
 * (no file I/O — used by the /api/setup-scenario endpoint).
 *
 * BBOX format: [south, west, north, east]  (decimal degrees)
 */

const https = require('https');
const { fetchRoutes: fetchRoutesFromTIGER } = require('./tigerRoutesFetcher');

const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const REQUEST_DELAY_MS = 2000; // polite delay between sequential requests

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

function fetchOverpassRawFromUrl(url, query) {
  return new Promise((resolve, reject) => {
    const body = 'data=' + encodeURIComponent(query);
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'Ember-WildfireSim/2.0 (LAHacks 2026)',
      },
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) {
          return reject(new Error(`Overpass HTTP ${res.statusCode}: ${raw.slice(0, 300)}`));
        }
        try { resolve(JSON.parse(raw)); }
        catch (e) { reject(new Error(`JSON parse: ${e.message}`)); }
      });
    });

    req.setTimeout(25000, () => { req.destroy(); reject(new Error('Overpass request timed out')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function fetchOverpassRaw(query) {
  let lastError;
  for (const url of OVERPASS_URLS) {
    try {
      return await fetchOverpassRawFromUrl(url, query);
    } catch (err) {
      lastError = err;
      console.warn(`[Overpass] ${url.split('/')[2]} failed: ${err.message} — trying next endpoint`);
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Query builders
// ---------------------------------------------------------------------------

function buildPointQuery(filters, bbox) {
  const [s, w, n, e] = bbox;
  const bboxStr = `${s},${w},${n},${e}`;
  const lines = filters
    .map((f) => `  node[${f}](${bboxStr});\n  way[${f}](${bboxStr});`)
    .join('\n');
  return `[out:json][timeout:25];\n(\n${lines}\n);\nout center;`;
}

function buildWayQuery(bbox) {
  const [s, w, n, e] = bbox;
  // Clamp to ~22km sides to prevent 504s on large city bboxes
  const MAX_DEG = 0.2;
  const midLat = (s + n) / 2;
  const midLng = (w + e) / 2;
  const cs = Math.max(s, midLat - MAX_DEG);
  const cn = Math.min(n, midLat + MAX_DEG);
  const cw = Math.max(w, midLng - MAX_DEG);
  const ce = Math.min(e, midLng + MAX_DEG);
  return `[out:json][timeout:25][maxsize:536870912];\n(\n  way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"](${cs},${cw},${cn},${ce});\n);\nout geom;`;
}

// ---------------------------------------------------------------------------
// Element → GeoJSON Feature converters
// ---------------------------------------------------------------------------

function elementToPointFeature(el, index, featureType, idPrefix) {
  let lat, lon;
  if (el.type === 'node') { lat = el.lat; lon = el.lon; }
  else if (el.center) { lat = el.center.lat; lon = el.center.lon; }
  if (lat == null || lon == null) return null;

  const tags = el.tags || {};
  const name = tags.name || tags.operator || `${featureType} ${index + 1}`;

  const extraProps = {};
  if (featureType === 'hospital') {
    extraProps.emergency = tags.emergency || null;
    extraProps.phone = tags.phone || null;
    extraProps.address = [tags['addr:housenumber'], tags['addr:street'], tags['addr:city']].filter(Boolean).join(' ') || null;
  } else if (featureType === 'fire_station') {
    extraProps.department = tags.operator || null;
    extraProps.phone = tags.phone || null;
    extraProps.address = [tags['addr:housenumber'], tags['addr:street'], tags['addr:city']].filter(Boolean).join(' ') || null;
  }

  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [parseFloat(lon.toFixed(6)), parseFloat(lat.toFixed(6))] },
    properties: {
      id: `${idPrefix}_${String(index + 1).padStart(3, '0')}`,
      name, type: featureType, status: 'operational',
      capacity: tags.capacity ? parseInt(tags.capacity, 10) : null,
      osm_id: el.id,
      ...extraProps,
    },
  };
}

function elementToZoneFeature(el, index) {
  let lat, lon;
  if (el.type === 'node') { lat = el.lat; lon = el.lon; }
  else if (el.center) { lat = el.center.lat; lon = el.center.lon; }
  if (lat == null || lon == null) return null;

  const tags = el.tags || {};
  const name = tags.name || tags['name:en'] || `Zone ${index + 1}`;
  
  // Create a square polygon around the point (~1km buffer) to satisfy frontend Polygon expectation
  const offset = 0.008; 
  const coords = [
    [parseFloat((lon - offset).toFixed(6)), parseFloat((lat - offset).toFixed(6))],
    [parseFloat((lon + offset).toFixed(6)), parseFloat((lat - offset).toFixed(6))],
    [parseFloat((lon + offset).toFixed(6)), parseFloat((lat + offset).toFixed(6))],
    [parseFloat((lon - offset).toFixed(6)), parseFloat((lat + offset).toFixed(6))],
    [parseFloat((lon - offset).toFixed(6)), parseFloat((lat - offset).toFixed(6))]
  ];

  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [coords] },
    properties: {
      zone_id: `Z${String(index + 1).padStart(3, '0')}`,
      name,
      population: 8000, // overridden by seedFromData() using real census tracts
      status: 'clear',
      centroid_lng: parseFloat(lon.toFixed(6)),
      centroid_lat: parseFloat(lat.toFixed(6)),
      osm_id: el.id,
    },
  };
}

function elementToShelterFeature(el, index) {
  let lat, lon;
  if (el.type === 'node') { lat = el.lat; lon = el.lon; }
  else if (el.center) { lat = el.center.lat; lon = el.center.lon; }
  if (lat == null || lon == null) return null;

  const tags = el.tags || {};
  const name = tags.name || tags['name:en'] || `Shelter ${index + 1}`;

  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [parseFloat(lon.toFixed(6)), parseFloat(lat.toFixed(6))] },
    properties: {
      shelter_id: `S${String(index + 1).padStart(3, '0')}`,
      name,
      capacity: tags.capacity ? parseInt(tags.capacity, 10) : 2500,
      status: 'open',
      osm_id: el.id,
    },
  };
}

const PRIORITY_MAP = { motorway: 'primary', trunk: 'primary', primary: 'secondary', secondary: 'secondary', tertiary: 'tertiary' };
const CAPACITY_MAP = { motorway: 4800, trunk: 3200, primary: 2400, secondary: 1600, tertiary: 800, residential: 400 };

function wayToRouteFeature(way, index) {
  const geom = way.geometry || [];
  if (geom.length < 2) return null;
  const coords = geom.map(({ lon, lat }) => [lon, lat]);
  if (coords.length === 2) coords.push([...coords[coords.length - 1]]);

  const tags = way.tags || {};
  const hwType = tags.highway || 'primary';
  const name = tags.name || tags['name:en'] || `Unnamed ${hwType}`;
  const ref = tags.ref || '';

  return {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: coords },
    properties: {
      route_id: `R${String(index + 1).padStart(3, '0')}`,
      osm_id: way.id,
      name: ref ? `${name} (${ref})` : name,
      highway: hwType,
      status: 'open',
      capacity_vph: CAPACITY_MAP[hwType] || 2400,
      direction: 'evacuation_out',
      priority: PRIORITY_MAP[hwType] || 'secondary',
    },
  };
}

// ---------------------------------------------------------------------------
// Public API — individual fetchers
// ---------------------------------------------------------------------------

async function fetchHospitals(bbox) {
  const query = buildPointQuery(['"amenity"="hospital"'], bbox);
  const data = await fetchOverpassRaw(query);
  const features = (data.elements || []).map((el, i) => elementToPointFeature(el, i, 'hospital', 'hospital')).filter(Boolean);
  return { type: 'FeatureCollection', features };
}

async function fetchFireStations(bbox) {
  const query = buildPointQuery(['"amenity"="fire_station"'], bbox);
  const data = await fetchOverpassRaw(query);
  const features = (data.elements || []).map((el, i) => elementToPointFeature(el, i, 'fire_station', 'fire_station')).filter(Boolean);
  return { type: 'FeatureCollection', features };
}

async function fetchRoutes(bbox) {
  try {
    // 1. Try TIGER first (more reliable for US road geometry)
    const tigerData = await fetchRoutesFromTIGER(bbox);
    if (tigerData.features.length > 0) return tigerData;
  } catch (err) {
    console.warn('[Routes] TIGER fetch failed, trying Overpass fallback…', err.message);
  }

  try {
    // 2. Fallback to Overpass with a very specific query to avoid timeouts
    const query = buildWayQuery(bbox);
    const data = await fetchOverpassRaw(query);
    const features = (data.elements || []).map((el, i) => wayToRouteFeature(el, i)).filter(Boolean);
    return { type: 'FeatureCollection', features };
  } catch (err) {
    console.error('[Routes] All road sources failed:', err.message);
    return { type: 'FeatureCollection', features: [] };
  }
}

async function fetchEvacuationZones(bbox) {
  const query = buildPointQuery(['"place"~"^(suburb|neighbourhood|quarter|hamlet)$"'], bbox);
  const data = await fetchOverpassRaw(query);
  const features = (data.elements || []).map((el, i) => elementToZoneFeature(el, i)).filter(Boolean);
  return { type: 'FeatureCollection', features };
}

async function fetchShelters(bbox) {
  const query = buildPointQuery(['"amenity"~"^(community_centre|school|social_facility)$"', '"leisure"="stadium"'], bbox);
  const data = await fetchOverpassRaw(query);
  const features = (data.elements || []).map((el, i) => elementToShelterFeature(el, i)).filter(Boolean);
  return { type: 'FeatureCollection', features };
}

// ---------------------------------------------------------------------------
// Batch query — all point features in one Overpass request
// ---------------------------------------------------------------------------

function buildBatchPointQuery(bbox) {
  const [s, w, n, e] = bbox;
  const b = `${s},${w},${n},${e}`;
  return `[out:json][timeout:25];
(
  node["amenity"="hospital"](${b});
  way["amenity"="hospital"](${b});
  node["amenity"="fire_station"](${b});
  way["amenity"="fire_station"](${b});
  node["place"~"^(suburb|neighbourhood|quarter|hamlet)$"](${b});
  way["place"~"^(suburb|neighbourhood|quarter|hamlet)$"](${b});
  node["amenity"~"^(community_centre|school|social_facility)$"](${b});
  way["amenity"~"^(community_centre|school|social_facility)$"](${b});
  node["leisure"="stadium"](${b});
  way["leisure"="stadium"](${b});
);
out center;`;
}

function categorizeElement(el) {
  const t = el.tags || {};
  if (t.amenity === 'hospital') return 'hospital';
  if (t.amenity === 'fire_station') return 'fire_station';
  if (t.place && /^(suburb|neighbourhood|quarter|hamlet)$/.test(t.place)) return 'zone';
  if ((t.amenity && /^(community_centre|school|social_facility)$/.test(t.amenity)) || t.leisure === 'stadium') return 'shelter';
  return null;
}

// ---------------------------------------------------------------------------
// Convenience: fetch all datasets for a given BBOX
// Returns { hospitals, fireStations, routes, evacuationZones, shelters }
// ---------------------------------------------------------------------------

async function fetchAllForBbox(bbox) {
  const emptyFC = () => ({ type: 'FeatureCollection', features: [] });

  console.log('[Overpass] Fetching all point features (single batched request)…');
  const counts = { hospital: 0, fire_station: 0, zone: 0, shelter: 0 };
  const hospitals = [], fireStations = [], evacuationZones = [], shelters = [];

  try {
    const data = await fetchOverpassRaw(buildBatchPointQuery(bbox));
    for (const el of (data.elements || [])) {
      const cat = categorizeElement(el);
      if (!cat) continue;
      const i = counts[cat]++;
      switch (cat) {
        case 'hospital': { const f = elementToPointFeature(el, i, 'hospital', 'hospital'); if (f) hospitals.push(f); break; }
        case 'fire_station': { const f = elementToPointFeature(el, i, 'fire_station', 'fire_station'); if (f) fireStations.push(f); break; }
        case 'zone': { const f = elementToZoneFeature(el, i); if (f) evacuationZones.push(f); break; }
        case 'shelter': { const f = elementToShelterFeature(el, i); if (f) shelters.push(f); break; }
      }
    }
  } catch (e) {
    console.warn('[Overpass] Batch point fetch failed:', e.message);
  }

  let routes = emptyFC();
  try { routes = await fetchRoutes(bbox); } catch (e) { console.warn('Routes fetch failed:', e.message); }

  console.log(
    `[Overpass] Done. hospitals=${hospitals.length}, ` +
    `fireStations=${fireStations.length}, ` +
    `routes=${routes.features.length}, ` +
    `zones=${evacuationZones.length}, ` +
    `shelters=${shelters.length}`
  );

  return {
    hospitals:       { type: 'FeatureCollection', features: hospitals },
    fireStations:    { type: 'FeatureCollection', features: fireStations },
    routes,
    evacuationZones: { type: 'FeatureCollection', features: evacuationZones },
    shelters:        { type: 'FeatureCollection', features: shelters },
  };
}

module.exports = { fetchHospitals, fetchFireStations, fetchRoutes, fetchEvacuationZones, fetchShelters, fetchAllForBbox };
