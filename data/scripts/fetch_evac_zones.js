#!/usr/bin/env node
/**
 * fetch_evac_zones.js
 *
 * Attempts to fetch LA County / California evacuation zone polygons from
 * public ArcGIS REST endpoints and writes the result to
 *   data/geojson/evacuation_zones.geojson
 *
 * Data source priority:
 *  1. LA County ArcGIS REST — Hazards / Fire Hazard Severity Zones
 *     https://public.gis.lacounty.gov/public/rest/services/LACounty_Dynamic/Hazards/MapServer/2/query
 *  2. Cal OES Active Evacuation Zones (Emergency Notification Areas)
 *     https://services1.arcgis.com/1vIhDJwtG5eNmiqX/arcgis/rest/services/Emergency_Notification_Areas_view/FeatureServer/0/query
 *  3. Static fallback — uses the pre-generated evacuation_zones.geojson already
 *     present in data/geojson/ (produced by the companion Python script).
 *
 * Usage:
 *   node data/scripts/fetch_evac_zones.js
 *
 * Requirements: Node.js ≥ 18 (uses built-in fetch) or install node-fetch.
 */

'use strict';

const https = require('https');
const fs    = require('fs');
const path  = require('path');

// ── Paths ────────────────────────────────────────────────────────────────────
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const OUT_PATH     = path.join(PROJECT_ROOT, 'data', 'geojson', 'evacuation_zones.geojson');

// ── LA County bounding box (WGS84) ───────────────────────────────────────────
const LA_BBOX = {
  xmin: -118.95,
  ymin:  33.70,
  xmax: -117.65,
  ymax:  34.85,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Simple HTTPS GET that returns the full response body as a string.
 * @param {string} url
 * @param {number} [timeoutMs=20000]
 * @returns {Promise<string>}
 */
function httpsGet(url, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.on('error', reject);
  });
}

/**
 * Convert an Esri FeatureSet (JSON) to a GeoJSON FeatureCollection.
 * @param {object} esriJson  - parsed Esri query response
 * @param {string} areaLabel - label to embed in properties.area
 * @returns {{ type: 'FeatureCollection', features: object[] }}
 */
function esriToGeoJSON(esriJson, areaLabel) {
  const features = (esriJson.features || []).map((f, i) => {
    const geom = f.geometry;
    const props = f.attributes || {};

    // Convert Esri polygon rings (already in WGS84 when outSR=4326)
    let geometry = null;
    if (geom && geom.rings) {
      geometry = { type: 'Polygon', coordinates: geom.rings };
    } else if (geom && geom.x != null) {
      geometry = { type: 'Point', coordinates: [geom.x, geom.y] };
    }

    // Compute centroid from first ring
    let centroid_lng = null;
    let centroid_lat = null;
    if (geometry && geometry.type === 'Polygon' && geometry.coordinates[0]) {
      const ring = geometry.coordinates[0];
      let area = 0, cx = 0, cy = 0;
      for (let j = 0; j < ring.length - 1; j++) {
        const [x0, y0] = ring[j];
        const [x1, y1] = ring[j + 1];
        const cross = x0 * y1 - x1 * y0;
        area += cross;
        cx += (x0 + x1) * cross;
        cy += (y0 + y1) * cross;
      }
      area /= 2;
      if (Math.abs(area) > 1e-12) {
        centroid_lng = Math.round((cx / (6 * area)) * 1e6) / 1e6;
        centroid_lat = Math.round((cy / (6 * area)) * 1e6) / 1e6;
      }
    }

    return {
      type: 'Feature',
      geometry,
      properties: {
        zone_id:      props.OBJECTID ? `Z${String(props.OBJECTID).padStart(3, '0')}` : `Z${String(i + 1).padStart(3, '0')}`,
        name:         props.LABEL || props.ZoneName || props.NAME || props.zone_label || `Zone ${i + 1}`,
        area:         areaLabel,
        population:   props.POP2020 || props.POPULATION || null,
        centroid_lng,
        centroid_lat,
        // preserve raw attributes for debugging
        _source_props: props,
      },
    };
  });

  return { type: 'FeatureCollection', features };
}

// ── Data Source 1: LA County Fire Hazard Severity Zones ──────────────────────

async function fetchLACountyHazards() {
  const base = 'https://public.gis.lacounty.gov/public/rest/services/LACounty_Dynamic/Hazards/MapServer/2/query';
  const geomStr = encodeURIComponent(JSON.stringify({
    xmin: LA_BBOX.xmin, ymin: LA_BBOX.ymin,
    xmax: LA_BBOX.xmax, ymax: LA_BBOX.ymax,
    spatialReference: { wkid: 4326 },
  }));
  const url = `${base}?where=1%3D1&outFields=*` +
    `&geometry=${geomStr}` +
    `&geometryType=esriGeometryEnvelope` +
    `&inSR=4326&spatialRel=esriSpatialRelIntersects` +
    `&outSR=4326&f=json&resultRecordCount=2000`;

  console.log('[1] Querying LA County Hazards MapServer …');
  const body = await httpsGet(url);
  const data = JSON.parse(body);

  if (data.error) throw new Error(`ArcGIS error: ${data.error.message}`);
  if (!data.features || data.features.length === 0) throw new Error('No features returned from LA County Hazards');

  console.log(`    → ${data.features.length} features received.`);
  return esriToGeoJSON(data, 'LA County Hazard Zone');
}

// ── Data Source 2: Cal OES Emergency Notification Areas ──────────────────────

async function fetchCalOESEvacZones() {
  const base = 'https://services1.arcgis.com/1vIhDJwtG5eNmiqX/arcgis/rest/services/Emergency_Notification_Areas_view/FeatureServer/0/query';
  const geomStr = encodeURIComponent(JSON.stringify({
    xmin: LA_BBOX.xmin, ymin: LA_BBOX.ymin,
    xmax: LA_BBOX.xmax, ymax: LA_BBOX.ymax,
    spatialReference: { wkid: 4326 },
  }));
  const url = `${base}?where=1%3D1&outFields=*` +
    `&geometry=${geomStr}` +
    `&geometryType=esriGeometryEnvelope` +
    `&inSR=4326&spatialRel=esriSpatialRelIntersects` +
    `&outSR=4326&f=json&resultRecordCount=2000`;

  console.log('[2] Querying Cal OES Emergency Notification Areas …');
  const body = await httpsGet(url);
  const data = JSON.parse(body);

  if (data.error) throw new Error(`ArcGIS error: ${data.error.message}`);
  if (!data.features || data.features.length === 0) throw new Error('No features returned from Cal OES');

  console.log(`    → ${data.features.length} features received.`);
  return esriToGeoJSON(data, 'Cal OES Evacuation Zone');
}

// ── Data Source 3: Static fallback ───────────────────────────────────────────

function loadStaticFallback() {
  console.log('[3] Using static fallback GeoJSON already present at:');
  console.log(`    ${OUT_PATH}`);
  if (!fs.existsSync(OUT_PATH)) {
    throw new Error(`Static fallback file not found: ${OUT_PATH}`);
  }
  return JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'));
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== fetch_evac_zones.js ===');
  console.log(`Output: ${OUT_PATH}\n`);

  // Ensure output directory exists
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });

  let geojson = null;
  let sourceLabel = '';

  // Try source 1
  try {
    geojson = await fetchLACountyHazards();
    sourceLabel = 'LA County ArcGIS (Fire Hazard Severity Zones)';
  } catch (err) {
    console.warn(`    Source 1 failed: ${err.message}`);
  }

  // Try source 2
  if (!geojson || geojson.features.length === 0) {
    try {
      geojson = await fetchCalOESEvacZones();
      sourceLabel = 'Cal OES Emergency Notification Areas';
    } catch (err) {
      console.warn(`    Source 2 failed: ${err.message}`);
    }
  }

  // Fallback
  if (!geojson || geojson.features.length === 0) {
    geojson = loadStaticFallback();
    sourceLabel = 'Static curated fallback';
  }

  // Annotate
  geojson.metadata = {
    ...(geojson.metadata || {}),
    source:    sourceLabel,
    generated: new Date().toISOString(),
    total_zones: geojson.features.length,
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(geojson, null, 2), 'utf8');

  console.log(`\nDone. ${geojson.features.length} zones written.`);
  console.log(`Source: ${sourceLabel}`);
  console.log(`File:   ${OUT_PATH}`);
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
