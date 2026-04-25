/**
 * tigerRoutesFetcher.js
 *
 * Fetches US road geometry from the Census TIGER/Line Transportation API.
 * No API key required, no rate limits — same infrastructure as populationFetcher.
 *
 * Queries three layers in parallel to ensure a dense, highly accurate road network:
 *   Layer 2 — Primary Roads   (S1100: Interstates)        — up to 2000
 *   Layer 3 — Secondary Roads (S1200: state/US highways)  — up to 2000
 *   Layer 8 — Local Roads     (S1400: arterials, streets) — up to 4000
 *
 * Returns a GeoJSON FeatureCollection matching the shape produced by
 * overpassFetcher's wayToRouteFeature, so the rest of the pipeline is unchanged.
 *
 * @param {[number, number, number, number]} bbox  [south, west, north, east]
 */

const BASE_URL = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Transportation/MapServer';

const MTFCC_HIGHWAY  = { S1100: 'motorway', S1200: 'primary', S1400: 'secondary' };
const MTFCC_CAPACITY = { S1100: 4800,       S1200: 2400,      S1400: 1200 };
const MTFCC_PRIORITY = { S1100: 'primary',  S1200: 'secondary', S1400: 'tertiary' };

async function fetchTIGERLayer(layerId, geometry, limit) {
  const url = new URL(`${BASE_URL}/${layerId}/query`);
  // For local roads (Layer 8), filter out minor trails/alleys to focus on drivable arterials
  if (layerId === 8) {
    url.searchParams.set('where', "MTFCC IN ('S1200', 'S1400')");
  } else {
    url.searchParams.set('where', '1=1');
  }
  url.searchParams.set('geometry', geometry);
  url.searchParams.set('geometryType', 'esriGeometryEnvelope');
  url.searchParams.set('inSR', '4326');
  url.searchParams.set('outSR', '4326');
  url.searchParams.set('spatialRel', 'esriSpatialRelIntersects');
  url.searchParams.set('outFields', 'NAME,MTFCC,RTTYP');
  url.searchParams.set('f', 'geojson');
  url.searchParams.set('returnGeometry', 'true');
  url.searchParams.set('resultRecordCount', String(limit));

  const res = await fetch(url.toString(), {
    headers: { 'User-Agent': 'Ember-WildfireSim/2.0 (LAHacks 2026)' },
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) throw new Error(`TIGER layer ${layerId} HTTP ${res.status}`);
  return res.json();
}

function tigerFeatureToRoute(feature, index) {
  const geom = feature.geometry;
  if (!geom || geom.type !== 'LineString' || geom.coordinates.length < 2) return null;

  const props  = feature.properties || {};
  const mtfcc  = props.MTFCC || 'S1400';
  const name   = props.NAME  || `Road ${index + 1}`;

  return {
    type: 'Feature',
    geometry: geom,
    properties: {
      route_id:     `R${String(index + 1).padStart(4, '0')}`,
      name,
      highway:      MTFCC_HIGHWAY[mtfcc]  || 'secondary',
      status:       'open',
      capacity_vph: MTFCC_CAPACITY[mtfcc] || 1200,
      direction:    'evacuation_out',
      priority:     MTFCC_PRIORITY[mtfcc] || 'tertiary',
      mtfcc,
    },
  };
}

async function fetchRoutes(bbox) {
  const [s, w, n, e] = bbox;
  const geometry = `${w},${s},${e},${n}`;

  console.log('[TIGER] Fetching comprehensive road network (layers 2, 3, 8)…');

  const [primary, secondary, local] = await Promise.all([
    fetchTIGERLayer(2, geometry, 2000).catch(err => {
      console.warn('[TIGER] Layer 2 (primary) failed:', err.message);
      return { features: [] };
    }),
    fetchTIGERLayer(3, geometry, 2000).catch(err => {
      console.warn('[TIGER] Layer 3 (secondary) failed:', err.message);
      return { features: [] };
    }),
    fetchTIGERLayer(8, geometry, 4000).catch(err => {
      console.warn('[TIGER] Layer 8 (local) failed:', err.message);
      return { features: [] };
    }),
  ]);

  const all = [
    ...(primary.features   || []),
    ...(secondary.features || []),
    ...(local.features     || []),
  ];

  const features = all.map((f, i) => tigerFeatureToRoute(f, i)).filter(Boolean);
  console.log(`[TIGER] Roads: ${(primary.features || []).length} primary + ${(secondary.features || []).length} secondary + ${(local.features || []).length} local = ${features.length} total segments mapped.`);

  return { type: 'FeatureCollection', features };
}

module.exports = { fetchRoutes };
