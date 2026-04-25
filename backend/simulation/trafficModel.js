const turf = require('@turf/turf');
const { buildRoadGraph, shortestPath } = require('./roadGraph');

/**
 * Dynamic traffic congestion model for evacuation routes.
 * 
 * Capacity is now modified by spatial proximity to the fire perimeter.
 * Routes intersecting the fire are automatically marked 'closed'.
 */

function pathDistanceKm(path) {
  if (!Array.isArray(path) || path.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += turf.distance(turf.point(path[i - 1]), turf.point(path[i]), {
      units: 'kilometers',
    });
  }
  return total;
}

function dedupeConsecutiveCoords(path) {
  const deduped = [];
  for (const coord of path || []) {
    const prev = deduped[deduped.length - 1];
    if (!prev || prev[0] !== coord[0] || prev[1] !== coord[1]) {
      deduped.push(coord);
    }
  }
  return deduped;
}

function buildDirectPath(zone, shelter) {
  if (!zone || !shelter?.location) return null;
  const from = [zone.centroid_lng, zone.centroid_lat];
  const to = [shelter.location.lng, shelter.location.lat];
  if (!Number.isFinite(from[0]) || !Number.isFinite(from[1]) || !Number.isFinite(to[0]) || !Number.isFinite(to[1])) {
    return null;
  }
  const mid = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
  return [from, mid, to];
}

function scoreRouteVariant(zonePoint, shelterPoint, variant, capacity) {
  return (
    turf.distance(zonePoint, turf.point(variant.entry), { units: 'kilometers' }) +
    turf.distance(shelterPoint, turf.point(variant.exit), { units: 'kilometers' }) +
    pathDistanceKm(variant.path) * 0.35 -
    Math.min(capacity, 5000) / 2500
  );
}

function planEvacuationRoutes(flow, baseRoutes, zonePolygons, shelterBaseData, closedRoutes = new Set()) {
  const zone = zonePolygons?.[flow.from_zone];
  const shelter = shelterBaseData?.[flow.to_shelter];
  const directPath = buildDirectPath(zone, shelter);
  const routeEntries = Object.values(baseRoutes || {}).filter(
    (route) => !closedRoutes.has(route.route_id) && route.geometry?.coordinates?.length >= 2,
  );

  if (!zone || !shelter || routeEntries.length === 0) {
    return directPath
      ? [{
          route_id: null,
          path: directPath,
          distance_km: pathDistanceKm(directPath),
          capacity_vph: 900,
          score: pathDistanceKm(directPath),
          share: 1,
        }]
      : [];
  }

  const zonePoint = turf.point([zone.centroid_lng, zone.centroid_lat]);
  const shelterPoint = turf.point([shelter.location.lng, shelter.location.lat]);

  const candidates = [];
  for (const route of routeEntries) {
    const coords = route.geometry.coordinates;
    const start = coords[0];
    const end = coords[coords.length - 1];
    const capacity = Number(route.capacity_vph) || 2400;
    const variants = [
      { entry: start, exit: end, path: [start, ...coords, end] },
      { entry: end, exit: start, path: [end, ...coords.slice().reverse(), start] },
    ];

    for (const variant of variants) {
      const score = scoreRouteVariant(zonePoint, shelterPoint, variant, capacity);
      const path = dedupeConsecutiveCoords([
        [zone.centroid_lng, zone.centroid_lat],
        ...variant.path,
        [shelter.location.lng, shelter.location.lat],
      ]);
      candidates.push({
        route_id: route.route_id,
        path,
        distance_km: pathDistanceKm(path),
        capacity_vph: capacity,
        score,
      });
    }
  }

  if (candidates.length === 0 && directPath) {
    return [{
      route_id: null,
      path: directPath,
      distance_km: pathDistanceKm(directPath),
      capacity_vph: 900,
      score: pathDistanceKm(directPath),
      share: 1,
    }];
  }

  const ranked = candidates.sort((a, b) => a.score - b.score);
  const cutoff = ranked[0] ? ranked[0].score * 1.35 : Infinity;
  const top = ranked
    .filter((candidate) => candidate.score <= cutoff)
    .slice(0, 2);

  const totalWeight = top.reduce(
    (sum, candidate) => sum + (candidate.capacity_vph / Math.max(candidate.score, 1)),
    0,
  ) || 1;

  return top.map((candidate) => ({
    ...candidate,
    share: (candidate.capacity_vph / Math.max(candidate.score, 1)) / totalWeight,
  }));
}

function planEvacuationRoute(flow, baseRoutes, zonePolygons, shelterBaseData, closedRoutes = new Set()) {
  const [primary] = planEvacuationRoutes(flow, baseRoutes, zonePolygons, shelterBaseData, closedRoutes);
  return primary || { route_id: null, path: [], distance_km: 0, share: 1 };
}

function getPerimeterFeature(firePerimeter) {
  return firePerimeter?.features?.[0] || null;
}

function distanceToPerimeterKm(perimFeature, routeLine) {
  const coords = perimFeature?.geometry?.coordinates?.[0];
  if (!coords?.length) return Infinity;

  let minDistance = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const distance = turf.pointToLineDistance(turf.point(coords[i]), routeLine, {
      units: 'kilometers',
    });
    if (distance < minDistance) minDistance = distance;
  }
  return minDistance;
}

function classifyRouteHazards(baseRoutes, firePerimeter, manuallyClosedRoutes = new Set()) {
  const perimFeature = getPerimeterFeature(firePerimeter);
  return Object.values(baseRoutes || {}).map((route) => {
    let capacityMultiplier = 1;
    let closureReason = manuallyClosedRoutes.has(route.route_id) ? 'manual' : null;
    let distance_to_fire_km = Infinity;

    if (perimFeature && route.geometry) {
      try {
        if (turf.booleanIntersects(perimFeature, route.geometry)) {
          closureReason = 'fire_intersection';
        } else {
          distance_to_fire_km = distanceToPerimeterKm(perimFeature, route.geometry);
          if (distance_to_fire_km < 0.5) {
            capacityMultiplier = 0.2;
          } else if (distance_to_fire_km < 1.5) {
            capacityMultiplier = 0.6;
          }
        }
      } catch (_) {
        // Invalid geometry should not break the simulation loop.
      }
    }

    return {
      route,
      route_id: route.route_id,
      is_closed: Boolean(closureReason),
      closure_reason: closureReason,
      distance_to_fire_km,
      capacity_multiplier: capacityMultiplier,
    };
  });
}

function fireClosedRouteIds(baseRoutes, firePerimeter) {
  return classifyRouteHazards(baseRoutes, firePerimeter)
    .filter((hazard) => hazard.closure_reason === 'fire_intersection')
    .map((hazard) => hazard.route_id);
}

/**
 * @param {object} evacuationState  - stateManager.state.evacuation
 * @param {object} baseRoutes       - stateManager.state.baseData.routes
 * @param {object} [firePerimeter]  - stateManager.state.fire.perimeter_geojson
 * @param {object} [baseZones]      - stateManager.state.baseData.zones
 * @returns {Array<{route_id: string, status: 'open'|'congested'|'closed', load_pct: number}>}
 */
function computeCongestion(evacuationState, baseRoutes, firePerimeter, baseZones = {}) {
  const { flows = [], closed_routes = [], total_evacuees = 0, in_transit_evacuees = 0 } = evacuationState;
  const results = [];

  // Distribute vehicles across open routes weighted by dynamic capacity
  const manualClosures = new Set(closed_routes || []);
  const processedRoutes = classifyRouteHazards(baseRoutes, firePerimeter, manualClosures).map((hazard) => {
    const capacity = Number(hazard.route.capacity_vph) || 2400;
    return {
      ...hazard.route,
      dynamicCapacity: Math.max(1, capacity * hazard.capacity_multiplier),
      isPhysicallyClosed: hazard.is_closed,
      closure_reason: hazard.closure_reason,
      capacity_multiplier: hazard.capacity_multiplier,
    };
  });

  const openRoutes = processedRoutes.filter(r => !r.isPhysicallyClosed);
  const routeDemand = new Map();
  for (const flow of flows) {
    const vehiclesInTransit = Math.max(
      0,
      ((Number(flow.departed) || 0) - (Number(flow.arrived) || 0)) / 2.5,
    );
    const routeOptions = Array.isArray(flow.route_options) && flow.route_options.length > 0
      ? flow.route_options
      : flow.route_id
        ? [{ route_id: flow.route_id, share: 1 }]
        : [];
    for (const option of routeOptions) {
      if (!option?.route_id) continue;
      const share = Math.max(0, Number(option.share) || 0);
      routeDemand.set(
        option.route_id,
        (routeDemand.get(option.route_id) || 0) + (vehiclesInTransit * share),
      );
    }
  }

  if (routeDemand.size === 0 && openRoutes.length > 0 && (in_transit_evacuees > 0 || total_evacuees > 0)) {
    const totalVehicles = Math.max(in_transit_evacuees, total_evacuees) / 2.5;
    const totalCapacity = openRoutes.reduce((sum, r) => sum + r.dynamicCapacity, 0);
    for (const route of openRoutes) {
      routeDemand.set(
        route.route_id,
        totalCapacity > 0 ? (totalVehicles * route.dynamicCapacity) / totalCapacity : 0,
      );
    }
  }

  if (openRoutes.length === 0) {
    // If all routes are closed, all return closed
    return processedRoutes.map(r => ({ route_id: r.route_id, status: 'closed', load_pct: 100 }));
  }

  for (const route of processedRoutes) {
    if (route.isPhysicallyClosed) {
      results.push({
        route_id: route.route_id,
        status: 'closed',
        load_pct: 100,
        reason: route.closure_reason || 'closed',
      });
      continue;
    }

    const loadVph = routeDemand.get(route.route_id) || 0;
    const loadPct = Math.min(200, Math.round((loadVph / route.dynamicCapacity) * 100));

    let status = 'open';
    if (loadPct >= 90) status = 'congested';

    results.push({
      route_id: route.route_id,
      status,
      load_pct: loadPct,
      capacity_multiplier: route.capacity_multiplier,
    });
  }

  return results;
}

/**
 * Generate trip waypoints for the TripsLayer.
 * (Logic remains similar but can be further refined for flow over time)
 */
function generateTripWaypoints(evacuationState, baseRoutes, zonePolygons, shelterBaseData, currentTick = 1) {
  const { flows = [], closed_routes = [] } = evacuationState;
  const LOOP_LENGTH        = 1800;
  const graph = buildRoadGraph(baseRoutes || {});
  const routeCongestion = Object.fromEntries(
    (evacuationState.route_congestion || []).map((route) => [route.route_id, route]),
  );

  const trips = [];
  for (const flow of flows) {
    const { from_zone, to_shelter } = flow;
    const population = Math.max(0, (Number(flow.departed) || 0) - (Number(flow.arrived) || 0));
    if (!from_zone || !to_shelter || !population) continue;

    const zone = zonePolygons?.[from_zone];
    if (!zone) continue;

    const zoneLng = zone.centroid_lng;
    const zoneLat = zone.centroid_lat;
    if (zoneLng == null || zoneLat == null) continue;

    const shelter = shelterBaseData?.[to_shelter];
    const shelterLng = shelter?.location?.lng;
    const shelterLat = shelter?.location?.lat;
    if (shelterLng == null || shelterLat == null) continue;

    const coords = shortestPath(graph, [zoneLng, zoneLat], [shelterLng, shelterLat], {
      closedRoutes: new Set(closed_routes || []),
      routeCongestion,
    })?.path || buildDirectPath(zone, shelter);
    if (!coords?.length) continue;

    const distances = [0];
    for (let i = 1; i < coords.length; i++) {
      const dx = coords[i][0] - coords[i - 1][0];
      const dy = coords[i][1] - coords[i - 1][1];
      distances.push(distances[i - 1] + Math.sqrt(dx * dx + dy * dy));
    }
    const totalDist = distances[distances.length - 1];
    if (totalDist === 0) continue;

    const baseVehicleCount = Math.min(30, Math.max(4, Math.round(population / 400)));
    const vehicleCount = baseVehicleCount * 3; // Increase cars to make it look like traffic
    const tripDuration = Math.max(220, Math.min(LOOP_LENGTH * 0.9, totalDist * 140));
    // Tighten the dispatch window so cars spawn closer together in a continuous stream
    const window = Math.min(LOOP_LENGTH - tripDuration, tripDuration * 1.5);

    for (let v = 0; v < vehicleCount; v++) {
      const phase = window > 0 ? (v / vehicleCount) * window : 0;
      const timestamps = distances.map(d => phase + (d / totalDist) * tripDuration);
      const path = coords.map(c => [c[0], c[1]]);
      trips.push({ path, timestamps, population, from_zone, to_shelter, particle_type: 'vehicle', one_way: true });
    }
  }

  return trips;
}

module.exports = {
  computeCongestion,
  generateTripWaypoints,
  planEvacuationRoute,
  planEvacuationRoutes,
  pathDistanceKm,
  classifyRouteHazards,
  fireClosedRouteIds,
};
