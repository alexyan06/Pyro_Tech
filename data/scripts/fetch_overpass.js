/**
 * fetch_overpass.js
 * PyroTech Wildfire Simulation — LAHacks 2026
 *
 * Fetches infrastructure data (hospitals, fire stations) for LA County from
 * the OpenStreetMap Overpass API and writes GeoJSON files.
 *
 * Usage:
 *   node fetch_overpass.js
 *
 * Outputs (relative to repo root):
 *   data/geojson/hospitals.geojson
 *   data/geojson/fire_stations.geojson
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

/** LA County bounding box: south, west, north, east */
const BBOX = [33.7, -118.95, 34.35, -117.65];

const OUTPUT_DIR = path.resolve(__dirname, '..', 'geojson');

// Delay between requests (ms) to respect the Overpass rate limit (2 req/slot)
const REQUEST_DELAY_MS = 35_000;

// ---------------------------------------------------------------------------
// Overpass queries
// ---------------------------------------------------------------------------

function buildQuery(filters) {
  const [s, w, n, e] = BBOX;
  const bbox = `${s},${w},${n},${e}`;
  const lines = filters
    .map((f) => `  node[${f}](${bbox});\n  way[${f}](${bbox});`)
    .join('\n');
  return `[out:json][timeout:25];\n(\n${lines}\n);\nout center;`;
}

const DATASETS = [
  {
    key: 'hospitals',
    outputFile: 'hospitals.geojson',
    featureType: 'hospital',
    idPrefix: 'hospital',
    query: buildQuery(['"amenity"="hospital"']),
  },
  {
    key: 'fire_stations',
    outputFile: 'fire_stations.geojson',
    featureType: 'fire_station',
    idPrefix: 'fire_station',
    query: buildQuery(['"amenity"="fire_station"']),
  },
];

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

/**
 * POST `data` param to the Overpass interpreter and return parsed JSON.
 * @param {string} query  Overpass QL string
 * @returns {Promise<object>}
 */
function fetchOverpass(query) {
  return new Promise((resolve, reject) => {
    const body = 'data=' + encodeURIComponent(query);

    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'Ember-WildfireSim/1.0 (LAHacks 2026)',
      },
    };

    const req = https.request(OVERPASS_URL, options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) {
          return reject(
            new Error(`Overpass returned HTTP ${res.statusCode}:\n${raw.slice(0, 500)}`)
          );
        }
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          reject(new Error(`JSON parse error: ${e.message}\nBody: ${raw.slice(0, 300)}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Conversion: Overpass element → GeoJSON Feature
// ---------------------------------------------------------------------------

/**
 * @param {object} el    Overpass element (node or way with center)
 * @param {number} index Zero-based index used to build a stable ID
 * @param {string} featureType  Value for `properties.type`
 * @param {string} idPrefix     Prefix for `properties.id`
 * @returns {object|null}  GeoJSON Feature, or null if coordinates are missing
 */
function elementToFeature(el, index, featureType, idPrefix) {
  let lat, lon;

  if (el.type === 'node') {
    lat = el.lat;
    lon = el.lon;
  } else if (el.center) {
    lat = el.center.lat;
    lon = el.center.lon;
  }

  if (lat == null || lon == null) return null;

  const tags = el.tags || {};
  const name = tags.name || tags.operator || `${featureType} ${index + 1}`;

  // Build a type-specific properties bag
  const extraProps = {};
  if (featureType === 'hospital') {
    extraProps.emergency = tags.emergency || null;
    extraProps.phone = tags.phone || null;
    extraProps.website = tags.website || null;
    extraProps.address =
      [tags['addr:housenumber'], tags['addr:street'], tags['addr:city']]
        .filter(Boolean)
        .join(' ') || null;
  } else if (featureType === 'fire_station') {
    extraProps.department = tags.operator || null;
    extraProps.phone = tags.phone || null;
    extraProps.address =
      [tags['addr:housenumber'], tags['addr:street'], tags['addr:city']]
        .filter(Boolean)
        .join(' ') || null;
  }

  return {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [
        parseFloat(lon.toFixed(6)),
        parseFloat(lat.toFixed(6)),
      ],
    },
    properties: {
      id: `${idPrefix}_${String(index + 1).padStart(3, '0')}`,
      name,
      type: featureType,
      status: 'operational',
      capacity: tags.capacity ? parseInt(tags.capacity, 10) : null,
      osm_id: el.id,
      ...extraProps,
    },
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  for (let i = 0; i < DATASETS.length; i++) {
    const ds = DATASETS[i];

    if (i > 0) {
      console.log(`  Waiting ${REQUEST_DELAY_MS / 1000}s to respect Overpass rate limit…`);
      await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));
    }

    console.log(`\n[${i + 1}/${DATASETS.length}] Fetching ${ds.key}…`);

    let data;
    try {
      data = await fetchOverpass(ds.query);
    } catch (err) {
      console.error(`  ERROR fetching ${ds.key}: ${err.message}`);
      console.error('  Skipping — use the static fallback GeoJSON files.');
      continue;
    }

    const elements = data.elements || [];
    console.log(`  Received ${elements.length} elements from Overpass.`);

    const features = elements
      .map((el, idx) =>
        elementToFeature(el, idx, ds.featureType, ds.idPrefix)
      )
      .filter(Boolean);

    console.log(`  Converted to ${features.length} GeoJSON features.`);

    const geojson = {
      type: 'FeatureCollection',
      features,
    };

    const outPath = path.join(OUTPUT_DIR, ds.outputFile);
    fs.writeFileSync(outPath, JSON.stringify(geojson, null, 2), 'utf8');
    console.log(`  Written → ${outPath}`);
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
