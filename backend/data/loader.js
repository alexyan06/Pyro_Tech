const fs = require('fs');
const path = require('path');
const { getScenarioState } = require('./scenarioState');

const DATA_DIR = path.join(__dirname, '../../data/geojson');

function loadGeoJSON(filename) {
  const filePath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filePath)) {
    console.warn(`[DataLoader] Missing: ${filename}`);
    return { type: 'FeatureCollection', features: [] };
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Filter a FeatureCollection's Point features to those within (or near) a bbox.
 * Falls back to the first `limit` features if no bbox is provided.
 */
function filterFeatures(collection, bbox, limit = 300) {
  if (!collection?.features?.length) return collection;
  if (bbox && bbox.length === 4) {
    const [west, south, east, north] = bbox;
    const buf = 0.5; // ~55km buffer around bbox
    const filtered = collection.features.filter(f => {
      const coords = f.geometry?.coordinates;
      if (!coords) return false;
      const lng = coords[0], lat = coords[1];
      return lng >= west - buf && lng <= east + buf && lat >= south - buf && lat <= north + buf;
    });
    return { ...collection, features: filtered.slice(0, limit) };
  }
  return { ...collection, features: collection.features.slice(0, limit) };
}

/**
 * Convert raw GeoJSON FeatureCollections into the flat lookup maps
 * expected by the simulation engine.
 */
function buildLookups({ evacuationZones, shelters, hospitals, fireStations, evacuationRoutes, populationTracts }) {
  const zones = {};
  if (evacuationZones && evacuationZones.features) {
    evacuationZones.features.forEach(f => {
      const zoneId = f.properties.zone_id || f.properties.id;
      if (!zoneId) return;
      zones[zoneId] = {
        ...f.properties,
        geometry: f.geometry,
        status: 'clear',
      };
    });
  }

  const shelterMap = {};
  if (shelters && shelters.features) {
    shelters.features.forEach(f => {
      const shelterId = f.properties.shelter_id || f.properties.id;
      if (!shelterId) return;
      shelterMap[shelterId] = {
        ...f.properties,
        location: { lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] },
      };
    });
  }

  const infrastructure = {};
  const infraSources = [
    ...(hospitals?.features || []),
    ...(fireStations?.features || []),
  ];

  infraSources.forEach(f => {
    const id = f.properties.id;
    if (!id) return;
    infrastructure[id] = {
      ...f.properties,
      geometry: f.geometry,
      location: { lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] },
    };
  });

  // Highways only. TIGER S1100 → motorway (Interstate), S1200 → primary
  // (state/US hwy); S1400 is local streets and maps to `secondary`, which we
  // drop. This matches the user's explicit "only show highways" requirement.
  const HIGHWAY_WHITELIST = new Set(['motorway', 'trunk', 'primary']);
  const routes = {};
  if (evacuationRoutes && evacuationRoutes.features) {
    evacuationRoutes.features.forEach(f => {
      const id = f.properties.route_id || f.properties.id;
      if (!id) return;
      const hwy = f.properties.highway;
      if (hwy && !HIGHWAY_WHITELIST.has(hwy)) return;
      routes[id] = { ...f.properties, geometry: f.geometry };
    });
  }
  console.log(`[DataLoader] Routes retained after highway filter: ${Object.keys(routes).length}`);

  const populationTractList = (populationTracts?.features || []).map(f => ({
    ...f.properties,
    lng: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
  }));

  return { zones, shelters: shelterMap, infrastructure, routes, populationTracts: populationTractList };
}

/**
 * Load all simulation data.
 *
 * Priority:
 *  1. Dynamic data from an active scenario (fetched via /api/setup-scenario)
 *  2. Static GeoJSON files on disk (Nationwide fallback for hospitals/fire/shelters)
 */
function loadAllData() {
  const state = getScenarioState();
  // Scenario bbox is stored as [south, west, north, east]; convert to [west, south, east, north]
  let bbox = null;
  if (state?.bbox && state.bbox.length === 4) {
    const [s, w, n, e] = state.bbox;
    bbox = [w, s, e, n];
  }

  // 1. Static GeoJSON files as nationwide fallbacks — filter to scenario bbox
  let shelters    = filterFeatures(loadGeoJSON('shelters.geojson'),     bbox, 150);
  let hospitals   = filterFeatures(loadGeoJSON('hospitals.geojson'),    bbox, 100);
  let fireStations = filterFeatures(loadGeoJSON('fire_stations.geojson'), bbox, 100);

  // These are now purely dynamic or provided by scenario
  let evacuationZones = { type: 'FeatureCollection', features: [] };
  let evacuationRoutes = { type: 'FeatureCollection', features: [] };

  // Population is still local but should be fetched per-scenario
  let populationTracts = loadGeoJSON('population_tracts.geojson');

  if (state && state.geojson) {
    console.log(`[DataLoader] Using dynamic OSM data for "${state.displayName ?? state.city}"`);
    
    // Override with dynamic data if available in scenario state
    if (state.geojson.evacuationZones?.features?.length > 0) {
      evacuationZones = state.geojson.evacuationZones;
    }
    
    // Merge dynamic data into the nationwide fallbacks to give the backend maximum visibility
    if (state.geojson.shelters?.features?.length > 0) {
      shelters.features.push(...state.geojson.shelters.features);
    }
    if (state.geojson.hospitals?.features?.length > 0) {
      hospitals.features.push(...state.geojson.hospitals.features);
    }
    if (state.geojson.fireStations?.features?.length > 0) {
      fireStations.features.push(...state.geojson.fireStations.features);
    }
    
    evacuationRoutes = state.geojson.routes ?? { type: 'FeatureCollection', features: [] };
    
    // Use dynamically fetched population tracts when available
    if (state.populationTracts && state.populationTracts.features?.length > 0) {
      populationTracts = state.populationTracts;
    }
  } else {
    console.log('[DataLoader] No active scenario — using static nationwide infrastructure fallback');
  }

  return buildLookups({
    evacuationZones,
    shelters,
    hospitals,
    fireStations,
    evacuationRoutes,
    populationTracts,
  });
}

module.exports = { loadAllData };
