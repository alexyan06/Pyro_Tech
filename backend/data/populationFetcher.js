/**
 * populationFetcher.js
 * --------------------
 * Fetches real census tract population data for a given bounding box.
 *
 * Strategy:
 *  1. US locations: Census TIGERweb for tract geometries → ACS 5-year for populations.
 *  2. Fallback: Overpass API for place nodes with population tags.
 *  3. Second fallback: empty FeatureCollection.
 *
 * Results are cached to disk at backend/data/cache/population/.
 */

const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, 'cache', 'population');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureCacheDir() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function roundBbox(bbox) {
  return bbox.map(v => Math.round(v * 1000) / 1000);
}

function cacheKey(bbox) {
  const [west, south, east, north] = roundBbox(bbox);
  return `${west}_${south}_${east}_${north}.geojson`;
}

function readCache(bbox) {
  ensureCacheDir();
  const file = path.join(CACHE_DIR, cacheKey(bbox));
  if (fs.existsSync(file)) {
    try {
      const raw = fs.readFileSync(file, 'utf8');
      return JSON.parse(raw);
    } catch (_) {
      // corrupted cache file — ignore
    }
  }
  return null;
}

function writeCache(bbox, data) {
  ensureCacheDir();
  const file = path.join(CACHE_DIR, cacheKey(bbox));
  try {
    fs.writeFileSync(file, JSON.stringify(data), 'utf8');
  } catch (err) {
    console.warn('[PopulationFetcher] Could not write cache:', err.message);
  }
}

/**
 * Compute polygon centroid by averaging all ring coordinates.
 * Works for Polygon and MultiPolygon geometries.
 */
function computeCentroid(geometry) {
  let sumLng = 0, sumLat = 0, count = 0;

  function processRing(ring) {
    for (const [lng, lat] of ring) {
      sumLng += lng;
      sumLat += lat;
      count++;
    }
  }

  if (geometry.type === 'Polygon') {
    processRing(geometry.coordinates[0]);
  } else if (geometry.type === 'MultiPolygon') {
    for (const polygon of geometry.coordinates) {
      processRing(polygon[0]);
    }
  }

  return count > 0 ? { lng: sumLng / count, lat: sumLat / count } : { lng: 0, lat: 0 };
}

/**
 * Approximate area of a bbox in km².
 */
function approxAreaKm2(west, south, east, north) {
  const lat = (south + north) / 2;
  return (east - west) * (north - south) * 111 * 111 * Math.cos((lat * Math.PI) / 180);
}

// ---------------------------------------------------------------------------
// US Census path
// ---------------------------------------------------------------------------

async function fetchTractsFromTIGER(west, south, east, north) {
  // inSR=4326 tells ArcGIS the envelope is in WGS84 (lat/lng), not a projected CRS.
  // Without it the service interprets coordinates as meter units and returns nothing.
  const url =
    `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/0/query` +
    `?geometry=${west},${south},${east},${north}` +
    `&geometryType=esriGeometryEnvelope` +
    `&inSR=4326` +
    `&spatialRel=esriSpatialRelIntersects` +
    `&outFields=GEOID,STATE,COUNTY,TRACT` +
    `&f=geojson` +
    `&returnGeometry=true` +
    `&resultRecordCount=5000`;

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Ember-WildfireSim/2.0 (LAHacks 2026)' },
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) throw new Error(`TIGERweb HTTP ${res.status}`);
  const data = await res.json();
  return data; // GeoJSON FeatureCollection
}

async function fetchACSPopulation(state, county) {
  const url =
    `https://api.census.gov/data/2022/acs/acs5` +
    `?get=B01003_001E,NAME` +
    `&for=tract:*` +
    `&in=state:${state}%20county:${county}`;

  const res = await fetch(url, {
    headers: { 'User-Agent': 'Ember-WildfireSim/2.0 (LAHacks 2026)' },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) throw new Error(`ACS HTTP ${res.status}`);
  const rows = await res.json(); // array of arrays; first row is header
  // rows[0] = ["B01003_001E","NAME","state","county","tract"]
  return rows.slice(1); // skip header
}

async function fetchUSCensusPopulation(bbox) {
  const [west, south, east, north] = bbox;

  // Step 1: get tract geometries
  const tractsGeoJSON = await fetchTractsFromTIGER(west, south, east, north);
  const features = tractsGeoJSON.features || [];

  if (features.length === 0) {
    throw new Error('TIGERweb returned 0 features — likely non-US location');
  }

  // Step 2: collect unique state+county pairs
  const pairs = new Map(); // "SS_CCC" -> { state, county }
  for (const f of features) {
    const { STATE, COUNTY } = f.properties;
    if (STATE && COUNTY) {
      pairs.set(`${STATE}_${COUNTY}`, { state: STATE, county: COUNTY });
    }
  }

  // Step 3: fetch ACS population for each state+county pair
  const popByGEOID = new Map(); // GEOID -> population number
  for (const { state, county } of pairs.values()) {
    try {
      const rows = await fetchACSPopulation(state, county);
      for (const row of rows) {
        // row: [population, name, state, county, tract]
        const population = parseInt(row[0], 10);
        const geoid = `${row[2]}${row[3]}${row[4]}`; // state+county+tract = 11-digit GEOID
        popByGEOID.set(geoid, isNaN(population) ? 0 : population);
      }
    } catch (err) {
      console.warn(`[PopulationFetcher] ACS fetch failed for ${state}/${county}: ${err.message}`);
    }
  }

  // Step 4: join by GEOID and build output features
  const outputFeatures = [];
  for (const f of features) {
    const geoid = f.properties.GEOID;
    if (!geoid) continue;

    const population = popByGEOID.get(geoid) ?? 0;
    const centroid = computeCentroid(f.geometry);

    // Approximate per-tract area using its own bbox
    const coords = [];
    function collectCoords(geometry) {
      if (geometry.type === 'Polygon') {
        geometry.coordinates[0].forEach(c => coords.push(c));
      } else if (geometry.type === 'MultiPolygon') {
        geometry.coordinates.forEach(poly => poly[0].forEach(c => coords.push(c)));
      }
    }
    collectCoords(f.geometry);

    let tractArea = 1;
    if (coords.length > 0) {
      const lngs = coords.map(c => c[0]);
      const lats = coords.map(c => c[1]);
      const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
      const minLat = Math.min(...lats), maxLat = Math.max(...lats);
      tractArea = approxAreaKm2(minLng, minLat, maxLng, maxLat) || 1;
    }

    outputFeatures.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [centroid.lng, centroid.lat],
      },
      properties: {
        tract_id: geoid,
        population,
        density_per_sqkm: population / tractArea,
        lng: centroid.lng,
        lat: centroid.lat,
      },
    });
  }

  return { type: 'FeatureCollection', features: outputFeatures };
}

// ---------------------------------------------------------------------------
// Overpass fallback
// ---------------------------------------------------------------------------

async function fetchOverpassPopulation(bbox) {
  const [west, south, east, north] = bbox;
  // Broader query: place nodes with OR without population tag, plus neighbourhood nodes.
  const query =
    `[out:json][timeout:25];` +
    `(` +
    `  node["place"~"^(city|town|village|suburb|neighbourhood|quarter)$"](${south},${west},${north},${east});` +
    `  node["place"~"^(city|town|village|suburb|neighbourhood|quarter)$"]["population"](${south},${west},${north},${east});` +
    `);` +
    `out body;`;

  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Ember-WildfireSim/2.0 (LAHacks 2026)',
    },
    body: `data=${encodeURIComponent(query)}`,
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
  const data = await res.json();
  const elements = data.elements || [];

  // Assign a default population for nodes that lack the tag based on place type
  const DEFAULT_POP = { city: 500000, town: 25000, village: 2000, suburb: 15000, neighbourhood: 8000, quarter: 5000 };

  const features = elements
    .filter(el => el.lat && el.lon)
    .map(el => {
      const raw = el.tags?.population ? parseInt(el.tags.population, 10) : 0;
      const pop = raw > 0 ? raw : (DEFAULT_POP[el.tags?.place] ?? 5000);
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [el.lon, el.lat] },
        properties: {
          tract_id: `osm_${el.id}`,
          population: pop,
          density_per_sqkm: 0,
          lng: el.lon,
          lat: el.lat,
          name: el.tags?.name,
          place: el.tags?.place,
        },
      };
    });

  return { type: 'FeatureCollection', features };
}

/**
 * Generate a synthetic grid of population points covering the bbox.
 * Used as a last resort so the simulation always has population data.
 */
function generateSyntheticPopulation(bbox) {
  const [west, south, east, north] = bbox;
  const areaKm2 = approxAreaKm2(west, south, east, north);
  // Suburban LA density ~2500/km²; scale to bbox area, cap at 200k total
  const totalPop = Math.min(Math.round(areaKm2 * 2500), 200000);

  const GRID = 4; // 4×4 = 16 sample points
  const features = [];
  for (let row = 0; row < GRID; row++) {
    for (let col = 0; col < GRID; col++) {
      const lat = south + (north - south) * ((row + 0.5) / GRID);
      const lng = west  + (east  - west)  * ((col + 0.5) / GRID);
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lng, lat] },
        properties: {
          tract_id: `synthetic_${row}_${col}`,
          population: Math.round(totalPop / (GRID * GRID)),
          density_per_sqkm: 2500,
          lng,
          lat,
        },
      });
    }
  }

  console.log(`[PopulationFetcher] Synthetic fallback: ${features.length} grid points, ~${totalPop.toLocaleString()} total pop`);
  return { type: 'FeatureCollection', features };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Fetch population data for a bounding box.
 * @param {[number, number, number, number]} bbox  [west, south, east, north]
 * @returns {Promise<GeoJSON.FeatureCollection>}
 */
async function fetchPopulationForBbox(bbox) {
  // Check disk cache first
  const cached = readCache(bbox);
  if (cached) {
    console.log(`[PopulationFetcher] Cache hit — ${cached.features.length} features`);
    return cached;
  }

  // Try US Census path
  try {
    const result = await fetchUSCensusPopulation(bbox);
    if (result.features.length > 0) {
      writeCache(bbox, result);
      console.log(`[PopulationFetcher] Census: ${result.features.length} tracts`);
      return result;
    }
    // Zero features from Census — fall through to Overpass
    throw new Error('Census returned 0 joined features');
  } catch (censusErr) {
    console.warn(`[PopulationFetcher] Census path failed: ${censusErr.message} — trying Overpass`);
  }

  // Overpass fallback
  try {
    const result = await fetchOverpassPopulation(bbox);
    console.log(`[PopulationFetcher] Overpass: ${result.features.length} features`);
    if (result.features.length > 0) {
      writeCache(bbox, result);
      return result;
    }
  } catch (overpassErr) {
    console.warn(`[PopulationFetcher] Overpass fallback failed: ${overpassErr.message}`);
  }

  // Synthetic grid fallback — ensures population data is always available
  const synthetic = generateSyntheticPopulation(bbox);
  writeCache(bbox, synthetic);
  return synthetic;
}

module.exports = { fetchPopulationForBbox };
