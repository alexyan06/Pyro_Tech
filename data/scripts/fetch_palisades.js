#!/usr/bin/env node
/**
 * fetch_palisades.js
 *
 * Documents and attempts to fetch historical fire perimeter data for the
 * January 2025 Palisades Fire from authoritative government sources.
 *
 * Sources attempted (in order):
 *   1. NIFC ArcGIS / GeoMAC Active Fires FeatureServer
 *      https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/Active_Fires/FeatureServer/0/query
 *   2. CAL FIRE FRAP Fire Perimeters dataset
 *      https://gis.data.ca.gov/datasets/CALFIRE-Forestry::fire-perimeters
 *   3. USGS GeoMAC outgoing archive
 *      https://rmgsc.cr.usgs.gov/outgoing/GeoMAC/
 *
 * The Palisades Fire ignited on January 7, 2025 near Pacific Palisades, CA
 * (approx 34.04°N, -118.52°W) and ultimately burned ~23,448 acres.
 *
 * If all live fetches fail the script falls back to the pre-built hand-crafted
 * GeoJSON at ../geojson/palisades_perimeter_historical.geojson which was
 * constructed from public incident reports and news coverage.
 *
 * Usage:
 *   node fetch_palisades.js
 *   node fetch_palisades.js --out ../geojson/palisades_perimeter_historical.geojson
 */

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const FIRE_NAME   = 'Palisades';
const OUTPUT_PATH = path.resolve(
  __dirname,
  '../geojson/palisades_perimeter_historical.geojson'
);

// NIFC ArcGIS FeatureServer – historical/archived perimeters layer
const NIFC_PERIMETERS_URL =
  'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/' +
  'Active_Fires/FeatureServer/0/query?' +
  'where=IncidentName+LIKE+%27%25PALISADES%25%27' +
  '&outFields=*&f=geojson&resultRecordCount=100';

// CAL FIRE FRAP – GeoJSON export (large; filtered via bbox + name)
const CALFIRE_URL =
  'https://gis.data.ca.gov/api/explore/v2.1/catalog/datasets/' +
  'fire-perimeters/exports/geojson?' +
  'where=FIRE_NAME%20LIKE%20%27%25PALISADES%25%27' +
  '&timezone=UTC&limit=50';

// USGS GeoMAC archive directory (informational – no direct GeoJSON endpoint)
const GEOMAC_ARCHIVE = 'https://rmgsc.cr.usgs.gov/outgoing/GeoMAC/2025_fire_data/';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { timeout: 15000 }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error(`JSON parse error from ${url}: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
  });
}

function hasFeatures(geojson) {
  return (
    geojson &&
    geojson.type === 'FeatureCollection' &&
    Array.isArray(geojson.features) &&
    geojson.features.length > 0
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`Fetching historical Palisades Fire perimeters…`);
  console.log(`Output: ${OUTPUT_PATH}\n`);

  // 1. Try NIFC ArcGIS
  try {
    console.log('Trying NIFC ArcGIS FeatureServer…');
    const data = await fetchUrl(NIFC_PERIMETERS_URL);
    if (hasFeatures(data)) {
      console.log(`  -> Got ${data.features.length} feature(s) from NIFC.`);
      fs.writeFileSync(OUTPUT_PATH, JSON.stringify(data, null, 2));
      console.log('Saved to', OUTPUT_PATH);
      return;
    }
    console.log('  -> No matching features returned.');
  } catch (e) {
    console.warn('  -> NIFC fetch failed:', e.message);
  }

  // 2. Try CAL FIRE FRAP
  try {
    console.log('Trying CAL FIRE FRAP dataset…');
    const data = await fetchUrl(CALFIRE_URL);
    if (hasFeatures(data)) {
      console.log(`  -> Got ${data.features.length} feature(s) from CAL FIRE.`);
      fs.writeFileSync(OUTPUT_PATH, JSON.stringify(data, null, 2));
      console.log('Saved to', OUTPUT_PATH);
      return;
    }
    console.log('  -> No matching features returned.');
  } catch (e) {
    console.warn('  -> CAL FIRE fetch failed:', e.message);
  }

  // 3. USGS GeoMAC – archive is a directory listing, not a direct API;
  //    document the URL but skip automated download.
  console.log(`USGS GeoMAC archive (manual download): ${GEOMAC_ARCHIVE}`);
  console.log('  -> Automated fetch not supported for directory-style archive.');

  // 4. Fall back to pre-built hand-crafted GeoJSON
  console.log('\nAll live sources unavailable. Using hand-crafted fallback GeoJSON.');
  const fallback = require('./palisades_fallback') || null;
  if (!fallback) {
    console.error(
      'Fallback module not found. ' +
      'The file ../geojson/palisades_perimeter_historical.geojson ' +
      'was pre-generated and committed to the repository.'
    );
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
